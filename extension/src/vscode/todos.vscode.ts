import * as vscode from 'vscode';
import { TodoFile, TodoItem, parseTodoMd } from '../core/todos';
import { getBuiltInByTitle } from './agents.vscode';
import { getBuiltInDefByTitle } from '../core/agents';
import { CLAUDE_TITLE } from '../core/utils';
import * as settings from './settings.vscode';
import type { AgentSettings } from '../core/settings';
import * as terminals from './terminals.vscode';
import { buildAgentTerminalEnv } from '../core/terminals';
import * as prewarm from './prewarm.vscode';
import { supportsPrewarming, buildResumeCommand } from '../core/prewarm';
import { needsPrewarming, generateClaudeSessionId, buildClaudeOpenCommand } from '../core/prewarm.simple';

const TODO_GLOB = '**/TODO.md';
const TODO_EXCLUDE = '**/{node_modules,.git}/**';

export async function discoverTodoFiles(): Promise<TodoFile[]> {
  if (!vscode.workspace.workspaceFolders?.length) return [];

  const uris = await vscode.workspace.findFiles(TODO_GLOB, TODO_EXCLUDE);
  const decoder = new TextDecoder('utf-8');
  const files: TodoFile[] = [];

  for (const uri of uris) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = decoder.decode(bytes);
      const items = parseTodoMd(content);
      files.push({ path: uri.fsPath, items });
    } catch (error) {
      console.error(`[TODOS] Failed to read ${uri.fsPath}`, error);
    }
  }

  return files;
}

export function watchTodoFiles(callback: (files: TodoFile[]) => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(TODO_GLOB);

  const update = async () => {
    const files = await discoverTodoFiles();
    callback(files);
  };

  const disposables: vscode.Disposable[] = [
    watcher,
    watcher.onDidChange(update),
    watcher.onDidCreate(update),
    watcher.onDidDelete(update)
  ];

  update();
  return vscode.Disposable.from(...disposables);
}

export async function spawnSwarmForTodo(
  item: TodoItem,
  context: vscode.ExtensionContext
): Promise<void> {
  const title = item.title?.trim() || 'Untitled task';
  const description = item.description ? `\n\n${item.description}` : '';
  const task = `${title}${description}`;

  const defaultAgentTitle = context.globalState.get<string>('agents.defaultAgentTitle', CLAUDE_TITLE);
  const defaultDef = getBuiltInDefByTitle(defaultAgentTitle) ?? getBuiltInDefByTitle(CLAUDE_TITLE);
  if (!defaultDef) {
    vscode.window.showErrorMessage('Could not determine default agent for swarm');
    return;
  }

  const swarmDef = ['claude', 'codex', 'gemini'].includes(defaultDef.key)
    ? defaultDef
    : getBuiltInDefByTitle(CLAUDE_TITLE);
  if (!swarmDef) {
    vscode.window.showErrorMessage('Could not determine swarm-capable agent');
    return;
  }

  // Format prompt without /swarm prefix, with planning context
  const prompt = `Let's make a clear plan to tackle this Todo item: ${task}`;

  const agentConfig = getBuiltInByTitle(context.extensionPath, swarmDef.title);
  if (!agentConfig) {
    vscode.window.showErrorMessage('Could not find agent configuration');
    return;
  }

  const agentKey = swarmDef.key as keyof AgentSettings['builtIn'];
  const defaultModel = settings.getDefaultModel(context, agentKey);
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

  // Handle session ID for supported agent types (prewarming)
  let sessionId: string | null = null;
  let command = agentConfig.command || '';

  if (supportsPrewarming(agentKey)) {
    if (agentKey === 'claude') {
      // Claude: Generate session ID at open time, no prewarming needed
      sessionId = generateClaudeSessionId();
      command = buildClaudeOpenCommand(sessionId);
    } else if (needsPrewarming(agentKey)) {
      // Codex/Gemini: Use prewarmed session from pool
      const prewarmedSession = prewarm.acquireSession(context, agentKey, cwd);
      if (prewarmedSession) {
        sessionId = prewarmedSession.sessionId;
        command = buildResumeCommand(prewarmedSession);
      }
    }
  }

  // Add default model if not already in command
  if (defaultModel && command && !command.includes('--model')) {
    command = `${command} --model ${defaultModel}`;
  }

  const editorLocation: vscode.TerminalEditorLocationOptions = {
    viewColumn: vscode.ViewColumn.Active,
    preserveFocus: false
  };

  const terminalId = terminals.nextId(agentConfig.prefix);
  const terminal = vscode.window.createTerminal({
    iconPath: agentConfig.iconPath,
    location: editorLocation,
    name: agentConfig.title,
    env: buildAgentTerminalEnv(terminalId, sessionId, cwd),
    isTransient: true
  });

  const pid = await terminal.processId;
  terminals.register(terminal, terminalId, agentConfig, pid, context);

  // Track session ID for prewarmed sessions
  if (sessionId && supportsPrewarming(agentKey)) {
    terminals.setSessionId(terminal, sessionId);
    terminals.setAgentType(terminal, agentKey as terminals.SessionAgentType);
    await prewarm.recordTerminalSession(context, terminalId, sessionId, agentKey, cwd);
  }

  terminals.queueMessage(terminal, prompt);
  if (command) {
    terminal.sendText(command);
  }

  setTimeout(() => {
    const queued = terminals.flushQueue(terminal);
    for (const msg of queued) {
      terminal.sendText(msg);
    }
  }, 5000);
}
