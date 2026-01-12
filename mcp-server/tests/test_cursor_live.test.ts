import { describe, test, expect } from 'bun:test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { AgentManager, checkCliAvailable, AgentStatus } from '../src/agents.js';
import { handleSpawn, handleStatus, handleStop, AgentStatusDetail } from '../src/api.js';

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

describe('Cursor Live E2E', () => {
  const [cursorAvailable, cursorPathOrError] = checkCliAvailable('cursor');
  
  (cursorAvailable ? test : test.skip)('should spawn cursor-agent and parse tool calls correctly', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cursor-test-'));
    const manager = new AgentManager(50, 10, tempDir);
    
    const testFile = `/tmp/cursor-live-test-${Date.now()}.txt`;
    const prompt = `Create a file at ${testFile} with the content 'hello from live test' using echo command`;

    console.log('Running cursor-agent with prompt:', prompt);

    const spawnResult = await handleSpawn(manager, 'test-cursor', 'cursor', prompt, null, null, null);
    console.log('Spawned agent:', spawnResult.agent_id);
    
    const statusResult = await pollUntilComplete(manager, 'test-cursor', spawnResult.agent_id, 90, 2000);
    
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
    
    await handleStop(manager, 'test-cursor', spawnResult.agent_id);
    
    try {
      unlinkSync(testFile);
    } catch {
    }
    
    rmSync(tempDir, { recursive: true, force: true });
  }, 120000);

  (cursorAvailable ? test : test.skip)('should handle comprehensive file operations', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cursor-test-'));
    const manager = new AgentManager(50, 10, tempDir);
    
    const testDir = `/tmp/cursor-comprehensive-test-${Date.now()}`;
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
      
      const spawnResult = await handleSpawn(manager, 'test-cursor', 'cursor', prompt, testDataPath, null, null);
      console.log('Spawned agent:', spawnResult.agent_id);
      
      const statusResult = await pollUntilComplete(manager, 'test-cursor', spawnResult.agent_id, 180, 2000);
      
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
      expect(statusResult.files_modified.length + statusResult.files_created.length).toBeGreaterThanOrEqual(1);
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
      
      await handleStop(manager, 'test-cursor', spawnResult.agent_id);
      
    } finally {
      try {
        const { rmSync } = await import('fs');
        rmSync(testDir, { recursive: true, force: true });
      } catch {
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 180000);
});
