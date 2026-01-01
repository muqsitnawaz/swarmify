// Tmux integration - VS Code dependent functions

import { exec } from 'child_process';
import * as vscode from 'vscode';

interface TmuxTerminal {
  terminal: vscode.Terminal;
  session: string;
  agentType: string;
  paneCount: number;
}

const tmuxTerminals = new Map<vscode.Terminal, TmuxTerminal>();

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

  const tmuxInit = [
    `tmux new-session -s ${session} -n main`,
    'tmux set -g mouse on',
    'tmux set -g pane-border-status top',
    `tmux set -g pane-border-format " #{pane_index}: ${name} "`,
  ].join(' \\; ');

  terminal.sendText(tmuxInit, true);

  if (agentCommand) {
    setTimeout(() => {
      terminal.sendText(agentCommand, true);
    }, 200);
  }

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
  terminal.sendText('tmux split-window -v', true);

  if (agentCommand) {
    setTimeout(() => {
      terminal.sendText(agentCommand, true);
    }, 100);
  }
}

export function tmuxSplitV(terminal: vscode.Terminal, agentCommand: string): void {
  const state = tmuxTerminals.get(terminal);
  if (!state) return;

  state.paneCount++;
  terminal.sendText('tmux split-window -h', true);

  if (agentCommand) {
    setTimeout(() => {
      terminal.sendText(agentCommand, true);
    }, 100);
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
