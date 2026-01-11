// VS Code-dependent settings functions
// Pure types are in settings.ts

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { AgentSettings, getDefaultSettings, CustomAgentConfig, SwarmAgentType, ALL_SWARM_AGENTS, PromptEntry, DEFAULT_DISPLAY_PREFERENCES, DEFAULT_NOTIFICATION_SETTINGS } from './settings';
import { readPromptsFromPath, writePromptsToPath, DEFAULT_PROMPTS } from './prompts';
import * as terminals from './terminals.vscode';
import * as swarm from './swarm.vscode';
import { discoverTodoFiles, spawnSwarmForTodo } from './todos.vscode';
import { discoverRecentSessions } from './sessions.vscode';
import { formatTerminalTitle, parseTerminalName } from './utils';
import { getBuiltInByKey } from './agents';
import * as prewarm from './prewarm.vscode';

// Check if a CLI command exists on the system
function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    exec(`${whichCmd} ${cmd}`, (err) => {
      resolve(!err);
    });
  });
}

// Check which agents are installed
export async function checkInstalledAgents(): Promise<Record<string, boolean>> {
  const agents = [
    { key: 'claude', command: 'claude' },
    { key: 'codex', command: 'codex' },
    { key: 'gemini', command: 'gemini' },
    { key: 'opencode', command: 'opencode' },
    { key: 'cursor', command: 'cursor-agent' },
  ];

  const results: Record<string, boolean> = {};
  for (const agent of agents) {
    results[agent.key] = await commandExists(agent.command);
  }
  // Shell is always available
  results['shell'] = true;
  return results;
}

// Module state
let settingsPanel: vscode.WebviewPanel | undefined;

// Data directory: ~/.swarmify/agents/
const SWARMIFY_DIR = path.join(homedir(), '.swarmify');
const AGENTS_DATA_DIR = path.join(SWARMIFY_DIR, 'agents');
const SWARM_CONFIG_PATH = path.join(AGENTS_DATA_DIR, 'config.json');
const PROMPTS_PATH = path.join(AGENTS_DATA_DIR, 'prompts.json');

