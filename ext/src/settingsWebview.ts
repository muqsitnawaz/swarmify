import * as vscode from 'vscode';

export interface BuiltInAgentSettings {
  login: boolean;
  instances: number;
}

export interface CustomAgentSettings {
  name: string;
  command: string;
  login: boolean;
  instances: number;
}

export interface AgentSettings {
  builtIn: {
    claude: BuiltInAgentSettings;
    codex: BuiltInAgentSettings;
    gemini: BuiltInAgentSettings;
    cursor: BuiltInAgentSettings;
  };
  custom: CustomAgentSettings[];
}

export interface RunningCounts {
  claude: number;
  codex: number;
  gemini: number;
  cursor: number;
  custom: Record<string, number>;
}

export function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  settings: AgentSettings,
  runningCounts: RunningCounts
): string {
  const toolkitUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js')
  );

  const claudeIconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'claude.png'));
  const codexIconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'chatgpt.png'));
  const geminiIconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'gemini.png'));
  const cursorIconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'cursor.png'));
  const defaultIconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'agents.png'));

  const customAgentsHtml = settings.custom.map((agent, index) => `
    <div class="agent-row" data-custom-index="${index}">
      <img src="${defaultIconUri}" class="agent-icon" alt="${agent.name}">
      <span class="agent-name">${escapeHtml(agent.name)}</span>
      <vscode-checkbox class="login-checkbox" data-agent="custom-${index}" ${agent.login ? 'checked' : ''}>Login</vscode-checkbox>
      <div class="instances-control" style="${agent.login ? '' : 'visibility: hidden'}">
        <vscode-text-field type="number" value="${agent.instances}" min="1" max="10" size="2" data-agent="custom-${index}" class="instances-input"></vscode-text-field>
        <span class="instances-label">${agent.instances === 1 ? 'instance' : 'instances'}</span>
      </div>
      <vscode-button appearance="secondary" class="edit-btn" data-index="${index}">Edit</vscode-button>
      <vscode-button appearance="secondary" class="remove-btn" data-index="${index}">Remove</vscode-button>
    </div>
  `).join('');

  const customRunningHtml = Object.entries(runningCounts.custom).map(([name, count]) => `
    <div class="running-item">
      <img src="${defaultIconUri}" class="running-icon" alt="${name}">
      <span class="running-name">${escapeHtml(name)}</span>
      <span class="running-count">${count}</span>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script type="module" src="${toolkitUri}"></script>
  <style>
    body {
      padding: 20px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
    }

    h2 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-foreground);
      margin: 0 0 12px 0;
      opacity: 0.8;
    }

    .section {
      margin-bottom: 32px;
    }

    .running-grid {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
    }

    .running-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
    }

    .running-icon {
      width: 20px;
      height: 20px;
      object-fit: contain;
    }

    .running-name {
      font-size: 13px;
    }

    .running-count {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-textLink-foreground);
      min-width: 24px;
      text-align: center;
    }

    .agents-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .agent-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 12px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
    }

    .agent-icon {
      width: 24px;
      height: 24px;
      object-fit: contain;
    }

    .agent-name {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
    }

    .login-checkbox {
      margin-right: 8px;
    }

    .instances-control {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 120px;
    }

    .instances-input {
      width: 50px;
    }

    .instances-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .separator {
      border: none;
      border-top: 1px solid var(--vscode-widget-border);
      margin: 16px 0;
    }

    .add-row {
      display: flex;
      justify-content: flex-end;
      margin-top: 12px;
    }

    .edit-btn, .remove-btn {
      padding: 4px 8px;
    }

    /* Modal styles */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }

    .modal-overlay.visible {
      display: flex;
    }

    .modal {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 8px;
      padding: 24px;
      min-width: 320px;
    }

    .modal h3 {
      margin: 0 0 16px 0;
      font-size: 14px;
      font-weight: 600;
    }

    .modal-field {
      margin-bottom: 16px;
    }

    .modal-field label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .modal-field vscode-text-field {
      width: 100%;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="section">
    <h2>Running Now</h2>
    <div class="running-grid" id="running-grid">
      <div class="running-item">
        <img src="${claudeIconUri}" class="running-icon" alt="Claude">
        <span class="running-name">Claude</span>
        <span class="running-count" id="running-claude">${runningCounts.claude}</span>
      </div>
      <div class="running-item">
        <img src="${codexIconUri}" class="running-icon" alt="Codex">
        <span class="running-name">Codex</span>
        <span class="running-count" id="running-codex">${runningCounts.codex}</span>
      </div>
      <div class="running-item">
        <img src="${geminiIconUri}" class="running-icon" alt="Gemini">
        <span class="running-name">Gemini</span>
        <span class="running-count" id="running-gemini">${runningCounts.gemini}</span>
      </div>
      <div class="running-item">
        <img src="${cursorIconUri}" class="running-icon" alt="Cursor">
        <span class="running-name">Cursor</span>
        <span class="running-count" id="running-cursor">${runningCounts.cursor}</span>
      </div>
      ${customRunningHtml}
    </div>
  </div>

  <div class="section">
    <h2>Agents</h2>
    <div class="agents-list">
      <div class="agent-row">
        <img src="${claudeIconUri}" class="agent-icon" alt="Claude">
        <span class="agent-name">Claude</span>
        <vscode-checkbox class="login-checkbox" data-agent="claude" ${settings.builtIn.claude.login ? 'checked' : ''}>Login</vscode-checkbox>
        <div class="instances-control" style="${settings.builtIn.claude.login ? '' : 'visibility: hidden'}">
          <vscode-text-field type="number" value="${settings.builtIn.claude.instances}" min="1" max="10" size="2" data-agent="claude" class="instances-input"></vscode-text-field>
          <span class="instances-label">${settings.builtIn.claude.instances === 1 ? 'instance' : 'instances'}</span>
        </div>
      </div>
      <div class="agent-row">
        <img src="${codexIconUri}" class="agent-icon" alt="Codex">
        <span class="agent-name">Codex</span>
        <vscode-checkbox class="login-checkbox" data-agent="codex" ${settings.builtIn.codex.login ? 'checked' : ''}>Login</vscode-checkbox>
        <div class="instances-control" style="${settings.builtIn.codex.login ? '' : 'visibility: hidden'}">
          <vscode-text-field type="number" value="${settings.builtIn.codex.instances}" min="1" max="10" size="2" data-agent="codex" class="instances-input"></vscode-text-field>
          <span class="instances-label">${settings.builtIn.codex.instances === 1 ? 'instance' : 'instances'}</span>
        </div>
      </div>
      <div class="agent-row">
        <img src="${geminiIconUri}" class="agent-icon" alt="Gemini">
        <span class="agent-name">Gemini</span>
        <vscode-checkbox class="login-checkbox" data-agent="gemini" ${settings.builtIn.gemini.login ? 'checked' : ''}>Login</vscode-checkbox>
        <div class="instances-control" style="${settings.builtIn.gemini.login ? '' : 'visibility: hidden'}">
          <vscode-text-field type="number" value="${settings.builtIn.gemini.instances}" min="1" max="10" size="2" data-agent="gemini" class="instances-input"></vscode-text-field>
          <span class="instances-label">${settings.builtIn.gemini.instances === 1 ? 'instance' : 'instances'}</span>
        </div>
      </div>
      <div class="agent-row">
        <img src="${cursorIconUri}" class="agent-icon" alt="Cursor">
        <span class="agent-name">Cursor</span>
        <vscode-checkbox class="login-checkbox" data-agent="cursor" ${settings.builtIn.cursor.login ? 'checked' : ''}>Login</vscode-checkbox>
        <div class="instances-control" style="${settings.builtIn.cursor.login ? '' : 'visibility: hidden'}">
          <vscode-text-field type="number" value="${settings.builtIn.cursor.instances}" min="1" max="10" size="2" data-agent="cursor" class="instances-input"></vscode-text-field>
          <span class="instances-label">${settings.builtIn.cursor.instances === 1 ? 'instance' : 'instances'}</span>
        </div>
      </div>

      ${settings.custom.length > 0 ? '<hr class="separator">' : ''}
      ${customAgentsHtml}
    </div>

    <div class="add-row">
      <vscode-button id="add-agent-btn">Add</vscode-button>
    </div>
  </div>

  <!-- Add/Edit Agent Modal -->
  <div class="modal-overlay" id="agent-modal">
    <div class="modal">
      <h3 id="modal-title">Add Agent</h3>
      <div class="modal-field">
        <label>Name</label>
        <vscode-text-field id="modal-name" placeholder="e.g., My CLI Agent"></vscode-text-field>
      </div>
      <div class="modal-field">
        <label>Command</label>
        <vscode-text-field id="modal-command" placeholder="e.g., my-cli-agent"></vscode-text-field>
      </div>
      <div class="modal-actions">
        <vscode-button appearance="secondary" id="modal-cancel">Cancel</vscode-button>
        <vscode-button id="modal-save">Save</vscode-button>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let editingIndex = null;

    // Handle login checkbox changes
    document.querySelectorAll('.login-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const agent = e.target.dataset.agent;
        const checked = e.target.checked;
        const row = e.target.closest('.agent-row');
        const instancesControl = row.querySelector('.instances-control');

        if (instancesControl) {
          instancesControl.style.visibility = checked ? 'visible' : 'hidden';
        }

        saveSettings();
      });
    });

    // Handle instances input changes
    document.querySelectorAll('.instances-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const value = parseInt(e.target.value) || 1;
        e.target.value = Math.max(1, Math.min(10, value));

        const label = e.target.parentElement.querySelector('.instances-label');
        if (label) {
          label.textContent = value === 1 ? 'instance' : 'instances';
        }

        saveSettings();
      });
    });

    // Add agent button
    document.getElementById('add-agent-btn').addEventListener('click', () => {
      editingIndex = null;
      document.getElementById('modal-title').textContent = 'Add Agent';
      document.getElementById('modal-name').value = '';
      document.getElementById('modal-command').value = '';
      document.getElementById('agent-modal').classList.add('visible');
    });

    // Edit buttons
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        const row = document.querySelector(\`.agent-row[data-custom-index="\${index}"]\`);
        const name = row.querySelector('.agent-name').textContent;

        editingIndex = index;
        document.getElementById('modal-title').textContent = 'Edit Agent';
        document.getElementById('modal-name').value = name;
        document.getElementById('modal-command').value = ''; // Will be filled from settings
        document.getElementById('agent-modal').classList.add('visible');

        vscode.postMessage({ type: 'getCustomAgentCommand', index });
      });
    });

    // Remove buttons
    document.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        vscode.postMessage({ type: 'removeCustomAgent', index });
      });
    });

    // Modal cancel
    document.getElementById('modal-cancel').addEventListener('click', () => {
      document.getElementById('agent-modal').classList.remove('visible');
    });

    // Modal save
    document.getElementById('modal-save').addEventListener('click', () => {
      const name = document.getElementById('modal-name').value.trim();
      const command = document.getElementById('modal-command').value.trim();

      if (!name || !command) {
        return;
      }

      if (editingIndex !== null) {
        vscode.postMessage({ type: 'editCustomAgent', index: editingIndex, name, command });
      } else {
        vscode.postMessage({ type: 'addCustomAgent', name, command });
      }

      document.getElementById('agent-modal').classList.remove('visible');
    });

    // Close modal on overlay click
    document.getElementById('agent-modal').addEventListener('click', (e) => {
      if (e.target.id === 'agent-modal') {
        document.getElementById('agent-modal').classList.remove('visible');
      }
    });

    function saveSettings() {
      const settings = {
        builtIn: {},
        custom: []
      };

      // Gather built-in agent settings
      ['claude', 'codex', 'gemini', 'cursor'].forEach(agent => {
        const checkbox = document.querySelector(\`.login-checkbox[data-agent="\${agent}"]\`);
        const input = document.querySelector(\`.instances-input[data-agent="\${agent}"]\`);
        settings.builtIn[agent] = {
          login: checkbox.checked,
          instances: parseInt(input.value) || 1
        };
      });

      // Gather custom agent settings
      document.querySelectorAll('.agent-row[data-custom-index]').forEach(row => {
        const index = row.dataset.customIndex;
        const checkbox = row.querySelector('.login-checkbox');
        const input = row.querySelector('.instances-input');
        settings.custom.push({
          login: checkbox.checked,
          instances: parseInt(input.value) || 1
        });
      });

      vscode.postMessage({ type: 'saveSettings', settings });
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;

      if (message.type === 'updateRunningCounts') {
        document.getElementById('running-claude').textContent = message.counts.claude;
        document.getElementById('running-codex').textContent = message.counts.codex;
        document.getElementById('running-gemini').textContent = message.counts.gemini;
        document.getElementById('running-cursor').textContent = message.counts.cursor;
      } else if (message.type === 'customAgentCommand') {
        document.getElementById('modal-command').value = message.command;
      } else if (message.type === 'refresh') {
        // Reload the webview
        location.reload();
      }
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getDefaultSettings(): AgentSettings {
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
