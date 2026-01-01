import * as vscode from 'vscode';
import { BUILT_IN_AGENTS, getBuiltInByKey, getBuiltInDefByTitle } from './agents';
import {
  AgentConfig,
  buildIconPath,
  createAgentConfig,
  getBuiltInByTitle
} from './agents.vscode';
import * as claudemd from './claudemd.vscode';
import { AgentsMarkdownEditorProvider, swarmCurrentDocument } from './customEditor';
import * as git from './git.vscode';
import { AgentSettings, hasLoginEnabled, PromptEntry } from './settings';
import * as settings from './settings.vscode';
import * as swarm from './swarm.vscode';
import * as notifications from './notifications.vscode';
import * as terminals from './terminals.vscode';
import * as workbench from './workbench.vscode';
import {
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  CURSOR_TITLE,
  OPENCODE_TITLE,
  findTerminalNameByTabLabel,
  getExpandedAgentName,
  getTerminalDisplayInfo,
  parseTerminalName,
  sanitizeLabel,
  formatTerminalTitle
} from './utils';
import {
  createTmuxTerminal,
  getTmuxState,
  isTmuxTerminal,
  registerTmuxCleanup,
  tmuxSplitH,
  tmuxSplitV,
  isTmuxAvailable
} from './tmux';
import { DEFAULT_DISPLAY_PREFERENCES } from './settings';

// Settings types are now imported from ./settings
// Settings functions are in ./settings.vscode

let agentStatusBarItem: vscode.StatusBarItem | undefined;
let defaultAgentTitle: string = CLAUDE_TITLE;

// BUILT_IN_AGENTS is now imported from ./agents

// Prompts helpers (file-based storage at ~/.swarmify/agents/prompts.yaml)
function getPrompts(): PromptEntry[] {
  return settings.readPrompts();
}

function savePrompts(prompts: PromptEntry[]): void {
  settings.writePrompts(prompts);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

function getDisplayPrefs(context: vscode.ExtensionContext) {
  return settings.getSettings(context).display || DEFAULT_DISPLAY_PREFERENCES;
}

function buildTerminalTitle(prefix: string, label: string | undefined | null, context: vscode.ExtensionContext): string {
  const display = getDisplayPrefs(context);
  return formatTerminalTitle(prefix, { label: label || undefined, display });
}

interface PromptQuickPickItem extends vscode.QuickPickItem {
  entry?: PromptEntry;
  isAddNew?: boolean;
}

async function showPrompts(): Promise<void> {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    vscode.window.showInformationMessage('No active terminal');
    return;
  }

  const parsed = parseTerminalName(terminal.name);
  if (!parsed.isAgent) {
    vscode.window.showInformationMessage('Active terminal is not an agent terminal');
    return;
  }

  const prompts = getPrompts();

  // Sort: favorites first, then by accessedAt descending (most recently used first)
  const sorted = [...prompts].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return b.accessedAt - a.accessedAt;
  });

  const quickPick = vscode.window.createQuickPick<PromptQuickPickItem>();
  quickPick.placeholder = 'Search prompts...';
  quickPick.matchOnDescription = true;

  const buildItems = (): PromptQuickPickItem[] => {
    const items: PromptQuickPickItem[] = sorted.map(entry => ({
      label: `${entry.isFavorite ? '$(star-full) ' : ''}${entry.title}`,
      description: truncateText(entry.content, 50),
      detail: entry.content,
      entry,
      buttons: [
        {
          iconPath: new vscode.ThemeIcon(entry.isFavorite ? 'star-full' : 'star-empty'),
          tooltip: entry.isFavorite ? 'Remove from favorites' : 'Add to favorites'
        },
        {
          iconPath: new vscode.ThemeIcon('trash'),
          tooltip: 'Delete prompt'
        }
      ]
    }));

    items.push({
      label: '$(add) Add new prompt',
      isAddNew: true
    });

    return items;
  };

  quickPick.items = buildItems();

  quickPick.onDidTriggerItemButton(async (e) => {
    const item = e.item;
    if (!item.entry) return;

    const buttonIndex = (quickPick.items.find(i => i.entry?.id === item.entry?.id) as PromptQuickPickItem)
      ?.buttons?.indexOf(e.button);

    if (buttonIndex === 0) {
      // Toggle favorite
      item.entry.isFavorite = !item.entry.isFavorite;
      item.entry.updatedAt = Date.now();
      savePrompts(prompts);
      // Re-sort and rebuild items
      sorted.sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return b.accessedAt - a.accessedAt;
      });
      quickPick.items = buildItems();
    } else if (buttonIndex === 1) {
      // Delete
      const idx = prompts.findIndex(p => p.id === item.entry?.id);
      if (idx !== -1) {
        prompts.splice(idx, 1);
        const sortedIdx = sorted.findIndex(p => p.id === item.entry?.id);
        if (sortedIdx !== -1) sorted.splice(sortedIdx, 1);
        savePrompts(prompts);
        quickPick.items = buildItems();
      }
    }
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected) return;

    quickPick.hide();

    if (selected.isAddNew) {
      // Add new prompt flow
      const title = await vscode.window.showInputBox({
        prompt: 'Prompt title',
        placeHolder: 'e.g., Debug Helper'
      });
      if (!title) return;

      const content = await vscode.window.showInputBox({
        prompt: 'Prompt content',
        placeHolder: 'Enter the prompt text...'
      });
      if (!content) return;

      const now = Date.now();
      const newEntry: PromptEntry = {
        id: generateId(),
        title,
        content,
        isFavorite: false,
        createdAt: now,
        updatedAt: now,
        accessedAt: now
      };

      prompts.push(newEntry);
      savePrompts(prompts);
      vscode.window.showInformationMessage(`Added "${title}" to Prompts`);
    } else if (selected.entry) {
      // Update accessedAt and paste to terminal (no auto-execute)
      selected.entry.accessedAt = Date.now();
      savePrompts(prompts);
      terminal.sendText(selected.entry.content, false);
      terminal.show();
    }
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

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

