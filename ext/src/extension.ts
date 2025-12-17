import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  parseTerminalName,
  sanitizeLabel,
  getExpandedAgentName,
  getIconFilename,
  CLAUDE_TITLE,
  CODEX_TITLE,
  GEMINI_TITLE,
  CURSOR_TITLE,
  LABEL_MAX_WORDS,
  KNOWN_PREFIXES
} from './utils';

interface TerminalState {
  claudeCount: number;
  codexCount: number;
  geminiCount: number;
  cursorCount: number;
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

interface CodingTask {
  id: string;
  description: string;
  type: 'feature' | 'bugfix' | 'refactor' | 'test' | 'documentation' | 'review';
  priority: 'high' | 'medium' | 'low';
  files?: string[];
  context?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  assignedAgents?: string[];
}

interface AgentCapability {
  agentType: 'claude' | 'codex' | 'gemini' | 'cursor';
  strengths: string[];
  weaknesses: string[];
  bestFor: string[];
}

interface OrchestrationSession {
  id: string;
  task: CodingTask;
  orchestratorTerminalId: string;
  workerAgents: Map<string, AgentCapability>;
  createdAt: number;
  status: 'analyzing' | 'orchestrating' | 'monitoring' | 'completed';
}

let managedTerminals: vscode.Terminal[] = [];
// Map to track terminal ID -> terminal instance for URI callbacks
const terminalMap = new Map<string, vscode.Terminal>();
// Counter to ensure unique terminal IDs
let terminalIdCounter = 0;

interface TerminalMetadata {
  id: string;
  baseName: string;
  label?: string;
}

const terminalMetadataByInstance = new Map<vscode.Terminal, TerminalMetadata>();
const terminalMetadataById = new Map<string, TerminalMetadata>();

let agentStatusBarItem: vscode.StatusBarItem | undefined;

const activeOrchestrationSessions = new Map<string, OrchestrationSession>();

const ORCHESTRATOR_TITLE = 'OR';

const AGENT_CAPABILITIES: Map<string, AgentCapability> = new Map([
  ['claude', {
    agentType: 'claude',
    strengths: ['code-generation', 'refactoring', 'documentation', 'code-review', 'architectural-design'],
    weaknesses: ['real-time-data', 'mathematical-calculations'],
    bestFor: ['feature', 'refactor', 'documentation', 'review']
  }],
  ['codex', {
    agentType: 'codex',
    strengths: ['code-completion', 'syntax-generation', 'quick-prototyping', 'pattern-matching'],
    weaknesses: ['complex-reasoning', 'architectural-planning'],
    bestFor: ['feature', 'bugfix']
  }],
  ['gemini', {
    agentType: 'gemini',
    strengths: ['multimodal-analysis', 'code-understanding', 'testing', 'documentation'],
    weaknesses: ['code-generation-speed'],
    bestFor: ['test', 'documentation', 'review']
  }],
  ['cursor', {
    agentType: 'cursor',
    strengths: ['codebase-navigation', 'context-awareness', 'incremental-changes', 'local-development'],
    weaknesses: ['large-scale-refactoring'],
    bestFor: ['bugfix', 'refactor', 'feature']
  }]
]);

function getBuiltInAgents(extensionPath: string): AgentConfig[] {
  const claudeIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'claude.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'claude.png'))
  };

