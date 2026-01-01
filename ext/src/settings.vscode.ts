// VS Code-dependent settings functions
// Pure types are in settings.ts

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { AgentSettings, getDefaultSettings, CustomAgentConfig, SwarmAgentType, ALL_SWARM_AGENTS, PromptEntry } from './settings';
import { readPromptsFromPath, writePromptsToPath, DEFAULT_PROMPTS } from './prompts';
import * as terminals from './terminals.vscode';
import * as swarm from './swarm.vscode';

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
    // Migrate: add swarmEnabledAgents if missing
    if (!stored.swarmEnabledAgents) {
      stored.swarmEnabledAgents = [...ALL_SWARM_AGENTS];
      context.globalState.update('agentSettings', stored);
    } else if (!stored.swarmEnabledAgents.includes('opencode')) {
      stored.swarmEnabledAgents = [...stored.swarmEnabledAgents, 'opencode'];
      context.globalState.update('agentSettings', stored);
    }
    if (!stored.builtIn.opencode) {
      stored.builtIn.opencode = { login: false, instances: 2 };
      context.globalState.update('agentSettings', stored);
    }
    // Migrate: load prompts from file (persists across uninstall)
    if (!stored.prompts || stored.prompts.length === 0) {
      stored.prompts = readPrompts();
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
      swarmEnabledAgents: [...ALL_SWARM_AGENTS],
      prompts: readPrompts()
    };
    context.globalState.update('agentSettings', migrated);
    return migrated;
  }

  return getDefaultSettings();
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
    settingsPanel.webview.postMessage({
      type: 'init',
      settings,
      runningCounts,
      swarmStatus
    });
  };

  settingsPanel.webview.html = getWebviewContent(settingsPanel.webview, context.extensionUri);

  settingsPanel.webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
      case 'ready':
        updateWebview();
        break;
      case 'saveSettings':
        await saveSettings(context, message.settings);
        break;
      case 'enableSwarm':
        await swarm.enableSwarm(context);
        updateWebview();
        break;
      case 'fetchTasks':
        const tasks = await swarm.fetchTasks(message.limit);
        settingsPanel?.webview.postMessage({ type: 'tasksData', tasks });
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
