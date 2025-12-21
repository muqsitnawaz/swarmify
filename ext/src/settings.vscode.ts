// VS Code-dependent settings functions
// Pure types are in settings.ts

import * as vscode from 'vscode';
import { AgentSettings, getDefaultSettings, CustomAgentConfig } from './settings';
import * as terminals from './terminals.vscode';
import * as swarm from './swarm.vscode';

// Module state
let settingsPanel: vscode.WebviewPanel | undefined;

// Load settings from global state, with migration from old format
export function getSettings(context: vscode.ExtensionContext): AgentSettings {
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
        cursor: { login: autoStart, instances: config.get<number>('cursorCount', 2) },
        shell: { login: false, instances: 1 }
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

// Save settings to global state
export async function saveSettings(context: vscode.ExtensionContext, settings: AgentSettings): Promise<void> {
  await context.globalState.update('agentSettings', settings);
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
