import * as vscode from 'vscode';
import * as path from 'path';

interface TerminalState {
  claudeCount: number;
  codexCount: number;
  terminalIds: string[];
}

let managedTerminals: vscode.Terminal[] = [];

const CLAUDE_TITLE = 'CC';
const CODEX_TITLE = 'CX';

async function setTerminalTitle(terminal: vscode.Terminal, title: string) {
  try {
    terminal.show();
    await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: title });
  } catch (error) {
    console.error(`Failed to set terminal title to ${title}`, error);
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Cursor Agents extension is now active');

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.open', () => openAgentTerminals(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.closeAll', closeAllTerminals)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.configure', configureCounts)
  );

  // Listen for terminal closures to update our tracking
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      const index = managedTerminals.indexOf(terminal);
      if (index !== -1) {
        managedTerminals.splice(index, 1);
      }
    })
  );

  // Auto-open terminals on startup if previously configured
  const state = context.globalState.get<TerminalState>('terminalState');
  if (state && state.terminalIds.length > 0) {
    // Delay to ensure workspace is fully loaded
    setTimeout(() => openAgentTerminals(context), 1000);
  }
}

async function openAgentTerminals(context: vscode.ExtensionContext) {
  // Close any existing managed terminals first
  closeAllTerminals();

  const config = vscode.workspace.getConfiguration('agentTabs');
  const claudeCount = config.get<number>('claudeCount', 2);
  const codexCount = config.get<number>('codexCount', 2);

  // Get extension path for icons
  const extensionPath = context.extensionPath;
  const claudeIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'logo1-claude.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'logo1-claude.png'))
  };
  const codexIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'logo1-chatgpt.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'logo1-chatgpt.png'))
  };
  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  // Create Claude terminals
  for (let i = 0; i < claudeCount; i++) {
    const terminal = vscode.window.createTerminal({
      iconPath: claudeIconPath,
      location: editorLocation,
      isTransient: true,
      name: CLAUDE_TITLE
    });

    // Send the claude command
    terminal.sendText('claude');
    await setTerminalTitle(terminal, CLAUDE_TITLE);

    managedTerminals.push(terminal);
  }

  // Create Codex terminals
  for (let i = 0; i < codexCount; i++) {
    const terminal = vscode.window.createTerminal({
      iconPath: codexIconPath,
      location: editorLocation,
      isTransient: true,
      name: CODEX_TITLE
    });

    // Send the codex command
    terminal.sendText('codex');
    await setTerminalTitle(terminal, CODEX_TITLE);

    managedTerminals.push(terminal);
  }

  // Note: VSCode API does not provide a way to programmatically pin terminal tabs
  // Users will need to manually pin terminals if desired

  // Save state for persistence
  const state: TerminalState = {
    claudeCount,
    codexCount,
    terminalIds: managedTerminals.map((_, idx) => `terminal-${idx}`)
  };
  await context.globalState.update('terminalState', state);

  vscode.window.showInformationMessage(
    `Opened ${claudeCount} Claude and ${codexCount} Codex terminals`
  );
}

function closeAllTerminals() {
  for (const terminal of managedTerminals) {
    terminal.dispose();
  }
  managedTerminals = [];
}

async function configureCounts() {
  const config = vscode.workspace.getConfiguration('agentTabs');

  const claudeInput = await vscode.window.showInputBox({
    prompt: 'Number of Claude Code terminals',
    value: config.get<number>('claudeCount', 2).toString(),
    validateInput: (value) => {
      const num = parseInt(value);
      if (isNaN(num) || num < 1 || num > 10) {
        return 'Please enter a number between 1 and 10';
      }
      return null;
    }
  });

  if (claudeInput === undefined) {
    return; // User cancelled
  }

  const codexInput = await vscode.window.showInputBox({
    prompt: 'Number of Codex terminals',
    value: config.get<number>('codexCount', 2).toString(),
    validateInput: (value) => {
      const num = parseInt(value);
      if (isNaN(num) || num < 1 || num > 10) {
        return 'Please enter a number between 1 and 10';
      }
      return null;
    }
  });

  if (codexInput === undefined) {
    return; // User cancelled
  }

  // Update configuration
  await config.update('claudeCount', parseInt(claudeInput), vscode.ConfigurationTarget.Global);
  await config.update('codexCount', parseInt(codexInput), vscode.ConfigurationTarget.Global);

  const action = await vscode.window.showInformationMessage(
    'Configuration updated. Open terminals now?',
    'Yes',
    'No'
  );

  if (action === 'Yes') {
    vscode.commands.executeCommand('agentTabs.open');
  }
}

export function deactivate() {
  closeAllTerminals();
}
