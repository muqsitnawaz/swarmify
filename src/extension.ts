import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';

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

interface TerminalMetadata {
  id: string;
  baseName: string;
  label?: string;
}

const terminalMetadataByInstance = new Map<vscode.Terminal, TerminalMetadata>();
const terminalMetadataById = new Map<string, TerminalMetadata>();

const CLAUDE_TITLE = 'CC';
const CODEX_TITLE = 'CX';
const GEMINI_TITLE = 'GM';
const LABEL_MAX_WORDS = 5;
const CONTEXT_SNIPPET_LIMIT = 800;
const decoder = new TextDecoder();

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

function buildDisplayedTitle(baseName: string, label?: string) {
  const cleanedLabel = sanitizeLabel(label ?? '');
  if (!cleanedLabel) {
    return baseName;
  }
  return `${baseName} - ${cleanedLabel}`;
}

function sanitizeLabel(raw: string) {
  const stripped = raw.replace(/["'`]/g, '').trim();
  if (!stripped) {
    return '';
  }
  const words = stripped.split(/\s+/).slice(0, LABEL_MAX_WORDS);
  return words.join(' ').trim();
}

function getFriendlyAgentName(title: string) {
  if (title === CLAUDE_TITLE) {
    return 'Claude';
  }
  if (title === CODEX_TITLE) {
    return 'Codex';
  }
  if (title === GEMINI_TITLE) {
    return 'Gemini';
  }
  return title;
}

async function applyLabelToTerminal(terminal: vscode.Terminal, metadata: TerminalMetadata, label: string) {
  const cleaned = sanitizeLabel(label);
  const finalTitle = buildDisplayedTitle(metadata.baseName, cleaned);
  metadata.label = cleaned;
  await setTerminalTitle(terminal, finalTitle);
}

function registerTerminalMetadata(terminal: vscode.Terminal, id: string, baseName: string) {
  const metadata: TerminalMetadata = { id, baseName };
  terminalMetadataByInstance.set(terminal, metadata);
  terminalMetadataById.set(id, metadata);
}

function unregisterTerminalMetadata(terminal: vscode.Terminal) {
  const metadata = terminalMetadataByInstance.get(terminal);
  if (metadata) {
    terminalMetadataByInstance.delete(terminal);
    terminalMetadataById.delete(metadata.id);
  }
}

function getWorkspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
}

async function readPreferredContextFile(): Promise<{ label: string; content: string } | undefined> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    return undefined;
  }

  // Priority: AGENTS.md > CLAUDE.md/GEMINI.md > README.md (case-insensitive)
  const candidates = [
    'AGENTS.md',
    'agents.md',
    'CLAUDE.md',
    'claude.md',
    'GEMINI.md',
    'gemini.md',
    'README.md',
    'readme.md'
  ];

  for (const fileName of candidates) {
    const fileUri = vscode.Uri.joinPath(workspaceRoot, fileName);
    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat) {
        const data = await vscode.workspace.fs.readFile(fileUri);
        const text = decoder.decode(data).slice(0, CONTEXT_SNIPPET_LIMIT);
        return { label: fileName, content: text };
      }
    } catch {
      // Ignore missing files and keep scanning
      continue;
    }
  }

  return undefined;
}

function getEditorSelectionSnippet(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }
  const selection = editor.selection;
  if (selection.isEmpty) {
    return undefined;
  }
  const text = editor.document.getText(selection).trim();
  if (!text) {
    return undefined;
  }
  return text.slice(0, 1000);
}

function buildLabelPrompt(params: {
  agentName: string;
  workspaceFolder?: string;
  selection?: string;
  fileContext?: { label: string; content: string };
}) {
  const lines: string[] = [];
  lines.push(
    'You create a concise, human-friendly label for a coding agent terminal tab.',
    'Rules: max 5 words, prefer feature/task names, no quotes/emoji, avoid trailing punctuation.',
    `Agent: ${params.agentName}`
  );

  if (params.workspaceFolder) {
    lines.push(`Workspace: ${params.workspaceFolder}`);
  }

  if (params.fileContext) {
    lines.push(`${params.fileContext.label} excerpt:\n${params.fileContext.content}`);
  }

  lines.push('User selection/context:');
  lines.push(params.selection ?? '(none provided)');
  lines.push('Return only the label text.');

  return lines.join('\n');
}

