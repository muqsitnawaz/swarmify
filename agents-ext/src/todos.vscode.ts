import * as vscode from 'vscode';
import { TodoFile, TodoItem, parseTodoMd } from './todos';
import { getBuiltInByTitle } from './agents.vscode';
import { getBuiltInDefByTitle } from './agents';
import { CLAUDE_TITLE } from './utils';
import * as settings from './settings.vscode';
import type { AgentSettings } from './settings';
import * as terminals from './terminals.vscode';

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

  const prompt = swarmDef.key === 'codex'
    ? `/prompts:swarm ${task}`
    : `/swarm ${task}`;

  const agentConfig = getBuiltInByTitle(context.extensionPath, swarmDef.title);
  if (!agentConfig) {
    vscode.window.showErrorMessage('Could not find agent configuration');
    return;
  }

  const defaultModel = settings.getDefaultModel(context, swarmDef.key as keyof AgentSettings['builtIn']);
  const command = defaultModel ? `${agentConfig.command} --model ${defaultModel}` : agentConfig.command;

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
