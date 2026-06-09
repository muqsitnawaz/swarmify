import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

type Agent = 'claude' | 'gemini';

const SERVER_NAME = 'watchdog';

async function isCliAvailable(agent: Agent): Promise<boolean> {
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    await execAsync(`${which} ${agent}`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function isInstalled(agent: Agent): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`${agent} mcp list`, { timeout: 5000 });
    return new RegExp(`\\b${SERVER_NAME}\\b`, 'i').test(stdout);
  } catch {
    return false;
  }
}

async function install(agent: Agent, mcpServerPath: string): Promise<void> {
  // Claude: `claude mcp add --scope user <name> <command> [args...]`
  // Gemini: `gemini mcp add <name> <commandOrUrl> [args...]`
  const cmd =
    agent === 'claude'
      ? `claude mcp add --scope user ${SERVER_NAME} node "${mcpServerPath}"`
      : `gemini mcp add ${SERVER_NAME} node "${mcpServerPath}"`;
  await execAsync(cmd, { timeout: 10000 });
}

/**
 * Register the watchdog MCP server in each supported agent's user-scope
 * config so peer terminals can call `send_to_agent`. Idempotent — skips
 * agents whose CLI is missing or that already have a `watchdog` entry.
 */
export async function ensureWatchdogMcpInstalled(mcpServerPath: string): Promise<void> {
  const agents: Agent[] = ['claude', 'gemini'];

  for (const agent of agents) {
    if (!(await isCliAvailable(agent))) {
      continue;
    }

    try {
      if (await isInstalled(agent)) {
        continue;
      }
      await install(agent, mcpServerPath);
      console.log(`[WATCHDOG] Registered ${SERVER_NAME} MCP for ${agent}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[WATCHDOG] Failed to register MCP for ${agent}: ${message}`);
    }
  }
}