export async function activate(context: vscode.ExtensionContext) {
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

  // Register terminals that appear after activation (e.g., restored sessions)
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(async (terminal) => {
      // Already tracked?
      if (terminals.getByTerminal(terminal)) {
        return;
      }

      const info = getTerminalDisplayInfo(terminal.name);
      if (!info.isAgent || !info.prefix) {
        return;
      }

      const agentConfig = inferAgentConfigFromName(terminal.name, context.extensionPath);
      if (!agentConfig) {
        return;
      }

      const id = terminals.nextId(info.prefix);
      let pid: number | undefined;
      try {
        pid = await terminal.processId;
      } catch {
        // ignore
      }

      terminals.register(terminal, id, agentConfig, pid, context, info.label || undefined);
    })
  );

  registerTmuxCleanup(context);

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

  // Load cached default agent if set
  const storedDefault = context.globalState.get<string>('agents.defaultAgentTitle');
  if (storedDefault) {
    defaultAgentTitle = storedDefault;
  }

  // Set initial context keys and subscribe to config changes
  await updateContextKeys();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('agents')) {
        await updateContextKeys();
      }
    })
  );

  // Run lightweight first-setup if needed
  await maybeRunFirstSetup(context);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agents.open', () => openAgentTerminals(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.configure', () => settings.openPanel(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.settings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:agents');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newAgent', () => {
      // Default is always Claude
      const agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
      if (agentConfig) {
        openSingleAgent(context, agentConfig);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newAgentHSplit', async () => {
      const config = vscode.workspace.getConfiguration('agents');
      const enableTmux = config.get<boolean>('enableTmux', false);
      const terminal = vscode.window.activeTerminal;

      if (enableTmux && terminal && isTmuxTerminal(terminal)) {
        const state = getTmuxState(terminal);
        if (state) {
          const agentDef = getBuiltInByKey(state.agentType);
          const customAgent = !agentDef
            ? settings.getSettings(context).custom.find(agent => agent.name === state.agentType)
            : undefined;
          const command = agentDef?.command ?? customAgent?.command ?? '';
          tmuxSplitH(terminal, command);
        }
        return;
      }

      // Create horizontal split (new editor group below current)
      await vscode.commands.executeCommand('workbench.action.splitEditorDown');

      // Open default agent in the new (active) group
      const agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
      if (agentConfig) {
        openSingleAgent(context, agentConfig);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newAgentVSplit', async () => {
      const config = vscode.workspace.getConfiguration('agents');
      const enableTmux = config.get<boolean>('enableTmux', false);
      const terminal = vscode.window.activeTerminal;

      if (enableTmux && terminal && isTmuxTerminal(terminal)) {
        const state = getTmuxState(terminal);
        if (state) {
          const agentDef = getBuiltInByKey(state.agentType);
          const customAgent = !agentDef
            ? settings.getSettings(context).custom.find(agent => agent.name === state.agentType)
            : undefined;
          const command = agentDef?.command ?? customAgent?.command ?? '';
          tmuxSplitV(terminal, command);
        }
        return;
      }

      // Create vertical split (new editor group to the side)
      await vscode.commands.executeCommand('workbench.action.splitEditor');

      // Open default agent in the new (active) group
      const agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
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
    vscode.commands.registerCommand('agents.autogit', git.generateCommitMessage)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.enableSwarm', () => swarm.enableSwarm(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.enableNotifications', () => notifications.enableNotifications(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.enableTmux', async () => {
      const config = vscode.workspace.getConfiguration();
      const current = config.get<boolean>('agents.enableTmux', false);
      await config.update('agents.enableTmux', !current, vscode.ConfigurationTarget.Global);
      const status = !current ? 'enabled' : 'disabled';
      vscode.window.showInformationMessage(`Tmux mode ${status}. New agent terminals will ${!current ? 'use tmux for per-tab splits' : 'use VS Code editor splits'}.`);
      await updateContextKeys();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.disableTmux', async () => {
      const config = vscode.workspace.getConfiguration();
      const current = config.get<boolean>('agents.enableTmux', false);
      if (current) {
        await config.update('agents.enableTmux', false, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Tmux mode disabled. New agent terminals will use VS Code editor splits.');
        await updateContextKeys();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.newTask', () => newTaskWithContext(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.openAgent', () => goToTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.prompts', () => showPrompts())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.setDefaultAgentTitle', (title: string) => {
      defaultAgentTitle = title;
      context.globalState.update('agents.defaultAgentTitle', title);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.enableView', async () => {
      const enabled = await workbench.toggleStreamlineLayout();
      vscode.window.showInformationMessage(
        enabled ? 'Streamline layout enabled' : 'Streamline layout disabled'
      );
      await updateContextKeys();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.disableView', async () => {
      await workbench.disableStreamlineLayout();
      vscode.window.showInformationMessage('Streamline layout disabled');
      await updateContextKeys();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.runSetup', async () => {
      await maybeRunFirstSetup(context, true);
    })
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
      console.log('[DEBUG] onDidChangeActiveTerminal fired, terminal:', terminal?.name);
      if (!agentStatusBarItem) return;

      if (!terminal) {
        agentStatusBarItem.text = 'Agents';
        return;
      }

      // Check if this is an agent terminal and scroll to bottom
      const agentInfo = identifyAgentTerminal(terminal, context.extensionPath);
      console.log('[DEBUG] agentInfo:', JSON.stringify({ isAgent: agentInfo.isAgent, prefix: agentInfo.prefix, label: agentInfo.label }));
      if (agentInfo.isAgent) {
        vscode.commands.executeCommand('workbench.action.terminal.scrollToBottom');
      }

      const entry = terminals.getByTerminal(terminal);
      console.log('[DEBUG] entry for terminal:', entry?.id, 'label:', entry?.label);

      updateStatusBarForTerminal(terminal, context.extensionPath);
    })
  );

  // Update status bar when active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!agentStatusBarItem) return;

      if (editor) {
        // Switching to a real text editor - reset status bar
        agentStatusBarItem.text = 'Agents';
      } else {
        // editor is undefined - could be switching to a terminal tab
        // Check if active tab is a terminal and update status bar accordingly
        const activeGroup = vscode.window.tabGroups.activeTabGroup;
        const activeTab = activeGroup?.activeTab;

        if (activeTab?.input instanceof vscode.TabInputTerminal) {
          const terminalNames = vscode.window.terminals.map(t => t.name);
          const matchedName = findTerminalNameByTabLabel(terminalNames, activeTab.label);
          if (matchedName) {
            const matchedTerminal = vscode.window.terminals.find(t => t.name === matchedName);
            if (matchedTerminal) {
              updateStatusBarForTerminal(matchedTerminal, context.extensionPath);
              return;
            }
          }
        }
      }
    })
  );

  // Listen for tab changes to catch editor-area terminal switches
  // (onDidChangeActiveTerminal doesn't fire reliably for terminal editor tabs)
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (!agentStatusBarItem) return;

      // Check if the active tab in the active group is a terminal
      const activeGroup = vscode.window.tabGroups.activeTabGroup;
      const activeTab = activeGroup?.activeTab;

      if (!activeTab || !(activeTab.input instanceof vscode.TabInputTerminal)) {
        // Not a terminal tab - already handled by onDidChangeActiveTextEditor
        return;
      }

      // Find the terminal that matches this tab by name
      const terminalNames = vscode.window.terminals.map(t => t.name);
      const matchedName = findTerminalNameByTabLabel(terminalNames, activeTab.label);
      if (matchedName) {
        const matchedTerminal = vscode.window.terminals.find(t => t.name === matchedName);
        if (matchedTerminal) {
          updateStatusBarForTerminal(matchedTerminal, context.extensionPath);
        }
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
  const config = vscode.workspace.getConfiguration('agents');
  const enableTmux = config.get<boolean>('enableTmux', false);
  const tmuxOk = enableTmux ? await isTmuxAvailable() : false;

  if (enableTmux && !tmuxOk) {
    vscode.window.showWarningMessage('Tmux mode is enabled, but tmux is not available on PATH. Falling back to VS Code splits.');
  }

  if (tmuxOk) {
    const title = buildTerminalTitle(agentConfig.title, undefined, context);
    const terminalId = terminals.nextId(agentConfig.prefix);
    const builtInDef = getBuiltInDefByTitle(agentConfig.title);
    const agentType = builtInDef?.key ?? agentConfig.title;
    const terminal = createTmuxTerminal(
      title,
      agentType,
      agentConfig.command || '',
      {
        iconPath: agentConfig.iconPath as vscode.Uri,
        env: {
          AGENT_TERMINAL_ID: terminalId,
          DISABLE_AUTO_TITLE: 'true',
          PROMPT_COMMAND: ''
        },
        viewColumn: vscode.ViewColumn.Active
      }
    );

    const pid = await terminal.processId;
    terminals.register(terminal, terminalId, agentConfig, pid, context);
    terminal.show();
    return;
  }

  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  // Generate ID first for env var
  const terminalId = terminals.nextId(agentConfig.prefix);
  const title = buildTerminalTitle(agentConfig.title, undefined, context);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: editorLocation,
    name: title,
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
  const agentConfig = getBuiltInByTitle(context.extensionPath, defaultAgentTitle);
  if (agentConfig) {
    await openSingleAgentWithQueue(context, agentConfig, [message]);
  }
}