// Write swarm config file with enabled agents
export function writeSwarmConfig(enabledAgents: SwarmAgentType[]): void {
  try {
    fs.mkdirSync(AGENTS_DATA_DIR, { recursive: true });
    const config = { enabledAgents };
    fs.writeFileSync(SWARM_CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Failed to write swarm config:', err);
  }
}

// Read prompts from YAML file (persists across extension uninstall)
export function readPrompts(): PromptEntry[] {
  const { prompts, usedDefaults } = readPromptsFromPath(PROMPTS_PATH);
  if (usedDefaults) {
    // Save defaults to file for next time
    writePrompts(prompts);
  }
  return prompts;
}

// Write prompts to YAML file
export function writePrompts(prompts: PromptEntry[]): void {
  writePromptsToPath(PROMPTS_PATH, prompts);
}

// Load settings from global state, with migration from old format
export function getSettings(context: vscode.ExtensionContext): AgentSettings {
  const stored = context.globalState.get<AgentSettings>('agentSettings');
  if (stored) {
    // Migrate: add swarmEnabledAgents if missing or filter out old agents
    if (!stored.swarmEnabledAgents) {
      stored.swarmEnabledAgents = [...ALL_SWARM_AGENTS];
      context.globalState.update('agentSettings', stored);
    } else {
      // Filter to only include supported agents (claude, codex, gemini)
      const filtered = stored.swarmEnabledAgents.filter(a => ALL_SWARM_AGENTS.includes(a));
      if (filtered.length !== stored.swarmEnabledAgents.length) {
        stored.swarmEnabledAgents = filtered.length > 0 ? filtered : [...ALL_SWARM_AGENTS];
        context.globalState.update('agentSettings', stored);
      }
    }
    if (!stored.builtIn.opencode) {
      stored.builtIn.opencode = { login: false, instances: 2 };
      context.globalState.update('agentSettings', stored);
    }
    // Migrate: add display preferences
    if (!stored.display) {
      stored.display = { ...DEFAULT_DISPLAY_PREFERENCES };
      context.globalState.update('agentSettings', stored);
    } else {
      // Backfill any missing keys
      if (stored.display.showFullAgentNames === undefined) {
        stored.display.showFullAgentNames = DEFAULT_DISPLAY_PREFERENCES.showFullAgentNames;
      }
      if (stored.display.showLabelsInTitles === undefined) {
        stored.display.showLabelsInTitles = DEFAULT_DISPLAY_PREFERENCES.showLabelsInTitles;
      }
      context.globalState.update('agentSettings', stored);
    }
    if (!stored.notifications) {
      stored.notifications = { ...DEFAULT_NOTIFICATION_SETTINGS };
      context.globalState.update('agentSettings', stored);
    } else {
      if (stored.notifications.enabled === undefined) {
        stored.notifications.enabled = DEFAULT_NOTIFICATION_SETTINGS.enabled;
      }
      if (!stored.notifications.style) {
        stored.notifications.style = DEFAULT_NOTIFICATION_SETTINGS.style;
      }
      if (!stored.notifications.enabledAgents || stored.notifications.enabledAgents.length === 0) {
        stored.notifications.enabledAgents = [...DEFAULT_NOTIFICATION_SETTINGS.enabledAgents];
      }
      context.globalState.update('agentSettings', stored);
    }
    // Migrate: load prompts from file (persists across uninstall)
    if (!stored.prompts || stored.prompts.length === 0) {
      stored.prompts = readPrompts();
      context.globalState.update('agentSettings', stored);
    }
    // Migrate: add aliases array if missing
    if (!stored.aliases) {
      stored.aliases = [];
      context.globalState.update('agentSettings', stored);
    }
    return stored;
  }

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
        opencode: { login: autoStart, instances: 2 },
        cursor: { login: autoStart, instances: config.get<number>('cursorCount', 2) },
        shell: { login: false, instances: 1 }
      },
      custom: (config.get<{ title: string; command: string; count: number }[]>('customAgents', []) || []).map(a => ({
        name: a.title,
        command: a.command,
        login: false,
        instances: a.count
      })),
      aliases: [],
      swarmEnabledAgents: [...ALL_SWARM_AGENTS],
      prompts: readPrompts(),
      display: { ...DEFAULT_DISPLAY_PREFERENCES },
      notifications: { ...DEFAULT_NOTIFICATION_SETTINGS }
    };
    context.globalState.update('agentSettings', migrated);
    return migrated;
  }

  return getDefaultSettings();
}

export function getDefaultModel(
  context: vscode.ExtensionContext,
  agentType: keyof AgentSettings['builtIn']
): string | undefined {
  const settings = getSettings(context);
  return settings.builtIn[agentType]?.defaultModel;
}

export async function setDefaultModel(
  context: vscode.ExtensionContext,
  agentType: keyof AgentSettings['builtIn'],
  model: string | undefined
): Promise<void> {
  const settings = getSettings(context);
  const current = settings.builtIn[agentType];
  const nextSettings: AgentSettings = {
    ...settings,
    builtIn: {
      ...settings.builtIn,
      [agentType]: {
        ...current,
        defaultModel: model || undefined
      }
    }
  };
  await saveSettings(context, nextSettings);
}

// Save settings to global state and write configs to files
export async function saveSettings(context: vscode.ExtensionContext, settings: AgentSettings): Promise<void> {
  await context.globalState.update('agentSettings', settings);
  writeSwarmConfig(settings.swarmEnabledAgents);
  // Sync prompts to file for persistence across uninstall
  if (settings.prompts) {
    writePrompts(settings.prompts);
  }
}

