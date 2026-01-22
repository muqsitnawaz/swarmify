// VS Code-dependent settings functions
// Pure types are in settings.ts

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { AgentSettings, getDefaultSettings, CustomAgentConfig, SwarmAgentType, ALL_SWARM_AGENTS, PromptEntry, DEFAULT_DISPLAY_PREFERENCES, DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_TASK_SOURCE_SETTINGS } from '../core/settings';
import { readPromptsFromPath, writePromptsToPath, DEFAULT_PROMPTS } from '../core/prompts';
import * as terminals from './terminals.vscode';
import * as swarm from './swarm.vscode';
import { discoverTodoFiles, spawnSwarmForTodo } from './todos.vscode';
import { fetchAllTasks, detectAvailableSources } from './tasks.vscode';
import { discoverRecentSessions } from './sessions.vscode';
import { formatTerminalTitle, parseTerminalName, getSessionChunk } from '../core/utils';
import { getBuiltInByKey } from '../core/agents';
import * as prewarm from './prewarm.vscode';
import * as workspaceConfig from './swarmifyConfig.vscode';
import { createSymlinksCodebaseWide } from './agentlinks.vscode';
import { scanMemoryFiles } from './contextFiles';
import * as workbench from './workbench.vscode';
import * as theme from './theme.vscode';

// Check if a CLI command exists on the system
function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    exec(`${whichCmd} ${cmd}`, (err) => {
      resolve(!err);
    });
  });
}

