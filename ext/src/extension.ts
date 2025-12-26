import * as vscode from 'vscode';
import { BUILT_IN_AGENTS, getBuiltInDefByTitle } from './agents';
import {
  AgentConfig,
  buildIconPath,
  createAgentConfig,
  getBuiltInByTitle
} from './agents.vscode';
import * as claudemd from './claudemd.vscode';
import { AgentsMarkdownEditorProvider, swarmCurrentDocument } from './customEditor';
import * as git from './git.vscode';
import { AgentSettings, hasLoginEnabled } from './settings';
import * as settings from './settings.vscode';
import * as swarm from './swarm.vscode';
import * as terminals from './terminals.vscode';
import {
  CLAUDE_TITLE,
  getExpandedAgentName,
  getTerminalDisplayInfo,
  parseTerminalName,
  sanitizeLabel
} from './utils';

// Settings types are now imported from ./settings
// Settings functions are in ./settings.vscode

let agentStatusBarItem: vscode.StatusBarItem | undefined;

// BUILT_IN_AGENTS is now imported from ./agents

function getAgentsToOpen(context: vscode.ExtensionContext): AgentConfig[] {
  const agentSettings = settings.getSettings(context);
  const extensionPath = context.extensionPath;
  const agents: AgentConfig[] = [];

  // Built-in agents
  for (const def of BUILT_IN_AGENTS) {
    const config = agentSettings.builtIn[def.key as keyof AgentSettings['builtIn']];
    if (config.login && config.instances > 0) {
      agents.push({ ...createAgentConfig(extensionPath, def.title, def.command, def.icon, def.prefix), count: config.instances });
    }
  }

  // Custom agents
  for (const custom of agentSettings.custom) {
    if (custom.login && custom.instances > 0) {
      agents.push({
        ...createAgentConfig(extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase()),
        count: custom.instances
      });
    }
  }

  return agents;
}

// getBuiltInByTitle is now imported from ./agents.vscode

interface AgentTerminalInfo {
  isAgent: boolean;
  prefix: string | null;
  label: string | null;
  iconPath: vscode.IconPath | null;
}

function identifyAgentTerminal(terminal: vscode.Terminal, extensionPath: string): AgentTerminalInfo {
  // First check terminals module state
  const entry = terminals.getByTerminal(terminal);
  if (entry && entry.agentConfig) {
    return {
      isAgent: true,
      prefix: entry.agentConfig.title,
      label: entry.label ?? null,
      iconPath: buildIconPath(entry.agentConfig.title, extensionPath)
    };
  }

  // Fall back to strict name parsing using shared util
  const parsed = parseTerminalName(terminal.name);
  if (parsed.isAgent && parsed.prefix) {
    return {
      isAgent: true,
      prefix: parsed.prefix,
      label: parsed.label,
      iconPath: buildIconPath(parsed.prefix, extensionPath)
    };
  }

  return { isAgent: false, prefix: null, label: null, iconPath: null };
}

function getAgentConfigFromTerminal(
  terminal: vscode.Terminal,
  context: vscode.ExtensionContext
): Omit<AgentConfig, 'count'> | null {
  const info = identifyAgentTerminal(terminal, context.extensionPath);

  if (!info.isAgent || !info.prefix) {
    // Check custom agents by name
    const terminalName = terminal.name.trim();
    const agentSettings = settings.getSettings(context);
    for (const custom of agentSettings.custom) {
      if (terminalName === custom.name || terminalName.startsWith(`${custom.name} - `)) {
        return createAgentConfig(context.extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase());
      }
    }
    return null;
  }

  // Check built-in agents
  const builtIn = getBuiltInDefByTitle(info.prefix);
  if (builtIn) {
    return createAgentConfig(context.extensionPath, builtIn.title, builtIn.command, builtIn.icon, builtIn.prefix);
  }

  // Check custom agents
  const agentSettings = settings.getSettings(context);
  for (const custom of agentSettings.custom) {
    if (info.prefix === custom.name) {
      return createAgentConfig(context.extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase());
    }
  }

  return null;
}

// Settings functions are now in ./settings.vscode

// scanExistingEditorTerminals is now terminals.scanExisting()

