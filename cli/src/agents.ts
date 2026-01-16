/**
 * Agent detection and path utilities
 * Handles Claude, Codex, Gemini, and Cursor CLI agents
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

export type AgentCli = 'claude' | 'codex' | 'gemini';
export type PromptPackAgent = AgentCli | 'cursor';

export const ALL_AGENTS: PromptPackAgent[] = ['claude', 'codex', 'gemini', 'cursor'];

/**
 * Agent configuration directories
 */
export const AGENT_CONFIG_DIRS: Record<PromptPackAgent, string> = {
  claude: path.join(os.homedir(), '.claude'),
  codex: path.join(os.homedir(), '.codex'),
  gemini: path.join(os.homedir(), '.gemini'),
  cursor: path.join(os.homedir(), '.cursor'),
};

/**
 * Subdirectory where skills/commands are stored per agent
 */
export const AGENT_SKILL_DIRS: Record<PromptPackAgent, string> = {
  claude: 'commands',
  codex: 'prompts',
  gemini: 'commands',
  cursor: 'commands',
};

/**
 * File extension for skill files per agent
 */
export const AGENT_SKILL_EXT: Record<PromptPackAgent, string> = {
  claude: 'md',
  codex: 'md',
  gemini: 'toml',
  cursor: 'md',
};

/**
 * Get the full path to the skills directory for an agent
 */
export function getAgentSkillsDir(agent: PromptPackAgent): string {
  return path.join(AGENT_CONFIG_DIRS[agent], AGENT_SKILL_DIRS[agent]);
}

/**
 * Get the full path to a specific skill file for an agent
 */
export function getSkillPath(agent: PromptPackAgent, skillName: string): string {
  const ext = AGENT_SKILL_EXT[agent];
  return path.join(getAgentSkillsDir(agent), `${skillName}.${ext}`);
}

/**
 * Check if a CLI is installed and available
 */
export function isCliAvailable(agent: AgentCli): boolean {
  try {
    execSync(`which ${agent}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an agent's config directory exists
 */
export function isAgentConfigured(agent: PromptPackAgent): boolean {
  return fs.existsSync(AGENT_CONFIG_DIRS[agent]);
}

/**
 * Check if a skill is installed for an agent
 */
export function isSkillInstalled(agent: PromptPackAgent, skillName: string): boolean {
  return fs.existsSync(getSkillPath(agent, skillName));
}

/**
 * Get CLI version if available
 */
export function getCliVersion(agent: AgentCli): string | null {
  try {
    const output = execSync(`${agent} --version`, { stdio: 'pipe', encoding: 'utf-8' });
    return output.trim().split('\n')[0];
  } catch {
    return null;
  }
}

/**
 * Check if MCP is registered for an agent
 */
export function isMcpRegistered(agent: AgentCli): boolean {
  try {
    const output = execSync(`${agent} mcp list`, { stdio: 'pipe', encoding: 'utf-8' });
    return /swarm/i.test(output);
  } catch {
    return false;
  }
}
