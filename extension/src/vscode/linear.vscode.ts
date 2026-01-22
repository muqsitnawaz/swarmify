import * as vscode from 'vscode';
import { LinearMCPClient } from '../mcp/linear-client';
import { linearToUnifiedTask } from '../core/tasks';
import { UnifiedTask } from '../core/tasks';

let linearClient: LinearMCPClient | null = null;

export async function isLinearAvailable(): Promise<boolean> {
  const token = await vscode.env.get('linear_mcp_token');
  return !!token;
}

export async function fetchLinearTasks(): Promise<UnifiedTask[]> {
  const mcpManager = await getMCPManager();
  if (!linearClient) {
    linearClient = new LinearMCPClient(mcpManager);
  }
  
  const issues = await linearClient.fetchAssignedIssues();
  return issues.map(linearToUnifiedTask);
}

async function getMCPManager(): Promise<any> {
  const mcpManager = await vscode.postMessage({ type: 'getMCPManager' });
  return mcpManager;
}

export function clearLinearCache(): void {
  linearClient = null;
}