interface TerminalQuickPickItem extends vscode.QuickPickItem {
  terminal: vscode.Terminal;
}

async function goToTerminal(context: vscode.ExtensionContext) {
  // Use internal registry - each entry has unique ID, no ambiguous matching needed
  const allEntries = terminals.getAllTerminals();

  // Filter to agent terminals and build quick pick items
  const items: TerminalQuickPickItem[] = [];

  for (const entry of allEntries) {
    // Skip non-agent terminals
    if (!entry.agentConfig) continue;

    const expandedName = getExpandedAgentName(entry.agentConfig.prefix);
    const label = entry.label || entry.autoLabel;

    items.push({
      label: expandedName,
      description: label || '',
      terminal: entry.terminal
    });
  }

  if (items.length === 0) {
    vscode.window.showInformationMessage('No agent terminals open');
    return;
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Go to terminal',
    matchOnDescription: true
  });

  if (selected) {
    selected.terminal.show();
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
  const title = buildTerminalTitle(agentConfig.title, undefined, context);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: editorLocation,
    name: title,
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

  // After delay, send queued messages (5s to ensure agent process fully loaded)
  setTimeout(() => {
    const queued = terminals.flushQueue(terminal);
    for (const msg of queued) {
      terminal.sendText(msg);
    }
  }, 5000);
}

