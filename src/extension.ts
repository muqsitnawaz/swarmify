import * as vscode from 'vscode';
import * as path from 'path';

interface TerminalState {
  claudeCount: number;
  codexCount: number;
  geminiCount: number;
  terminalIds: string[];
}

interface AgentConfig {
  title: string;
  command: string;
  count: number;
  iconPath: vscode.IconPath;
  prefix: string;
}

interface CustomAgentSettings {
  title: string;
  command: string;
  count: number;
  iconPath?: string;
}

let managedTerminals: vscode.Terminal[] = [];
// Map to track terminal ID -> terminal instance for URI callbacks
const terminalMap = new Map<string, vscode.Terminal>();

const CLAUDE_TITLE = 'CC';
const CODEX_TITLE = 'CX';
const GEMINI_TITLE = 'GM';

function getBuiltInAgents(extensionPath: string): AgentConfig[] {
  const claudeIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'logo1-claude.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'logo1-claude.png'))
  };

  const codexIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'logo1-chatgpt.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'logo1-chatgpt.png'))
  };

  const geminiIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'gemini.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'gemini.png'))
  };

  const config = vscode.workspace.getConfiguration('agentTabs');
  const claudeCount = config.get<number>('claudeCount', 2);
  const codexCount = config.get<number>('codexCount', 2);
  const geminiCount = config.get<number>('geminiCount', 2);

  return [
    {
      title: CLAUDE_TITLE,
      command: 'claude',
      count: claudeCount,
      iconPath: claudeIconPath,
      prefix: 'cc'
    },
    {
      title: CODEX_TITLE,
      command: 'codex',
      count: codexCount,
      iconPath: codexIconPath,
      prefix: 'cx'
    },
    {
      title: GEMINI_TITLE,
      command: 'gemini',
      count: geminiCount,
      iconPath: geminiIconPath,
      prefix: 'gm'
    }
  ];
}

function getCustomAgents(extensionPath: string): AgentConfig[] {
  const config = vscode.workspace.getConfiguration('agentTabs');
  const customAgents = config.get<CustomAgentSettings[]>('customAgents', []);

  const defaultIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'agents.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'agents.png'))
  };

  return customAgents.map((agent) => {
    const iconPath = agent.iconPath
      ? {
          light: vscode.Uri.file(path.join(extensionPath, agent.iconPath)),
          dark: vscode.Uri.file(path.join(extensionPath, agent.iconPath))
        }
      : defaultIconPath;

    // Generate prefix from title (lowercase, remove spaces/special chars)
    const prefix = agent.title.toLowerCase().replace(/[^a-z0-9]/g, '');

    return {
      title: agent.title,
      command: agent.command,
      count: agent.count,
      iconPath,
      prefix
    };
  });
}

function getAllAgents(extensionPath: string): AgentConfig[] {
  return [...getBuiltInAgents(extensionPath), ...getCustomAgents(extensionPath)];
}

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

  // Register URI handler for notification callbacks
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path === '/focus') {
          // Parse terminalId from query string
          const params = new URLSearchParams(uri.query);
          const terminalId = params.get('terminalId');

          if (terminalId && terminalMap.has(terminalId)) {
            const terminal = terminalMap.get(terminalId);
            if (terminal) {
              // Focus Cursor window and show the terminal
              terminal.show();
              console.log(`Focused terminal: ${terminalId}`);
            }
          } else {
            console.warn(`Terminal not found for ID: ${terminalId}`);
          }
        }
      }
    })
  );

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

  // Register built-in individual agent commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.newClaudeCode', () => {
      const builtInAgents = getBuiltInAgents(context.extensionPath);
      const claudeAgent = builtInAgents.find(a => a.title === CLAUDE_TITLE);
      if (claudeAgent) {
        openSingleAgent(context, claudeAgent);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.newCodex', () => {
      const builtInAgents = getBuiltInAgents(context.extensionPath);
      const codexAgent = builtInAgents.find(a => a.title === CODEX_TITLE);
      if (codexAgent) {
        openSingleAgent(context, codexAgent);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.newGemini', () => {
      const builtInAgents = getBuiltInAgents(context.extensionPath);
      const geminiAgent = builtInAgents.find(a => a.title === GEMINI_TITLE);
      if (geminiAgent) {
        openSingleAgent(context, geminiAgent);
      }
    })
  );

  // Dynamically register custom agent commands
  const customAgents = getCustomAgents(context.extensionPath);
  for (const agent of customAgents) {
    // Create a command ID from the agent title (sanitized)
    const commandId = `agentTabs.new${agent.title.replace(/[^a-zA-Z0-9]/g, '')}`;

    // Register command with closure to capture the agent config
    const disposable = vscode.commands.registerCommand(commandId, () => {
      openSingleAgent(context, agent);
    });

    context.subscriptions.push(disposable);

    console.log(`Registered custom agent command: ${commandId} for ${agent.title}`);
  }

  // Listen for terminal closures to update our tracking
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      const index = managedTerminals.indexOf(terminal);
      if (index !== -1) {
        managedTerminals.splice(index, 1);
      }

      // Clean up terminal map
      for (const [id, term] of terminalMap.entries()) {
        if (term === terminal) {
          terminalMap.delete(id);
          break;
        }
      }
    })
  );

  // Auto-open terminals on startup if previously configured and autoStart is enabled
  const config = vscode.workspace.getConfiguration('agentTabs');
  const autoStart = config.get<boolean>('autoStart', false);
  const state = context.globalState.get<TerminalState>('terminalState');

  if (autoStart && state && state.terminalIds.length > 0) {
    // Delay to ensure workspace is fully loaded
    setTimeout(() => openAgentTerminals(context), 1000);
  }
}

