// VS Code-dependent terminal state management
// Implements API.md 2-map architecture

import * as vscode from 'vscode';
import { AgentConfig } from './agents.vscode';
import { countRunningFromNames, generateTerminalId, RunningCounts } from './terminals';
import { getTerminalDisplayInfo } from './utils';

// Terminal entry following API.md
export interface EditorTerminal {
  id: string;
  terminal: vscode.Terminal;
  agentConfig: Omit<AgentConfig, 'count'> | null;
  label?: string;           // User-set status bar label (manual via Cmd+L)
  autoLabel?: string;       // Auto-generated label (populated by LLM)
  createdAt: number;
  pid?: number;             // Shell process ID
  messageQueue: string[];   // Queued messages to send after terminal ready
}

const STATUS_BAR_LABELS_KEY = 'agentStatusBarLabels';

type StatusBarLabelsStorage = { [pid: number]: string };

export function loadStatusBarLabels(context: vscode.ExtensionContext): StatusBarLabelsStorage {
  const stored = context.globalState.get<StatusBarLabelsStorage>(STATUS_BAR_LABELS_KEY);
  return stored || {};
}

export async function saveStatusBarLabel(
  context: vscode.ExtensionContext,
  pid: number,
  label: string | undefined
): Promise<void> {
  const stored = loadStatusBarLabels(context);
  if (label) {
    stored[pid] = label;
  } else {
    delete stored[pid];
  }
  await context.globalState.update(STATUS_BAR_LABELS_KEY, stored);
}

export async function removeStatusBarLabel(
  context: vscode.ExtensionContext,
  pid: number | undefined
): Promise<void> {
  if (pid === undefined) return;
  const stored = loadStatusBarLabels(context);
  delete stored[pid];
  await context.globalState.update(STATUS_BAR_LABELS_KEY, stored);
}

// Two-map architecture (API.md)
const editorTerminals = new Map<string, EditorTerminal>();
const terminalToId = new WeakMap<vscode.Terminal, string>();
let terminalIdCounter = 0;

// Accessors

export function getByTerminal(t: vscode.Terminal): EditorTerminal | undefined {
  const id = terminalToId.get(t);
  const entry = id ? editorTerminals.get(id) : undefined;
  console.log(`[DEBUG getByTerminal] terminal="${t.name}" -> id=${id}, entry.label="${entry?.label}"`);
  return entry;
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
  pid?: number,
  context?: vscode.ExtensionContext,
  initialLabel?: string
): void {
  console.log(`[DEBUG register] Registering terminal: name="${terminal.name}", id=${id}, pid=${pid}, initialLabel=${initialLabel}`);

  const entry: EditorTerminal = {
    id,
    terminal,
    agentConfig,
    createdAt: Date.now(),
    pid,
    messageQueue: []
  };

  if (pid !== undefined && context) {
    const persistedLabels = loadStatusBarLabels(context);
    console.log(`[DEBUG register] All persisted labels in globalState:`, JSON.stringify(persistedLabels));
    const persistedLabel = persistedLabels[pid];
    console.log(`[DEBUG register] Persisted label for PID ${pid}: "${persistedLabel}"`);
    if (persistedLabel) {
      entry.label = persistedLabel;
    } else if (initialLabel) {
      entry.label = initialLabel;
      // Also persist this label since we found it on a restored terminal
      saveStatusBarLabel(context, pid, initialLabel);
    }
  } else if (initialLabel) {
    entry.label = initialLabel;
  }

  console.log(`[DEBUG register] Final entry.label: "${entry.label}"`);
  editorTerminals.set(id, entry);
  terminalToId.set(terminal, id);
  console.log(`[DEBUG register] editorTerminals now has ${editorTerminals.size} entries`);
}

export function unregister(terminal: vscode.Terminal): void {
  const id = terminalToId.get(terminal);
  if (id) {
    editorTerminals.delete(id);
    // WeakMap auto-cleans when terminal is GC'd
  }
}

export async function setLabel(
  terminal: vscode.Terminal,
  label: string | undefined,
  context?: vscode.ExtensionContext
): Promise<void> {
  console.log(`[DEBUG setLabel] Setting label for terminal "${terminal.name}" to "${label}"`);
  const entry = getByTerminal(terminal);
  console.log(`[DEBUG setLabel] Found entry: id=${entry?.id}, pid=${entry?.pid}, currentLabel="${entry?.label}"`);
  if (entry) {
    entry.label = label;
    if (entry.pid !== undefined && context) {
      console.log(`[DEBUG setLabel] Persisting label "${label}" for PID ${entry.pid}`);
      await saveStatusBarLabel(context, entry.pid, label);
    }
  } else {
    console.log(`[DEBUG setLabel] No entry found for terminal - label NOT saved!`);
  }
}

export function setAutoLabel(terminal: vscode.Terminal, autoLabel: string | undefined): void {
  const entry = getByTerminal(terminal);
  if (entry) {
    entry.autoLabel = autoLabel;
  }
}

// Message queue management

export function queueMessage(terminal: vscode.Terminal, message: string): void {
  const entry = getByTerminal(terminal);
  if (entry) {
    entry.messageQueue.push(message);
  }
}

export function flushQueue(terminal: vscode.Terminal): string[] {
  const entry = getByTerminal(terminal);
  if (entry) {
    const messages = [...entry.messageQueue];
    entry.messageQueue = [];
    return messages;
  }
  return [];
}

// Lifecycle

export async function scanExisting(
  inferAgentConfig: (name: string) => Omit<AgentConfig, 'count'> | null,
  context?: vscode.ExtensionContext
): Promise<number> {
  console.log('[TERMINALS] Scanning all terminals...');
  let registeredCount = 0;

  for (const terminal of vscode.window.terminals) {
    console.log(`[TERMINALS] Checking terminal: "${terminal.name}"`);

    // Skip if already registered
    if (terminalToId.has(terminal)) {
      console.log(`[TERMINALS] Already registered, skipping`);
      continue;
    }

    const info = getTerminalDisplayInfo(terminal.name);
    console.log(`[TERMINALS] Display info for "${terminal.name}": isAgent=${info.isAgent}, prefix=${info.prefix}`);

    if (!info.isAgent || !info.prefix) continue;

    const agentConfig = inferAgentConfig(terminal.name);
    if (!agentConfig) continue;

    const id = nextId(info.prefix);

    let pid: number | undefined;
    try {
      pid = await terminal.processId;
    } catch (error) {
      console.log(`[TERMINALS] Could not retrieve PID for terminal "${terminal.name}"`);
    }

    register(terminal, id, agentConfig, pid, context, info.label || undefined);
    registeredCount++;
    console.log(`[TERMINALS] Registered: id=${id}, prefix=${info.prefix}, pid=${pid}, label=${info.label}`);
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
