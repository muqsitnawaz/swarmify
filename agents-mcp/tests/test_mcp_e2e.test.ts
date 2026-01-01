/**
 * End-to-end tests for the MCP server.
 *
 * These tests spawn the REAL server process and communicate via MCP protocol.
 * They would have caught the bug where runServer() was never called.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';

const SERVER_PATH = path.join(__dirname, '../dist/server.js');

interface MCPMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Spawns the MCP server and provides helpers for sending/receiving messages.
 */
class MCPTestClient {
  private process: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests = new Map<number, { resolve: (msg: MCPMessage) => void; reject: (err: Error) => void }>();
  private reader: readline.Interface | null = null;
  private startupPromise: Promise<void> | null = null;

  async start(): Promise<void> {
    // Use node directly (not bun run) because bun handles stdin differently
    this.process = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to get stdio streams');
    }

    this.reader = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    this.reader.on('line', (line) => {
      try {
        const msg: MCPMessage = JSON.parse(line);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const { resolve } = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          resolve(msg);
        }
      } catch {
        // Ignore non-JSON lines (like startup messages to stderr)
      }
    });

    // Wait briefly for process to start
    await new Promise(resolve => setTimeout(resolve, 500));

    if (this.process.exitCode !== null) {
      throw new Error(`Server process exited immediately with code ${this.process.exitCode}`);
    }
  }

  async send(method: string, params?: unknown): Promise<MCPMessage> {
    if (!this.process?.stdin) {
      throw new Error('Server not started');
    }

    const id = ++this.messageId;
    const message: MCPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after 10s`));
      }, 10000);

      this.pendingRequests.set(id, {
        resolve: (msg) => {
          clearTimeout(timeout);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.process!.stdin!.write(JSON.stringify(message) + '\n');
    });
  }

  async stop(): Promise<void> {
    if (this.reader) {
      this.reader.close();
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        if (this.process!.exitCode !== null) {
          resolve();
        } else {
          this.process!.on('exit', () => resolve());
        }
      });
    }
    this.pendingRequests.clear();
  }
}

describe('MCP Server E2E Tests', () => {
  let client: MCPTestClient;

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.start();
  });

  afterAll(async () => {
    await client.stop();
  });

  test('server starts and accepts connections', async () => {
    // If we got here without error, the server started
    // This would have caught the runServer() not being called bug
    expect(true).toBe(true);
  });

  test('responds to initialize request', async () => {
    const response = await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0',
      },
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as { serverInfo: { name: string; version: string }; capabilities: unknown };
    expect(result.serverInfo).toBeDefined();
    expect(result.serverInfo.name).toBe('agent-swarm');
  });

  test('responds to tools/list request with spawn, status, stop tools', async () => {
    const response = await client.send('tools/list', {});

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
    expect(result.tools).toBeInstanceOf(Array);
    expect(result.tools.length).toBe(3);

    const toolNames = result.tools.map(t => t.name).sort();
    expect(toolNames).toEqual(['spawn', 'status', 'stop']);

    // Verify spawn tool has required parameters
    const spawnTool = result.tools.find(t => t.name === 'spawn');
    expect(spawnTool).toBeDefined();
    expect(spawnTool!.inputSchema).toBeDefined();

    const spawnSchema = spawnTool!.inputSchema as { required: string[] };
    expect(spawnSchema.required).toContain('task_name');
    expect(spawnSchema.required).toContain('agent_type');
    expect(spawnSchema.required).toContain('prompt');
  });

  test('status tool returns empty result for nonexistent task', async () => {
    const response = await client.send('tools/call', {
      name: 'status',
      arguments: {
        task_name: 'nonexistent-task-' + Date.now(),
      },
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as { content: Array<{ type: string; text: string }> };
    expect(result.content).toBeInstanceOf(Array);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');

    const statusResult = JSON.parse(result.content[0].text);
    expect(statusResult.agents).toBeInstanceOf(Array);
    expect(statusResult.agents.length).toBe(0);
  });

  test('stop tool handles nonexistent task gracefully', async () => {
    const response = await client.send('tools/call', {
      name: 'stop',
      arguments: {
        task_name: 'nonexistent-task-' + Date.now(),
      },
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as { content: Array<{ type: string; text: string }> };
    const stopResult = JSON.parse(result.content[0].text);
    expect(stopResult.stopped).toBeInstanceOf(Array);
    expect(stopResult.stopped.length).toBe(0);
  });

  test('spawn tool validates required parameters', async () => {
    // Missing required parameters should return an error in the response
    const response = await client.send('tools/call', {
      name: 'spawn',
      arguments: {
        task_name: 'test-task',
        // Missing agent_type and prompt
      },
    });

    // The MCP server should handle this gracefully
    expect(response.result).toBeDefined();

    const result = response.result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    // Should contain an error about missing parameters or invalid agent type
    expect(parsed.error).toBeDefined();
  });

  test('spawn tool validates agent_type', async () => {
    const response = await client.send('tools/call', {
      name: 'spawn',
      arguments: {
        task_name: 'test-task',
        agent_type: 'invalid-agent-type',
        prompt: 'Test prompt',
      },
    });

    expect(response.result).toBeDefined();

    const result = response.result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    // Should reject invalid agent type
    expect(parsed.error).toBeDefined();
    expect(parsed.error.toLowerCase()).toContain('unknown');
  });

  test('spawn tool validates mode parameter', async () => {
    const response = await client.send('tools/call', {
      name: 'spawn',
      arguments: {
        task_name: 'test-task',
        agent_type: 'codex',
        prompt: 'Test prompt',
        mode: 'yolo', // Invalid - should be 'plan' or 'edit'
      },
    });

    expect(response.result).toBeDefined();

    const result = response.result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    // Should reject invalid mode
    expect(parsed.error).toBeDefined();
    expect(parsed.error.toLowerCase()).toContain('mode');
  });

  test('unknown tool returns error', async () => {
    const response = await client.send('tools/call', {
      name: 'unknown-tool',
      arguments: {},
    });

    expect(response.result).toBeDefined();

    const result = response.result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.toLowerCase()).toContain('unknown');
  });
});

describe('MCP Server Startup Tests', () => {
  test('server process starts without crashing', async () => {
    // Use node directly (not bun run) because bun handles stdin differently
    const serverProcess = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    serverProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Wait for startup
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Server should still be running
    expect(serverProcess.exitCode).toBeNull();

    // Should have logged startup message to stderr
    expect(stderr).toContain('agent-swarm');

    serverProcess.kill('SIGTERM');
  });

  test('server logs startup message', async () => {
    // Use node directly (not bun run) because bun handles stdin differently
    const serverProcess = spawn('node', [SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    serverProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Should log server version on startup
    expect(stderr).toMatch(/agent-swarm.*v\d+\.\d+\.\d+/i);

    serverProcess.kill('SIGTERM');
  });
});
