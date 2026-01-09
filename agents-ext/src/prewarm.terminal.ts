// Session pre-warming using VS Code's built-in terminal API
// Uses `script` command to capture terminal output to a file

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  PrewarmAgentType,
  PrewarmConfig,
  PrewarmResult,
  PREWARM_CONFIGS,
  stripAnsi,
} from './prewarm';

// Configuration
const PREWARM_TIMEOUT_MS = 45000;
const READY_POLL_INTERVAL_MS = 500;
const TEMP_DIR = path.join(os.tmpdir(), 'swarmify-prewarm');

// UUID pattern for session IDs
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Ready patterns per agent
const READY_PATTERNS: Record<PrewarmAgentType, RegExp[]> = {
  claude: [/Claude Code v[\d.]+/, />\s*$/, /Try "/],
  codex: [/Codex/, />\s*$/],
  gemini: [/Gemini/, />\s*$/],
};

/**
 * Ensure temp directory exists
 */
function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Check if output indicates CLI is ready
 */
function isReady(output: string, agentType: PrewarmAgentType): boolean {
  const patterns = READY_PATTERNS[agentType];
  return patterns.some(p => p.test(output));
}

/**
 * Extract session ID from output
 */
function extractSessionId(output: string): string | null {
  const clean = stripAnsi(output);
  const match = clean.match(UUID_PATTERN);
  return match ? match[0] : null;
}

/**
 * Spawn a prewarm session using VS Code terminal with script capture
 */
export async function spawnPrewarmSessionViaTerminal(
  agentType: PrewarmAgentType,
  cwd: string
): Promise<PrewarmResult> {
  const config = PREWARM_CONFIGS[agentType];

  ensureTempDir();
  const timestamp = Date.now();
  const outputFile = path.join(TEMP_DIR, `output-${agentType}-${timestamp}.txt`);

  // Clean up any existing output file
  try {
    fs.unlinkSync(outputFile);
  } catch {}

  return new Promise((resolve) => {
    let resolved = false;
    let terminal: vscode.Terminal | null = null;
    let statusSent = false;
    let pollTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      // Don't delete output file immediately - useful for debugging
    };

    const finish = (result: PrewarmResult) => {
      if (resolved) return;
      resolved = true;
      cleanup();

      // Dispose terminal after a short delay
      setTimeout(() => {
        if (terminal) {
          terminal.dispose();
        }
      }, 500);

      resolve(result);
    };

    try {
      console.log(`[PREWARM] Creating terminal for ${agentType} in ${cwd}`);
      console.log(`[PREWARM] Output file: ${outputFile}`);

      // Create terminal that runs CLI with script to capture output
      // Using `script -q` to capture all terminal output to a file
      terminal = vscode.window.createTerminal({
        name: `Prewarm-${agentType}`,
        cwd,
        hideFromUser: true, // Hidden from UI
        shellPath: '/bin/bash',
        shellArgs: ['-c', `script -q "${outputFile}" ${config.command}`],
      });

      // Poll output file for readiness and session ID
      pollTimer = setInterval(() => {
        if (resolved) return;

        try {
          if (!fs.existsSync(outputFile)) return;

          const output = fs.readFileSync(outputFile, 'utf-8');
          if (!output) return;

          // Check for blocking prompts
          if (output.includes('Do you trust the files')) {
            console.log(`[PREWARM] ${agentType} blocked by trust prompt`);
            finish({
              status: 'blocked',
              blockedReason: 'trust_prompt',
              rawOutput: output,
            });
            return;
          }

          if (output.includes('Please log in') || output.includes('Not authenticated')) {
            console.log(`[PREWARM] ${agentType} blocked by auth`);
            finish({
              status: 'blocked',
              blockedReason: 'auth_required',
              rawOutput: output,
            });
            return;
          }

          // Check if ready and haven't sent status yet
          if (!statusSent && isReady(output, agentType)) {
            statusSent = true;
            console.log(`[PREWARM] ${agentType} ready, sending ${config.statusCommand}`);
            terminal?.sendText(config.statusCommand);
          }

          // Try to extract session ID after sending status
          if (statusSent) {
            const sessionId = extractSessionId(output);
            if (sessionId) {
              console.log(`[PREWARM] Got ${agentType} session ID: ${sessionId}`);

              // Send exit sequence
              if (agentType === 'claude') {
                terminal?.sendText('\x1b', false); // Esc
              }
              setTimeout(() => {
                terminal?.sendText('\x03', false); // Ctrl+C
                setTimeout(() => {
                  terminal?.sendText('\x03', false); // Ctrl+C again
                }, 100);
              }, 100);

              finish({
                status: 'success',
                sessionId,
                rawOutput: output,
              });
            }
          }
        } catch (err) {
          // File read error - keep polling
        }
      }, READY_POLL_INTERVAL_MS);

      // Timeout
      setTimeout(() => {
        if (!resolved) {
          console.log(`[PREWARM] ${agentType} terminal timeout`);
          let rawOutput = '';
          try {
            rawOutput = fs.readFileSync(outputFile, 'utf-8');
          } catch {}
          finish({
            status: 'failed',
            failedReason: 'timeout',
            rawOutput,
          });
        }
      }, PREWARM_TIMEOUT_MS);

    } catch (err) {
      console.error(`[PREWARM] Failed to create terminal for ${agentType}:`, err);
      finish({
        status: 'failed',
        failedReason: 'cli_error',
        rawOutput: String(err),
      });
    }
  });
}

/**
 * Check if terminal-based warming is available
 */
export function isTerminalWarmingAvailable(): boolean {
  // Available on macOS/Linux (where `script` command exists)
  return process.platform !== 'win32';
}