  const codexIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'chatgpt.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'chatgpt.png'))
  };

  const geminiIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'gemini.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'gemini.png'))
  };

  const cursorIconPath: vscode.IconPath = {
    light: vscode.Uri.file(path.join(extensionPath, 'assets', 'cursor.png')),
    dark: vscode.Uri.file(path.join(extensionPath, 'assets', 'cursor.png'))
  };

  const config = vscode.workspace.getConfiguration('agentTabs');
  const claudeCount = config.get<number>('claudeCount', 2);
  const codexCount = config.get<number>('codexCount', 2);
  const geminiCount = config.get<number>('geminiCount', 2);
  const cursorCount = config.get<number>('cursorCount', 2);

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
    },
    {
      title: CURSOR_TITLE,
      command: 'cursor',
      count: cursorCount,
      iconPath: cursorIconPath,
      prefix: 'cr'
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
    const prefix = agent.title.toLowerCase().replace(/[^a-z0-9]/g, '') || 'ax';

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

interface AgentTerminalInfo {
  isAgent: boolean;
  prefix: string | null;
  label: string | null;
  iconPath: vscode.IconPath | null;
}

function identifyAgentTerminal(terminal: vscode.Terminal, extensionPath: string): AgentTerminalInfo {
  const buildIconPath = (prefix: string): vscode.IconPath | null => {
    const iconFile = getIconFilename(prefix);
    if (iconFile) {
      return {
        light: vscode.Uri.file(path.join(extensionPath, 'assets', iconFile)),
        dark: vscode.Uri.file(path.join(extensionPath, 'assets', iconFile))
      };
    }
    return null;
  };

  // First check in-memory metadata
  const metadata = terminalMetadataByInstance.get(terminal);
  if (metadata) {
    return {
      isAgent: true,
      prefix: metadata.baseName,
      label: metadata.label ?? null,
      iconPath: buildIconPath(metadata.baseName)
    };
  }

  // Fall back to strict name parsing using shared util
  const parsed = parseTerminalName(terminal.name);
  if (parsed.isAgent && parsed.prefix) {
    return {
      isAgent: true,
      prefix: parsed.prefix,
      label: parsed.label,
      iconPath: buildIconPath(parsed.prefix)
    };
  }

  return { isAgent: false, prefix: null, label: null, iconPath: null };
}

function getAgentConfigFromTerminal(
  terminal: vscode.Terminal,
  extensionPath: string
): AgentConfig | null {
  const info = identifyAgentTerminal(terminal, extensionPath);
  const builtInAgents = getBuiltInAgents(extensionPath);
  const customAgents = getCustomAgents(extensionPath);

  if (!info.isAgent || !info.prefix) {
    // Check custom agents by name
    const terminalName = terminal.name.trim();
    for (const agent of customAgents) {
      if (terminalName === agent.title || terminalName.startsWith(`${agent.title} - `)) {
        return agent;
      }
    }
    return null;
  }

  // Map prefix to agent config
  const prefixToTitle: Record<string, string> = {
    [CLAUDE_TITLE]: CLAUDE_TITLE,
    [CODEX_TITLE]: CODEX_TITLE,
    [GEMINI_TITLE]: GEMINI_TITLE,
    [CURSOR_TITLE]: CURSOR_TITLE
  };

  const title = prefixToTitle[info.prefix];
  if (title) {
    return builtInAgents.find(a => a.title === title) || null;
  }

  // Check custom agents
  for (const agent of customAgents) {
    if (info.prefix === agent.title) {
      return agent;
    }
  }

  return null;
}

async function analyzeCodebase(): Promise<{
  languages: string[];
  frameworks: string[];
  fileCount: number;
  structure: string;
}> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return { languages: [], frameworks: [], fileCount: 0, structure: 'No workspace open' };
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  let fileCount = 0;
  const structure: string[] = [];

  try {
    const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 1000);
    fileCount = files.length;

    for (const file of files) {
      const ext = path.extname(file.fsPath).toLowerCase();
      if (ext === '.ts' || ext === '.tsx') languages.add('TypeScript');
      else if (ext === '.js' || ext === '.jsx') languages.add('JavaScript');
      else if (ext === '.py') languages.add('Python');
      else if (ext === '.go') languages.add('Go');
      else if (ext === '.rs') languages.add('Rust');
      else if (ext === '.java') languages.add('Java');
      else if (ext === '.rb') languages.add('Ruby');
      else if (ext === '.php') languages.add('PHP');

      const relativePath = path.relative(rootPath, file.fsPath);
      if (relativePath.includes('package.json')) {
        try {
          const content = fs.readFileSync(file.fsPath, 'utf8');
          const pkg = JSON.parse(content);
          if (pkg.dependencies) {
            if (pkg.dependencies.react) frameworks.add('React');
            if (pkg.dependencies.vue) frameworks.add('Vue');
            if (pkg.dependencies.angular) frameworks.add('Angular');
            if (pkg.dependencies['@nestjs/core']) frameworks.add('NestJS');
            if (pkg.dependencies.express) frameworks.add('Express');
            if (pkg.dependencies.next) frameworks.add('Next.js');
          }
        } catch {}
      }
    }

    const topLevelDirs = fs.readdirSync(rootPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .filter(name => !name.startsWith('.') && name !== 'node_modules');

    structure.push(`Root: ${path.basename(rootPath)}`);
    structure.push(`Top-level directories: ${topLevelDirs.join(', ')}`);
  } catch (error) {
    console.error('Error analyzing codebase:', error);
  }

  return {
    languages: Array.from(languages),
    frameworks: Array.from(frameworks),
    fileCount,
    structure: structure.join('\n')
  };
}

function selectAgentsForTask(task: CodingTask): string[] {
  const selectedAgents: string[] = [];
  const taskType = task.type;

  for (const [agentName, capability] of AGENT_CAPABILITIES.entries()) {
    if (capability.bestFor.includes(taskType)) {
      selectedAgents.push(agentName);
    }
  }

  if (selectedAgents.length === 0) {
    selectedAgents.push('claude');
  }

  if (task.priority === 'high' && selectedAgents.length < 2) {
    if (!selectedAgents.includes('claude')) selectedAgents.push('claude');
    if (!selectedAgents.includes('cursor')) selectedAgents.push('cursor');
  }

  return selectedAgents.slice(0, 3);
}

