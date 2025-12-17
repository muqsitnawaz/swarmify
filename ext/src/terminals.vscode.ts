// VS Code-dependent terminal state management
// Implements API.md 2-map architecture

import * as vscode from 'vscode';
import { getTerminalDisplayInfo, parseTerminalName } from './utils';
import { AgentConfig } from './agents.vscode';
import { generateTerminalId, countRunningFromNames, RunningCounts } from './terminals';

// Terminal entry following API.md
export interface EditorTerminal {
  id: string;
  terminal: vscode.Terminal;
  agentConfig: Omit<AgentConfig, 'count'> | null;
  label?: string;           // User-set label (manual via Cmd+L)
  autoLabel?: string;       // Auto-generated label (populated by LLM)
  createdAt: number;
  pid?: number;             // Shell process ID
}

// Two-map architecture (API.md)
const editorTerminals = new Map<string, EditorTerminal>();
const terminalToId = new WeakMap<vscode.Terminal, string>();
let terminalIdCounter = 0;

// Accessors

export function getByTerminal(t: vscode.Terminal): EditorTerminal | undefined {
  const id = terminalToId.get(t);
  return id ? editorTerminals.get(id) : undefined;
}

export function getById(id: string): EditorTerminal | undefined {
  return editorTerminals.get(id);
}

export function getAllTerminals(): EditorTerminal[] {
  return Array.from(editorTerminals.values());
}

export function isAgentTerminal(t: vscode.Terminal): boolean {
  const entry = getByTerminal(t);
  return entry?.agentConfig !== null && entry?.agentConfig !== undefined;
}

// Mutations

// Generate a unique terminal ID (call before creating terminal for env var)
export function nextId(prefix: string): string {
  return generateTerminalId(prefix, ++terminalIdCounter);
}

// Register a terminal with a pre-generated ID
export function register(
  terminal: vscode.Terminal,
  id: string,
  agentConfig: Omit<AgentConfig, 'count'> | null,
  pid?: number
): void {
  const entry: EditorTerminal = {
    id,
    terminal,
    agentConfig,
    createdAt: Date.now(),
    pid
  };
  editorTerminals.set(id, entry);
  terminalToId.set(terminal, id);
}

export function unregister(terminal: vscode.Terminal): void {
  const id = terminalToId.get(terminal);
  if (id) {
    editorTerminals.delete(id);
    // WeakMap auto-cleans when terminal is GC'd
  }
}

export function setLabel(terminal: vscode.Terminal, label: string | undefined): void {
  const entry = getByTerminal(terminal);
  if (entry) {
    entry.label = label;
  }
}

export function setAutoLabel(terminal: vscode.Terminal, autoLabel: string | undefined): void {
  const entry = getByTerminal(terminal);
  if (entry) {
    entry.autoLabel = autoLabel;
  }
}

// Lifecycle

export function scanExisting(
  inferAgentConfig: (name: string) => Omit<AgentConfig, 'count'> | null
): number {
  console.log('[TERMINALS] Scanning terminals in editor area...');
  let registeredCount = 0;

  // Build terminal name -> instance map
  const terminalsByName = new Map<string, vscode.Terminal>();
  for (const terminal of vscode.window.terminals) {
    terminalsByName.set(terminal.name, terminal);
    console.log(`[TERMINALS] Available terminal: "${terminal.name}"`);
  }

  for (const group of vscode.window.tabGroups.all) {
    console.log(`[TERMINALS] Tab group ${group.viewColumn}: ${group.tabs.length} tabs`);

    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputTerminal) {
        console.log(`[TERMINALS] Found editor terminal tab: label="${tab.label}"`);

        const info = getTerminalDisplayInfo(tab.label);
        console.log(`[TERMINALS] Display info for "${tab.label}": isAgent=${info.isAgent}, prefix=${info.prefix}`);

        if (!info.isAgent || !info.prefix) continue;

        const terminal = terminalsByName.get(tab.label);
        if (!terminal) {
          console.log(`[TERMINALS] No matching terminal found for label "${tab.label}"`);
          continue;
        }

        // Skip if already registered
        if (terminalToId.has(terminal)) {
          console.log(`[TERMINALS] Already registered, skipping`);
          continue;
        }

        const agentConfig = inferAgentConfig(tab.label);
        const id = nextId(info.prefix);
        register(terminal, id, agentConfig);
        registeredCount++;
        console.log(`[TERMINALS] Registered: id=${id}, prefix=${info.prefix}`);
      }
    }
  }

  console.log(`[TERMINALS] Scan complete. Registered ${registeredCount} agent terminals.`);
  return registeredCount;
}

// Count running agents
export function countRunning(): RunningCounts {
  const names = vscode.window.terminals.map(t => t.name);
  return countRunningFromNames(names);
}

// Clear state (for testing/deactivation)
export function clear(): void {
  editorTerminals.clear();
  terminalIdCounter = 0;
}