// Infer agent config from terminal name for scan
function inferAgentConfigFromName(name: string, extensionPath: string): Omit<AgentConfig, 'count'> | null {
  const info = getTerminalDisplayInfo(name);
  if (!info.isAgent || !info.prefix) return null;

  const def = getBuiltInDefByTitle(info.prefix);
  if (def) {
    return createAgentConfig(extensionPath, def.title, def.command, def.icon, def.prefix);
  }
  return null;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Cursor Agents extension is now active');

  // Create status bar item for showing active terminal status bar label
  agentStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  agentStatusBarItem.text = 'Agents';
  agentStatusBarItem.show();
  context.subscriptions.push(agentStatusBarItem);

  // Scan existing terminals in the editor area to register any agent terminals
  terminals.scanExisting((name) => inferAgentConfigFromName(name, context.extensionPath), context).catch(err => {
    console.error('[EXTENSION] Error scanning existing terminals:', err);
  });

  // Ensure CLAUDE.md has Swarm instructions if Swarm is enabled
  claudemd.ensureSwarmInstructions();

  // Register URI handler for notification callbacks
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path === '/focus') {
          // Parse terminalId from query string
          const params = new URLSearchParams(uri.query);
          const terminalId = params.get('terminalId');

          const entry = terminalId ? terminals.getById(terminalId) : undefined;
          if (entry) {
            entry.terminal.show();
            console.log(`Focused terminal: ${terminalId}`);
          } else {
            console.warn(`Terminal not found for ID: ${terminalId}`);
          }
        }
      }
    })
  );

  // Register custom markdown editor
  context.subscriptions.push(
    AgentsMarkdownEditorProvider.register(context)
  );

  // Swarm document command (Cmd+Shift+S in custom editor)
  context.subscriptions.push(
    vscode.commands.registerCommand('agents.swarmDocument', () =>
      swarmCurrentDocument(context)
    )
  );

  // New shell command
  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newShell', () => openNewShell())
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agents.open', () => openAgentTerminals(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.configure', () => settings.openPanel(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newAgent', () => {
      // Default is always Claude
      const agentConfig = getBuiltInByTitle(context.extensionPath, CLAUDE_TITLE);
      if (agentConfig) {
        openSingleAgent(context, agentConfig);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.setTitle', () => setStatusBarLabelForActiveTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.clear', () => clearActiveTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.generateCommit', git.generateCommitMessage)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.enableSwarm', () => swarm.enableSwarm(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newTask', () => newTaskWithContext(context))
  );

  // Register built-in individual agent commands
  for (const def of BUILT_IN_AGENTS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(def.commandId, () => {
        const agentConfig = getBuiltInByTitle(context.extensionPath, def.title);
        if (agentConfig) {
          openSingleAgent(context, agentConfig);
        }
      })
    );
  }

  // Dynamically register custom agent commands
  const customAgentSettings = settings.getSettings(context);
  for (const custom of customAgentSettings.custom) {
    const commandId = `agents.new${custom.name.replace(/[^a-zA-Z0-9]/g, '')}`;
    const agentConfig = createAgentConfig(context.extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase());

    context.subscriptions.push(
      vscode.commands.registerCommand(commandId, () => {
        openSingleAgent(context, agentConfig);
      })
    );

    console.log(`Registered custom agent command: ${commandId} for ${custom.name}`);
  }

  // Listen for terminal closures to update our tracking
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      terminals.unregister(terminal);
    })
  );

  // Update status bar when active terminal changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!agentStatusBarItem) return;

      if (!terminal) {
        agentStatusBarItem.text = 'Agents';
        return;
      }

      // Check if this is an agent terminal and scroll to bottom
      const agentInfo = identifyAgentTerminal(terminal, context.extensionPath);
      if (agentInfo.isAgent) {
        vscode.commands.executeCommand('workbench.action.terminal.scrollToBottom');
      }

      updateStatusBarForTerminal(terminal, context.extensionPath);
    })
  );

  // Reset status bar when a text editor becomes active (switching away from terminal)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (agentStatusBarItem) {
        agentStatusBarItem.text = 'Agents';
      }
    })
  );

  // Auto-open terminals on startup if any agents have login enabled
  const startupSettings = settings.getSettings(context);
  if (hasLoginEnabled(startupSettings)) {
    setTimeout(() => openAgentTerminals(context), 1000);
  }
}

