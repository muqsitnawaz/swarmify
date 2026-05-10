import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as vscode from 'vscode';
import { getAllTerminals } from '../vscode/terminals.vscode';

const SOCKET_PATH = path.join(os.homedir(), '.agents', '.tmp', 'watchdog.sock');
const WATCHDOG_LOG = path.join(os.homedir(), '.agents', 'watchdog.log');

export interface WatchdogBridge {
  mcpServerPath: string;
  dispose(): void;
}

interface SendNudgeRequest {
  sessionId: string;
  text: string;
  reason: string;
}

interface SendNudgeResponse {
  success: boolean;
  error?: string;
  nudgedAt?: number;
  terminalId?: string;
}

async function ensureSocketDir(): Promise<void> {
  const dir = path.dirname(SOCKET_PATH);
  await fs.mkdir(dir, { recursive: true });
}

async function cleanupSocket(): Promise<void> {
  try {
    await fs.unlink(SOCKET_PATH);
  } catch {
    // Socket doesn't exist, that's fine
  }
}

async function logNudge(entry: {
  sessionId: string;
  terminalId: string;
  agentType: string | undefined;
  text: string;
  reason: string;
}): Promise<void> {
  const logEntry = {
    ts: Date.now(),
    ...entry,
  };
  try {
    await fs.mkdir(path.dirname(WATCHDOG_LOG), { recursive: true });
    await fs.appendFile(WATCHDOG_LOG, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.warn('[WATCHDOG] Failed to log nudge:', err);
  }
}

async function handleSendNudge(
  request: SendNudgeRequest
): Promise<SendNudgeResponse> {
  const { sessionId, text, reason } = request;

  // Find terminal by sessionId
  const terminals = getAllTerminals();
  const entry = terminals.find((t) => t.sessionId === sessionId);

  if (!entry) {
    // Try partial match (sessionId might be truncated)
    const partialMatch = terminals.find((t) =>
      t.sessionId?.startsWith(sessionId) || sessionId.startsWith(t.sessionId || '')
    );
    if (!partialMatch) {
      return {
        success: false,
        error: `No terminal found for session ${sessionId}. Active sessions: ${terminals.map((t) => t.sessionId).filter(Boolean).join(', ')}`,
      };
    }
  }

  const terminal = entry || terminals.find((t) =>
    t.sessionId?.startsWith(sessionId) || sessionId.startsWith(t.sessionId || '')
  );

  if (!terminal) {
    return { success: false, error: 'Terminal lookup failed' };
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return { success: false, error: 'Text cannot be empty' };
  }

  if (trimmedText.length > 200) {
    return { success: false, error: 'Text must be under 200 characters' };
  }

  try {
    // Use \r for Claude's Ink TUI, \n for others
    if (terminal.agentType === 'claude') {
      terminal.terminal.sendText(trimmedText, false);
      terminal.terminal.sendText('\r', false);
    } else {
      terminal.terminal.sendText(trimmedText, true);
    }

    await logNudge({
      sessionId,
      terminalId: terminal.id,
      agentType: terminal.agentType,
      text: trimmedText,
      reason,
    });

    console.log(
      `[WATCHDOG] Nudged ${terminal.id} (${terminal.agentType}): "${trimmedText}" — ${reason}`
    );

    return {
      success: true,
      nudgedAt: Date.now(),
      terminalId: terminal.id,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to send text: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function startWatchdogBridge(
  context: vscode.ExtensionContext
): WatchdogBridge {
  const mcpServerPath = path.join(
    context.extensionPath,
    'dist',
    'mcp',
    'watchdog-server.js'
  );

  let server: net.Server | null = null;

  const startServer = async () => {
    await ensureSocketDir();
    await cleanupSocket();

    server = net.createServer((socket) => {
      let data = '';

      socket.on('data', (chunk) => {
        data += chunk.toString();
      });

      socket.on('end', async () => {
        try {
          const request = JSON.parse(data) as SendNudgeRequest;
          const result = await handleSendNudge(request);
          socket.write(JSON.stringify(result));
        } catch (err) {
          socket.write(
            JSON.stringify({
              success: false,
              error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
            })
          );
        }
        socket.end();
      });

      socket.on('error', (err) => {
        console.error('[WATCHDOG] Socket error:', err);
      });
    });

    server.listen(SOCKET_PATH, () => {
      console.log(`[WATCHDOG] Bridge listening on ${SOCKET_PATH}`);
    });

    server.on('error', (err) => {
      console.error('[WATCHDOG] Server error:', err);
    });
  };

  startServer().catch((err) => {
    console.error('[WATCHDOG] Failed to start bridge:', err);
  });

  return {
    mcpServerPath,
    dispose() {
      if (server) {
        server.close();
        server = null;
      }
      cleanupSocket().catch(() => {});
      console.log('[WATCHDOG] Bridge disposed');
    },
  };
}
