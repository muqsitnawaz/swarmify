import { MCPClientManager } from './client';
import { githubToUnifiedTask } from '../core/tasks';
import { UnifiedTask } from '../core/tasks';

interface GitHubIssue {
  id: string;
  number: number;
  title: string;
  body?: string;
  state: string;
  html_url: string;
  labels?: { name: string }[];
  assignee?: { login: string };
}

export class GitHubMCPClient {
  private manager: MCPClientManager;

  constructor(manager: MCPClientManager) {
    this.manager = manager;
  }

  async fetchMyIssues(): Promise<GitHubIssue[]> {
    try {
      const result = await this.manager.callGitHubTool('list_issues', {
        state: 'open',
        assignee: '@me'
      });

      const issues = result?.issues || result?.items || [];
      return this.parseGitHubIssues(issues);
    } catch (err) {
      console.error('[GITHUB MCP] Error fetching issues:', err);
      return [];
    }
  }

  private parseGitHubIssues(issues: any[]): GitHubIssue[] {
    return issues.map((issue: any) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      url: issue.html_url,
      labels: issue.labels?.map((l: any) => l.name) || [],
      assignee: issue.assignee?.login
    }));
  }
}