async function spawnWorkerAgent(
  context: vscode.ExtensionContext,
  agentType: string,
  task: CodingTask,
  sessionId: string
): Promise<string | null> {
  const builtInAgents = getBuiltInAgents(context.extensionPath);
  let agentConfig: AgentConfig | undefined;

  switch (agentType) {
    case 'claude':
      agentConfig = builtInAgents.find(a => a.title === CLAUDE_TITLE);
      break;
    case 'codex':
      agentConfig = builtInAgents.find(a => a.title === CODEX_TITLE);
      break;
    case 'gemini':
      agentConfig = builtInAgents.find(a => a.title === GEMINI_TITLE);
      break;
    case 'cursor':
      agentConfig = builtInAgents.find(a => a.title === CURSOR_TITLE);
      break;
  }

  if (!agentConfig) {
    console.error(`Agent config not found for type: ${agentType}`);
    return null;
  }

  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  const terminalId = `${agentConfig.prefix}-${Date.now()}-${++terminalIdCounter}`;
  const baseName = `${agentConfig.title} [${task.id.substring(0, 8)}]`;

  try {
    const terminal = vscode.window.createTerminal({
      iconPath: agentConfig.iconPath,
      location: editorLocation,
      isTransient: true,
      name: baseName,
      env: {
        AGENT_TERMINAL_ID: terminalId,
        ORCHESTRATION_SESSION_ID: sessionId,
        TASK_ID: task.id,
        TASK_DESCRIPTION: task.description,
        DISABLE_AUTO_TITLE: 'true',
        PROMPT_COMMAND: ''
      }
    });

    terminalMap.set(terminalId, terminal);
    registerTerminalMetadata(terminal, terminalId, baseName);

    const capability = AGENT_CAPABILITIES.get(agentType);
    if (capability) {
      const session = activeOrchestrationSessions.get(sessionId);
      if (session) {
        session.workerAgents.set(terminalId, capability);
      }
    }

    terminal.sendText(agentConfig.command);

    managedTerminals.push(terminal);
    return terminalId;
  } catch (error) {
    console.error(`Failed to spawn worker agent ${agentType}:`, error);
    return null;
  }
}

function applyLabelToTerminal(
  terminal: vscode.Terminal,
  metadata: TerminalMetadata,
  label: string
) {
  const cleaned = sanitizeLabel(label);
  metadata.label = cleaned;
  // Update status bar if this terminal is active
  if (vscode.window.activeTerminal === terminal && agentStatusBarItem) {
    agentStatusBarItem.text = cleaned || metadata.baseName;
    agentStatusBarItem.show();
  }
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

export function activate(context: vscode.ExtensionContext) {
  console.log('Cursor Agents extension is now active');

  // Create status bar item for showing active terminal label
  agentStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  context.subscriptions.push(agentStatusBarItem);

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
    vscode.commands.registerCommand('agentTabs.configure', configureCounts)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.newAgent', () => {
      const config = vscode.workspace.getConfiguration('agentTabs');
      const defaultAgent = config.get<string>('defaultAgent', 'claude');
      const builtInAgents = getBuiltInAgents(context.extensionPath);

      let agentConfig: AgentConfig | undefined;
      switch (defaultAgent) {
        case 'claude':
          agentConfig = builtInAgents.find(a => a.title === CLAUDE_TITLE);
          break;
        case 'codex':
          agentConfig = builtInAgents.find(a => a.title === CODEX_TITLE);
          break;
        case 'gemini':
          agentConfig = builtInAgents.find(a => a.title === GEMINI_TITLE);
          break;
        case 'cursor':
          agentConfig = builtInAgents.find(a => a.title === CURSOR_TITLE);
          break;
      }

      if (agentConfig) {
        openSingleAgent(context, agentConfig);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.setTitle', () => setTitleForActiveTerminal(context.extensionPath))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.reload', () => reloadActiveTerminal(context))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.generateCommit', generateCommitMessage)
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

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.newCursor', () => {
      const builtInAgents = getBuiltInAgents(context.extensionPath);
      const cursorAgent = builtInAgents.find(a => a.title === CURSOR_TITLE);
      if (cursorAgent) {
        openSingleAgent(context, cursorAgent);
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

  // Update status bar when active terminal changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!terminal || !agentStatusBarItem) {
        agentStatusBarItem?.hide();
        return;
      }
      const metadata = terminalMetadataByInstance.get(terminal);
      if (metadata?.label) {
        agentStatusBarItem.text = metadata.label;
        agentStatusBarItem.show();
      } else if (metadata) {
        agentStatusBarItem.text = metadata.baseName;
        agentStatusBarItem.show();
      } else {
        agentStatusBarItem.hide();
      }
    })
  );

  // Auto-open terminals on startup if autoStart is enabled
  const config = vscode.workspace.getConfiguration('agentTabs');
  const autoStart = config.get<boolean>('autoStart', false);

  if (autoStart) {
    // Delay to ensure workspace is fully loaded
    setTimeout(() => openAgentTerminals(context), 1000);
  }
}

