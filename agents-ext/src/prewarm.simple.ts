// Simple command-based session pre-warming for all agents
// Uses non-interactive commands that output session ID directly
// Much more reliable than PTY-based approach

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import {
  PrewarmAgentType,
  PrewarmResult,
  stripAnsi,
} from './prewarm';

const execAsync = promisify(exec);

// Configuration for simple command-based prewarm
interface SimplePrewarmConfig {
  // Method: 'exec' runs to completion, 'spawn-kill' kills after getting session ID
  method: 'exec' | 'spawn-kill';
  // Command args for spawn, or full command for exec
  command: string[];
  // For Claude: generate UUID ourselves
  generateSessionId?: () => string;
  // Extract session ID from output (streaming for spawn-kill)
  extractSessionId?: (output: string) => string | null;
  timeout: number;
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const SIMPLE_PREWARM_CONFIGS: Record<PrewarmAgentType, SimplePrewarmConfig> = {
  claude: {
    // Generate UUID ourselves and pass to Claude - runs to completion with empty prompt
    method: 'exec',
    command: [], // Will be generated dynamically
    generateSessionId: () => randomUUID(),
    timeout: 30000,
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
 * Check if simple prewarm is available for an agent type
 * Now available for all agents!
 */
export function hasSimplePrewarm(agentType: PrewarmAgentType): boolean {
  return agentType in SIMPLE_PREWARM_CONFIGS;
}

/**
 * Spawn a prewarm session using simple command execution
 * Works for all agents now:
 * - Claude: Generate UUID, pass via --session-id, run to completion
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

  if (config.method === 'exec') {
    return spawnExecMethod(agentType, cwd, config);
  } else {
    return spawnKillMethod(agentType, cwd, config);
  }
}

/**
 * Exec method: Run command to completion (for Claude with pre-generated UUID)
 */
async function spawnExecMethod(
  agentType: PrewarmAgentType,
  cwd: string,
  config: SimplePrewarmConfig
): Promise<PrewarmResult> {
  // Generate session ID for Claude
  const sessionId = config.generateSessionId?.();
  if (!sessionId) {
    return {
      status: 'failed',
      failedReason: 'cli_error',
      rawOutput: 'Failed to generate session ID',
    };
  }

  // Build command: claude --session-id "<uuid>" -p ""
  const command = `claude --session-id "${sessionId}" -p ""`;
  console.log(`[PREWARM] Simple exec for ${agentType}: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: config.timeout,
      env: { ...process.env },
    });

    const output = stdout + stderr;
    console.log(`[PREWARM] ${agentType} exec completed: ${output.length} bytes`);
    console.log(`[PREWARM] ${agentType} using pre-generated session ID: ${sessionId}`);

    return {
      status: 'success',
      sessionId,
      rawOutput: output,
    };

  } catch (err: any) {
    const errorOutput = (err.stdout || '') + (err.stderr || '') + String(err);
    console.log(`[PREWARM] ${agentType} exec error: ${err.message || err}`);

    if (err.killed || err.signal === 'SIGTERM') {
      return { status: 'failed', failedReason: 'timeout', rawOutput: errorOutput };
    }
    if (errorOutput.includes('authenticate') || errorOutput.includes('log in')) {
      return { status: 'blocked', blockedReason: 'auth_required', rawOutput: errorOutput };
    }
    return { status: 'failed', failedReason: 'cli_error', rawOutput: errorOutput };
  }
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
