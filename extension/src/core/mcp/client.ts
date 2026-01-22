import { Client } from '@modelcontextprotocol/sdk';
import { HttpServerTransport } from '@modelcontextprotocol/sdk/client/http.js';
import { getToken } from './storage';

export class MCPClientManager {
  private linearClient: Client | null = null;
  private githubClient: Client | null = null;

  async connectLinear(): Promise<void> {
    const token = await getToken('linear');
    if (!token) {
      throw new Error('Linear token not found');
    }

    this.linearClient = new Client({
      name: 'swarmify-linear',
      version: '1.0.0'
    });

    const transport = new HttpServerTransport({
      url: 'https://mcp.linear.app/mcp',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    await this.linearClient.connect(transport);
    await this.linearClient.initialize();
  }

  async connectGitHub(): Promise<void> {
    const token = await getToken('github');
    if (!token) {
      throw new Error('GitHub token not found');
    }

    this.githubClient = new Client({
      name: 'swarmify-github',
      version: '1.0.0'
    });

    const transport = new HttpServerTransport({
      url: 'https://api.githubcopilot.com/mcp/',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    await this.githubClient.connect(transport);
    await this.githubClient.initialize();
  }

  async listLinearTools(): Promise<Tool[]> {
    if (!this.linearClient) throw new Error('Linear client not connected');
    const result = await this.linearClient.listTools();
    return result.tools;
  }

  async callLinearTool(name: string, args: any): Promise<unknown> {
    if (!this.linearClient) throw new Error('Linear client not connected');
    const result = await this.linearClient.callTool({ name, arguments: args });
    return result.content;
  }

  async listGitHubTools(): Promise<Tool[]> {
    if (!this.githubClient) throw new Error('GitHub client not connected');
    const result = await this.githubClient.listTools();
    return result.tools;
  }

  async callGitHubTool(name: string, args: any): Promise<unknown> {
    if (!this.githubClient) throw new Error('GitHub client not connected');
    const result = await this.githubClient.callTool({ name, arguments: args });
    return result.content;
  }

  async close(): Promise<void> {
    await this.linearClient?.close();
    await this.githubClient?.close();
    this.linearClient = null;
    this.githubClient = null;
  }
}