async function openSingleAgent(context: vscode.ExtensionContext, agentConfig: AgentConfig) {
  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  const terminalId = `${agentConfig.prefix}-${Date.now()}-${++terminalIdCounter}`;
  const baseName = agentConfig.title;
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

  // Store terminal in map for URI callback
  terminalMap.set(terminalId, terminal);
  registerTerminalMetadata(terminal, terminalId, baseName);

  // Send the agent command
  terminal.sendText(agentConfig.command);

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
      const terminalId = `${agent.prefix}-${Date.now()}-${++terminalIdCounter}`;
      const baseName = agent.title;
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

      // Store terminal in map for URI callback
      terminalMap.set(terminalId, terminal);
      registerTerminalMetadata(terminal, terminalId, baseName);

      // Send the agent command
      terminal.sendText(agent.command);

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
    cursorCount: config.get<number>('cursorCount', 2),
    terminalIds: managedTerminals.map((terminal) => {
      const metadata = terminalMetadataByInstance.get(terminal);
      return metadata?.id || '';
    }).filter(id => id !== '')
  };
  await context.globalState.update('terminalState', state);

  if (totalCount > 0) {
    vscode.window.showInformationMessage(
      `Opened ${totalCount} agent terminal${totalCount > 1 ? 's' : ''}`
    );
  }
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

  const cursorInput = await vscode.window.showInputBox({
    prompt: 'Number of Cursor terminals',
    value: config.get<number>('cursorCount', 2).toString(),
    validateInput: (value) => {
      const num = parseInt(value);
      if (isNaN(num) || num < 0 || num > 10) {
        return 'Please enter a number between 0 and 10';
      }
      return null;
    }
  });

  if (cursorInput === undefined) {
    return; // User cancelled
  }

  // Update configuration
  await config.update('claudeCount', parseInt(claudeInput), vscode.ConfigurationTarget.Global);
  await config.update('codexCount', parseInt(codexInput), vscode.ConfigurationTarget.Global);
  await config.update('geminiCount', parseInt(geminiInput), vscode.ConfigurationTarget.Global);
  await config.update('cursorCount', parseInt(cursorInput), vscode.ConfigurationTarget.Global);

  const action = await vscode.window.showInformationMessage(
    'Configuration updated. Open terminals now?',
    'Yes',
    'No'
  );

  if (action === 'Yes') {
    vscode.commands.executeCommand('agentTabs.open');
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
    const metadata = terminalMetadataByInstance.get(terminal);

    if (metadata) {
      metadata.label = cleaned || undefined;
    }

    // Update status bar only (don't rename terminal tab)
    updateStatusBarForTerminal(terminal, extensionPath);
  });
}

async function reloadActiveTerminal(context: vscode.ExtensionContext) {
  try {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      vscode.window.showErrorMessage('No active terminal to reload.');
      return;
    }

    const agentConfig = getAgentConfigFromTerminal(terminal, context.extensionPath);
    if (!agentConfig) {
      vscode.window.showErrorMessage('Could not identify agent type from active terminal.');
      return;
    }

    terminal.sendText('/quit');
    terminal.sendText('\r');

    await new Promise(resolve => setTimeout(resolve, 2500));

    try {
      terminal.sendText('clear');
      terminal.sendText(agentConfig.command);
      terminal.sendText('\r');
      vscode.window.showInformationMessage(`Reloaded ${agentConfig.title} agent.`);
    } catch (sendError) {
      vscode.window.showWarningMessage('Terminal may have been closed. Please open a new agent terminal.');
    }
  } catch (error) {
    console.error('Error reloading terminal:', error);
    vscode.window.showErrorMessage(`Failed to reload terminal: ${error}`);
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
    vscode.window.showErrorMessage('API key not set. Please set agents.apiKey in settings.');
    return;
  }

  const provider = config.get<string>('provider', 'openai');
  const model = config.get<string>('model', 'gpt-4o-mini');
  const autoPush = config.get<boolean>('autoPush', true);
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
        if (autoPush) {
          try {
            await repo.push();
            vscode.window.showInformationMessage(`Pushed: ${commitMessage}`);
          } catch (pushError: unknown) {
            const msg = pushError instanceof Error ? pushError.message : String(pushError);
            vscode.window.showErrorMessage(`Committed but push failed: ${msg}`);
          }
        } else {
          vscode.window.showInformationMessage(`Committed: ${commitMessage}`);
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
  for (const terminal of managedTerminals) {
    terminal.dispose();
    unregisterTerminalMetadata(terminal);
  }
  managedTerminals = [];
  terminalMap.clear();
}
