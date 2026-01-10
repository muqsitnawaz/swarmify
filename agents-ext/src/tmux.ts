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

  const terminal = vscode.window.createTerminal({
    name,
    iconPath: options.iconPath,
    location: { viewColumn: options.viewColumn ?? vscode.ViewColumn.Active },
    env: {
      ...options.env,
      TMUX_AGENT_SESSION: session,
    },
  });

  // Build a single chained command that:
  // 1. Creates tmux session in detached mode
  // 2. Configures mouse and pane labels
  // 3. Sends agent command directly to the session via send-keys (if provided)
  // 4. Attaches to the session
  // This avoids race conditions from using separate sendText calls with timeouts.
  const escapedName = name.replace(/'/g, "'\\''");
  const tmuxCommands = [
    `tmux new-session -d -s ${session} -n main`,
    `tmux set-option -t ${session} mouse on`,
    `tmux set-option -t ${session} pane-border-status top`,
    `tmux set-option -t ${session} pane-border-format " #{pane_index}: ${escapedName} "`,
  ];

  if (agentCommand) {
    const escapedCmd = agentCommand.replace(/'/g, "'\\''");
    tmuxCommands.push(`tmux send-keys -t ${session} '${escapedCmd}' Enter`);
  }

  tmuxCommands.push(`tmux attach -t ${session}`);

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
    agentType,
    paneCount: 1,
  });

  return terminal;
}

export function tmuxSplitH(terminal: vscode.Terminal, agentCommand: string): void {
  const state = tmuxTerminals.get(terminal);
  if (!state) return;

  state.paneCount++;

  // When inside an attached tmux session (with Claude running), we can't type
  // shell commands directly - they go to Claude's input. Instead, we use tmux's
  // prefix key (Ctrl+B) to enter command mode.
  // \x02 = Ctrl+B (tmux default prefix)
  terminal.sendText('\x02', false);  // Send tmux prefix

  setTimeout(() => {
    // ':' enters command-line mode, then we type the split command
    terminal.sendText(':split-window -v', true);

    if (agentCommand) {
      // After split, new pane has focus with a shell prompt
      setTimeout(() => {
        terminal.sendText(agentCommand, true);
      }, 200);
    }
  }, 50);
}

export function tmuxSplitV(terminal: vscode.Terminal, agentCommand: string): void {
  const state = tmuxTerminals.get(terminal);
  if (!state) return;

  state.paneCount++;

  // When inside an attached tmux session (with Claude running), we can't type
  // shell commands directly - they go to Claude's input. Instead, we use tmux's
  // prefix key (Ctrl+B) to enter command mode.
  // \x02 = Ctrl+B (tmux default prefix)
  terminal.sendText('\x02', false);  // Send tmux prefix

  setTimeout(() => {
    // ':' enters command-line mode, then we type the split command
    terminal.sendText(':split-window -h', true);

    if (agentCommand) {
      // After split, new pane has focus with a shell prompt
      setTimeout(() => {
        terminal.sendText(agentCommand, true);
      }, 200);
    }
  }, 50);
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
    exec(`tmux kill-session -t ${state.session}`);
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
