/**
 * Integration tests for the MCP server API.
 * These tests call the REAL handler functions with actual logging.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { AgentManager, AgentProcess, AgentStatus, checkCliAvailable } from '../src/agents.js';
import { handleSpawn, handleStatus, handleStop } from '../src/api.js';

describe('API Integration Tests', () => {
  let manager: AgentManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `api_tests_${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    manager = new AgentManager(50, 10, testDir);
    await manager['initialize']();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {}
  });

  describe('handleSpawn', () => {
    test('should fail gracefully when CLI not installed', async () => {
      // This tests the REAL spawn path - it will fail because codex isn't installed
      // But we verify the error handling works correctly
      console.log('\n--- TEST: spawn with missing CLI ---');

      try {
        const result = await handleSpawn(
          manager,
          'test-task',
          'codex',
          'Write hello world',
          null,
          null,
          null
        );
        // If we get here, codex IS installed - which is also valid
        console.log('Result:', JSON.stringify(result, null, 2));
        expect(result.task_name).toBe('test-task');
        expect(result.agent_id).toBeDefined();
        expect(result.agent_type).toBe('codex');
        console.log(`SUCCESS: Spawned agent ${result.agent_id}`);
      } catch (err: any) {
        // Expected when CLI not installed
        console.log('Expected error (CLI not installed):', err.message);
        expect(err.message).toMatch(/not found|not available|CLI tool/i);
      }
    });

    test('should check CLI availability before spawn', async () => {
      console.log('\n--- TEST: CLI availability check ---');

      const [codexAvailable, codexPath] = checkCliAvailable('codex');
      const [cursorAvailable, cursorPath] = checkCliAvailable('cursor');
      const [geminiAvailable, geminiPath] = checkCliAvailable('gemini');
      const [claudeAvailable, claudePath] = checkCliAvailable('claude');

      console.log(`codex: ${codexAvailable ? 'INSTALLED at ' + codexPath : 'NOT INSTALLED'}`);
      console.log(`cursor: ${cursorAvailable ? 'INSTALLED at ' + cursorPath : 'NOT INSTALLED'}`);
      console.log(`gemini: ${geminiAvailable ? 'INSTALLED at ' + geminiPath : 'NOT INSTALLED'}`);
      console.log(`claude: ${claudeAvailable ? 'INSTALLED at ' + claudePath : 'NOT INSTALLED'}`);

      // At least verify the function runs and returns booleans
      expect(typeof codexAvailable).toBe('boolean');
      expect(typeof cursorAvailable).toBe('boolean');
      expect(typeof geminiAvailable).toBe('boolean');
      expect(typeof claudeAvailable).toBe('boolean');
    });
  });

  describe('handleStatus', () => {
    test('should return empty status for nonexistent task', async () => {
      console.log('\n--- TEST: status for nonexistent task ---');

      const result = await handleStatus(manager, 'nonexistent-task');

      console.log('Result:', JSON.stringify(result, null, 2));

      expect('agents' in result).toBe(true);
      if ('agents' in result) {
        expect(result.agents.length).toBe(0);
        expect(result.summary.running).toBe(0);
      }
    });

    test('should return status for task with agents', async () => {
      console.log('\n--- TEST: status for task with agents ---');

      // Manually add agents to test status (since we can't spawn real ones)
      const agent1 = new AgentProcess('agent-1', 'my-task', 'codex', 'Work 1', null, false, null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('agent-2', 'my-task', 'cursor', 'Work 2', null, false, null, AgentStatus.COMPLETED);
      manager['agents'].set('agent-1', agent1);
      manager['agents'].set('agent-2', agent2);

      const result = await handleStatus(manager, 'my-task');

      console.log('Result:', JSON.stringify(result, null, 2));

      expect('agents' in result).toBe(true);
      if ('agents' in result) {
        expect(result.agents.length).toBe(2);
        expect(result.summary.running).toBe(1);
        expect(result.summary.completed).toBe(1);
      }
    });

    test('should return detailed status for specific agent', async () => {
      console.log('\n--- TEST: detailed status for specific agent ---');

      const agent = new AgentProcess('agent-123', 'detail-task', 'gemini', 'Complex work', null, false, null, AgentStatus.RUNNING);
      manager['agents'].set('agent-123', agent);

      const result = await handleStatus(manager, 'detail-task', 'agent-123');

      console.log('Result:', JSON.stringify(result, null, 2));

      expect('agent_id' in result).toBe(true);
      if ('agent_id' in result) {
        expect(result.agent_id).toBe('agent-123');
        expect(result.agent_type).toBe('gemini');
        expect(result.status).toBe('running');
      }
    });

    test('should return error for agent not in task', async () => {
      console.log('\n--- TEST: agent not in requested task ---');

      const agent = new AgentProcess('agent-456', 'task-a', 'codex', 'Work', null, false, null, AgentStatus.RUNNING);
      manager['agents'].set('agent-456', agent);

      const result = await handleStatus(manager, 'task-b', 'agent-456');

      console.log('Result:', JSON.stringify(result, null, 2));

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toContain('not in task');
      }
    });
  });

  describe('handleStop', () => {
    test('should stop all agents in task', async () => {
      console.log('\n--- TEST: stop all agents in task ---');

      const agent1 = new AgentProcess('stop-1', 'stop-task', 'codex', 'Work', null, false, null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('stop-2', 'stop-task', 'cursor', 'Work', null, false, null, AgentStatus.COMPLETED);
      manager['agents'].set('stop-1', agent1);
      manager['agents'].set('stop-2', agent2);

      const result = await handleStop(manager, 'stop-task');

      console.log('Result:', JSON.stringify(result, null, 2));

      expect('stopped' in result).toBe(true);
      if ('stopped' in result) {
        // stop-2 was already completed
        expect(result.already_stopped).toContain('stop-2');
      }
    });

    test('should stop specific agent', async () => {
      console.log('\n--- TEST: stop specific agent ---');

      const agent = new AgentProcess('single-stop', 'single-task', 'codex', 'Work', null, false, null, AgentStatus.COMPLETED);
      manager['agents'].set('single-stop', agent);

      const result = await handleStop(manager, 'single-task', 'single-stop');

      console.log('Result:', JSON.stringify(result, null, 2));

      expect('already_stopped' in result).toBe(true);
      if ('already_stopped' in result) {
        expect(result.already_stopped).toContain('single-stop');
      }
    });

    test('should return not_found for missing agent', async () => {
      console.log('\n--- TEST: stop missing agent ---');

      const result = await handleStop(manager, 'any-task', 'missing-agent');

      console.log('Result:', JSON.stringify(result, null, 2));

      expect('not_found' in result).toBe(true);
      if ('not_found' in result) {
        expect(result.not_found).toContain('missing-agent');
      }
    });
  });


  describe('Full Flow: spawn -> status -> read -> stop', () => {
    test('should handle complete lifecycle (mocked agents)', async () => {
      console.log('\n--- TEST: complete agent lifecycle ---');

      // Step 1: Add agents (simulating spawn since CLI may not be installed)
      console.log('\n[Step 1] Adding 3 agents to task "feature-x"...');
      const agent1 = new AgentProcess('flow-1', 'feature-x', 'codex', 'Build feature', null, false, null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('flow-2', 'feature-x', 'cursor', 'Fix bugs', null, false, null, AgentStatus.RUNNING);
      const agent3 = new AgentProcess('flow-3', 'feature-x', 'gemini', 'Refactor', null, false, null, AgentStatus.COMPLETED);
      manager['agents'].set('flow-1', agent1);
      manager['agents'].set('flow-2', agent2);
      manager['agents'].set('flow-3', agent3);
      console.log('Added: flow-1 (codex, running), flow-2 (cursor, running), flow-3 (gemini, completed)');

      // Step 2: Get task status
      console.log('\n[Step 2] Getting status for task "feature-x"...');
      const taskStatus = await handleStatus(manager, 'feature-x');
      console.log('Task status:', JSON.stringify(taskStatus, null, 2));

      expect('agents' in taskStatus).toBe(true);
      if ('agents' in taskStatus) {
        expect(taskStatus.agents.length).toBe(3);
        expect(taskStatus.summary.running).toBe(2);
        expect(taskStatus.summary.completed).toBe(1);
      }

      // Step 3: Get individual agent status
      console.log('\n[Step 3] Getting detailed status for agent "flow-1"...');
      const agentStatus = await handleStatus(manager, 'feature-x', 'flow-1');
      console.log('Agent status:', JSON.stringify(agentStatus, null, 2));

      expect('agent_id' in agentStatus).toBe(true);
      if ('agent_id' in agentStatus) {
        expect(agentStatus.agent_id).toBe('flow-1');
        expect(agentStatus.agent_type).toBe('codex');
      }

      // Step 4: Stop all agents in task
      console.log('\n[Step 5] Stopping all agents in task "feature-x"...');
      const stopResult = await handleStop(manager, 'feature-x');
      console.log('Stop result:', JSON.stringify(stopResult, null, 2));

      expect('stopped' in stopResult).toBe(true);
      if ('stopped' in stopResult) {
        // flow-3 was already completed
        expect(stopResult.already_stopped).toContain('flow-3');
      }

      // Step 5: Verify final status
      console.log('\n[Step 5] Verifying final status...');
      const finalStatus = await handleStatus(manager, 'feature-x');
      console.log('Final status:', JSON.stringify(finalStatus, null, 2));

      console.log('\n--- LIFECYCLE TEST COMPLETE ---');
    });
  });

  describe('Multi-Agent Status Polling (Live)', () => {
    test('should spawn claude, codex, and cursor agents with different tasks and poll status until done', async () => {
      console.log('\n--- TEST: multi-agent status polling (live) ---');
      
      const testdataDir = path.join(__dirname, 'testdata');
      const statusLogPath = path.join(testdataDir, 'multi-agent-status-polling.jsonl');
      const { writeFileSync, appendFileSync, mkdirSync } = await import('fs');
      
      const taskName = `multi-agent-live-${Date.now()}`;
      const timestamp = Date.now();
      
      const codexTaskDir = path.join(testdataDir, `codex-task-${timestamp}`);
      const cursorTaskDir = path.join(testdataDir, `cursor-task-${timestamp}`);
      const claudeTaskDir = path.join(testdataDir, `claude-task-${timestamp}`);
      
      mkdirSync(codexTaskDir, { recursive: true });
      mkdirSync(cursorTaskDir, { recursive: true });
      mkdirSync(claudeTaskDir, { recursive: true });
      
      writeFileSync(path.join(codexTaskDir, 'input.txt'), 'Hello from codex task\n');
      writeFileSync(path.join(cursorTaskDir, 'input.txt'), 'Hello from cursor task\n');
      writeFileSync(path.join(claudeTaskDir, 'input.txt'), 'Hello from claude task\n');
      
      const agentConfigs = [
        {
          type: 'codex' as const,
          taskDir: codexTaskDir,
          prompt: `Working in ${codexTaskDir}, do the following:
1. Read the file input.txt
2. Create a new file output.txt with the content reversed
3. Create a subdirectory called results
4. Copy output.txt to results/copy.txt
5. List all files in the directory`
        },
        {
          type: 'cursor' as const,
          taskDir: cursorTaskDir,
          prompt: `Working in ${cursorTaskDir}, do the following:
1. Read input.txt
2. Create a file summary.md with a markdown summary of the input
3. Create a file data.json with {"source": "input.txt", "processed": true}
4. Count how many files are in the directory`
        },
        {
          type: 'claude' as const,
          taskDir: claudeTaskDir,
          prompt: `Working in ${claudeTaskDir}, do the following:
1. Read input.txt
2. Create a file report.txt with the content from input.txt plus " - Processed by Claude"
3. Create a subdirectory called archive
4. Move input.txt to archive/input.txt
5. Verify the move was successful`
        }
      ];
      
      writeFileSync(statusLogPath, '', 'utf-8');
      console.log(`Status log file: ${statusLogPath}`);
      
      const agentIds: string[] = [];
      
      console.log('\n[Step 1] Spawning 3 agents (codex, cursor, claude)...');
      for (const config of agentConfigs) {
        const [available] = checkCliAvailable(config.type);
        if (!available) {
          console.log(`Skipping ${config.type} - not installed`);
          continue;
        }
        
        try {
          const result = await handleSpawn(
            manager,
            taskName,
            config.type,
            config.prompt,
            config.taskDir,
            null,
            null
          );
          agentIds.push(result.agent_id);
          console.log(`Spawned ${config.type} agent: ${result.agent_id} (working in ${config.taskDir})`);
        } catch (err: any) {
          console.log(`Failed to spawn ${config.type}: ${err.message}`);
        }
      }
      
      if (agentIds.length === 0) {
        console.log('No agents were spawned (CLIs not available). Skipping test.');
        return;
      }
      
      console.log(`\n[Step 2] Polling status until all ${agentIds.length} agents are done...`);
      
      const maxIterations = 180;
      const pollIntervalMs = 2000;
      let iteration = 0;
      let allDone = false;
      
      while (!allDone && iteration < maxIterations) {
        iteration++;
        console.log(`\n[Poll ${iteration}] Checking status...`);
        
        const statusResult = await handleStatus(manager, taskName);
        
        if ('error' in statusResult) {
          console.log(`Status error: ${statusResult.error}`);
          break;
        }
        
        if ('agents' in statusResult) {
          const statusEntry = {
            iteration,
            timestamp: new Date().toISOString(),
            task_name: statusResult.task_name,
            summary: statusResult.summary,
            agents: statusResult.agents
          };
          
          appendFileSync(statusLogPath, JSON.stringify(statusEntry) + '\n', 'utf-8');
          console.log(`Status: running=${statusResult.summary.running}, completed=${statusResult.summary.completed}, failed=${statusResult.summary.failed}, stopped=${statusResult.summary.stopped}`);
          
          for (const agent of statusResult.agents) {
            if (agent.status === 'running') {
              console.log(`  - ${agent.agent_id} (${agent.agent_type}): ${agent.status}, last_message: ${agent.last_message ? agent.last_message.substring(0, 50) + '...' : 'none'}`);
            }
          }
          
          allDone = statusResult.summary.running === 0;
          
          if (!allDone) {
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          }
        } else {
          console.log('Unexpected status result format');
          break;
        }
      }
      
      if (allDone) {
        console.log(`\n[Complete] All agents finished after ${iteration} polls`);
      } else {
        console.log(`\n[Timeout] Stopped polling after ${iteration} iterations`);
      }
      
      const finalStatus = await handleStatus(manager, taskName);
      if ('agents' in finalStatus) {
        const finalEntry = {
          iteration: 'final',
          timestamp: new Date().toISOString(),
          task_name: finalStatus.task_name,
          summary: finalStatus.summary,
          agents: finalStatus.agents
        };
        appendFileSync(statusLogPath, JSON.stringify(finalEntry) + '\n', 'utf-8');
        console.log('Final status:', JSON.stringify(finalStatus.summary, null, 2));
        
        for (const agent of finalStatus.agents) {
          console.log(`  - ${agent.agent_id} (${agent.agent_type}): ${agent.status}, last_message: ${agent.last_message ? agent.last_message.substring(0, 100) : 'none'}`);
        }
      }
      
      console.log(`\nStatus log saved to: ${statusLogPath}`);
      console.log(`Task directories:`);
      console.log(`  - Codex: ${codexTaskDir}`);
      console.log(`  - Cursor: ${cursorTaskDir}`);
      console.log(`  - Claude: ${claudeTaskDir}`);
    }, 600000);
  });
});
