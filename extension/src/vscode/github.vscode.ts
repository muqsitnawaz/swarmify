import * as vscode from 'vscode';
import { UnifiedTask } from '../core/tasks';

export async function isGitHubAvailable(context: vscode.ExtensionContext): Promise<boolean> {
  const token = context.globalState.get<string>('github_mcp_token');
  return !!token;
}

export async function fetchGitHubTasks(context: vscode.ExtensionContext): Promise<UnifiedTask[]> {
  // TODO: Implement GitHub MCP client integration
  return [];
}

export function clearGitHubCache(): void {
  // TODO: Implement cache clearing
}