async function openSingleAgent(context: vscode.ExtensionContext, agentConfig: Omit<AgentConfig, 'count'>) {
  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  // Generate ID first for env var
  const terminalId = terminals.nextId(agentConfig.prefix);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: editorLocation,
    name: agentConfig.title,
    env: {
      AGENT_TERMINAL_ID: terminalId,
      DISABLE_AUTO_TITLE: 'true',
      PROMPT_COMMAND: ''
    }
  });

  const pid = await terminal.processId;
  terminals.register(terminal, terminalId, agentConfig, pid, context);
  if (agentConfig.command) {
    terminal.sendText(agentConfig.command);
  }
}

async function newTaskWithContext(context: vscode.ExtensionContext) {
  // 1. Copy selection to clipboard (if any)
  await vscode.commands.executeCommand('workbench.action.terminal.copySelection');

  // 2. Read clipboard
  const clipboardText = await vscode.env.clipboard.readText();

  // 3. Get user prompt
  const userPrompt = await vscode.window.showInputBox({
    prompt: 'Enter task for the agent',
    placeHolder: 'What should the agent do?'
  });

  if (userPrompt === undefined) return; // User cancelled

  // 4. Format message
  let message: string;
  if (clipboardText && clipboardText.trim()) {
    message = `<context>\n${clipboardText.trim()}\n</context>\n\n${userPrompt}`;
  } else {
    message = userPrompt;
  }

  // 5. Open new Claude agent with queued message
  const agentConfig = getBuiltInByTitle(context.extensionPath, CLAUDE_TITLE);
  if (agentConfig) {
    await openSingleAgentWithQueue(context, agentConfig, [message]);
  }
}

async function openSingleAgentWithQueue(
  context: vscode.ExtensionContext,
  agentConfig: Omit<AgentConfig, 'count'>,
  messages: string[]
) {
  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  const terminalId = terminals.nextId(agentConfig.prefix);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: editorLocation,
    name: agentConfig.title,
    env: {
      AGENT_TERMINAL_ID: terminalId,
      DISABLE_AUTO_TITLE: 'true',
      PROMPT_COMMAND: ''
    }
  });

  const pid = await terminal.processId;
  terminals.register(terminal, terminalId, agentConfig, pid, context);

  // Queue messages
  for (const msg of messages) {
    terminals.queueMessage(terminal, msg);
  }

  // Send agent command
  if (agentConfig.command) {
    terminal.sendText(agentConfig.command);
  }

  // After delay, send queued messages
  setTimeout(() => {
    const queued = terminals.flushQueue(terminal);
    for (const msg of queued) {
      terminal.sendText(msg);
    }
  }, 2000); // 2s delay for agent to initialize
}

async function openAgentTerminals(context: vscode.ExtensionContext) {
  const agents = getAgentsToOpen(context);

  if (agents.length === 0) {
    vscode.window.showInformationMessage('No agents configured to open on login. Use "Agents: Settings" to configure.');
    return;
  }

  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  let totalCount = 0;

  for (const agent of agents) {
    for (let i = 0; i < agent.count; i++) {
      // Generate ID first for env var
      const terminalId = terminals.nextId(agent.prefix);
      const terminal = vscode.window.createTerminal({
        iconPath: agent.iconPath,
        location: editorLocation,
        name: agent.title,
        env: {
          AGENT_TERMINAL_ID: terminalId,
          DISABLE_AUTO_TITLE: 'true',
          PROMPT_COMMAND: ''
        }
      });

      const pid = await terminal.processId;
      terminals.register(terminal, terminalId, agent, pid, context);
      if (agent.command) {
        terminal.sendText(agent.command);
      }
      totalCount++;
    }
  }

  if (totalCount > 0) {
    vscode.window.showInformationMessage(`Opened ${totalCount} agent terminal${totalCount > 1 ? 's' : ''}`);
  }
}