async function callLabelModel(prompt: string) {
  const config = vscode.workspace.getConfiguration('agentTabs');
  const apiKey = config.get<string>('openAiApiKey', '').trim();
  const model = config.get<string>('openAiModel', 'gpt-4o-mini').trim() || 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error('Set agentTabs.openAiApiKey in settings to generate labels.');
  }

  const fetchFn: any = (globalThis as any).fetch;
  if (!fetchFn) {
    throw new Error('fetch is not available in this environment.');
  }

  const response = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 30,
      messages: [
        {
          role: 'system',
          content:
            'You write short, human-friendly labels for VS Code terminal tabs. Respond with <=5 words, no quotes or emoji.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM call failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('LLM returned no content');
  }
  return text.trim();
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

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.setTitle', () => setTitleForActiveTerminal())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.generateTitle', () => generateTitleForActiveTerminal())
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

      unregisterTerminalMetadata(terminal);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal(async (terminal) => {
      if (!terminal) {
        return;
      }
      const metadata = terminalMetadataByInstance.get(terminal);
      if (!metadata) {
        return;
      }
      const title = buildDisplayedTitle(metadata.baseName, metadata.label);
      await setTerminalTitle(terminal, title);
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
  const baseName = getFriendlyAgentName(agentConfig.title);
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
  registerTerminalMetadata(terminal, terminalId, baseName);

  // Send the agent command
  terminal.sendText(agentConfig.command);
  await setTerminalTitle(terminal, baseName);

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
      const baseName = getFriendlyAgentName(agent.title);
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
      registerTerminalMetadata(terminal, terminalId, baseName);

      // Send the agent command
      terminal.sendText(agent.command);
      await setTerminalTitle(terminal, baseName);

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
    unregisterTerminalMetadata(terminal);
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

async function getActiveManagedTerminal() {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    vscode.window.showInformationMessage('No active terminal to label.');
    return undefined;
  }
  const metadata = terminalMetadataByInstance.get(terminal);
  if (!metadata) {
    vscode.window.showInformationMessage('Active terminal is not managed by Cursor Agents.');
    return undefined;
  }
  return { terminal, metadata };
}

async function setTitleForActiveTerminal() {
  const active = await getActiveManagedTerminal();
  if (!active) {
    return;
  }

  const currentLabel = active.metadata.label ?? '';
  const input = await vscode.window.showInputBox({
    prompt: 'Set a short label for this agent tab',
    placeHolder: 'Feature name or task (max 5 words)',
    value: currentLabel
  });

  if (input === undefined) {
    return;
  }

  const cleaned = sanitizeLabel(input);
  if (!cleaned) {
    vscode.window.showInformationMessage('Label not set (empty input).');
    return;
  }

  await applyLabelToTerminal(active.terminal, active.metadata, cleaned);
}

async function generateTitleForActiveTerminal() {
  const active = await getActiveManagedTerminal();
  if (!active) {
    return;
  }

  const selection = getEditorSelectionSnippet();
  const manualContext =
    selection ??
    (await vscode.window.showInputBox({
      prompt: 'Optional: paste a short task/context snippet for this tab',
      placeHolder: 'E.g., Fix login bug, implement feature X'
    }));

  const workspaceRoot = getWorkspaceRoot();
  const workspaceName = workspaceRoot ? path.basename(workspaceRoot.fsPath) : undefined;
  const fileContext = await readPreferredContextFile();
  const prompt = buildLabelPrompt({
    agentName: active.metadata.baseName,
    workspaceFolder: workspaceName,
    selection: manualContext?.slice(0, 1000),
    fileContext
  });

  try {
    const suggested = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating agent tab label…'
      },
      async () => callLabelModel(prompt)
    );

    const cleaned = sanitizeLabel(suggested);
    const finalLabel = await vscode.window.showInputBox({
      prompt: 'Review or edit the generated label',
      value: cleaned || active.metadata.label || '',
      placeHolder: 'Feature name or task (max 5 words)'
    });

    if (finalLabel === undefined) {
      return;
    }

    const finalCleaned = sanitizeLabel(finalLabel);
    if (!finalCleaned) {
      vscode.window.showInformationMessage('Label not set (empty input).');
      return;
    }

    await applyLabelToTerminal(active.terminal, active.metadata, finalCleaned);
  } catch (error: any) {
    console.error('Failed to generate tab label', error);
    vscode.window.showErrorMessage(
      `Could not generate label: ${error?.message ?? 'Unknown error'}`
    );
  }
}

export function deactivate() {
  closeAllTerminals();
}
