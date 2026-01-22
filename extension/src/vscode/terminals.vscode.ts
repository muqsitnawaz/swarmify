// VS Code-dependent terminal state management
// Implements API.md 2-map architecture

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AgentConfig } from './agents.vscode';
import { generateTerminalId, RunningCounts } from '../core/terminals';
import * as sessionsPersist from '../core/sessions.persist';
import { getSessionPathBySessionId, getSessionPreviewInfo, SessionPreviewInfo } from './sessions.vscode';
import { extractCurrentActivity, formatActivity } from '../core/session.activity';
import {
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  OPENCODE_TITLE,
  CURSOR_TITLE,
  SHELL_TITLE,
  getTerminalDisplayInfo,
  TerminalIdentificationOptions
} from '../core/utils';

/**
 * Extract identification options from a VS Code terminal.
 * Used to gather all inputs for getTerminalDisplayInfo.
 */
function extractTerminalIdentificationOptions(terminal: vscode.Terminal): TerminalIdentificationOptions {
  const opts = terminal.creationOptions as vscode.TerminalOptions;
  const env = opts?.env;
  const terminalId = env ? env['AGENT_TERMINAL_ID'] : undefined;
  const sessionId = env ? env['AGENT_SESSION_ID'] : undefined;

  // Extract icon filename from iconPath
  let iconFilename: string | null = null;
  if (opts?.iconPath) {
    const icon: any = opts.iconPath;
    if (icon instanceof vscode.Uri) {
      iconFilename = path.basename(icon.fsPath);
    } else if (icon && typeof icon === 'object') {
      // Support { light: Uri; dark: Uri } or direct object with fsPath
      const candidate = icon.light ?? icon.dark ?? icon;
      if (candidate instanceof vscode.Uri || (candidate && typeof candidate.fsPath === 'string')) {
        iconFilename = path.basename(candidate.fsPath);
      }
    }
  }

  return {
    name: terminal.name,
    terminalId: terminalId as string | undefined,
    sessionId: sessionId as string | undefined,
    iconFilename
  };
}

// Agent types that support session tracking
export type SessionAgentType = 'claude' | 'codex' | 'gemini' | 'cursor';

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
  sessionId?: string;       // CLI session ID (for resume, history reading)
  agentType?: SessionAgentType; // Agent type for session operations
}

const STATUS_BAR_LABELS_KEY = 'agentStatusBarLabels';

type StatusBarLabelsStorage = { [pid: number]: string };

// Re-export PersistedSession from sessions.persist for external use
export { PersistedSession } from '../core/sessions.persist';

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

// Debounced disk persistence
let persistTimeout: NodeJS.Timeout | null = null;

/**
 * Schedule disk persistence (debounced to batch rapid changes).
 * Call this after any terminal state change.
 */
export function schedulePersist(): void {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return;

  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(() => {
    persistSessions(workspacePath);
    persistTimeout = null;
    console.log('[TERMINALS] Persisted sessions to disk');
  }, 500); // 500ms debounce
}

/**
 * Persist immediately (for critical operations like deactivate).
 */
export function persistNow(): void {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) return;

  if (persistTimeout) {
    clearTimeout(persistTimeout);
    persistTimeout = null;
  }
  persistSessions(workspacePath);
  console.log('[TERMINALS] Persisted sessions to disk (immediate)');
}

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
// IMPORTANT: This function is idempotent - if the terminal is already registered,
// it will skip registration to prevent race conditions from overwriting sessionId
export function register(
  terminal: vscode.Terminal,
  id: string,
  agentConfig: Omit<AgentConfig, 'count'> | null,
  pid?: number,
  context?: vscode.ExtensionContext,
  initialLabel?: string
): void {
  // Check if terminal is already registered (prevents race condition with onDidOpenTerminal)
  const existingId = terminalToId.get(terminal);
  if (existingId) {
    console.log(`[TERMINALS] Terminal "${terminal.name}" already registered with id=${existingId}, skipping duplicate registration`);
    return;
  }

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

  // Persist to disk
  schedulePersist();
}

