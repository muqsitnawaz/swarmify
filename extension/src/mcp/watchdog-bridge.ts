import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as vscode from 'vscode';
import { getAllTerminals } from '../vscode/terminals.vscode';

const SOCKET_PATH = path.join(os.homedir(), '.agents', '.tmp', 'watchdog.sock');
const WATCHDOG_LOG = path.join(os.homedir(), '.agents', 'watchdog.log');
const PEER_MESSAGES_LOG = path.join(os.homedir(), '.agents', 'peer-messages.log');

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

interface SendToAgentRequest {
  kind: 'peer';
  senderSessionId: string;
  targetSessionId: string;
  text: string;
}

interface SendToAgentResponse {
  success: boolean;
  error?: string;
  sentAt?: number;
  recipientTerminalId?: string;
}

type ExtensionRequest = SendNudgeRequest | SendToAgentRequest;

function isPeerRequest(req: ExtensionRequest): req is SendToAgentRequest {
  return (req as SendToAgentRequest).kind === 'peer';
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

async function logPeerMessage(entry: {
  senderSessionId: string;
  targetSessionId: string;
  recipientTerminalId: string;
  recipientAgentType: string | undefined;
  text: string;
}): Promise<void> {
  const logEntry = {
    ts: Date.now(),
    ...entry,
  };
  try {
    await fs.mkdir(path.dirname(PEER_MESSAGES_LOG), { recursive: true });
    await fs.appendFile(PEER_MESSAGES_LOG, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.warn('[PEER-MSG] Failed to log message:', err);
  }
}

async function handleSendToAgent(
  request: SendToAgentRequest
): Promise<SendToAgentResponse> {
  const { senderSessionId, targetSessionId, text } = request;

  const trimmedText = text.trim();
  if (!trimmedText) {
    return { success: false, error: 'Text cannot be empty' };
  }
  if (trimmedText.length > 2000) {
    return { success: false, error: 'Text must be under 2000 characters' };
  }

  // Self-send guard. Only enforced when sender identified itself —
  // smart-watchdog one-shots have no AGENT_SESSION_ID and that's fine.
  if (senderSessionId && senderSessionId === targetSessionId) {
    return { success: false, error: 'Cannot send a message to your own session' };
  }

  const terminals = getAllTerminals();
  const exact = terminals.find((t) => t.sessionId === targetSessionId);
  const recipient =
    exact ||
    terminals.find(
      (t) =>
        (t.sessionId && t.sessionId.startsWith(targetSessionId)) ||
        (t.sessionId && targetSessionId.startsWith(t.sessionId))
    );

  if (!recipient) {
    const active = terminals.map((t) => t.sessionId).filter(Boolean).join(', ');
    return {
      success: false,
      error: `No terminal found for session ${targetSessionId}. Active sessions: ${active}`,
    };
  }

  if (senderSessionId && recipient.sessionId === senderSessionId) {
    return { success: false, error: 'Cannot send a message to your own session' };
  }

  try {
    // Claude's Ink TUI needs an explicit carriage return; other agents take \n.
    // Same convention as handleSendNudge.
    if (recipient.agentType === 'claude') {
      recipient.terminal.sendText(trimmedText, false);
      recipient.terminal.sendText('\r', false);
    } else {
      recipient.terminal.sendText(trimmedText, true);
    }

    await logPeerMessage({
      senderSessionId: senderSessionId || 'unknown',
      targetSessionId,
      recipientTerminalId: recipient.id,
      recipientAgentType: recipient.agentType,
      text: trimmedText,
    });

    console.log(
      `[PEER-MSG] ${senderSessionId || 'unknown'} -> ${recipient.id} (${recipient.agentType}): "${trimmedText.slice(0, 80)}${trimmedText.length > 80 ? '…' : ''}"`
    );

    return {
      success: true,
      sentAt: Date.now(),
      recipientTerminalId: recipient.id,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to send text: ${err instanceof Error ? err.message : String(err)}`,
    };
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
          const request = JSON.parse(data) as ExtensionRequest;
          const result = isPeerRequest(request)
            ? await handleSendToAgent(request)
            : await handleSendNudge(request);
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
