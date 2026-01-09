// Session pre-warming using node-pty for reliable TTY emulation
// This provides consistent CLI behavior matching interactive terminals

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import {
  PrewarmAgentType,
  PrewarmConfig,
  PrewarmResult,
  PREWARM_CONFIGS,
  isCliReady,
  detectBlockingPrompt,
  stripAnsi,
  extractSessionId,
} from './prewarm';

// Conditionally import node-pty (may not be available in all environments)
let pty: typeof import('node-pty') | null = null;
try {
  pty = require('node-pty');
  console.log('[PREWARM] node-pty loaded successfully');
} catch (err) {
  console.warn('[PREWARM] node-pty not available, will use VS Code terminal fallback');
  // Don't log full error to avoid noise - terminal fallback will be used
}

// Import terminal-based warming as fallback
let terminalWarming: typeof import('./prewarm.terminal') | null = null;
try {
  terminalWarming = require('./prewarm.terminal');
  console.log('[PREWARM] Terminal-based warming available as fallback');
} catch {
  // Terminal warming not available
}

// Import simple command-based warming (for Codex/Gemini)
import { hasSimplePrewarm, spawnSimplePrewarmSession } from './prewarm.simple';

// Configuration
const PREWARM_TIMEOUT_MS = 45000;  // 45 seconds total timeout
const STATUS_RETRY_DELAY_MS = 500;
const STATUS_MAX_RETRIES = 3;
const EXIT_SEQUENCE_DELAY_MS = 100;

// Logging
const PREWARM_LOG_DIR = path.join(os.homedir(), '.swarmify', 'agents', 'logs');
const MAX_LOG_FILES = 10;

/**
 * Check if PTY is available
 */