// Open the settings webview panel
export function openPanel(context: vscode.ExtensionContext): void {
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
      retainContextWhenHidden: true, // Prevent full reload when panel loses focus
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

  const updateWebview = async () => {
    if (!settingsPanel) return;
    const settings = getSettings(context);
    const runningCounts = terminals.countRunning();
      const swarmStatus = await swarm.getSwarmStatus();
      const skillsStatus = await swarm.getSkillsStatus();
      settingsPanel.webview.postMessage({
        type: 'init',
        settings,
        runningCounts,
        swarmStatus,
        skillsStatus
      });
    };

  settingsPanel.webview.html = getWebviewContent(settingsPanel.webview, context.extensionUri);

  settingsPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
      case 'ready':
        updateWebview();
        break;
      case 'saveSettings':
        // Compare display prefs to decide if we need to retitle open terminals
        const previous = getSettings(context);
        await saveSettings(context, message.settings);
        maybeUpdateTerminalTitles(previous, message.settings);
        break;
      case 'enableSwarm':
        settingsPanel?.webview.postMessage({ type: 'swarmInstallStart' });
        await swarm.setupSwarmIntegration(context, (swarmStatus) => {
          settingsPanel?.webview.postMessage({ type: 'swarmStatus', swarmStatus });
        });
        settingsPanel?.webview.postMessage({ type: 'swarmInstallDone' });
        updateWebview();
        break;
      case 'installSwarmAgent':
        settingsPanel?.webview.postMessage({ type: 'swarmInstallStart' });
        await swarm.setupSwarmIntegrationForAgent(message.agent, context, (swarmStatus) => {
          settingsPanel?.webview.postMessage({ type: 'swarmStatus', swarmStatus });
        });
        const refreshedStatus = await swarm.getSwarmStatus();
        settingsPanel?.webview.postMessage({ type: 'swarmStatus', swarmStatus: refreshedStatus });
        settingsPanel?.webview.postMessage({
          type: 'skillsStatus',
          skillsStatus: await swarm.getSkillsStatus()
        });
        settingsPanel?.webview.postMessage({ type: 'swarmInstallDone' });
        break;
      case 'fetchTasks':
        const tasks = await swarm.fetchTasks(message.limit);
        settingsPanel?.webview.postMessage({ type: 'tasksData', tasks });
        break;
      case 'installSkillCommand':
        settingsPanel?.webview.postMessage({ type: 'skillInstallStart' });
        await swarm.installSkillCommand(message.skill, message.agent, context);
        settingsPanel?.webview.postMessage({
          type: 'skillsStatus',
          skillsStatus: await swarm.getSkillsStatus()
        });
        settingsPanel?.webview.postMessage({ type: 'skillInstallDone' });
        break;
      case 'fetchAgentTerminals':
        const terminalDetails = terminals.getTerminalsByAgentType(message.agentType);
        settingsPanel?.webview.postMessage({
          type: 'agentTerminalsData',
          agentType: message.agentType,
          terminals: terminalDetails
        });
        break;
      case 'openGuide':
        openGuide(context, message.guide);
        break;
      case 'checkInstalledAgents':
        const installedAgents = await checkInstalledAgents();
        settingsPanel?.webview.postMessage({
          type: 'installedAgentsData',
          installedAgents
        });
        break;
      case 'getDefaultAgent':
        const defaultAgent = context.globalState.get<string>('agents.defaultAgentTitle', 'CC');
        settingsPanel?.webview.postMessage({
          type: 'defaultAgentData',
          defaultAgent
        });
        break;
      case 'setDefaultAgent':
        // Update via command which also updates the module-level variable
        await vscode.commands.executeCommand('agents.setDefaultAgentTitle', message.agentTitle);
        break;
      case 'spawnAgent':
        // Spawn a new agent of the given type
        const agentKey = message.agentKey as string;
        if (message.isCustom) {
          // Custom agent - command ID is agents.new{Name} with non-alphanumeric chars removed
          const commandId = `agents.new${agentKey.replace(/[^a-zA-Z0-9]/g, '')}`;
          vscode.commands.executeCommand(commandId);
        } else {
          // Built-in agent - prefer explicit commandId from registry (handles casing like OpenCode)
          const builtIn = getBuiltInByKey(agentKey);
          const commandId = builtIn?.commandId || `agents.new${agentKey.charAt(0).toUpperCase() + agentKey.slice(1)}`;
          vscode.commands.executeCommand(commandId);
        }
        break;
      case 'fetchTodoFiles':
        const todoFiles = await discoverTodoFiles();
        settingsPanel?.webview.postMessage({ type: 'todoFilesData', files: todoFiles });
        break;
      case 'fetchSessions':
        const sessionsWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const sessions = await discoverRecentSessions(message.limit || 50, sessionsWorkspace);
        settingsPanel?.webview.postMessage({ type: 'sessionsData', sessions });
        break;
      case 'spawnSwarmForTodo':
        await spawnSwarmForTodo(message.item, context);
        break;
      case 'openSession':
        // Open session file in editor
        if (message.session?.path) {
          const sessionUri = vscode.Uri.file(message.session.path);
          vscode.window.showTextDocument(sessionUri, { preview: true });
        }
        break;
      case 'getPrewarmStatus':
        settingsPanel?.webview.postMessage({
          type: 'prewarmStatus',
          enabled: prewarm.isEnabled(context),
          pools: prewarm.getPoolInfo()
        });
        break;
      case 'togglePrewarm':
        const newEnabled = !prewarm.isEnabled(context);
        await prewarm.setEnabled(context, newEnabled);
        settingsPanel?.webview.postMessage({
          type: 'prewarmStatus',
          enabled: newEnabled,
          pools: prewarm.getPoolInfo()
        });
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

// Open guide in markdown preview
function openGuide(context: vscode.ExtensionContext, guide: string): void {
  const guideFiles: Record<string, string> = {
    'getting-started': 'getting-started.md',
    'swarm': 'swarm-guide.md'
  };

  const filename = guideFiles[guide];
  if (!filename) {
    vscode.window.showErrorMessage(`Unknown guide: ${guide}`);
    return;
  }

  const guidePath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'guides', filename);

  // Check if file exists, if not show info message
  vscode.workspace.fs.stat(guidePath).then(
    () => {
      // Open with custom markdown editor
      vscode.commands.executeCommand('vscode.openWith', guidePath, 'agents.markdownEditor');
    },
    () => {
      // File doesn't exist yet - show info message
      vscode.window.showInformationMessage(
        `Guide "${guide}" is coming soon. Check our GitHub for documentation.`,
        'Open GitHub'
      ).then(selection => {
        if (selection === 'Open GitHub') {
          vscode.env.openExternal(vscode.Uri.parse('https://github.com/muqsitnawaz/swarmify'));
        }
      });
    }
  );
}

