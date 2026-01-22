import * as vscode from 'vscode';
import { UnifiedTask } from '../core/tasks';

export async function isLinearAvailable(context: vscode.ExtensionContext): Promise<boolean> {
  const token = context.globalState.get<string>('linear_mcp_token');
  return !!token;
}

export async function fetchLinearTasks(context: vscode.ExtensionContext): Promise<UnifiedTask[]> {
  // TODO: Implement Linear MCP client integration
  return [];
}

export function clearLinearCache(): void {
  // TODO: Implement cache clearing
}
