import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class AgentsMarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new AgentsMarkdownEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      'agents.markdownEditor',
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    );
    return providerRegistration;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui', 'editor'),
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
      ],
    };

    // Set webview HTML content
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document);

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message, document, webviewPanel.webview);
    });

    // Handle document changes (external edits)
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        this.updateWebview(webviewPanel.webview, document);
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    // Send initial content to webview
    this.updateWebview(webviewPanel.webview, document);
  }

  private async handleMessage(
    message: any,
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    switch (message.type) {
      case 'update':
        return this.updateDocument(document, message.content);

      case 'saveAsset':
        return this.saveAsset(message.data, message.fileName, document, webview);

      case 'ready':
        // Webview is ready, send initial content
        this.updateWebview(webview, document);
        break;

      case 'sendToAgent':
        return this.handleSendToAgent(message, webview);

      case 'triggerAgent':
        return this.handleAgentTrigger(message, webview);

      case 'aiAction':
        return this.handleAIAction(message, webview);
    }
  }

  private async handleSendToAgent(message: any, webview: vscode.Webview): Promise<void> {
    const { selection } = message;

    try {
      // Copy selection to clipboard for context
      await vscode.env.clipboard.writeText(selection);

      // Trigger the newTask command which opens a new Claude terminal with context
      await vscode.commands.executeCommand('agents.newTask');

      webview.postMessage({
        type: 'agentResult',
        result: 'Opening new agent terminal with your selection...',
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to send to agent: ${error}`);
      webview.postMessage({
        type: 'agentResult',
        result: 'Failed to send to agent. Please try again.',
      });
    }
  }

  private async handleAgentTrigger(message: any, webview: vscode.Webview): Promise<void> {
    const { action, topic } = message;

    try {
      let result = '';

      if (action === 'ask') {
        // Trigger new agent with input prompt
        const input = await vscode.window.showInputBox({
          prompt: 'What would you like to ask the agent?',
          placeHolder: 'Enter your question...',
        });

        if (input) {
          await vscode.env.clipboard.writeText(input);
          await vscode.commands.executeCommand('agents.newTask');
          result = 'Opening agent with your question...';
        }
      } else if (action === 'research') {
        if (topic) {
          await vscode.env.clipboard.writeText(`Research: ${topic}`);
          await vscode.commands.executeCommand('agents.newTask');
          result = `Researching: ${topic}...`;
        }
      }

      webview.postMessage({
        type: 'agentResult',
        result,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Agent error: ${error}`);
      webview.postMessage({
        type: 'agentResult',
        result: 'Agent failed to respond. Please try again.',
      });
    }
  }

  private async handleAIAction(message: any, webview: vscode.Webview): Promise<void> {
    const { action, selection, topic } = message;

    try {
      let result = '';
      let prompt = '';

      // Build prompt based on action
      switch (action) {
        case 'write':
          prompt = `Write content about: ${topic}`;
          break;
        case 'continue':
          prompt = 'Continue writing from where I left off';
          break;
        case 'improve':
          prompt = `Improve this text: ${selection}`;
          break;
        case 'expand':
          prompt = `Expand on this idea: ${selection}`;
          break;
        case 'summarize':
          prompt = `Summarize this text: ${selection}`;
          break;
        case 'fix':
          prompt = `Fix grammar and spelling in: ${selection}`;
          break;
        default:
          prompt = selection || '';
      }

      // Copy prompt to clipboard and notify user
      await vscode.env.clipboard.writeText(prompt);
      result = `Prompt copied to clipboard. Paste it into an agent to get AI response.`;

      webview.postMessage({
        type: 'aiResult',
        action,
        result,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`AI action error: ${error}`);
      webview.postMessage({
        type: 'aiResult',
        action,
        result: 'AI action failed. Please try again.',
      });
    }
  }

  private async updateDocument(document: vscode.TextDocument, content: string): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      content
    );
    await vscode.workspace.applyEdit(edit);
  }

  private async saveAsset(
    data: string,
    fileName: string,
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration('agents');
    const assetFolder = config.get('editor.assetFolder', '.assets');

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const assetDir = path.join(workspaceFolder.uri.fsPath, assetFolder);

    // Create asset directory if it doesn't exist
    if (!fs.existsSync(assetDir)) {
      fs.mkdirSync(assetDir, { recursive: true });
    }

    // Generate unique filename if file already exists
    let uniqueFileName = fileName;
    let counter = 1;
    while (fs.existsSync(path.join(assetDir, uniqueFileName))) {
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);
      uniqueFileName = `${base}-${counter}${ext}`;
      counter++;
    }

    const assetPath = path.join(assetDir, uniqueFileName);

    // Save the file
    const buffer = Buffer.from(data.split(',')[1], 'base64');
    fs.writeFileSync(assetPath, buffer);

    // Send back the relative path
    const relativePath = path.join(assetFolder, uniqueFileName);
    webview.postMessage({
      type: 'assetSaved',
      path: relativePath,
    });
  }

  private updateWebview(webview: vscode.Webview, document: vscode.TextDocument): void {
    webview.postMessage({
      type: 'update',
      content: document.getText(),
    });
  }

  private getHtmlForWebview(webview: vscode.Webview, document: vscode.TextDocument): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui', 'editor', 'assets', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'ui', 'editor', 'assets', 'index.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    img-src ${webview.cspSource} https: data:;
    font-src ${webview.cspSource};
    connect-src https:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Agents Markdown Editor</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Swarm the current document - opens a new Claude terminal and runs /swarm with the document content
 */
export async function swarmCurrentDocument(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  // Check if we have an active markdown document
  if (!editor) {
    // Try to get content from active custom editor
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab?.input instanceof vscode.TabInputCustom) {
      // We're in a custom editor - get the document content via URI
      const docUri = activeTab.input.uri;
      if (docUri.fsPath.endsWith('.md')) {
        try {
          const doc = await vscode.workspace.openTextDocument(docUri);
          const content = doc.getText();
          await sendSwarmCommand(content, context);
          return;
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to read document: ${error}`);
          return;
        }
      }
    }
    vscode.window.showWarningMessage('Open a markdown file to swarm');
    return;
  }

  if (!editor.document.fileName.endsWith('.md')) {
    vscode.window.showWarningMessage('Open a markdown file to swarm');
    return;
  }

  const content = editor.document.getText();
  await sendSwarmCommand(content, context);
}

async function sendSwarmCommand(content: string, context: vscode.ExtensionContext): Promise<void> {
  const message = `/swarm ${content}`;

  // Import dynamically to avoid circular dependencies
  const { getBuiltInByTitle } = await import('./agents.vscode');
  const { CLAUDE_TITLE } = await import('./utils');
  const terminals = await import('./terminals.vscode');

  const agentConfig = getBuiltInByTitle(context.extensionPath, CLAUDE_TITLE);
  if (!agentConfig) {
    vscode.window.showErrorMessage('Could not find Claude agent configuration');
    return;
  }

  // Create new terminal
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

  // Queue the swarm message
  terminals.queueMessage(terminal, message);

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
  }, 2000);

  vscode.window.showInformationMessage('Swarming document with Claude...');
}
