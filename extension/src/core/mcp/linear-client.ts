import { MCPClientManager } from './client';
import { linearToUnifiedTask } from '../tasks';
import { UnifiedTask } from '../tasks';

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: { name: string; type: string };
  stateType: string;
  priority: number;
  url: string;
  labels?: { nodes: { name: string }[] };
  assignee?: { name: string };
}

export class LinearMCPClient {
  private manager: MCPClientManager;

  constructor(manager: MCPClientManager) {
    this.manager = manager;
  }

  async fetchAssignedIssues(): Promise<LinearIssue[]> {
    try {
      const result = await this.manager.callLinearTool('list_issues', {
        filter: {
          assignee: { isMe: { eq: true } },
          state: {
            type: {
              nin: ['completed', 'canceled']
            }
          }
        }
      }) as any;

      const issues = result?.issues || result?.nodes || [];
      return this.parseLinearIssues(issues);
    } catch (err) {
      console.error('[LINEAR MCP] Error fetching issues:', err);
      return [];
    }
  }

  private parseLinearIssues(response: any): LinearIssue[] {
    const issues = response?.issues || response?.nodes || [];
    return issues.map((issue: any) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state.name,
      stateType: issue.state.type,
      priority: issue.priority,
      url: issue.url,
      labels: issue.labels?.nodes?.map((n: any) => n.name) || [],
      assignee: issue.assignee?.name
    }));
  }
}