export function isPtyAvailable(): boolean {
  return pty !== null;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensure log directory exists
 */
async function ensureLogDir(): Promise<void> {
  try {
    await fs.promises.mkdir(PREWARM_LOG_DIR, { recursive: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Prune old log files, keeping only the most recent ones
 */
async function pruneOldLogs(): Promise<void> {
  try {
    const files = await fs.promises.readdir(PREWARM_LOG_DIR);
    const logFiles = files
      .filter(f => f.startsWith('prewarm-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(PREWARM_LOG_DIR, f),
        time: parseInt(f.split('-').pop()?.replace('.log', '') || '0', 10)
      }))
      .sort((a, b) => b.time - a.time);

    // Remove files beyond MAX_LOG_FILES
    for (const file of logFiles.slice(MAX_LOG_FILES)) {
      await fs.promises.unlink(file.path).catch(() => {});
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Log prewarm attempt for debugging
 */
async function logPrewarmAttempt(
  agentType: PrewarmAgentType,
  result: PrewarmResult,
  rawOutput: string
): Promise<void> {
  await ensureLogDir();
  const logFile = path.join(PREWARM_LOG_DIR, `prewarm-${agentType}-${Date.now()}.log`);
  const logData = {
    timestamp: new Date().toISOString(),
    agentType,
    result: {
      status: result.status,
      sessionId: result.sessionId,
      blockedReason: result.blockedReason,
      failedReason: result.failedReason,
    },
    rawOutputLength: rawOutput.length,
    rawOutput: rawOutput.slice(0, 10000), // Limit output size
  };
  await fs.promises.writeFile(logFile, JSON.stringify(logData, null, 2)).catch(() => {});
  await pruneOldLogs();
}

/**
 * Check if CLI is available
 */
export async function isCliAvailable(agentType: PrewarmAgentType): Promise<boolean> {
  const config = PREWARM_CONFIGS[agentType];

  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const proc = spawn(config.command, ['--version'], { shell: true });

    let resolved = false;
    const finish = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    proc.on('close', (code: number) => finish(code === 0));
    proc.on('error', () => finish(false));

    setTimeout(() => {
      proc.kill();
      finish(false);
    }, 5000);
  });
}

/**
 * Spawn a prewarm session using PTY
 */
export async function spawnPrewarmSession(
  agentType: PrewarmAgentType,
  cwd: string
): Promise<PrewarmResult> {
  const config = PREWARM_CONFIGS[agentType];

  // Check if PTY is available
  if (!pty) {
    return {
      status: 'failed',
      failedReason: 'cli_not_found',
      rawOutput: 'node-pty not available',
    };
  }

  // Check if CLI is available
  const available = await isCliAvailable(agentType);
  if (!available) {
    return {
      status: 'failed',
      failedReason: 'cli_not_found',
      rawOutput: `${config.command} CLI not found or not executable`,
    };
  }

  return new Promise(async (resolve) => {
    let output = '';
    let sessionId: string | null = null;
    let statusSent = false;
    let statusRetries = 0;
    let resolved = false;
    let ptyProcess: ReturnType<typeof pty.spawn> | null = null;

    const finish = (result: PrewarmResult) => {
      if (resolved) return;
      resolved = true;

      // Kill PTY if still running
      if (ptyProcess) {
        try {
          ptyProcess.kill();
        } catch {
          // Ignore
        }
      }

      // Log the attempt
      logPrewarmAttempt(agentType, result, output).catch(() => {});

      resolve(result);
    };

    try {
      console.log(`[PREWARM] Spawning ${agentType} PTY session in ${cwd}`);

      // Spawn PTY process using shell for PATH resolution
      const shell = process.env.SHELL || '/bin/bash';
      ptyProcess = pty.spawn(shell, ['-c', config.command], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd,
        env: { ...process.env },
      });

      // Handle PTY data (combined stdout/stderr)
      ptyProcess.onData((data: string) => {
        output += data;
        const cleanOutput = stripAnsi(output);

        // Log data reception periodically
        if (output.length < 500 || output.length % 1000 < data.length) {
          console.log(`[PREWARM] ${agentType} output: ${output.length} bytes, statusSent=${statusSent}`);
        }

        // Check for blocking prompts first
        const blocked = detectBlockingPrompt(cleanOutput);
        if (blocked) {
          console.log(`[PREWARM] ${agentType} blocked: ${blocked}`);
          finish({
            status: 'blocked',
            blockedReason: blocked,
            rawOutput: output,
          });
          return;
        }

        // Check if CLI is ready and we haven't sent /status yet
        if (!statusSent && isCliReady(cleanOutput, agentType)) {
          statusSent = true;
          console.log(`[PREWARM] ${agentType} CLI ready, sending ${config.statusCommand}`);
          console.log(`[PREWARM] ${agentType} output before status: ${cleanOutput.slice(-200)}`);
          ptyProcess?.write(`${config.statusCommand}\n`);
        }

        // Try to parse session ID after sending /status
        if (statusSent && !sessionId) {
          sessionId = extractSessionId(cleanOutput);
          if (sessionId) {
            console.log(`[PREWARM] Got ${agentType} session ID: ${sessionId}`);
            // Send exit sequence with delays
            const extractedId = sessionId; // Capture for closure
            sendExitSequence(ptyProcess!, config).then(() => {
              // Give CLI time to process exit
              setTimeout(() => {
                finish({
                  status: 'success',
                  sessionId: extractedId || undefined,
                  rawOutput: output,
                });
              }, 500);
            });
          }
        }
      });

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode }) => {
        console.log(`[PREWARM] ${agentType} PTY exited with code ${exitCode}, output=${output.length} bytes, statusSent=${statusSent}`);
        if (!resolved) {
          if (sessionId) {
            finish({
              status: 'success',
              sessionId: sessionId || undefined,
              rawOutput: output,
            });
          } else {
            const cleanOutput = stripAnsi(output);
            console.log(`[PREWARM] ${agentType} parse_error - last 500 chars: ${cleanOutput.slice(-500)}`);
            console.log(`[PREWARM] ${agentType} parse_error - first 500 chars: ${cleanOutput.slice(0, 500)}`);
            finish({
              status: 'failed',
              failedReason: 'parse_error',
              rawOutput: output,
            });
          }
        }
      });

      // Retry /status if no session ID received
      const retryInterval = setInterval(async () => {
        if (resolved || sessionId) {
          clearInterval(retryInterval);
          return;
        }

        if (statusSent && statusRetries < STATUS_MAX_RETRIES) {
          statusRetries++;
          console.log(`[PREWARM] ${agentType} retrying ${config.statusCommand} (attempt ${statusRetries + 1})`);
          ptyProcess?.write(`${config.statusCommand}\n`);
        }
      }, STATUS_RETRY_DELAY_MS * 2);

      // Timeout
      setTimeout(() => {
        clearInterval(retryInterval);
        if (!resolved) {
          console.log(`[PREWARM] ${agentType} session timed out`);
          finish({
            status: 'failed',
            failedReason: 'timeout',
            rawOutput: output,
          });
        }
      }, PREWARM_TIMEOUT_MS);

    } catch (err) {
      console.error(`[PREWARM] Failed to spawn ${agentType} PTY:`, err);
      finish({
        status: 'failed',
        failedReason: 'cli_error',
        rawOutput: output + `\n\nError: ${err}`,
      });
    }
  });
}

/**
 * Send exit sequence with appropriate delays
 */
async function sendExitSequence(
  ptyProcess: ReturnType<typeof import('node-pty').spawn>,
  config: PrewarmConfig
): Promise<void> {
  for (const seq of config.exitSequence) {
    ptyProcess.write(seq);
    await sleep(EXIT_SEQUENCE_DELAY_MS);
  }
}

/**
 * Spawn prewarm session with fallback chain:
 * 1. Simple command (for Codex/Gemini - most reliable)
 * 2. node-pty (for Claude - needs TTY)
 * 3. VS Code terminal (fallback for Claude)
 * 4. child_process spawn (last resort)
 */
export async function spawnPrewarmSessionWithFallback(
  agentType: PrewarmAgentType,
  cwd: string
): Promise<PrewarmResult> {
  // Try simple command-based prewarm first (Codex/Gemini)
  if (hasSimplePrewarm(agentType)) {
    console.log(`[PREWARM] Using simple command for ${agentType}`);
    return spawnSimplePrewarmSession(agentType, cwd);
  }

  // For Claude: Try node-pty first
  if (isPtyAvailable()) {
    console.log(`[PREWARM] Using node-pty for ${agentType}`);
    return spawnPrewarmSession(agentType, cwd);
  }

  // Try VS Code terminal fallback
  if (terminalWarming) {
    console.log(`[PREWARM] Using VS Code terminal for ${agentType}`);
    return terminalWarming.spawnPrewarmSessionViaTerminal(agentType, cwd);
  }

  // Last resort: child_process spawn (usually fails because CLIs need TTY)
  console.log(`[PREWARM] Using spawn fallback for ${agentType} (may fail)`);
  return spawnPrewarmSessionFallback(agentType, cwd);
}

/**
 * Fallback implementation using child_process.spawn
 */
async function spawnPrewarmSessionFallback(
  agentType: PrewarmAgentType,
  cwd: string
): Promise<PrewarmResult> {
  const { spawn } = require('child_process');
  const config = PREWARM_CONFIGS[agentType];

  return new Promise((resolve) => {
    let output = '';
    let sessionId: string | null = null;
    let statusSent = false;
    let resolved = false;

    const finish = (result: PrewarmResult) => {
      if (resolved) return;
      resolved = true;
      if (proc && !proc.killed) {
        proc.kill();
      }
      logPrewarmAttempt(agentType, result, output).catch(() => {});
      resolve(result);
    };

    const proc = spawn(config.command, [], {
      cwd,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    const handleOutput = (data: Buffer) => {
      output += data.toString();
      const cleanOutput = stripAnsi(output);

      // Log data reception periodically
      if (output.length < 500 || output.length % 1000 < data.length) {
        console.log(`[PREWARM] ${agentType} spawn output: ${output.length} bytes, statusSent=${statusSent}`);
      }

      const blocked = detectBlockingPrompt(cleanOutput);
      if (blocked) {
        finish({ status: 'blocked', blockedReason: blocked, rawOutput: output });
        return;
      }

      if (!statusSent && isCliReady(cleanOutput, agentType)) {
        statusSent = true;
        console.log(`[PREWARM] ${agentType} spawn CLI ready, sending ${config.statusCommand}`);
        proc.stdin?.write(`${config.statusCommand}\n`);
      }

      if (statusSent && !sessionId) {
        sessionId = extractSessionId(cleanOutput);
        if (sessionId) {
          console.log(`[PREWARM] ${agentType} spawn got session ID: ${sessionId}`);
          for (const seq of config.exitSequence) {
            proc.stdin?.write(seq);
          }
        }
      }
    };

    proc.stdout?.on('data', handleOutput);
    proc.stderr?.on('data', handleOutput);

    proc.on('close', () => {
      console.log(`[PREWARM] ${agentType} spawn closed, output=${output.length} bytes, statusSent=${statusSent}`);
      if (sessionId) {
        finish({ status: 'success', sessionId: sessionId || undefined, rawOutput: output });
      } else {
        const cleanOutput = stripAnsi(output);
        console.log(`[PREWARM] ${agentType} spawn parse_error - output: ${cleanOutput.slice(0, 500)}`);
        finish({ status: 'failed', failedReason: 'parse_error', rawOutput: output });
      }
    });

    proc.on('error', (err: Error) => {
      finish({ status: 'failed', failedReason: 'cli_error', rawOutput: output + `\n\nError: ${err}` });
    });

    setTimeout(() => {
      if (!resolved) {
        finish({ status: 'failed', failedReason: 'timeout', rawOutput: output });
      }
    }, PREWARM_TIMEOUT_MS);
  });
}
