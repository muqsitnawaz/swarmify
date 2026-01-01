// Pure data and lookup functions (no VS Code dependencies - testable)
// VS Code-dependent functions are in agents.vscode.ts

import {
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  OPENCODE_TITLE,
  CURSOR_TITLE,
  SHELL_TITLE
} from './utils';

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
  { key: 'opencode', title: OPENCODE_TITLE, command: 'opencode', icon: 'opencode.png', prefix: 'oc', commandId: 'agents.newOpenCode' },
  { key: 'cursor', title: CURSOR_TITLE, command: 'cursor-agent', icon: 'cursor.png', prefix: 'cr', commandId: 'agents.newCursor' },
  { key: 'shell', title: SHELL_TITLE, command: '', icon: 'agents.png', prefix: 'sh', commandId: 'agents.newShell' }
];

// Lookup built-in agent by key (e.g., "claude", "codex")
export function getBuiltInByKey(key: string): BuiltInAgentDef | undefined {
  return BUILT_IN_AGENTS.find(a => a.key === key);
}

// Lookup built-in agent by prefix (e.g., "cc", "cx")
export function getBuiltInByPrefix(prefix: string): BuiltInAgentDef | undefined {
  return BUILT_IN_AGENTS.find(a => a.prefix === prefix);
}

// Lookup built-in agent by title (e.g., "CC", "CX")
export function getBuiltInDefByTitle(title: string): BuiltInAgentDef | undefined {
  return BUILT_IN_AGENTS.find(a => a.title === title);
}