export function unregister(terminal: vscode.Terminal): void {
  const id = terminalToId.get(terminal);
  if (id) {
    editorTerminals.delete(id);
    terminalToId.delete(terminal);

    // Persist to disk
    schedulePersist();
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

    // Persist to disk
    schedulePersist();
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

export function setSessionId(terminal: vscode.Terminal, sessionId: string): void {
  const entry = getByTerminal(terminal);
  if (entry) {
    entry.sessionId = sessionId;
    console.log(`[TERMINALS] Set sessionId for terminal "${terminal.name}": ${sessionId}`);

    // Persist to disk
    schedulePersist();
  } else {
    console.error(`[TERMINALS] FAILED to set sessionId - terminal "${terminal.name}" not found in registry. This may indicate a race condition.`);
  }
}

export function setAgentType(terminal: vscode.Terminal, agentType: SessionAgentType): void {
  const entry = getByTerminal(terminal);
  if (entry) {
    entry.agentType = agentType;

    // Persist to disk
    schedulePersist();
  } else {
    console.error(`[TERMINALS] FAILED to set agentType - terminal "${terminal.name}" not found in registry.`);
  }
}

export function getSessionId(terminal: vscode.Terminal): string | undefined {
  const entry = getByTerminal(terminal);
  return entry?.sessionId;
}

export function getAgentType(terminal: vscode.Terminal): SessionAgentType | undefined {
  const entry = getByTerminal(terminal);
  return entry?.agentType;
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

// Rename a terminal tab title (must be active)
export async function renameTerminal(terminal: vscode.Terminal, newName: string): Promise<void> {
  try {
    terminal.show(false);
    await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: newName });
  } catch (err) {
    console.error('[TERMINALS] Failed to rename terminal', err);
  }
}

// Lifecycle

export async function scanExisting(
  inferAgentConfig: (name: string, knownPrefix?: string | null) => Omit<AgentConfig, 'count'> | null,
  context?: vscode.ExtensionContext
): Promise<number> {
  console.log('[TERMINALS] Scanning all terminals...');
  let registeredCount = 0;

  for (const terminal of vscode.window.terminals) {
    console.log(`[TERMINALS] Checking terminal: "${terminal.name}"`);

    // Skip terminals whose process has exited (tab may still be open)
    if (terminal.exitStatus !== undefined) {
      console.log(`[TERMINALS] Process exited, skipping`);
      continue;
    }

    // Skip if already registered
    if (terminalToId.has(terminal)) {
      console.log(`[TERMINALS] Already registered, skipping`);
      continue;
    }

    // Use the central identification function with all available inputs
    const identOpts = extractTerminalIdentificationOptions(terminal);
    const info = getTerminalDisplayInfo(identOpts);
    console.log(`[TERMINALS] Display info for "${terminal.name}": isAgent=${info.isAgent}, prefix=${info.prefix}`);

    if (!info.isAgent || !info.prefix) continue;

    const agentConfig = inferAgentConfig(terminal.name, info.prefix);
    if (!agentConfig) continue;

    const id = identOpts.terminalId || nextId(info.prefix);

    let pid: number | undefined;
    try {
      pid = await terminal.processId;
    } catch (error) {
      console.log(`[TERMINALS] Could not retrieve PID for terminal "${terminal.name}"`);
    }

    register(terminal, id, agentConfig, pid, context, info.label || undefined);
    registeredCount++;
    console.log(`[TERMINALS] Registered: id=${id}, prefix=${info.prefix}, pid=${pid}, label=${info.label}`);

    // Restore session tracking if available from env vars
    if (identOpts.sessionId) {
      setSessionId(terminal, identOpts.sessionId);
      const agentType = prefixToAgentType(info.prefix);
      if (agentType) {
        setAgentType(terminal, agentType);
      }
      console.log(`[TERMINALS] Restored session: sessionId=${identOpts.sessionId}, agentType=${agentType}`);
    }
  }

  console.log(`[TERMINALS] Scan complete. Registered ${registeredCount} agent terminals.`);
  return registeredCount;
}

// Count running agents
export function countRunning(): RunningCounts {
  const counts: RunningCounts = {
    claude: 0,
    codex: 0,
    gemini: 0,
    opencode: 0,
    cursor: 0,
    shell: 0,
    custom: {}
  };

  for (const terminal of vscode.window.terminals) {
    // Skip terminals whose process has exited (tab may still be open)
    if (terminal.exitStatus !== undefined) continue;

    // Use full identification (name + env + icon) so we keep prefix even when the
    // tab title is just a label (showLabelsInTitles=true) or has been manually renamed.
    const identOpts = extractTerminalIdentificationOptions(terminal);
    const info = getTerminalDisplayInfo(identOpts);
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
      case OPENCODE_TITLE:
        counts.opencode++;
        break;
      case CURSOR_TITLE:
        counts.cursor++;
        break;
      case SHELL_TITLE:
        counts.shell++;
        break;
      default:
        counts.custom[info.prefix] = (counts.custom[info.prefix] || 0) + 1;
        break;
    }
  }

  return counts;
}

// Terminal detail for UI display
export interface TerminalDetail {
  id: string;
  agentType: string;
  label: string | null;
  autoLabel: string | null;
  createdAt: number;
  index: number; // 1-based index within agent type
  sessionId: string | null; // CLI session ID
  lastUserMessage?: string; // Last user message from session
  messageCount?: number; // Total message count in session
  currentActivity?: string; // Live activity (e.g., "Reading src/auth.ts", "Running npm test")
}

// Map from lowercase key (used in UI) to prefix (used in terminal names)
const AGENT_KEY_TO_PREFIX: Record<string, string> = {
  claude: 'CL',
  codex: 'CX',
  gemini: 'GX',
  opencode: 'OC',
  cursor: 'CR',
  shell: 'SH'
};

// Map from prefix to SessionAgentType (only for agents that support sessions)
function prefixToAgentType(prefix: string | null): SessionAgentType | null {
  if (!prefix) return null;
  switch (prefix) {
    case 'CL': return 'claude';
    case 'CX': return 'codex';
    case 'GX': return 'gemini';
    case 'CR': return 'cursor';
    default: return null;
  }
}

