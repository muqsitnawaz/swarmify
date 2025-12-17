import * as vscode from 'vscode';
import * as path from 'path';
import {
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  CURSOR_TITLE,
  getIconFilename
} from './utils';

// Runtime agent configuration
export interface AgentConfig {
  title: string;
  command: string;
  count: number;
  iconPath: vscode.IconPath;
  prefix: string;
}

// Built-in agent definition (static data)
export interface BuiltInAgentDef {
  key: string;
  title: string;
  command: string;
  icon: string;
  prefix: string;
  commandId: string;
}

export const BUILT_IN_AGENTS: BuiltInAgentDef[] = [
  { key: 'claude', title: CLAUDE_TITLE, command: 'claude', icon: 'claude.png', prefix: 'cc', commandId: 'agents.newClaude' },
  { key: 'codex', title: CODEX_TITLE, command: 'codex', icon: 'chatgpt.png', prefix: 'cx', commandId: 'agents.newCodex' },
  { key: 'gemini', title: GEMINI_TITLE, command: 'gemini', icon: 'gemini.png', prefix: 'gm', commandId: 'agents.newGemini' },
  { key: 'cursor', title: CURSOR_TITLE, command: 'cursor', icon: 'cursor.png', prefix: 'cr', commandId: 'agents.newCursor' }
];

// Create agent config with icon paths
export function createAgentConfig(
  extensionPath: string,
  title: string,
  command: string,
  icon: string,
  prefix: string
): Omit<AgentConfig, 'count'> {
  return {
    title,
    command,
    iconPath: {
      light: vscode.Uri.file(path.join(extensionPath, 'assets', icon)),
      dark: vscode.Uri.file(path.join(extensionPath, 'assets', icon))
    },
    prefix
  };
}

// Lookup built-in agent by title (e.g., "CC", "CX")
export function getBuiltInByTitle(
  extensionPath: string,
  title: string
): Omit<AgentConfig, 'count'> | null {
  const def = BUILT_IN_AGENTS.find(a => a.title === title);
  if (!def) return null;
  return createAgentConfig(extensionPath, def.title, def.command, def.icon, def.prefix);
}

// Lookup built-in agent by key (e.g., "claude", "codex")
export function getBuiltInByKey(key: string): BuiltInAgentDef | undefined {
  return BUILT_IN_AGENTS.find(a => a.key === key);
}

// Lookup built-in agent by prefix (e.g., "cc", "cx")
export function getBuiltInByPrefix(prefix: string): BuiltInAgentDef | undefined {
  return BUILT_IN_AGENTS.find(a => a.prefix === prefix);
}

// Build icon path for a given prefix
export function buildIconPath(prefix: string, extensionPath: string): vscode.IconPath | null {
  const iconFile = getIconFilename(prefix);
  if (!iconFile) return null;
  return {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', iconFile)),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', iconFile))
  };
}