function updateStatusBarForTerminal(terminal: vscode.Terminal, extensionPath: string) {
  if (!agentStatusBarItem) return;

  const entry = terminals.getByTerminal(terminal);
  const info = identifyAgentTerminal(terminal, extensionPath);

  // If this is an agent terminal, show its name
  if (info.isAgent && info.prefix) {
    const expandedName = getExpandedAgentName(info.prefix);
    const displayLabel = entry?.label || entry?.autoLabel;
    if (displayLabel) {
      agentStatusBarItem.text = `Agents: ${expandedName} - ${displayLabel}`;
    } else {
      agentStatusBarItem.text = `Agents: ${expandedName}`;
    }
    return;
  }

  // Not an agent terminal - show "Terminal" for regular shells
  agentStatusBarItem.text = 'Agents: Terminal';
}

function setStatusBarLabelForActiveTerminal(context: vscode.ExtensionContext) {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    vscode.window.showInformationMessage('No active terminal to set status bar label.');
    return;
  }

  const info = identifyAgentTerminal(terminal, context.extensionPath);
  if (!info.isAgent) {
    vscode.window.showInformationMessage('This terminal is not an agent terminal.');
    return;
  }

  const currentLabel = info.label ?? '';

  vscode.window.showInputBox({
    prompt: 'Set a status bar label for this agent',
    placeHolder: 'Status bar label (max 5 words)',
    value: currentLabel
  }).then(async (input) => {
    if (input === undefined) {
      return;
    }

    // Ensure terminal is registered before setting label
    let entry = terminals.getByTerminal(terminal);
    if (!entry && info.prefix) {
      const def = getBuiltInDefByTitle(info.prefix);
      if (def) {
        const agentConfig = createAgentConfig(context.extensionPath, def.title, def.command, def.icon, def.prefix);
        const id = terminals.nextId(info.prefix);
        const pid = await terminal.processId;
        terminals.register(terminal, id, agentConfig, pid, context);
      }
    }

    const cleaned = sanitizeLabel(input.trim());
    await terminals.setLabel(terminal, cleaned || undefined, context);

    // Update status bar only (don't rename terminal tab)
    updateStatusBarForTerminal(terminal, context.extensionPath);
  });
}

async function clearActiveTerminal(context: vscode.ExtensionContext) {
  try {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      vscode.window.showErrorMessage('No active terminal to clear.');
      return;
    }

    const agentConfig = getAgentConfigFromTerminal(terminal, context);
    if (!agentConfig) {
      vscode.window.showErrorMessage('Could not identify agent type from active terminal.');
      return;
    }

    // Send Ctrl+C twice to exit CLI agents (first interrupts, second exits)
    terminal.show();
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: '\u0003'
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: '\u0003'
    });

    // Wait for process to terminate
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
      terminal.sendText('clear && ' + agentConfig.command);

      // Clear status bar label (user-set and auto-generated)
      await terminals.setLabel(terminal, undefined, context);
      terminals.setAutoLabel(terminal, undefined);

      // Unpin the terminal if pinned
      await vscode.commands.executeCommand('workbench.action.unpinEditor');

      // Update status bar to reflect cleared label
      updateStatusBarForTerminal(terminal, context.extensionPath);

      const entry = terminals.getByTerminal(terminal);
      const agentNum = entry?.id ? entry.id.split('-').pop() : '';
      const numSuffix = agentNum ? ` agent # ${agentNum}` : ' agent';
      vscode.window.showInformationMessage(`Cleared ${getExpandedAgentName(agentConfig.title)}${numSuffix}`);
    } catch (sendError) {
      vscode.window.showWarningMessage('Terminal may have been closed. Please open a new agent terminal.');
    }
  } catch (error) {
    console.error('Error clearing terminal:', error);
    vscode.window.showErrorMessage(`Failed to clear terminal: ${error}`);
  }
}

// Git functions are now in ./git.vscode

function openNewShell() {
  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  vscode.window.createTerminal({
    location: editorLocation,
    name: 'Shell'
  });
}

export function deactivate() {
  // Dispose all tracked terminals
  for (const entry of terminals.getAllTerminals()) {
    entry.terminal.dispose();
  }
  terminals.clear();
}
