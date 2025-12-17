import * as vscode from 'vscode';
import * as path from 'path';
import {
  parseTerminalName,
  sanitizeLabel,
  getExpandedAgentName,
  getTerminalDisplayInfo,
  mergeMcpConfig,
  createSwarmServerConfig,
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  CURSOR_TITLE,
  McpConfig
} from './utils';
import { BUILT_IN_AGENTS, getBuiltInDefByTitle } from './agents';
import {
  AgentConfig,
  createAgentConfig,
  getBuiltInByTitle,
  buildIconPath
} from './agents.vscode';
import * as terminals from './terminals.vscode';

// Settings types for webview
interface BuiltInAgentConfig {
  login: boolean;
  instances: number;
}

interface CustomAgentConfig {
  name: string;
  command: string;
  login: boolean;
  instances: number;
}

interface AgentSettings {
  builtIn: {
    claude: BuiltInAgentConfig;
    codex: BuiltInAgentConfig;
    gemini: BuiltInAgentConfig;
    cursor: BuiltInAgentConfig;
  };
  custom: CustomAgentConfig[];
}

// RunningCounts is now imported from ./terminals

let settingsPanel: vscode.WebviewPanel | undefined;
let agentStatusBarItem: vscode.StatusBarItem | undefined;

// Terminal state is now managed by ./terminals.vscode

// BUILT_IN_AGENTS is now imported from ./agents

