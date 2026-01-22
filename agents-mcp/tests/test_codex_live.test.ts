import { describe, test, expect } from 'bun:test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { AgentManager, checkCliAvailable, AgentStatus } from '../src/agents.js';
import { handleSpawn, handleStatus, handleStop, AgentStatusDetail, SpawnResult } from '../src/api.js';
import { AgentType } from '../src/parsers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function pollUntilComplete(
  manager: AgentManager,
  taskName: string,
  agentId: string,
  maxIterations: number,
  pollIntervalMs: number
): Promise<AgentStatusDetail> {
  for (let i = 0; i < maxIterations; i++) {
    // Use 'all' filter to see completed agents, not just running
    const result = await handleStatus(manager, taskName, 'all');
    const agent = result.agents.find(a => a.agent_id === agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found in task ${taskName}`);
    }

    if (agent.status !== AgentStatus.RUNNING) {
      return agent;
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  const finalResult = await handleStatus(manager, taskName, 'all');
  const agent = finalResult.agents.find(a => a.agent_id === agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} not found in task ${taskName}`);
  }
  return agent;
}

describe('Codex Live E2E', () => {
  const [codexAvailable, codexPathOrError] = checkCliAvailable('codex');
  
  (codexAvailable ? test : test.skip)('should spawn codex and parse tool calls correctly', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codex-test-'));
    const manager = new AgentManager(50, 10, tempDir);
    
    const testFile = `/tmp/codex-live-test-${Date.now()}.txt`;
    const prompt = `Create a file at ${testFile} with the content 'hello from live test' using echo command`;

    console.log('Running codex with prompt:', prompt);

    const spawnResult = await handleSpawn(manager, 'test-codex', 'codex', prompt, null, 'edit', null);
    console.log('Spawned agent:', spawnResult.agent_id);
    
    const statusResult = await pollUntilComplete(manager, 'test-codex', spawnResult.agent_id, 90, 2000);
    
    console.log('Final status:', statusResult.status);
    console.log('Tool count:', statusResult.tool_count);
    console.log('Bash commands:', statusResult.bash_commands);
    console.log('Last messages:', statusResult.last_messages);
    console.log('Files modified:', statusResult.files_modified);
    
    expect(statusResult.status).not.toBe(AgentStatus.RUNNING);
    expect(statusResult.tool_count).toBeGreaterThan(0);
    expect(statusResult.bash_commands).toBeDefined();
    expect(Array.isArray(statusResult.bash_commands)).toBe(true);
    expect(statusResult.bash_commands.length).toBeGreaterThan(0);
    expect(statusResult.bash_commands.every(cmd => typeof cmd === 'string')).toBe(true);
    expect(statusResult.bash_commands.some(cmd => cmd.includes('echo') || cmd.includes(testFile))).toBe(true);
    expect(statusResult.last_messages).toBeDefined();
    expect(Array.isArray(statusResult.last_messages)).toBe(true);
    expect(statusResult.last_messages.length).toBeGreaterThan(0);
    expect(statusResult.last_messages.length).toBeLessThanOrEqual(3);
    expect(statusResult.last_messages.every(msg => typeof msg === 'string')).toBe(true);
    
    await handleStop(manager, 'test-codex', spawnResult.agent_id);
    
    try {
      unlinkSync(testFile);
    } catch {
    }
    
    rmSync(tempDir, { recursive: true, force: true });
  }, 120000);

  (codexAvailable ? test : test.skip)('should spawn codex-agent and parse tool calls correctly', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codex-test-'));
    const manager = new AgentManager(50, 10, tempDir);
    
    const testDir = `/tmp/codex-comprehensive-test-${Date.now()}`;
    const testDataPath = `${testDir}/tests/testdata`;
    
    const { mkdirSync, writeFileSync, readFileSync } = await import('fs');
    
    try {
      mkdirSync(testDataPath, { recursive: true });
      mkdirSync(join(testDataPath, 'dir1'), { recursive: true });
      mkdirSync(join(testDataPath, 'dir2'), { recursive: true });
      mkdirSync(join(testDataPath, 'dir3'), { recursive: true });
      
      writeFileSync(join(testDataPath, 'dir1', 'file1.py'), 'def hello():\n    print("Hello")\n');
      writeFileSync(join(testDataPath, 'dir1', 'file2.ts'), 'export const x = 1;\n');
      writeFileSync(join(testDataPath, 'dir2', 'file3.md'), '# File 3\n');
      writeFileSync(join(testDataPath, 'dir2', 'file4.json'), '{"name": "file4"}\n');
      writeFileSync(join(testDataPath, 'dir3', 'file5.py'), 'def process():\n    pass\n');
      writeFileSync(join(testDataPath, 'dir3', 'file6.ts'), 'export const y = 2;\n');
      writeFileSync(join(testDataPath, 'dir3', 'file7.md'), '# File 7\n');
      writeFileSync(join(testDataPath, 'root1.json'), '{"root": true}\n');
      writeFileSync(join(testDataPath, 'root2.md'), '# Root\n');
      
      const fileToDelete = join(testDataPath, 'dir1', 'file1.py');
      const deletedFileContent = readFileSync(fileToDelete, 'utf-8');
      
      const prompt = `Working in ${testDataPath}, do the following:
1. List directory contents using ls command
2. Read the file dir1/file1.py to get its content
3. Modify dir1/file2.ts to add a new export
4. Delete dir1/file1.py using rm command
5. After deletion, tell me how many files are left in dir1
6. Recreate dir1/file1.py with the same content it had before deletion
7. Create a new directory called dir4 using mkdir command
8. Create a new file dir4/newfile.txt with content "new file"`;

      console.log('Running comprehensive test with prompt:', prompt);
      
      const spawnResult = await handleSpawn(manager, 'test-codex', 'codex', prompt, testDataPath, 'edit', null);
      console.log('Spawned agent:', spawnResult.agent_id);
      
      const statusResult = await pollUntilComplete(manager, 'test-codex', spawnResult.agent_id, 180, 2000);
      
      console.log('Final status:', statusResult.status);
      console.log('Tool count:', statusResult.tool_count);
      console.log('Files created:', statusResult.files_created);
      console.log('Files modified:', statusResult.files_modified);
      console.log('Files read:', statusResult.files_read);
      console.log('Files deleted:', statusResult.files_deleted);
      console.log('Bash commands:', statusResult.bash_commands);
      console.log('Last messages:', statusResult.last_messages);
      
      expect(statusResult.status).not.toBe(AgentStatus.RUNNING);
      expect(statusResult.tool_count).toBeGreaterThan(0);
      expect(statusResult.files_read.length).toBeGreaterThanOrEqual(1);
      expect(statusResult.bash_commands).toBeDefined();
      expect(Array.isArray(statusResult.bash_commands)).toBe(true);
      expect(statusResult.bash_commands.length).toBeGreaterThan(0);
      expect(statusResult.bash_commands.every(cmd => typeof cmd === 'string')).toBe(true);
      expect(statusResult.bash_commands.some(cmd => cmd.includes('ls') || cmd.includes('rm') || cmd.includes('mkdir'))).toBe(true);
      expect(statusResult.last_messages).toBeDefined();
      expect(Array.isArray(statusResult.last_messages)).toBe(true);
      expect(statusResult.last_messages.length).toBeGreaterThan(0);
      expect(statusResult.last_messages.length).toBeLessThanOrEqual(3);
      expect(statusResult.last_messages.every(msg => typeof msg === 'string')).toBe(true);
      
      await handleStop(manager, 'test-codex', spawnResult.agent_id);
      
    } finally {
      try {
        const { rmSync } = await import('fs');
        rmSync(testDir, { recursive: true, force: true });
      } catch {
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 180000);

  (codexAvailable ? test : test.skip)(`should work through MCP commands${!codexAvailable ? ` (skipped: ${codexPathOrError})` : ''}`, async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codex-mcp-test-'));
    const manager = new AgentManager(50, 10, tempDir);
    
    const testFile = `/tmp/codex-mcp-test-${Date.now()}.txt`;
    const prompt = `Create a file at ${testFile} with the content 'hello from MCP test' using echo command`;
    
    async function callMCPTool(name: string, args: any): Promise<any> {
      let result: any;
      
      if (name === 'Spawn') {
        if (!args) {
          throw new Error('Missing arguments for spawn');
        }
        result = await handleSpawn(
          manager,
          args.task_name as string,
          args.agent_type as AgentType,
          args.prompt as string,
          (args.cwd as string) || null,
          (args.mode as string) || null,
          (args.model as string) || null
        );
      } else if (name === 'Status') {
        if (!args) {
          throw new Error('Missing arguments for status');
        }
        result = await handleStatus(
          manager,
          args.task_name as string,
          args.agent_id as string | undefined
        );
      } else if (name === 'Stop') {
        if (!args) {
          throw new Error('Missing arguments for stop');
        }
        result = await handleStop(
          manager,
          args.task_name as string,
          args.agent_id as string | undefined
        );
      } else {
        result = { error: `Unknown tool: ${name}` };
      }
      
      return JSON.parse(JSON.stringify(result));
    }
    
    console.log('Testing MCP Spawn command');
    const spawnResult: SpawnResult = await callMCPTool('Spawn', {
      task_name: 'test-codex-mcp',
      agent_type: 'codex',
      prompt: prompt,
      mode: 'edit',
    });
    
    expect(spawnResult.agent_id).toBeDefined();
    expect(spawnResult.task_name).toBe('test-codex-mcp');
    expect(spawnResult.agent_type).toBe('codex');
    console.log('Spawned agent via MCP:', spawnResult.agent_id);
    
    console.log('Testing MCP Status command');
    await pollUntilComplete(manager, 'test-codex-mcp', spawnResult.agent_id, 90, 2000);

    const mcpTaskResult = await callMCPTool('Status', {
      task_name: 'test-codex-mcp',
    });
    const mcpStatusResult = mcpTaskResult.agents.find((a: any) => a.agent_id === spawnResult.agent_id);
    expect(mcpStatusResult).toBeDefined();

    console.log('MCP status result:', mcpStatusResult.status);
    console.log('MCP bash commands:', mcpStatusResult.bash_commands);
    console.log('MCP last messages:', mcpStatusResult.last_messages);

    expect(mcpStatusResult.status).not.toBe(AgentStatus.RUNNING);
    expect(mcpStatusResult.agent_id).toBe(spawnResult.agent_id);
    expect(mcpStatusResult.bash_commands).toBeDefined();
    expect(Array.isArray(mcpStatusResult.bash_commands)).toBe(true);
    expect(mcpStatusResult.bash_commands.length).toBeGreaterThan(0);
    expect(mcpStatusResult.bash_commands.every((cmd: string) => typeof cmd === 'string')).toBe(true);
    expect(mcpStatusResult.bash_commands.some((cmd: string) => cmd.includes('echo') || cmd.includes(testFile))).toBe(true);
    expect(mcpStatusResult.last_messages).toBeDefined();
    expect(Array.isArray(mcpStatusResult.last_messages)).toBe(true);
    expect(mcpStatusResult.last_messages.length).toBeGreaterThan(0);
    expect(mcpStatusResult.last_messages.length).toBeLessThanOrEqual(3);
    expect(mcpStatusResult.last_messages.every((msg: string) => typeof msg === 'string')).toBe(true);
    
    console.log('Testing MCP Stop command');
    const stopResult = await callMCPTool('Stop', {
      task_name: 'test-codex-mcp',
      agent_id: spawnResult.agent_id,
    });
    
    expect(stopResult.stopped).toBeDefined();
    console.log('Stopped via MCP:', stopResult.stopped);
    
    try {
      unlinkSync(testFile);
    } catch {
    }
    
    rmSync(tempDir, { recursive: true, force: true });
  }, 120000);
});
