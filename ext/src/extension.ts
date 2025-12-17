import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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

const CLAUDE_TITLE = 'CC';
const CODEX_TITLE = 'CX';
const GEMINI_TITLE = 'GX';
const CURSOR_TITLE = 'CR';
const ORCHESTRATOR_TITLE = 'OR';
const LABEL_MAX_WORDS = 5;

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

function detectAgentTypeFromTerminalName(terminalName: string): string | null {
  const nameLower = terminalName.toLowerCase();
  
  if (nameLower.includes('claude') || nameLower.includes('cc')) {
    return CLAUDE_TITLE;
  } else if (nameLower.includes('codex') || nameLower.includes('cx')) {
    return CODEX_TITLE;
  } else if (nameLower.includes('gemini') || nameLower.includes('gx') || nameLower.includes('gm')) {
    return GEMINI_TITLE;
  } else if (nameLower.includes('cursor') || nameLower.includes('cr')) {
    return CURSOR_TITLE;
  }
  
  return null;
}

function getAgentConfigFromTerminal(
  terminal: vscode.Terminal,
  extensionPath: string
): AgentConfig | null {
  const metadata = terminalMetadataByInstance.get(terminal);
  let baseName: string | null = null;
  
  const builtInAgents = getBuiltInAgents(extensionPath);
  const customAgents = getCustomAgents(extensionPath);
  
  if (metadata) {
    baseName = metadata.baseName.trim();
  } else {
    const detectedPrefix = detectAgentTypeFromTerminalName(terminal.name);
    if (detectedPrefix) {
      baseName = detectedPrefix;
    } else {
      const terminalName = terminal.name.trim();
      for (const agent of customAgents) {
        if (terminalName.toLowerCase().includes(agent.title.toLowerCase()) || 
            terminalName.startsWith(agent.title)) {
          return agent;
        }
      }
      return null;
    }
  }

  if (baseName.startsWith(CLAUDE_TITLE)) {
    return builtInAgents.find(a => a.title === CLAUDE_TITLE) || null;
  } else if (baseName.startsWith(CODEX_TITLE)) {
    return builtInAgents.find(a => a.title === CODEX_TITLE) || null;
  } else if (baseName.startsWith(GEMINI_TITLE)) {
    return builtInAgents.find(a => a.title === GEMINI_TITLE) || null;
  } else if (baseName.startsWith(CURSOR_TITLE)) {
    return builtInAgents.find(a => a.title === CURSOR_TITLE) || null;
  } else {
    for (const agent of customAgents) {
      if (baseName.startsWith(agent.title)) {
        return agent;
      }
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

function sanitizeLabel(raw: string) {
  const stripped = raw.replace(/["'`]/g, '').trim();
  if (!stripped) {
    return '';
  }
  const words = stripped.split(/\s+/).slice(0, LABEL_MAX_WORDS);
  return words.join(' ').trim();
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
    vscode.commands.registerCommand('agentTabs.setTitle', () => setTitleForActiveTerminal())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentTabs.reload', () => reloadActiveTerminal(context))
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

function setTitleForActiveTerminal() {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    vscode.window.showInformationMessage('No active terminal to label.');
    return;
  }

  const metadata = terminalMetadataByInstance.get(terminal);
  if (!metadata) {
    vscode.window.showInformationMessage('This terminal is not managed by Agent Tabs.');
    return;
  }

  const currentLabel = metadata.label ?? '';
  vscode.window.showInputBox({
    prompt: 'Set a label for this agent (shown in status bar)',
    placeHolder: 'Feature name or task (max 5 words)',
    value: currentLabel
  }).then((input) => {
    if (input === undefined) {
      return;
    }

    const cleaned = input.trim();
    if (!cleaned) {
      // Clear the label
      metadata.label = undefined;
      if (agentStatusBarItem && vscode.window.activeTerminal === terminal) {
        agentStatusBarItem.text = metadata.baseName;
      }
      return;
    }

    applyLabelToTerminal(terminal, metadata, sanitizeLabel(cleaned));
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

export function deactivate() {
  for (const terminal of managedTerminals) {
    terminal.dispose();
    unregisterTerminalMetadata(terminal);
  }
  managedTerminals = [];
  terminalMap.clear();
}
