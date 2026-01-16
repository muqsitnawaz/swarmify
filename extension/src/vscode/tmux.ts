// Tmux integration - VS Code dependent functions

import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

interface TmuxTerminal {
  terminal: vscode.Terminal;
  session: string;
  socket: string;  // Pinned tmux socket path for reliable server targeting
  agentType: string;
  paneCount: number;
}

const tmuxTerminals = new Map<vscode.Terminal, TmuxTerminal>();
const execAsync = promisify(exec);

let tmuxAvailable: Promise<boolean> | null = null;

export function isTmuxAvailable(): Promise<boolean> {
  if (!tmuxAvailable) {
    tmuxAvailable = execAsync('command -v tmux')
      .then(() => true)
      .catch(() => false);
  }

  return tmuxAvailable;
}

export function createTmuxTerminal(
  name: string,
  agentType: string,
  agentCommand: string,
  options: {
    iconPath?: vscode.Uri;
    env?: Record<string, string>;
    viewColumn?: vscode.ViewColumn;
  }
): vscode.Terminal {
  const session = `agents-${Date.now()}`;
  const socket = `/tmp/agents-tmux-${session}.sock`;  // Unique socket per session

  const terminal = vscode.window.createTerminal({
    name,
    iconPath: options.iconPath,
    location: { viewColumn: options.viewColumn ?? vscode.ViewColumn.Active },
    env: {
      ...options.env,
      TMUX_AGENT_SESSION: session,
    },
    isTransient: true
  });

  // Build a single chained command that:
  // 1. Creates tmux session in detached mode with pinned socket
  // 2. Configures mouse and pane labels
  // 3. Sends agent command directly to the session via send-keys (if provided)
  // 4. Attaches to the session
  // Using -S socket ensures both terminal shell and execAsync talk to same server.
  const escapedName = name.replace(/'/g, "'\\''");
  const tmuxCommands = [
    `tmux -S ${socket} new-session -d -s ${session} -n main`,
    `tmux -S ${socket} set-option -t ${session} mouse on`,
    `tmux -S ${socket} set-option -t ${session} pane-border-status top`,
    `tmux -S ${socket} set-option -t ${session} pane-border-format " #{pane_index}: ${escapedName} "`,
  ];

  if (agentCommand) {
    const escapedCmd = agentCommand.replace(/'/g, "'\\''");
    tmuxCommands.push(`tmux -S ${socket} send-keys -t ${session} '${escapedCmd}' Enter`);
  }

  tmuxCommands.push(`tmux -S ${socket} attach -t ${session}`);

  const tmuxInit = tmuxCommands.join(' && ');

  // Some shells (e.g., with heavy profile scripts) take a moment to populate PATH.
  // Delay sending tmux init so `tmux` resolves consistently instead of failing
  // with "unknown command: tmux".
  setTimeout(() => {
    terminal.sendText(tmuxInit, true);
  }, 2000);

  tmuxTerminals.set(terminal, {
    terminal,
    session,
    socket,
    agentType,
    paneCount: 1,
  });

  return terminal;
}

export async function tmuxSplitH(terminal: vscode.Terminal, agentCommand: string): Promise<void> {
  const state = tmuxTerminals.get(terminal);
  if (!state) return;

  try {
    // Verify session exists first
    await execAsync(`tmux -S ${state.socket} has-session -t ${state.session}`);

    state.paneCount++;

    // Use execAsync to run tmux command directly - bypasses terminal input entirely.
    // This avoids issues with Claude capturing keystrokes.
    if (agentCommand) {
      const escapedCmd = agentCommand.replace(/'/g, "'\\''");
      await execAsync(`tmux -S ${state.socket} split-window -v -t ${state.session} '${escapedCmd}'`);
    } else {
      await execAsync(`tmux -S ${state.socket} split-window -v -t ${state.session}`);
    }
  } catch (err) {
    console.error('[TMUX] Split H failed:', err);
    // Session doesn't exist - clean up stale state
    tmuxTerminals.delete(terminal);
  }
}

export async function tmuxSplitV(terminal: vscode.Terminal, agentCommand: string): Promise<void> {
  const state = tmuxTerminals.get(terminal);
  if (!state) return;

  try {
    // Verify session exists first
    await execAsync(`tmux -S ${state.socket} has-session -t ${state.session}`);

    state.paneCount++;

    // Use execAsync to run tmux command directly - bypasses terminal input entirely.
    // This avoids issues with Claude capturing keystrokes.
    if (agentCommand) {
      const escapedCmd = agentCommand.replace(/'/g, "'\\''");
      await execAsync(`tmux -S ${state.socket} split-window -h -t ${state.session} '${escapedCmd}'`);
    } else {
      await execAsync(`tmux -S ${state.socket} split-window -h -t ${state.session}`);
    }
  } catch (err) {
    console.error('[TMUX] Split V failed:', err);
    // Session doesn't exist - clean up stale state
    tmuxTerminals.delete(terminal);
  }
}

export function isTmuxTerminal(terminal: vscode.Terminal): boolean {
  return tmuxTerminals.has(terminal);
}

export function getTmuxState(terminal: vscode.Terminal): TmuxTerminal | undefined {
  return tmuxTerminals.get(terminal);
}

export function cleanupTmuxTerminal(terminal: vscode.Terminal): void {
  const state = tmuxTerminals.get(terminal);
  if (!state) return;

  try {
    // Kill session using the pinned socket
    exec(`tmux -S ${state.socket} kill-session -t ${state.session}`);
    // Remove the socket file to avoid orphan sockets
    exec(`rm -f ${state.socket}`);
  } catch {
    // Ignore errors - session may already be dead
  }

  tmuxTerminals.delete(terminal);
}

export function registerTmuxCleanup(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      cleanupTmuxTerminal(terminal);
    })
  );
}
