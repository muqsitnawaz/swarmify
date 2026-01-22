import * as vscode from 'vscode';
import { GitHubMCPClient } from '../mcp/github-client';
import { githubToUnifiedTask } from '../core/tasks';
import { UnifiedTask } from '../core/tasks';

let githubClient: GitHubMCPClient | null = null;

export async function isGitHubAvailable(): Promise<boolean> {
  const token = await vscode.env.get('github_mcp_token');
  return !!token;
}

export async function fetchGitHubTasks(): Promise<UnifiedTask[]> {
  const mcpManager = await getMCPManager();
  if (!githubClient) {
    githubClient = new GitHubMCPClient(mcpManager);
  }
  
  const issues = await githubClient.fetchMyIssues();
  return issues.map(githubToUnifiedTask);
}

async function getMCPManager(): Promise<any> {
  const mcpManager = await vscode.postMessage({ type: 'getMCPManager' });
  return mcpManager;
}

export function clearGitHubCache(): void {
  githubClient = null;
}
