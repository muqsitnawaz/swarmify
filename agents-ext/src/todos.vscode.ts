import * as vscode from 'vscode';
import { TodoFile, TodoItem, parseTodoMd } from './todos';

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

export async function spawnSwarmForTodo(item: TodoItem): Promise<void> {
  const title = item.title?.trim() || 'Untitled task';
  const description = item.description ? `\n\n${item.description}` : '';
  const prompt = `/swarm ${title}${description}`;

  await vscode.env.clipboard.writeText(prompt);

  try {
    await vscode.commands.executeCommand('agents.newClaude');
  } catch (error) {
    console.error('[TODOS] Failed to open Claude orchestrator', error);
    await vscode.commands.executeCommand('agents.newAgent');
  }

  setTimeout(() => {
    vscode.commands.executeCommand('workbench.action.terminal.paste');
  }, 1000);
}
