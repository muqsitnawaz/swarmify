import { describe, test, expect } from 'bun:test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { AgentManager, checkCliAvailable, AgentStatus } from '../src/agents.js';
import { handleSpawn, handleStatus, handleStop, AgentStatusResult } from '../src/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function pollUntilComplete(
  manager: AgentManager,
  taskName: string,
  agentId: string,
  maxIterations: number,
  pollIntervalMs: number
): Promise<AgentStatusResult> {
  for (let i = 0; i < maxIterations; i++) {
    const result = await handleStatus(manager, taskName, agentId);
    if ('error' in result) {
      throw new Error(result.error);
    }
    
    const statusResult = result as AgentStatusResult;
    if (statusResult.status !== AgentStatus.RUNNING) {
      return statusResult;
    }
    
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  const finalResult = await handleStatus(manager, taskName, agentId);
  if ('error' in finalResult) {
    throw new Error(finalResult.error);
  }
  return finalResult as AgentStatusResult;
}

describe('Claude Live E2E', () => {
  test('should spawn claude and parse tool calls correctly', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-test-'));
    const manager = new AgentManager(50, 10, tempDir);
    
    const [available, pathOrError] = checkCliAvailable('claude');
    if (!available) {
      console.warn(`Skipping test: ${pathOrError}`);
      rmSync(tempDir, { recursive: true, force: true });
      return;
    }
    
    const testdataDir = join(__dirname, 'testdata');
    const testFile = join(testdataDir, `claude-live-test-${Date.now()}.txt`);
    const prompt = `Create a file at ${testFile} with the content 'hello from live test' using echo command`;
    
    console.log('Running claude with prompt:', prompt);
    
    const spawnResult = await handleSpawn(manager, 'test-claude', 'claude', prompt, null, null, null);
    console.log('Spawned agent:', spawnResult.agent_id);
    
    const statusResult = await pollUntilComplete(manager, 'test-claude', spawnResult.agent_id, 90, 2000);
    
    console.log('Final status:', statusResult.status);
    console.log('Tool count:', statusResult.tool_count);
    console.log('Bash commands:', statusResult.bash_commands.length);
    console.log('Files modified:', statusResult.files_modified);
    
    expect(statusResult.status).not.toBe(AgentStatus.RUNNING);
    expect(statusResult.tool_count).toBeGreaterThan(0);
    expect(statusResult.bash_commands.length).toBeGreaterThan(0);
    
    await handleStop(manager, 'test-claude', spawnResult.agent_id);
    
    try {
      unlinkSync(testFile);
    } catch {
    }
    
    rmSync(tempDir, { recursive: true, force: true });
  }, 120000);

  test('should handle comprehensive file operations', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'claude-test-'));
    const manager = new AgentManager(50, 10, tempDir);
    
    const [available, pathOrError] = checkCliAvailable('claude');
    if (!available) {
      console.warn(`Skipping test: ${pathOrError}`);
      rmSync(tempDir, { recursive: true, force: true });
      return;
    }
    
    const testdataDir = join(__dirname, 'testdata');
    const testSubDir = join(testdataDir, `claude-comprehensive-test-${Date.now()}`);
    const testDataPath = testSubDir;
    
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
      
      const spawnResult = await handleSpawn(manager, 'test-claude', 'claude', prompt, testDataPath, null, null);
      console.log('Spawned agent:', spawnResult.agent_id);
      
      const statusResult = await pollUntilComplete(manager, 'test-claude', spawnResult.agent_id, 180, 2000);
      
      console.log('Final status:', statusResult.status);
      console.log('Tool count:', statusResult.tool_count);
      console.log('Files created:', statusResult.files_created);
      console.log('Files modified:', statusResult.files_modified);
      console.log('Files read:', statusResult.files_read);
      console.log('Files deleted:', statusResult.files_deleted);
      
      expect(statusResult.status).not.toBe(AgentStatus.RUNNING);
      expect(statusResult.tool_count).toBeGreaterThan(0);
      expect(statusResult.files_read.length).toBeGreaterThanOrEqual(1);
      expect(statusResult.files_modified.length + statusResult.files_created.length).toBeGreaterThanOrEqual(1);
      
      await handleStop(manager, 'test-claude', spawnResult.agent_id);
      
    } finally {
      try {
        const { rmSync } = await import('fs');
        rmSync(testSubDir, { recursive: true, force: true });
      } catch {
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 180000);
});
