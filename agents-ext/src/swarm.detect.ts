import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export type AgentCli = 'claude' | 'codex' | 'gemini';

// Paths where the /swarm command file lives for each CLI
// Claude, Codex use markdown; Gemini uses TOML commands
export function getAgentCommandPath(agent: AgentCli, command: string = 'swarm'): string {
  const baseDirs: Record<AgentCli, string> = {
    claude: path.join(os.homedir(), '.claude', 'commands'),
    codex: path.join(os.homedir(), '.codex', 'prompts'),
    gemini: path.join(os.homedir(), '.gemini', 'commands'),
  };

  const ext = agent === 'gemini' ? 'toml' : 'md';
  return path.join(baseDirs[agent], `${command}.${ext}`);
}

// Detect whether a CLI binary is available
export async function isAgentCliAvailable(agent: AgentCli): Promise<boolean> {
  const commands: Record<AgentCli, string> = {
    claude: 'claude --version',
    codex: 'codex --version',
    gemini: 'gemini --version',
  };

  try {
    await execAsync(commands[agent]);
    return true;
  } catch {
    return false;
  }
}

// Detect whether the Swarm MCP server is registered for a CLI
export async function isAgentMcpEnabled(agent: AgentCli): Promise<boolean> {
  const commands: Record<AgentCli, string> = {
    claude: 'claude mcp list',
    codex: 'codex mcp list',
    gemini: 'gemini mcp list',
  };

  try {
    const { stdout } = await execAsync(commands[agent]);
    return /swarm/i.test(stdout) || /swarmify-agents/i.test(stdout);
  } catch {
    return false;
  }
}

// Detect whether the /swarm slash-command file is present for a CLI
export function isAgentCommandInstalled(agent: AgentCli, command: string = 'swarm'): boolean {
  const target = getAgentCommandPath(agent, command);
  return fs.existsSync(target);
}
