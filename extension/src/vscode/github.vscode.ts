import * as vscode from 'vscode';
import { GitHubMCPClient } from '../../../src/mcp/github-client';
import { githubToUnifiedTask } from '../core/tasks';
import { UnifiedTask } from '../core/tasks';

let githubClient: GitHubMCPClient | null = null;

export async function isGitHubAvailable(context: vscode.ExtensionContext): Promise<boolean> {
  const token = context.globalState.get<string>('github_mcp_token');
  return !!token;
}

export async function fetchGitHubTasks(context: vscode.ExtensionContext): Promise<UnifiedTask[]> {
  const mcpManager = await getMCPManager(context);
  if (!githubClient) {
    githubClient = new GitHubMCPClient(mcpManager);
  }

  const issues = await githubClient.fetchMyIssues();
  return issues.map(githubToUnifiedTask);
}

async function getMCPManager(context: vscode.ExtensionContext): Promise<any> {
  // TODO: Implement proper MCP manager retrieval
  return null;
}

export function clearGitHubCache(): void {
  githubClient = null;
}
