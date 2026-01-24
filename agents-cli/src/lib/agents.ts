import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as TOML from 'smol-toml';
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
    skillsDir: path.join(HOME, '.claude', 'skills'),
    hooksDir: 'hooks',
    format: 'markdown',
    variableSyntax: '$ARGUMENTS',
    supportsHooks: true,
    capabilities: { hooks: true, mcp: true, allowlist: true, skills: true },
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    cliCommand: 'codex',
    npmPackage: '@openai/codex',
    configDir: path.join(HOME, '.codex'),
    commandsDir: path.join(HOME, '.codex', 'prompts'),
    commandsSubdir: 'prompts',
    skillsDir: path.join(HOME, '.codex', 'skills'),
    hooksDir: 'hooks',
    format: 'markdown',
    variableSyntax: '$ARGUMENTS',
    supportsHooks: false,
    capabilities: { hooks: false, mcp: true, allowlist: false, skills: true },
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    cliCommand: 'gemini',
    npmPackage: '@google/gemini-cli',
    configDir: path.join(HOME, '.gemini'),
    commandsDir: path.join(HOME, '.gemini', 'commands'),
    commandsSubdir: 'commands',
    skillsDir: path.join(HOME, '.gemini', 'skills'),
    hooksDir: 'hooks',
    format: 'toml',
    variableSyntax: '{{args}}',
    supportsHooks: true,
    capabilities: { hooks: true, mcp: true, allowlist: false, skills: true },
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    cliCommand: 'cursor-agent',
    npmPackage: '',
    configDir: path.join(HOME, '.cursor'),
    commandsDir: path.join(HOME, '.cursor', 'commands'),
    commandsSubdir: 'commands',
    skillsDir: path.join(HOME, '.cursor', 'skills'),
    hooksDir: 'hooks',
    format: 'markdown',
    variableSyntax: '$ARGUMENTS',
    supportsHooks: false,
    capabilities: { hooks: false, mcp: true, allowlist: false, skills: true },
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    cliCommand: 'opencode',
    npmPackage: '',
    configDir: path.join(HOME, '.opencode'),
    commandsDir: path.join(HOME, '.opencode', 'commands'),
    commandsSubdir: 'commands',
    skillsDir: path.join(HOME, '.opencode', 'skills'),
    hooksDir: 'hooks',
    format: 'markdown',
    variableSyntax: '$ARGUMENTS',
    supportsHooks: false,
    capabilities: { hooks: false, mcp: true, allowlist: false, skills: true },
  },
};

export const ALL_AGENT_IDS: AgentId[] = Object.keys(AGENTS) as AgentId[];
export const MCP_CAPABLE_AGENTS: AgentId[] = ALL_AGENT_IDS.filter(
  (id) => AGENTS[id].capabilities.mcp
);
export const SKILLS_CAPABLE_AGENTS: AgentId[] = ALL_AGENT_IDS.filter(
  (id) => AGENTS[id].capabilities.skills
);
export const HOOKS_CAPABLE_AGENTS = ['claude', 'gemini'] as const;

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

export function ensureSkillsDir(agentId: AgentId): void {
  const agent = AGENTS[agentId];
  if (!fs.existsSync(agent.skillsDir)) {
    fs.mkdirSync(agent.skillsDir, { recursive: true });
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

export type McpScope = 'user' | 'project';

export interface InstalledMcp {
  name: string;
  scope: McpScope;
  command?: string;
  version?: string;
}

interface McpConfigEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
}

/**
 * Extract version from npm package specification.
 * Examples: @swarmify/agents-mcp@latest -> latest
 *           @swarmify/agents-mcp@1.2.3 -> 1.2.3
 *           some-package -> undefined
 */
function extractNpmVersion(args: string[]): string | undefined {
  // Find npm package argument (looks like @scope/package@version or package@version)
  for (const arg of args) {
    // Match @scope/package@version or package@version
    const match = arg.match(/@([^@]+)$|^([^@]+)@(.+)$/);
    if (match) {
      // @scope/package@version pattern
      const versionMatch = arg.match(/@([^@/]+)$/);
      if (versionMatch) {
        return versionMatch[1];
      }
    }
  }
  return undefined;
}

/**
 * Strip JSON comments for JSONC parsing.
 * Only removes comments outside of strings.
 */
function stripJsonComments(content: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];

    if (escape) {
      result += char;
      escape = false;
      i++;
      continue;
    }

    if (char === '\\' && inString) {
      result += char;
      escape = true;
      i++;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    if (!inString) {
      // Check for single-line comment
      if (char === '/' && next === '/') {
        // Skip until end of line
        while (i < content.length && content[i] !== '\n') {
          i++;
        }
        continue;
      }
      // Check for multi-line comment
      if (char === '/' && next === '*') {
        i += 2;
        while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) {
          i++;
        }
        i += 2; // Skip */
        continue;
      }
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Parse MCP servers from a JSON/JSONC config file.
 */
function parseMcpFromJsonConfig(configPath: string): Record<string, McpConfigEntry> {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    let content = fs.readFileSync(configPath, 'utf-8');
    // Handle JSONC (JSON with comments)
    if (configPath.endsWith('.jsonc')) {
      content = stripJsonComments(content);
    }
    const config = JSON.parse(content);

    // Claude uses mcpServers, others may use mcp_servers or mcp
    return config.mcpServers || config.mcp_servers || config.mcp || {};
  } catch {
    return {};
  }
}

/**
 * Parse MCP servers from a TOML config file (Codex).
 * Codex stores MCPs as [mcp_servers.ServerName] sections.
 */
function parseMcpFromTomlConfig(configPath: string): Record<string, McpConfigEntry> {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = TOML.parse(content) as Record<string, unknown>;

    // Codex uses mcp_servers as a table with server names as keys
    const mcpServers = config.mcp_servers as Record<string, McpConfigEntry> | undefined;
    return mcpServers || {};
  } catch {
    return {};
  }
}