async function openSingleAgent(context: vscode.ExtensionContext, agentConfig: AgentConfig) {
  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  const terminalId = `${agentConfig.prefix}-${Date.now()}-0`;
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: editorLocation,
    isTransient: true,
    name: agentConfig.title,
    env: {
      CLAUDE_TERMINAL_ID: terminalId
    }
  });

  // Store terminal in map for URI callback
  terminalMap.set(terminalId, terminal);

  // Send the agent command
  terminal.sendText(agentConfig.command);
  await setTerminalTitle(terminal, agentConfig.title);

  managedTerminals.push(terminal);
}

async function openAgentTerminals(context: vscode.ExtensionContext) {
  const extensionPath = context.extensionPath;
  const agents = getAllAgents(extensionPath);

  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  let totalCount = 0;

  // Create terminals for each agent type
  for (const agent of agents) {
    for (let i = 0; i < agent.count; i++) {
      const terminalId = `${agent.prefix}-${Date.now()}-${i}`;
      const terminal = vscode.window.createTerminal({
        iconPath: agent.iconPath,
        location: editorLocation,
        isTransient: true,
        name: agent.title,
        env: {
          CLAUDE_TERMINAL_ID: terminalId
        }
      });

      // Store terminal in map for URI callback
      terminalMap.set(terminalId, terminal);

      // Send the agent command
      terminal.sendText(agent.command);
      await setTerminalTitle(terminal, agent.title);

      managedTerminals.push(terminal);
      totalCount++;
    }
  }

  // Note: VSCode API does not provide a way to programmatically pin terminal tabs
  // Users will need to manually pin terminals if desired

  // Save state for persistence
  const config = vscode.workspace.getConfiguration('agentTabs');
  const state: TerminalState = {
    claudeCount: config.get<number>('claudeCount', 2),
    codexCount: config.get<number>('codexCount', 2),
    geminiCount: config.get<number>('geminiCount', 2),
    terminalIds: managedTerminals.map((_, idx) => `terminal-${idx}`)
  };
  await context.globalState.update('terminalState', state);

  if (totalCount > 0) {
    vscode.window.showInformationMessage(
      `Opened ${totalCount} agent terminal${totalCount > 1 ? 's' : ''}`
    );
  }
}

function closeAllTerminals() {
  for (const terminal of managedTerminals) {
    terminal.dispose();
  }
  managedTerminals = [];
  terminalMap.clear();
}

async function configureCounts() {
  const config = vscode.workspace.getConfiguration('agentTabs');

  const claudeInput = await vscode.window.showInputBox({
    prompt: 'Number of Claude Code terminals',
    value: config.get<number>('claudeCount', 2).toString(),
    validateInput: (value) => {
      const num = parseInt(value);
      if (isNaN(num) || num < 0 || num > 10) {
        return 'Please enter a number between 0 and 10';
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
      if (isNaN(num) || num < 0 || num > 10) {
        return 'Please enter a number between 0 and 10';
      }
      return null;
    }
  });

  if (codexInput === undefined) {
    return; // User cancelled
  }

  const geminiInput = await vscode.window.showInputBox({
    prompt: 'Number of Gemini terminals',
    value: config.get<number>('geminiCount', 2).toString(),
    validateInput: (value) => {
      const num = parseInt(value);
      if (isNaN(num) || num < 0 || num > 10) {
        return 'Please enter a number between 0 and 10';
      }
      return null;
    }
  });

  if (geminiInput === undefined) {
    return; // User cancelled
  }

  // Update configuration
  await config.update('claudeCount', parseInt(claudeInput), vscode.ConfigurationTarget.Global);
  await config.update('codexCount', parseInt(codexInput), vscode.ConfigurationTarget.Global);
  await config.update('geminiCount', parseInt(geminiInput), vscode.ConfigurationTarget.Global);

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