function getAgentsToOpen(context: vscode.ExtensionContext): AgentConfig[] {
  const settings = getAgentSettings(context);
  const extensionPath = context.extensionPath;
  const agents: AgentConfig[] = [];

  // Built-in agents
  for (const def of BUILT_IN_AGENTS) {
    const config = settings.builtIn[def.key as keyof AgentSettings['builtIn']];
    if (config.login && config.instances > 0) {
      agents.push({ ...createAgentConfig(extensionPath, def.title, def.command, def.icon, def.prefix), count: config.instances });
    }
  }

  // Custom agents
  for (const custom of settings.custom) {
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
    const settings = getAgentSettings(context);
    for (const custom of settings.custom) {
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
  const settings = getAgentSettings(context);
  for (const custom of settings.custom) {
    if (info.prefix === custom.name) {
      return createAgentConfig(context.extensionPath, custom.name, custom.command, 'agents.png', custom.name.toLowerCase());
    }
  }

  return null;
}

// Terminal metadata functions are now in terminals.vscode.ts
// Settings functions for webview
function getDefaultSettings(): AgentSettings {
  return {
    builtIn: {
      claude: { login: false, instances: 2 },
      codex: { login: false, instances: 2 },
      gemini: { login: false, instances: 2 },
      cursor: { login: false, instances: 2 }
    },
    custom: []
  };
}

function getAgentSettings(context: vscode.ExtensionContext): AgentSettings {
  const stored = context.globalState.get<AgentSettings>('agentSettings');
  if (stored) return stored;

  // Migrate from old settings if they exist
  const config = vscode.workspace.getConfiguration('agents');
  const claudeCount = config.get<number>('claudeCount');
  const autoStart = config.get<boolean>('autoStart', false);

  if (claudeCount !== undefined) {
    // Old settings exist, migrate them
    const migrated: AgentSettings = {
      builtIn: {
        claude: { login: autoStart, instances: config.get<number>('claudeCount', 2) },
        codex: { login: autoStart, instances: config.get<number>('codexCount', 2) },
        gemini: { login: autoStart, instances: config.get<number>('geminiCount', 2) },
        cursor: { login: autoStart, instances: config.get<number>('cursorCount', 2) }
      },
      custom: (config.get<{ title: string; command: string; count: number }[]>('customAgents', []) || []).map(a => ({
        name: a.title,
        command: a.command,
        login: false,
        instances: a.count
      }))
    };
    context.globalState.update('agentSettings', migrated);
    return migrated;
  }

  return getDefaultSettings();
}

async function saveAgentSettings(context: vscode.ExtensionContext, settings: AgentSettings) {
  await context.globalState.update('agentSettings', settings);
}

// countRunningAgents is now terminals.countRunning()

function openSettingsWebview(context: vscode.ExtensionContext) {
  if (settingsPanel) {
    settingsPanel.reveal();
    return;
  }

  settingsPanel = vscode.window.createWebviewPanel(
    'agentsSettings',
    'Agents',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'out', 'ui'),
        vscode.Uri.joinPath(context.extensionUri, 'assets')
      ]
    }
  );

  // Set the tab icon
  settingsPanel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, 'assets', 'agents.png'),
    dark: vscode.Uri.joinPath(context.extensionUri, 'assets', 'agents.png')
  };

  const updateWebview = () => {
    if (!settingsPanel) return;
    const settings = getAgentSettings(context);
    const runningCounts = terminals.countRunning();
    settingsPanel.webview.postMessage({
      type: 'init',
      settings,
      runningCounts
    });
  };

  settingsPanel.webview.html = getWebviewContent(settingsPanel.webview, context.extensionUri);

  settingsPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
      case 'ready':
        updateWebview();
        break;
      case 'saveSettings':
        await saveAgentSettings(context, message.settings);
        break;
    }
  }, undefined, context.subscriptions);

  // Update running counts when terminals change
  const terminalListener = vscode.window.onDidOpenTerminal(() => {
    if (settingsPanel) {
      settingsPanel.webview.postMessage({
        type: 'updateRunningCounts',
        counts: terminals.countRunning()
      });
    }
  });

  const terminalCloseListener = vscode.window.onDidCloseTerminal(() => {
    if (settingsPanel) {
      settingsPanel.webview.postMessage({
        type: 'updateRunningCounts',
        counts: terminals.countRunning()
      });
    }
  });

  settingsPanel.onDidDispose(() => {
    settingsPanel = undefined;
    terminalListener.dispose();
    terminalCloseListener.dispose();
  }, undefined, context.subscriptions);
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'ui', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'ui', 'main.css'));

  // Get asset URIs for icons
  const claudeIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'claude.png'));
  const codexIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'chatgpt.png'));
  const geminiIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'gemini.png'));
  const cursorIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'cursor.png'));
  const agentsIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'agents.png'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <script>
    // Inject icon paths for the React app
    window.__ICONS__ = {
      claude: "${claudeIcon}",
      codex: "${codexIcon}",
      gemini: "${geminiIcon}",
      cursor: "${cursorIcon}",
      agents: "${agentsIcon}"
    };
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

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

  // Create status bar item for showing active terminal label
  agentStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  agentStatusBarItem.text = 'Agents';
  agentStatusBarItem.show();
  context.subscriptions.push(agentStatusBarItem);

  // Scan existing terminals in the editor area to register any agent terminals
  terminals.scanExisting((name) => inferAgentConfigFromName(name, context.extensionPath));

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

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('agents.open', () => openAgentTerminals(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.configure', () => openSettingsWebview(context))
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
    vscode.commands.registerCommand('agents.setTitle', () => setTitleForActiveTerminal(context.extensionPath))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.clear', () => clearActiveTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.generateCommit', generateCommitMessage)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agents.enableSwarm', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const cliTsPath = path.join(context.extensionPath, '..', 'cli-ts', 'dist', 'index.js');
      const mcpJsonPath = path.join(workspaceFolder.uri.fsPath, '.mcp.json');

      // Read existing .mcp.json or create new
      let existingConfig: McpConfig | null = null;
      try {
        const existing = await vscode.workspace.fs.readFile(vscode.Uri.file(mcpJsonPath));
        existingConfig = JSON.parse(existing.toString());
      } catch {
        // File doesn't exist, use null
      }

      // Merge swarm server config
      const swarmConfig = createSwarmServerConfig(cliTsPath);
      const mcpConfig = mergeMcpConfig(existingConfig, 'swarm', swarmConfig);

      // Write back
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(mcpJsonPath),
        Buffer.from(JSON.stringify(mcpConfig, null, 2))
      );

      vscode.window.showInformationMessage('Multi-agent support enabled. Reload Agents.');
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
  const settings = getAgentSettings(context);
  for (const custom of settings.custom) {
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

      // Check for user-set label in terminals module first
      const entry = terminals.getByTerminal(terminal);
      if (entry?.label && entry.agentConfig) {
        const expandedName = getExpandedAgentName(entry.agentConfig.title);
        agentStatusBarItem.text = `Agents: ${expandedName} - ${entry.label}`;
        return;
      }

      // Fall back to parsing terminal name directly
      const info = getTerminalDisplayInfo(terminal.name);
      if (info.isAgent && info.expandedName) {
        agentStatusBarItem.text = `Agents: ${info.expandedName}`;
      } else {
        agentStatusBarItem.text = 'Agents';
      }
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
  const startupSettings = getAgentSettings(context);
  const hasLoginEnabled =
    Object.values(startupSettings.builtIn).some(a => a.login) ||
    startupSettings.custom.some(a => a.login);

  if (hasLoginEnabled) {
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
    isTransient: true,
    name: agentConfig.title,
    env: {
      AGENT_TERMINAL_ID: terminalId,
      DISABLE_AUTO_TITLE: 'true',
      PROMPT_COMMAND: ''
    }
  });

  terminals.register(terminal, terminalId, agentConfig);
  terminal.sendText(agentConfig.command);
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
        isTransient: true,
        name: agent.title,
        env: {
          AGENT_TERMINAL_ID: terminalId,
          DISABLE_AUTO_TITLE: 'true',
          PROMPT_COMMAND: ''
        }
      });

      terminals.register(terminal, terminalId, agent);
      terminal.sendText(agent.command);
      totalCount++;
    }
  }

  if (totalCount > 0) {
    vscode.window.showInformationMessage(`Opened ${totalCount} agent terminal${totalCount > 1 ? 's' : ''}`);
  }
}

