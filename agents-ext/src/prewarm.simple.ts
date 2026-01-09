// Simple command-based session pre-warming for Codex and Gemini
// Claude doesn't need prewarming - just generate UUID at terminal open time

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import {
  PrewarmAgentType,
  PrewarmResult,
  stripAnsi,
} from './prewarm';

// Configuration for simple command-based prewarm
interface SimplePrewarmConfig {
  // Method: 'none' for Claude (no prewarm), 'spawn-kill' kills after getting session ID
  method: 'none' | 'spawn-kill';
  // Command args for spawn
  command: string[];
  // Extract session ID from output (streaming for spawn-kill)
  extractSessionId?: (output: string) => string | null;
  timeout: number;
}

const SIMPLE_PREWARM_CONFIGS: Record<PrewarmAgentType, SimplePrewarmConfig> = {
  claude: {
    // Claude doesn't need prewarming - we generate UUID at terminal open time
    // and pass it via `claude --session-id <uuid>`
    method: 'none',
    command: [],
    timeout: 0,
  },
  gemini: {
    // Spawn gemini, kill as soon as we see session_id in JSON output
    method: 'spawn-kill',
    command: ['gemini', '-p', ' ', '-o', 'json'],
    extractSessionId: (output: string): string | null => {
      // Look for "session_id": "<uuid>" in streaming output
      const match = output.match(/"session_id":\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
      return match ? match[1] : null;
    },
    timeout: 30000,
  },
  codex: {
    // Spawn codex, kill as soon as we see session id in banner
    method: 'spawn-kill',
    command: ['codex', 'exec', ''],
    extractSessionId: (output: string): string | null => {
      const clean = stripAnsi(output);
      // Pattern: "session id: 019ba3f0-4dda-79b0-a8cc-6832bf78d6a9"
      const match = clean.match(/session id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      return match ? match[1] : null;
    },
    timeout: 60000,
  },
};

/**
 * Check if agent type needs actual prewarming (spawning a process)
 * Claude doesn't need it - we just generate UUID at open time
 */
export function needsPrewarming(agentType: PrewarmAgentType): boolean {
  return agentType !== 'claude';
}

/**
 * Generate a session ID for Claude (no prewarming needed)
 */
export function generateClaudeSessionId(): string {
  return randomUUID();
}

/**
 * Build the open command for Claude with a session ID
 */
export function buildClaudeOpenCommand(sessionId: string): string {
  return `claude --session-id ${sessionId}`;
}

/**
 * Spawn a prewarm session using simple command execution
 * - Claude: Returns immediately with generated UUID (no command execution)
 * - Codex: Spawn 'codex exec', kill as soon as session id appears in banner
 * - Gemini: Spawn with -o json, kill as soon as session_id appears in JSON
 */
export async function spawnSimplePrewarmSession(
  agentType: PrewarmAgentType,
  cwd: string
): Promise<PrewarmResult> {
  const config = SIMPLE_PREWARM_CONFIGS[agentType];
  if (!config) {
    return {
      status: 'failed',
      failedReason: 'cli_not_found',
      rawOutput: `Simple prewarm not available for ${agentType}`,
    };
  }

  // Claude: No prewarming needed, generate UUID immediately
  if (config.method === 'none') {
    const sessionId = generateClaudeSessionId();
    console.log(`[PREWARM] Claude using on-demand session ID: ${sessionId}`);
    return {
      status: 'success',
      sessionId,
      rawOutput: 'No prewarming needed for Claude',
    };
  }

  // Codex/Gemini: spawn-kill method
  return spawnKillMethod(agentType, cwd, config);
}

/**
 * Spawn-kill method: Start process, watch output, kill as soon as session ID found
 * Prevents the CLI from doing any actual work (like reading files)
 */
function spawnKillMethod(
  agentType: PrewarmAgentType,
  cwd: string,
  config: SimplePrewarmConfig
): Promise<PrewarmResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = config.command;
    let output = '';
    let resolved = false;
    let sessionId: string | null = null;

    console.log(`[PREWARM] Simple spawn-kill for ${agentType}: ${cmd} ${args.join(' ')}`);

    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const finish = (result: PrewarmResult) => {
      if (resolved) return;
      resolved = true;

      // Kill the process if still running
      if (!proc.killed) {
        proc.kill('SIGTERM');
        // Force kill after 500ms if still alive
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 500);
      }

      resolve(result);
    };

    const checkOutput = () => {
      if (resolved) return;

      // Try to extract session ID
      sessionId = config.extractSessionId?.(output) || null;
      if (sessionId) {
        console.log(`[PREWARM] ${agentType} spawn-kill got session ID: ${sessionId}, killing process`);
        finish({
          status: 'success',
          sessionId,
          rawOutput: output,
        });
      }
    };

    proc.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      checkOutput();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
      checkOutput();
    });

    proc.on('error', (err: Error) => {
      console.log(`[PREWARM] ${agentType} spawn error: ${err.message}`);
      finish({
        status: 'failed',
        failedReason: 'cli_error',
        rawOutput: output + `\nError: ${err.message}`,
      });
    });

    proc.on('close', (code: number | null) => {
      console.log(`[PREWARM] ${agentType} spawn closed with code ${code}, output: ${output.length} bytes`);
      if (!resolved) {
        // Process exited before we found session ID
        if (sessionId) {
          finish({ status: 'success', sessionId, rawOutput: output });
        } else {
          console.log(`[PREWARM] ${agentType} spawn-kill parse_error - output: ${output.slice(0, 500)}`);
          finish({ status: 'failed', failedReason: 'parse_error', rawOutput: output });
        }
      }
    });

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        console.log(`[PREWARM] ${agentType} spawn-kill timeout`);
        finish({ status: 'failed', failedReason: 'timeout', rawOutput: output });
      }
    }, config.timeout);
  });
}