/**
 * Parse MCP servers from OpenCode's JSONC config.
 * OpenCode stores MCPs in the "mcp" object with different structure.
 */
function parseMcpFromOpenCodeConfig(configPath: string): Record<string, McpConfigEntry> {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const content = stripJsonComments(fs.readFileSync(configPath, 'utf-8'));
    const config = JSON.parse(content);
    const mcpConfig = config.mcp as Record<string, {
      type?: string;
      command?: string[];
      url?: string;
      enabled?: boolean;
    }> | undefined;

    if (!mcpConfig) return {};

    // Convert OpenCode format to our McpConfigEntry format
    const result: Record<string, McpConfigEntry> = {};
    for (const [name, entry] of Object.entries(mcpConfig)) {
      if (entry.type === 'local' && entry.command) {
        // Local MCP: command is an array like ["npx", "-y", "@pkg@version"]
        result[name] = {
          command: entry.command[0],
          args: entry.command.slice(1),
        };
      } else if (entry.type === 'remote' && entry.url) {
        // Remote MCP: HTTP URL
        result[name] = {
          url: entry.url,
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Get user-scoped MCP config path for an agent.
 */
function getUserMcpConfigPath(agentId: AgentId): string {
  const agent = AGENTS[agentId];

  switch (agentId) {
    case 'claude':
      // Claude user-scoped MCPs are in ~/.claude.json (global user config)
      return path.join(HOME, '.claude.json');
    case 'codex':
      // Codex uses TOML config
      return path.join(agent.configDir, 'config.toml');
    case 'opencode':
      // OpenCode uses JSONC config
      return path.join(agent.configDir, 'opencode.jsonc');
    case 'cursor':
      // Cursor uses mcp.json
      return path.join(agent.configDir, 'mcp.json');
    default:
      // Gemini and others use settings.json
      return path.join(agent.configDir, 'settings.json');
  }
}

/**
 * Get project-scoped MCP config path for an agent.
 */
function getProjectMcpConfigPath(agentId: AgentId, cwd: string = process.cwd()): string {
  switch (agentId) {
    case 'codex':
      return path.join(cwd, `.${agentId}`, 'config.toml');
    case 'opencode':
      return path.join(cwd, `.${agentId}`, 'opencode.jsonc');
    case 'cursor':
      return path.join(cwd, `.${agentId}`, 'mcp.json');
    default:
      return path.join(cwd, `.${agentId}`, 'settings.json');
  }
}

/**
 * Parse MCP config based on agent type.
 */
function parseMcpConfig(agentId: AgentId, configPath: string): Record<string, McpConfigEntry> {
  switch (agentId) {
    case 'codex':
      return parseMcpFromTomlConfig(configPath);
    case 'opencode':
      return parseMcpFromOpenCodeConfig(configPath);
    default:
      return parseMcpFromJsonConfig(configPath);
  }
}

/**
 * List installed MCP servers with scope information.
 */
export function listInstalledMcpsWithScope(
  agentId: AgentId,
  cwd: string = process.cwd()
): InstalledMcp[] {
  const results: InstalledMcp[] = [];

  // User-scoped MCPs
  const userConfigPath = getUserMcpConfigPath(agentId);
  const userMcps = parseMcpConfig(agentId, userConfigPath);
  for (const [name, config] of Object.entries(userMcps)) {
    results.push({
      name,
      scope: 'user',
      command: config.command || (config.args ? config.args.join(' ') : undefined),
      version: config.args ? extractNpmVersion(config.args) : undefined,
    });
  }

  // Project-scoped MCPs
  const projectConfigPath = getProjectMcpConfigPath(agentId, cwd);
  const projectMcps = parseMcpConfig(agentId, projectConfigPath);
  for (const [name, config] of Object.entries(projectMcps)) {
    // Skip if already in user scope (project can override, but we show both)
    results.push({
      name,
      scope: 'project',
      command: config.command || (config.args ? config.args.join(' ') : undefined),
      version: config.args ? extractNpmVersion(config.args) : undefined,
    });
  }

  return results;
}

/**
 * Copy a project-scoped MCP to user scope.
 */
export function promoteMcpToUser(
  agentId: AgentId,
  mcpName: string,
  cwd: string = process.cwd()
): { success: boolean; error?: string } {
  const projectConfigPath = getProjectMcpConfigPath(agentId, cwd);
  const projectMcps = parseMcpConfig(agentId, projectConfigPath);

  if (!projectMcps[mcpName]) {
    return { success: false, error: `Project MCP '${mcpName}' not found` };
  }

  const mcpConfig = projectMcps[mcpName];
  const command = mcpConfig.command || (mcpConfig.args ? mcpConfig.args.join(' ') : '');

  if (!command) {
    return { success: false, error: 'Cannot determine MCP command' };
  }

  return registerMcp(agentId, mcpName, command, 'user');
}
