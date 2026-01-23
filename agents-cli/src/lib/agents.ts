import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentConfig, AgentId, CliState } from './types.js';

const HOME = os.homedir();

export const AGENTS: Record<AgentId, AgentConfig> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    cliCommand: 'claude',
    npmPackage: '@anthropic-ai/claude-code',
    configDir: path.join(HOME, '.claude'),
    commandsDir: path.join(HOME, '.claude', 'commands'),
    commandsSubdir: 'commands',
    format: 'markdown',
    variableSyntax: '$ARGUMENTS',
    capabilities: { hooks: true, mcp: true, allowlist: true },
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    cliCommand: 'codex',
    npmPackage: '@openai/codex',
    configDir: path.join(HOME, '.codex'),
    commandsDir: path.join(HOME, '.codex', 'prompts'),
    commandsSubdir: 'prompts',
    format: 'markdown',
    variableSyntax: '$ARGUMENTS',
    capabilities: { hooks: false, mcp: true, allowlist: false },
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    cliCommand: 'gemini',
    npmPackage: '@google/gemini-cli',
    configDir: path.join(HOME, '.gemini'),
    commandsDir: path.join(HOME, '.gemini', 'commands'),
    commandsSubdir: 'commands',
    format: 'toml',
    variableSyntax: '{{args}}',
    capabilities: { hooks: false, mcp: true, allowlist: false },
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    cliCommand: 'cursor-agent',
    npmPackage: '',
    configDir: path.join(HOME, '.cursor'),
    commandsDir: path.join(HOME, '.cursor', 'commands'),
    commandsSubdir: 'commands',
    format: 'markdown',
    variableSyntax: '$ARGUMENTS',
    capabilities: { hooks: false, mcp: false, allowlist: false },
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    cliCommand: 'opencode',
    npmPackage: '',
    configDir: path.join(HOME, '.opencode'),
    commandsDir: path.join(HOME, '.opencode', 'commands'),
    commandsSubdir: 'commands',
    format: 'markdown',
    variableSyntax: '$ARGUMENTS',
    capabilities: { hooks: false, mcp: false, allowlist: false },
  },
  trae: {
    id: 'trae',
    name: 'Trae',
    cliCommand: 'trae-cli',
    npmPackage: '',
    configDir: path.join(HOME, '.trae'),
    commandsDir: path.join(HOME, '.trae', 'commands'),
    commandsSubdir: 'commands',
    format: 'markdown',
    variableSyntax: '$ARGUMENTS',
    capabilities: { hooks: false, mcp: false, allowlist: false },
  },
};

export const ALL_AGENT_IDS: AgentId[] = Object.keys(AGENTS) as AgentId[];
export const MCP_CAPABLE_AGENTS: AgentId[] = ALL_AGENT_IDS.filter(
  (id) => AGENTS[id].capabilities.mcp
);

export function isCliInstalled(agentId: AgentId): boolean {
  const agent = AGENTS[agentId];
  try {
    execSync(`which ${agent.cliCommand}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function getCliVersion(agentId: AgentId): string | null {
  const agent = AGENTS[agentId];
  try {
    const output = execSync(`${agent.cliCommand} --version`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : output.trim();
  } catch {
    return null;
  }
}

export function getCliPath(agentId: AgentId): string | null {
  const agent = AGENTS[agentId];
  try {
    return execSync(`which ${agent.cliCommand}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

export function getCliState(agentId: AgentId): CliState {
  const installed = isCliInstalled(agentId);
  return {
    installed,
    version: installed ? getCliVersion(agentId) : null,
    path: installed ? getCliPath(agentId) : null,
  };
}

export function getAllCliStates(): Partial<Record<AgentId, CliState>> {
  const states: Partial<Record<AgentId, CliState>> = {};
  for (const agentId of ALL_AGENT_IDS) {
    states[agentId] = getCliState(agentId);
  }
  return states;
}

export function isConfigured(agentId: AgentId): boolean {
  const agent = AGENTS[agentId];
  return fs.existsSync(agent.configDir);
}

export function ensureCommandsDir(agentId: AgentId): void {
  const agent = AGENTS[agentId];
  if (!fs.existsSync(agent.commandsDir)) {
    fs.mkdirSync(agent.commandsDir, { recursive: true });
  }
}

export function isMcpRegistered(agentId: AgentId, mcpName: string): boolean {
  const agent = AGENTS[agentId];
  if (!agent.capabilities.mcp || !isCliInstalled(agentId)) {
    return false;
  }
  try {
    const output = execSync(`${agent.cliCommand} mcp list`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return output.toLowerCase().includes(mcpName.toLowerCase());
  } catch {
    return false;
  }
}

export function registerMcp(
  agentId: AgentId,
  name: string,
  command: string,
  scope: 'user' | 'project' = 'user'
): { success: boolean; error?: string } {
  const agent = AGENTS[agentId];
  if (!agent.capabilities.mcp) {
    return { success: false, error: 'Agent does not support MCP' };
  }
  if (!isCliInstalled(agentId)) {
    return { success: false, error: 'CLI not installed' };
  }

  try {
    let cmd: string;
    if (agentId === 'claude') {
      cmd = `${agent.cliCommand} mcp add --scope ${scope} "${name}" ${command}`;
    } else {
      cmd = `${agent.cliCommand} mcp add "${name}" ${command}`;
    }
    execSync(cmd, { stdio: 'pipe' });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function unregisterMcp(
  agentId: AgentId,
  name: string
): { success: boolean; error?: string } {
  const agent = AGENTS[agentId];
  if (!agent.capabilities.mcp) {
    return { success: false, error: 'Agent does not support MCP' };
  }
  if (!isCliInstalled(agentId)) {
    return { success: false, error: 'CLI not installed' };
  }

  try {
    execSync(`${agent.cliCommand} mcp remove "${name}"`, { stdio: 'pipe' });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
