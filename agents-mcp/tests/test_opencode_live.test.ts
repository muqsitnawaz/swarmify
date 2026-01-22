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

describe('OpenCode Live E2E', () => {
  const [opencodeAvailable, opencodePathOrError] = checkCliAvailable('opencode');

  (opencodeAvailable ? test : test.skip)('should spawn opencode in edit mode and parse tool calls correctly', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'opencode-test-'));
    const manager = new AgentManager(50, 10, tempDir);

    const prompt = `echo 'hello from opencode test'`;

    console.log('Running opencode with prompt:', prompt);

    const spawnResult = await handleSpawn(manager, 'test-opencode', 'opencode', prompt, null, 'edit', null);
    console.log('Spawned agent:', spawnResult.agent_id);

    const statusResult = await pollUntilComplete(manager, 'test-opencode', spawnResult.agent_id, 90, 2000);

    console.log('Final status:', statusResult.status);
    console.log('Tool count:', statusResult.tool_count);
    console.log('Bash commands:', statusResult.bash_commands);
    console.log('Last messages:', statusResult.last_messages);

    expect(statusResult.status).not.toBe(AgentStatus.RUNNING);
    expect(statusResult.tool_count).toBeGreaterThan(0);
    expect(statusResult.bash_commands).toBeDefined();
    expect(Array.isArray(statusResult.bash_commands)).toBe(true);
    expect(statusResult.bash_commands.length).toBeGreaterThan(0);
    expect(statusResult.bash_commands.every(cmd => typeof cmd === 'string')).toBe(true);
    expect(statusResult.bash_commands.some(cmd => cmd.includes('echo') && cmd.includes('hello'))).toBe(true);
    expect(statusResult.last_messages).toBeDefined();
    expect(Array.isArray(statusResult.last_messages)).toBe(true);
    // OpenCode may not produce text messages for simple commands
    expect(statusResult.last_messages.length).toBeLessThanOrEqual(5);
    expect(statusResult.last_messages.every(msg => typeof msg === 'string')).toBe(true);

    await handleStop(manager, 'test-opencode', spawnResult.agent_id);

    rmSync(tempDir, { recursive: true, force: true });
  }, 120000);

  (opencodeAvailable ? test : test.skip)('should spawn opencode in plan mode', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'opencode-plan-test-'));
    const manager = new AgentManager(50, 10, tempDir);

    const prompt = `Describe what files are in the current directory`;

    const spawnResult = await handleSpawn(manager, 'test-opencode-plan', 'opencode', prompt, null, 'plan', null);
    const statusResult = await pollUntilComplete(manager, 'test-opencode-plan', spawnResult.agent_id, 60, 2000);

    expect(statusResult.status).not.toBe(AgentStatus.RUNNING);

    await handleStop(manager, 'test-opencode-plan', spawnResult.agent_id);

    rmSync(tempDir, { recursive: true, force: true });
  }, 120000);

  (opencodeAvailable ? test : test.skip)('should spawn opencode with fast effort level', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'opencode-fast-test-'));
    const manager = new AgentManager(50, 10, tempDir);

    const prompt = `echo 'hello from fast mode'`;

    const spawnResult = await handleSpawn(manager, 'test-opencode-fast', 'opencode', prompt, null, 'edit', 'fast');
    const statusResult = await pollUntilComplete(manager, 'test-opencode-fast', spawnResult.agent_id, 60, 2000);

    expect(statusResult.status).not.toBe(AgentStatus.RUNNING);

    await handleStop(manager, 'test-opencode-fast', spawnResult.agent_id);

    rmSync(tempDir, { recursive: true, force: true });
  }, 120000);
});
