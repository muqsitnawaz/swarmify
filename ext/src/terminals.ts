// Terminal state management following API.md architecture
// Pure functions are testable, VS Code integration in terminals.vscode.ts

import {
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  CURSOR_TITLE,
  getTerminalDisplayInfo
} from './utils';

// Running counts for settings panel
export interface RunningCounts {
  claude: number;
  codex: number;
  gemini: number;
  cursor: number;
  custom: Record<string, number>;
}

// Count running agents from terminal names (pure function)
export function countRunningFromNames(terminalNames: string[]): RunningCounts {
  const counts: RunningCounts = {
    claude: 0,
    codex: 0,
    gemini: 0,
    cursor: 0,
    custom: {}
  };

  for (const name of terminalNames) {
    const info = getTerminalDisplayInfo(name);
    if (!info.isAgent || !info.prefix) continue;

    switch (info.prefix) {
      case CLAUDE_TITLE:
        counts.claude++;
        break;
      case CODEX_TITLE:
        counts.codex++;
        break;
      case GEMINI_TITLE:
        counts.gemini++;
        break;
      case CURSOR_TITLE:
        counts.cursor++;
        break;
      default:
        counts.custom[info.prefix] = (counts.custom[info.prefix] || 0) + 1;
        break;
    }
  }

  return counts;
}

// Generate terminal ID
export function generateTerminalId(prefix: string, counter: number): string {
  return `${prefix}-${Date.now()}-${counter}`;
}
