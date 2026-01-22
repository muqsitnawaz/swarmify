import * as vscode from 'vscode';
import { LinearMCPClient } from '../mcp/linear-client';
import { linearToUnifiedTask } from '../core/tasks';
import { UnifiedTask } from '../core/tasks';

let linearClient: LinearMCPClient | null = null;

export async function isLinearAvailable(context: vscode.ExtensionContext): Promise<boolean> {
  const token = context.globalState.get<string>('linear_mcp_token');
  return !!token;
}

export async function fetchLinearTasks(context: vscode.ExtensionContext): Promise<UnifiedTask[]> {
  const mcpManager = await getMCPManager(context);
  if (!linearClient) {
    linearClient = new LinearMCPClient(mcpManager);
  }

  const issues = await linearClient.fetchAssignedIssues();
  return issues.map(linearToUnifiedTask);
}

async function getMCPManager(context: vscode.ExtensionContext): Promise<any> {
  // TODO: Implement proper MCP manager retrieval
  return null;
}

export function clearLinearCache(): void {
  linearClient = null;
}
