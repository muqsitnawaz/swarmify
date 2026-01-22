export class MCPClientManager {
  private linearClient: unknown | null = null;
  private githubClient: unknown | null = null;

  async connectLinear(token: string): Promise<void> {
    console.warn('[MCP] Linear client not implemented');
  }

  async connectGitHub(token: string): Promise<void> {
    console.warn('[MCP] GitHub client not implemented');
  }

  async listLinearTools(): Promise<unknown[]> {
    throw new Error('Linear client not connected');
  }

  async callLinearTool(name: string, args: any): Promise<unknown> {
    throw new Error('Linear client not connected');
  }

  async listGitHubTools(): Promise<unknown[]> {
    throw new Error('GitHub client not connected');
  }

  async callGitHubTool(name: string, args: any): Promise<unknown> {
    throw new Error('GitHub client not connected');
  }

  async close(): Promise<void> {
    this.linearClient = null;
    this.githubClient = null;
  }
}