// Get GitHub repo from git remote (returns "username/repo" or null)
function getGitHubRepo(workspacePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec('git remote get-url origin', { cwd: workspacePath }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const url = stdout.trim();
      // Parse GitHub URL formats:
      // https://github.com/user/repo.git
      // git@github.com:user/repo.git
      // https://github.com/user/repo
      const httpsMatch = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
      const sshMatch = url.match(/github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
      const repo = httpsMatch?.[1] || sshMatch?.[1] || null;
      resolve(repo);
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

// Notify settings panel when OAuth completes (called from extension.ts URI handler)
export function notifyOAuthComplete(provider: string, token: string): void {
  settingsPanel?.webview.postMessage({ type: 'oauthToken', provider, token });
}

// Data directory: ~/.agents/
const AGENTS_CONFIG_DIR = path.join(homedir(), '.agents');
const AGENTS_CONFIG_PATH = path.join(AGENTS_CONFIG_DIR, 'config.json');
const PROMPTS_PATH = path.join(AGENTS_CONFIG_DIR, 'prompts.json');

// Write swarm config file with enabled agents
export function writeSwarmConfig(enabledAgents: SwarmAgentType[]): void {
  try {
    fs.mkdirSync(AGENTS_CONFIG_DIR, { recursive: true });

    // Read existing config to preserve agent settings
    let existingConfig: any = { agents: {}, providers: {} };
    if (fs.existsSync(AGENTS_CONFIG_PATH)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(AGENTS_CONFIG_PATH, 'utf-8'));
      } catch {
        // If file is invalid, use empty config
      }
    }

    // Update enabled status for all agent types
    for (const agentType of ALL_SWARM_AGENTS) {
      if (!existingConfig.agents[agentType]) {
        existingConfig.agents[agentType] = { enabled: false, models: {}, provider: '' };
      }
      existingConfig.agents[agentType].enabled = enabledAgents.includes(agentType);
    }

    fs.writeFileSync(AGENTS_CONFIG_PATH, JSON.stringify(existingConfig, null, 2));
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
      if (stored.display.showSessionIdInTitles === undefined) {
        stored.display.showSessionIdInTitles = DEFAULT_DISPLAY_PREFERENCES.showSessionIdInTitles;
      }
      if (stored.display.labelReplacesTitle === undefined) {
        stored.display.labelReplacesTitle = DEFAULT_DISPLAY_PREFERENCES.labelReplacesTitle;
      }
      if (stored.display.showLabelOnlyOnFocus === undefined) {
        stored.display.showLabelOnlyOnFocus = DEFAULT_DISPLAY_PREFERENCES.showLabelOnlyOnFocus;
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
    if (!stored.editor) {
      stored.editor = { markdownViewerEnabled: true };
      context.globalState.update('agentSettings', stored);
    } else if (stored.editor.markdownViewerEnabled === undefined) {
      stored.editor.markdownViewerEnabled = true;
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
    // Migrate: add welcome screen setting if missing (default: enabled)
    if (stored.showWelcomeScreen === undefined) {
      stored.showWelcomeScreen = true;
      context.globalState.update('agentSettings', stored);
    }
    // Migrate: add task sources if missing
    if (!stored.taskSources) {
      stored.taskSources = { ...DEFAULT_TASK_SOURCE_SETTINGS };
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
      editor: { markdownViewerEnabled: true },
      display: { ...DEFAULT_DISPLAY_PREFERENCES },
      notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
      showWelcomeScreen: true,
      taskSources: { ...DEFAULT_TASK_SOURCE_SETTINGS }
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

  // Update new config format
  const configPath = AGENTS_CONFIG_PATH;
  let config: any = { agents: {}, providers: {} };
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      // If file is invalid, use empty config
    }
  }

  const agentKey = agentType.toString();
  if (!config.agents[agentKey]) {
    config.agents[agentKey] = { enabled: false, models: {}, provider: '' };
  }

  // Update model in the appropriate effort level (default by convention)
  config.agents[agentKey].models.default = model;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Also update VS Code settings for backward compatibility
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
  await workbench.setMarkdownEditorAssociation(settings.editor?.markdownViewerEnabled ?? true);
}

// Open the settings webview panel
export function openPanel(context: vscode.ExtensionContext): void {
  if (settingsPanel) {
    settingsPanel.reveal();
    return;
  }

  // Check for orphaned dashboard tab (extension restarted but tab survived)
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview && tab.label === 'Agents') {
        return;
      }
    }
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
  settingsPanel.iconPath = theme.buildIconPathFromUri(context.extensionUri, 'agents.png');

  const updateWebview = async () => {
    if (!settingsPanel) return;

    const wsFolder = workspaceConfig.getActiveWorkspaceFolder();
    const workspacePath = wsFolder?.uri.fsPath || null;

    // PHASE 1: Send instant data immediately - UI renders right away
    settingsPanel.webview.postMessage({
      type: 'init',
      settings: getSettings(context),
      runningCounts: terminals.countRunning(),
      workspacePath,
      dismissedTaskIds: context.globalState.get<string[]>('agents.dismissedTaskIds', []),
      // Status will be sent in phase 2
      swarmStatus: null,
      skillsStatus: null,
      githubRepo: null,
    });

    // PHASE 2: Fetch heavy data in parallel, send when ready
    const [swarmStatus, skillsStatus, githubRepo] = await Promise.all([
      swarm.getSwarmStatus(),
      swarm.getSkillsStatus(),
      workspacePath ? getGitHubRepo(workspacePath) : Promise.resolve(null),
    ]);

    if (!settingsPanel) return; // Panel may have closed during fetch
    settingsPanel.webview.postMessage({
      type: 'statusUpdate',
      swarmStatus,
      skillsStatus,
      githubRepo,
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
      case 'installCommandPack':
        settingsPanel?.webview.postMessage({ type: 'commandPackInstallStart' });
        await swarm.installCommandPack(context);
        settingsPanel?.webview.postMessage({
          type: 'skillsStatus',
          skillsStatus: await swarm.getSkillsStatus()
        });
        settingsPanel?.webview.postMessage({
          type: 'swarmStatus',
          swarmStatus: await swarm.getSwarmStatus()
        });
        settingsPanel?.webview.postMessage({ type: 'commandPackInstallDone' });
        break;
      case 'fetchTasks':
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const tasks = await swarm.fetchTasks(message.limit, workspacePath);
        settingsPanel?.webview.postMessage({ type: 'tasksData', tasks });
        break;
      case 'fetchTasksBySession':
        const sessionTasks = await swarm.fetchTasksBySession(message.sessionId);
        settingsPanel?.webview.postMessage({
          type: 'sessionTasksData',
          sessionId: message.sessionId,
          tasks: sessionTasks
        });
        break;
      case 'fetchAgentTerminals':
        const terminalWorkspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const terminalDetails = await terminals.getTerminalsByAgentType(message.agentType, terminalWorkspace);
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
        const defaultAgent = context.globalState.get<string>('agents.defaultAgentTitle', 'CL');
        settingsPanel?.webview.postMessage({
          type: 'defaultAgentData',
          defaultAgent
        });
        break;
      case 'getSecondaryAgent':
        const secondaryAgent = context.globalState.get<string>('agents.secondaryAgentTitle', 'CX');
        settingsPanel?.webview.postMessage({
          type: 'secondaryAgentData',
          secondaryAgent
        });
        break;
      case 'setDefaultAgent':
        // Update via command which also updates the module-level variable
        await vscode.commands.executeCommand('agents.setDefaultAgentTitle', message.agentTitle);
        break;
      case 'setSecondaryAgent':
        // Update via command which also updates the module-level variable
        await vscode.commands.executeCommand('agents.setSecondaryAgentTitle', message.agentTitle);
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
        try {
          const todoFiles = await discoverTodoFiles();
          settingsPanel?.webview.postMessage({ type: 'todoFilesData', files: todoFiles });
        } catch (err) {
          console.error('[SETTINGS] Error fetching todo files:', err);
          settingsPanel?.webview.postMessage({ type: 'todoFilesData', files: [] });
        }
        break;
      case 'fetchUnifiedTasks':
        try {
          // Fetch tasks from all enabled sources (markdown, linear, github)
          const currentSettings = getSettings(context);
          const unifiedTasks = await fetchAllTasks(context, currentSettings.taskSources);
          settingsPanel?.webview.postMessage({ type: 'unifiedTasksData', tasks: unifiedTasks });
        } catch (err) {
          console.error('[SETTINGS] Error fetching unified tasks:', err);
          settingsPanel?.webview.postMessage({ type: 'unifiedTasksData', tasks: [] });
        }
        break;
      case 'startOAuth': {
        const { provider: oauthProvider } = message;

        if (oauthProvider === 'github') {
          // GitHub OAuth - separate apps per IDE (each needs its own callback URL)
          const uriScheme = vscode.env.uriScheme;
          const githubClientIds: Record<string, string> = {
            'vscode': 'Ov23liKYaRnJ5DqzmPYO',
            'cursor': 'Ov23libl1NZ18xfKlvhi',
            'vscode-insiders': 'Ov23liKYaRnJ5DqzmPYO',
          };
          const clientId = githubClientIds[uriScheme] || githubClientIds['vscode'];
          const redirectUri = encodeURIComponent(`${uriScheme}://swarm-ext/oauth/callback`);
          const state = 'github';
          const scope = 'repo,read:user';

          const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`;
          vscode.env.openExternal(vscode.Uri.parse(oauthUrl));
          settingsPanel?.webview.postMessage({ type: 'oauthStarted', provider: oauthProvider });
        } else if (oauthProvider === 'linear') {
          // Linear OAuth
          const clientId = '2e9e7d9e5c0f';
          const redirectUri = encodeURIComponent(`${vscode.env.uriScheme}://swarm-ext/oauth/callback`);
          const state = 'linear';

          const oauthUrl = `https://linear.app/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=read&state=${state}`;
          vscode.env.openExternal(vscode.Uri.parse(oauthUrl));
          settingsPanel?.webview.postMessage({ type: 'oauthStarted', provider: oauthProvider });
        } else {
          console.error(`[OAUTH] Unknown provider: ${oauthProvider}`);
        }
        break;
      }

      case 'checkOAuthStatus':
        const token = context.globalState.get<string>(`${message.provider}_mcp_token`);
        settingsPanel?.webview.postMessage({ type: 'oauthToken', provider: message.provider, token: token || null });
        break;


      case 'detectTaskSources':
        try {
          // Detect which task sources are available
          const availableSources = await detectAvailableSources(context);
          settingsPanel?.webview.postMessage({ type: 'taskSourcesData', sources: availableSources });
        } catch (err) {
          console.error('[SETTINGS] Error detecting task sources:', err);
          settingsPanel?.webview.postMessage({ type: 'taskSourcesData', sources: { markdown: true, linear: false, github: false } });
        }
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
      case 'exchangeCodeForToken':
        const { provider, code } = message;

        // Exchange authorization code for access token
        // For MVP: simulate token exchange (in production, this would make actual API calls)
        const mockToken = `${provider}_mock_token_${Date.now()}`;

        await context.globalState.update(`${provider}_mcp_token`, mockToken);
        console.log(`[OAUTH] Stored token for ${provider}`);

        settingsPanel?.webview.postMessage({ type: 'oauthToken', provider, token: mockToken });
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
      case 'getWorkspaceConfig':
        const wsFolder = workspaceConfig.getActiveWorkspaceFolder();
        if (wsFolder) {
          const exists = workspaceConfig.configExists(wsFolder);
          const userExists = workspaceConfig.userConfigExists();
          const config = exists ? await workspaceConfig.loadWorkspaceConfig(wsFolder) : null;
          settingsPanel?.webview.postMessage({
            type: 'workspaceConfigData',
            config,
            exists,
            userExists
          });
        } else {
          settingsPanel?.webview.postMessage({
            type: 'workspaceConfigData',
            config: null,
            exists: false,
            userExists: workspaceConfig.userConfigExists()
          });
        }
        break;
      case 'saveWorkspaceConfig':
        const saveWsFolder = workspaceConfig.getActiveWorkspaceFolder();
        if (saveWsFolder && message.config) {
          await workspaceConfig.saveWorkspaceConfig(saveWsFolder, message.config);
          // Trigger symlink re-creation after config save
          const mergedConfig = await workspaceConfig.loadWorkspaceConfig(saveWsFolder);
          await createSymlinksCodebaseWide(saveWsFolder, mergedConfig);
          settingsPanel?.webview.postMessage({
            type: 'workspaceConfigData',
            config: message.config,
            exists: true,
            userExists: workspaceConfig.userConfigExists()
          });
        }
        break;
      case 'initWorkspaceConfig':
        const initWsFolder = workspaceConfig.getActiveWorkspaceFolder();
        if (initWsFolder) {
          const newConfig = await workspaceConfig.initWorkspaceConfig(initWsFolder);
          if (newConfig) {
            const mergedConfig = await workspaceConfig.loadWorkspaceConfig(initWsFolder);
            await createSymlinksCodebaseWide(initWsFolder, mergedConfig);
          }
          settingsPanel?.webview.postMessage({
            type: 'workspaceConfigData',
            config: newConfig,
            exists: true,
            userExists: workspaceConfig.userConfigExists()
          });
        }
        break;
      case 'fetchContextFiles':
        try {
          const contextWsFolder = workspaceConfig.getActiveWorkspaceFolder();
          if (contextWsFolder) {
            const contextFiles = await scanMemoryFiles(contextWsFolder.uri.fsPath);
            settingsPanel?.webview.postMessage({ type: 'contextFilesData', files: contextFiles });
          } else {
            settingsPanel?.webview.postMessage({ type: 'contextFilesData', files: [] });
          }
        } catch (err) {
          console.error('[SETTINGS] Error fetching context files:', err);
          settingsPanel?.webview.postMessage({ type: 'contextFilesData', files: [] });
        }
        break;
      case 'openContextFile':
        if (message.path) {
          const ctxWsFolder = workspaceConfig.getActiveWorkspaceFolder();
          if (ctxWsFolder) {
            const fileUri = vscode.Uri.file(path.join(ctxWsFolder.uri.fsPath, message.path));
            vscode.window.showTextDocument(fileUri, { preview: true });
          }
        }
        break;
      case 'dismissTask':
        if (message.taskId) {
          const currentDismissed = context.globalState.get<string[]>('agents.dismissedTaskIds', []);
          if (!currentDismissed.includes(message.taskId)) {
            context.globalState.update('agents.dismissedTaskIds', [...currentDismissed, message.taskId]);
          }
        }
        break;
    }
  }, undefined, context.subscriptions);

  // Debounce terminal updates to avoid excessive webview messages
  let terminalUpdateTimeout: ReturnType<typeof setTimeout> | undefined;
  const debouncedTerminalUpdate = () => {
    if (terminalUpdateTimeout) clearTimeout(terminalUpdateTimeout);
    terminalUpdateTimeout = setTimeout(() => {
      if (settingsPanel) {
        settingsPanel.webview.postMessage({
          type: 'updateRunningCounts',
          counts: terminals.countRunning()
        });
      }
    }, 500);
  };

  // Update running counts when terminals change (debounced)
  const terminalListener = vscode.window.onDidOpenTerminal(debouncedTerminalUpdate);
  const terminalCloseListener = vscode.window.onDidCloseTerminal(debouncedTerminalUpdate);

  settingsPanel.onDidDispose(() => {
    settingsPanel = undefined;
    terminalListener.dispose();
    terminalCloseListener.dispose();
    if (terminalUpdateTimeout) clearTimeout(terminalUpdateTimeout);
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
      const markdownViewerEnabled =
        getSettings(context).editor?.markdownViewerEnabled ?? true;
      if (markdownViewerEnabled) {
        vscode.commands.executeCommand(
          'vscode.openWith',
          guidePath,
          'agents.markdownEditor'
        );
      } else {
        vscode.window.showTextDocument(guidePath, { preview: true });
      }
    },
    () => {
      // File doesn't exist yet - show info message
      vscode.window.showInformationMessage(
        `Guide "${guide}" is coming soon. Check our GitHub for documentation.`,
        'Open GitHub'
      ).then(selection => {
        if (selection === 'Open GitHub') {
          vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/muqsitnawaz/swarmify')
          );
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
    oldDisplay.showLabelsInTitles !== newDisplay.showLabelsInTitles ||
    oldDisplay.showSessionIdInTitles !== newDisplay.showSessionIdInTitles ||
    oldDisplay.labelReplacesTitle !== newDisplay.labelReplacesTitle;

  if (!changed) return;

  for (const entry of terminals.getAllTerminals()) {
    // Skip if we don't have an agent config
    const prefix = entry.agentConfig?.title || parseTerminalName(entry.terminal.name).prefix;
    if (!prefix) continue;

    const label = newDisplay.showLabelsInTitles ? (entry.label || entry.autoLabel) : null;
    const sessionChunk = newDisplay.showSessionIdInTitles ? getSessionChunk(entry.sessionId) : null;
    const newTitle = formatTerminalTitle(prefix, {
      label,
      display: newDisplay,
      sessionChunk: sessionChunk || null
    });
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
  const codexIconLight = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'chatgpt-light.png'));
  const geminiIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'gemini.png'));
  const opencodeIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'opencode.png'));
  const cursorIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'cursor.png'));
  const cursorIconLight = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'cursor-light.png'));
  const traeIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'trae.png'));
  const agentsIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'agents.png'));
  const githubIcon = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'github.png'));

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
      codex: { dark: "${codexIcon}", light: "${codexIconLight}" },
      gemini: "${geminiIcon}",
      opencode: "${opencodeIcon}",
      cursor: { dark: "${cursorIcon}", light: "${cursorIconLight}" },
      trae: "${traeIcon}",
      shell: "${agentsIcon}",
      agents: "${agentsIcon}",
      github: "${githubIcon}"
    };
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