// Update titles of existing agent terminals when display preferences change
function maybeUpdateTerminalTitles(oldSettings: AgentSettings, newSettings: AgentSettings): void {
  const oldDisplay = oldSettings.display ?? DEFAULT_DISPLAY_PREFERENCES;
  const newDisplay = newSettings.display ?? DEFAULT_DISPLAY_PREFERENCES;

  const changed =
    oldDisplay.showFullAgentNames !== newDisplay.showFullAgentNames ||
    oldDisplay.showLabelsInTitles !== newDisplay.showLabelsInTitles;

  if (!changed) return;

  for (const entry of terminals.getAllTerminals()) {
    // Skip if we don't have an agent config
    const prefix = entry.agentConfig?.title || parseTerminalName(entry.terminal.name).prefix;
    if (!prefix) continue;

    const label = newDisplay.showLabelsInTitles ? (entry.label || entry.autoLabel) : null;
    const newTitle = formatTerminalTitle(prefix, { label, display: newDisplay });
    terminals.renameTerminal(entry.terminal, newTitle);
  }
}

// Generate webview HTML content
function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'ui', 'settings', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'ui', 'settings', 'main.css'));

  // Get asset URIs for icons
  const claudeIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'claude.png'));
  const codexIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'chatgpt.png'));
  const geminiIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'gemini.png'));
  const opencodeIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'opencode.png'));
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
      opencode: "${opencodeIcon}",
      cursor: "${cursorIcon}",
      shell: "${agentsIcon}",
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