async function openAgentTerminals(context: vscode.ExtensionContext) {
  const agents = getAgentsToOpen(context);

  if (agents.length === 0) {
    vscode.window.showInformationMessage('No agents configured to open on login. Use "Agents: Dashboard" to configure.');
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
      const title = buildTerminalTitle(agent.title, undefined, context);
      const terminal = vscode.window.createTerminal({
        iconPath: agent.iconPath,
        location: editorLocation,
        name: title,
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

    // Optionally update tab title when labels are shown in titles
    const display = getDisplayPrefs(context);
    if (display.showLabelsInTitles && info.prefix) {
      const newTitle = buildTerminalTitle(info.prefix, cleaned || undefined, context);
      await terminals.renameTerminal(terminal, newTitle);
    }
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

      // If labels were shown in titles, reset the tab title to base
      const display = getDisplayPrefs(context);
      if (display.showLabelsInTitles && agentConfig.title) {
        const baseTitle = buildTerminalTitle(agentConfig.title, null, context);
        await terminals.renameTerminal(terminal, baseTitle);
      }

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

async function updateContextKeys(): Promise<void> {
  const config = vscode.workspace.getConfiguration('agents');
  const tmuxEnabled = config.get<boolean>('enableTmux', false);
  await vscode.commands.executeCommand('setContext', 'agents.tmuxEnabled', tmuxEnabled);

  const viewEnabled = workbench.isStreamlineLayout();
  await vscode.commands.executeCommand('setContext', 'agents.viewEnabled', viewEnabled);
}

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const child = require('child_process').exec(`${whichCmd} ${cmd}`, (err: Error | null) => {
      resolve(!err);
    });
    if (!child) resolve(false);
  });
}

async function detectDefaultAgentTitle(): Promise<string> {
  const candidates = [
    { title: CLAUDE_TITLE, command: 'claude' },
    { title: CODEX_TITLE, command: 'codex' },
    { title: GEMINI_TITLE, command: 'gemini' },
    { title: CURSOR_TITLE, command: 'cursor-agent' },
    { title: OPENCODE_TITLE, command: 'opencode' }
  ];

  for (const candidate of candidates) {
    if (await commandExists(candidate.command)) {
      return candidate.title;
    }
  }

  return CLAUDE_TITLE;
}

async function maybeRunFirstSetup(context: vscode.ExtensionContext, force = false): Promise<void> {
  const already = context.globalState.get<boolean>('agents.setupComplete', false);
  if (already && !force) {
    const stored = context.globalState.get<string>('agents.defaultAgentTitle');
    if (stored) {
      defaultAgentTitle = stored;
    }
    return;
  }

  // Detect default agent automatically
  const detected = await detectDefaultAgentTitle();
  defaultAgentTitle = detected;
  await context.globalState.update('agents.defaultAgentTitle', detected);

  // Ensure swarm MCP + command is enabled
  try {
    const status = await swarm.getSwarmStatus();
    if (!status.mcpEnabled || !status.commandInstalled) {
      await swarm.enableSwarm(context);
    }
  } catch {
    // Non-fatal; user can rerun setup
  }

  await context.globalState.update('agents.setupComplete', true);
  vscode.window.showInformationMessage(`Agents setup completed. Default agent: ${detected}.`);
}

// Git functions are now in ./git.vscode

export function deactivate() {
  // Dispose all tracked terminals
  for (const entry of terminals.getAllTerminals()) {
    entry.terminal.dispose();
  }
  terminals.clear();
}