// Helper to read tail of session file for activity extraction
async function readSessionTail(filePath: string, maxBytes: number = 32 * 1024): Promise<string> {
  try {
    const stats = await fs.stat(filePath);
    const start = Math.max(0, stats.size - maxBytes);
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(Math.min(maxBytes, stats.size));
    await handle.read(buffer, 0, buffer.length, start);
    await handle.close();
    return buffer.toString('utf-8');
  } catch {
    return '';
  }
}

// Get terminals filtered by agent type with display details
// Scans VS Code terminals directly to handle restored/unregistered terminals
export async function getTerminalsByAgentType(
  agentType: string,
  workspacePath?: string
): Promise<TerminalDetail[]> {
  const expectedPrefix = AGENT_KEY_TO_PREFIX[agentType];
  const results: TerminalDetail[] = [];
  const sessionPromises: Array<{
    index: number;
    sessionPath: Promise<string | undefined>;
    agentType: 'claude' | 'codex' | 'gemini';
  }> = [];
  let index = 0;

  for (const terminal of vscode.window.terminals) {
    // Skip terminals whose process has exited (tab may still be open)
    if (terminal.exitStatus !== undefined) continue;

    const identOpts = extractTerminalIdentificationOptions(terminal);
    const info = getTerminalDisplayInfo(identOpts);
    if (!info.isAgent || !info.prefix) continue;

    // Match by prefix for built-in agents, or by exact name for custom agents
    const isMatch = expectedPrefix
      ? info.prefix === expectedPrefix
      : info.prefix === agentType;

    if (!isMatch) continue;

    index++;

    // Try to get additional info from our internal map
    const entry = getByTerminal(terminal);
    const resultIndex = results.length;

    results.push({
      id: entry?.id || `unregistered-${index}`,
      agentType: agentType,
      label: entry?.label || info.label || null,
      autoLabel: entry?.autoLabel || null,
      createdAt: entry?.createdAt || Date.now(),
      index: index,
      sessionId: entry?.sessionId || null
    });

    // Queue session path lookup if session exists
    if (entry?.sessionId && entry?.agentType) {
      const sessionAgentType = entry.agentType as 'claude' | 'codex' | 'gemini';
      sessionPromises.push({
        index: resultIndex,
        sessionPath: getSessionPathBySessionId(entry.sessionId!, sessionAgentType, workspacePath),
        agentType: sessionAgentType
      });
    }
  }

  // Resolve all session paths first
  const sessionPaths = await Promise.all(sessionPromises.map(p => p.sessionPath));

  // Now fetch preview info and activity in parallel for each session
  const dataPromises = sessionPromises.map(async (p, i) => {
    const sessionPath = sessionPaths[i];
    if (!sessionPath) return { index: p.index, preview: null, activity: null };

    const [preview, tail] = await Promise.all([
      getSessionPreviewInfo(sessionPath),
      readSessionTail(sessionPath, 64 * 1024) // Read last 64KB for activity
    ]);

    const activity = tail ? extractCurrentActivity(tail, p.agentType) : null;

    return {
      index: p.index,
      preview,
      activity: activity ? formatActivity(activity) : null
    };
  });

  const dataResults = await Promise.all(dataPromises);

  // Populate results with fetched data
  for (const data of dataResults) {
    if (data.preview) {
      results[data.index].lastUserMessage = data.preview.lastUserMessage;
      results[data.index].messageCount = data.preview.messageCount;
    }
    if (data.activity) {
      results[data.index].currentActivity = data.activity;
    }
  }

  return results;
}

// Clear state (for testing/deactivation)
export function clear(): void {
  editorTerminals.clear();
  terminalIdCounter = 0;
}

// Session persistence for restore across VS Code restarts

// Build persisted session data from current terminals
export function buildPersistedSessions(): sessionsPersist.PersistedSession[] {
  const sessions: sessionsPersist.PersistedSession[] = [];

  for (const entry of editorTerminals.values()) {
    // Only persist agent terminals (not regular terminals)
    if (!entry.agentConfig) continue;

    sessions.push({
      terminalId: entry.id,
      prefix: entry.agentConfig.prefix,
      sessionId: entry.sessionId,
      label: entry.label,
      agentType: entry.agentType,
      createdAt: entry.createdAt
    });
  }

  return sessions;
}

// Persist all current sessions for a workspace
export function persistSessions(workspacePath: string): void {
  const sessions = buildPersistedSessions();
  sessionsPersist.saveWorkspaceSessions(workspacePath, sessions, true);
}

// Load persisted sessions for a workspace
export function loadPersistedSessions(workspacePath: string): sessionsPersist.PersistedSession[] {
  return sessionsPersist.getWorkspaceSessions(workspacePath);
}

// Clear persisted sessions after successful restore
export function clearPersistedSessions(workspacePath: string): void {
  sessionsPersist.clearWorkspaceSessions(workspacePath);
}

// Update a session's metadata (e.g., when CLI sessionId is captured)
export function updatePersistedSession(
  workspacePath: string,
  terminalId: string,
  updates: Partial<sessionsPersist.PersistedSession>
): void {
  sessionsPersist.updateSession(workspacePath, terminalId, updates);
}