function updateStatusBarForTerminal(terminal: vscode.Terminal, extensionPath: string) {
  if (!agentStatusBarItem) return;

  const info = identifyAgentTerminal(terminal, extensionPath);
  if (!info.isAgent) {
    agentStatusBarItem.hide();
    return;
  }

  const expandedName = getExpandedAgentName(info.prefix!);
  if (info.label) {
    agentStatusBarItem.text = `${expandedName}: ${info.label}`;
  } else {
    agentStatusBarItem.text = expandedName;
  }
  agentStatusBarItem.show();
}

function setTitleForActiveTerminal(extensionPath: string) {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    vscode.window.showInformationMessage('No active terminal to label.');
    return;
  }

  const info = identifyAgentTerminal(terminal, extensionPath);
  if (!info.isAgent) {
    vscode.window.showInformationMessage('This terminal is not an agent terminal.');
    return;
  }

  const currentLabel = info.label ?? '';

  vscode.window.showInputBox({
    prompt: 'Set a label for this agent',
    placeHolder: 'Feature name or task (max 5 words)',
    value: currentLabel
  }).then((input) => {
    if (input === undefined) {
      return;
    }

    const cleaned = sanitizeLabel(input.trim());
    terminals.setLabel(terminal, cleaned || undefined);

    // Update status bar only (don't rename terminal tab)
    updateStatusBarForTerminal(terminal, extensionPath);
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
      // Get agent number from terminals module
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

function getApiEndpoint(provider: string): string {
  if (provider === 'openai') {
    return 'https://api.openai.com/v1/chat/completions';
  } else if (provider === 'openrouter') {
    return 'https://openrouter.ai/api/v1/chat/completions';
  } else if (provider.startsWith('http')) {
    return provider;
  }
  return 'https://api.openai.com/v1/chat/completions';
}

async function generateCommitMessage(sourceControl?: { rootUri?: vscode.Uri }) {
  const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
  if (!gitExtension) {
    vscode.window.showErrorMessage('Git extension not found');
    return;
  }

  const gitApi = gitExtension.getAPI(1);
  if (gitApi.repositories.length === 0) {
    vscode.window.showErrorMessage('No Git repository found');
    return;
  }

  let repo = gitApi.repositories[0];

  // If triggered from SCM panel with repository context, use that repository
  if (sourceControl?.rootUri) {
    const matchingRepo = gitApi.repositories.find((r: { rootUri: vscode.Uri }) =>
      r.rootUri.toString() === sourceControl.rootUri!.toString()
    );
    if (matchingRepo) {
      repo = matchingRepo;
    }
  } else if (gitApi.repositories.length > 1) {
    // Fallback: try to detect repo from active editor
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.uri) {
      const activeUri = activeEditor.document.uri;
      const matchingRepo = gitApi.repositories.find((r: { rootUri: vscode.Uri }) =>
        activeUri.fsPath.startsWith(r.rootUri.fsPath)
      );
      if (matchingRepo) {
        repo = matchingRepo;
      }
    }
  }

  // If selected repo has no changes, find one that does
  const selectedHasChanges = (repo.state.workingTreeChanges || []).length > 0 ||
                              (repo.state.indexChanges || []).length > 0;
  if (!selectedHasChanges && !sourceControl?.rootUri) {
    const repoWithChanges = gitApi.repositories.find((r: { state: { workingTreeChanges: unknown[]; indexChanges: unknown[] } }) => {
      const hasWorkingChanges = (r.state.workingTreeChanges || []).length > 0;
      const hasIndexChanges = (r.state.indexChanges || []).length > 0;
      return hasWorkingChanges || hasIndexChanges;
    });
    if (repoWithChanges) {
      repo = repoWithChanges;
    }
  }

  const config = vscode.workspace.getConfiguration('agents');
  const apiKey = config.get<string>('apiKey');
  if (!apiKey) {
    vscode.window.showErrorMessage('API key not set', 'Open Settings').then(action => {
      if (action === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'agents.apiKey');
      }
    });
    return;
  }

  const provider = 'openai';
  const model = 'gpt-4o-mini';
  const commitMessageExamples = config.get<string[]>('commitMessageExamples', []);
  const ignoreFilesRaw = config.get<string>('ignoreFiles', '');

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.SourceControl,
    title: 'Generating commit...',
    cancellable: false
  }, async () => {
    try {
      const unstagedDiffChanges = await repo.diff();
      const stagedDiffChanges = await repo.diffWithHEAD();

      const workingTreeChanges = repo.state.workingTreeChanges || [];
      const indexChanges = repo.state.indexChanges || [];

      // Filter changes based on ignore patterns
      const ignorePatterns = ignoreFilesRaw ? ignoreFilesRaw.split(',').map((p: string) => p.trim()).filter(Boolean) : [];

      const shouldIgnore = (filePath: string) => {
        return ignorePatterns.some((pattern: string) => {
          if (pattern.startsWith('*.')) {
            return filePath.endsWith(pattern.slice(1));
          }
          return filePath.includes(`/${pattern}/`) || filePath.includes(`/${pattern}`) || filePath.endsWith(`/${pattern}`);
        });
      };

      const filteredWorkingTreeChanges = workingTreeChanges.filter((c: { uri: vscode.Uri }) => !shouldIgnore(c.uri.path));
      const filteredIndexChanges = indexChanges.filter((c: { uri: vscode.Uri }) => !shouldIgnore(c.uri.path));

      const unstagedStatusChanges = filteredWorkingTreeChanges.map((change: { status: number; uri: vscode.Uri }) => {
        const status = change.status === 7 ? 'New' :
                      change.status === 5 ? 'Modified' :
                      change.status === 6 ? 'Deleted' : 'Changed';
        return `Unstaged ${status}: ${change.uri.path}`;
      }).join('\n');

      const stagedStatusChanges = filteredIndexChanges.map((change: { status: number; uri: vscode.Uri }) => {
        const status = change.status === 7 ? 'New' :
                      change.status === 5 ? 'Modified' :
                      change.status === 6 ? 'Deleted' : 'Changed';
        return `Staged ${status}: ${change.uri.path}`;
      }).join('\n');

      const allStatusChanges = [unstagedStatusChanges, stagedStatusChanges].filter(s => s.length > 0).join('\n');

      const diffParts: string[] = [];
      if (stagedDiffChanges) {
        diffParts.push(`Staged Changes:\n${stagedDiffChanges}`);
      }
      if (unstagedDiffChanges) {
        diffParts.push(`Unstaged Changes:\n${unstagedDiffChanges}`);
      }
      const allDiffChanges = diffParts.join('\n\n');

      const hasChanges = (filteredWorkingTreeChanges.length > 0 || filteredIndexChanges.length > 0) ||
                        (unstagedDiffChanges && unstagedDiffChanges.length > 0) ||
                        (stagedDiffChanges && stagedDiffChanges.length > 0);

      if (!hasChanges) {
        vscode.window.showInformationMessage('No changes to commit.');
        return;
      }

      const fullChanges = `Status:\n${allStatusChanges}\n\nDiff:\n${allDiffChanges}`;

      let systemPrompt = "You are a helpful assistant that generates commit messages based on the provided git diffs. ";
      if (commitMessageExamples.length > 0) {
        let maxMessageLen = 50;
        for (const example of commitMessageExamples) {
          if (example.length > maxMessageLen) {
            maxMessageLen = example.length;
          }
        }
        systemPrompt += `Please generate the commit message following the style in these ${commitMessageExamples.length} examples: - ${commitMessageExamples.join('\n- ')}\n`;
        systemPrompt += `The commit message should be no longer than ${maxMessageLen} characters.\n`;
      }
      systemPrompt += "You should only output the commit message and nothing else.";

      const endpoint = getApiEndpoint(provider);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Review the following git status + diff and generate a concise commit message:\n\n${fullChanges}` }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      const commitMessage = data.choices[0].message.content.trim();
      repo.inputBox.value = commitMessage;

      // Stage all unstaged changes
      const allChangesToStage = [...(repo.state.workingTreeChanges || []), ...(repo.state.mergeChanges || [])];
      if (allChangesToStage.length > 0) {
        const changePaths = allChangesToStage.map((change: { uri: vscode.Uri }) => change.uri.fsPath);
        await repo.add(changePaths);
      }

      // Check if there are staged changes to commit
      const stagedChangesBefore = repo.state.indexChanges || [];
      const hasStagedChanges = stagedChangesBefore.length > 0 || allChangesToStage.length > 0;

      if (!hasStagedChanges) {
        vscode.window.showWarningMessage('No changes to commit.');
        return;
      }

      try {
        await repo.commit(commitMessage);
        try {
          await repo.push();
          vscode.window.showInformationMessage(`Pushed: ${commitMessage}`);
        } catch (pushError: unknown) {
          const msg = pushError instanceof Error ? pushError.message : String(pushError);
          vscode.window.showErrorMessage(`Committed but push failed: ${msg}`);
        }
      } catch (commitError: unknown) {
        const msg = commitError instanceof Error ? commitError.message : String(commitError);
        vscode.window.showErrorMessage(`Commit failed: ${msg}`);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage('Error generating commit message: ' + msg);
    }
  });
}

export function deactivate() {
  // Dispose all tracked terminals
  for (const entry of terminals.getAllTerminals()) {
    entry.terminal.dispose();
  }
  terminals.clear();
}
