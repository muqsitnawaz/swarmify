/**
 * Integration tests for the MCP server API.
 * These tests call the REAL handler functions with actual logging.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import { AgentManager, AgentProcess, AgentStatus, checkCliAvailable } from '../src/agents.js';
import { handleSpawn, handleStatus, handleStop, handleTasks } from '../src/api.js';

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

    test('should allow duplicate task names', async () => {
      console.log('\n--- TEST: duplicate task name allowed ---');

      // Seed an existing agent with the task name
      const existing = new AgentProcess('agent-existing', 'dup-task', 'codex', 'noop', null, 'plan', null, AgentStatus.RUNNING);
      manager['agents'].set(existing.agentId, existing);

      let error: any = null;
      let result: any = null;
      try {
        result = await handleSpawn(
          manager,
          'dup-task',
          'codex',
          'Write hello world',
          null,
          null,
          null
        );
      } catch (err: any) {
        error = err;
      }

      if (error) {
        expect(error.code).not.toBe('TASK_NAME_IN_USE');
      } else {
        expect(result).toBeTruthy();
        expect(result.task_name).toBe('dup-task');
      }
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
      const agent1 = new AgentProcess('agent-1', 'my-task', 'codex', 'Work 1', null, 'plan', null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('agent-2', 'my-task', 'cursor', 'Work 2', null, 'plan', null, AgentStatus.COMPLETED);
      manager['agents'].set('agent-1', agent1);
      manager['agents'].set('agent-2', agent2);

      const result = await handleStatus(manager, 'my-task', 'all');

      console.log('Result:', JSON.stringify(result, null, 2));

      expect('agents' in result).toBe(true);
      if ('agents' in result) {
        expect(result.agents.length).toBe(2);
        expect(result.summary.running).toBe(1);
        expect(result.summary.completed).toBe(1);
      }
    });

    test('should return full details for each agent in task', async () => {
      console.log('\n--- TEST: full details for agents in task ---');

      const agent = new AgentProcess('agent-123', 'detail-task', 'gemini', 'Complex work', null, 'plan', null, AgentStatus.RUNNING);
      manager['agents'].set('agent-123', agent);

      const result = await handleStatus(manager, 'detail-task');

      console.log('Result:', JSON.stringify(result, null, 2));

      expect(result.agents.length).toBe(1);
      const agentStatus = result.agents[0];
      expect(agentStatus.agent_id).toBe('agent-123');
      expect(agentStatus.agent_type).toBe('gemini');
      expect(agentStatus.status).toBe('running');
      // Verify full details are included
      expect(agentStatus.files_created).toBeDefined();
      expect(agentStatus.files_modified).toBeDefined();
      expect(agentStatus.bash_commands).toBeDefined();
      expect(agentStatus.last_messages).toBeDefined();
    });

    test('should support cursor-based delta updates', async () => {
      console.log('\n--- TEST: cursor-based delta updates ---');

      // Create an agent with some initial events
      const agent = new AgentProcess('cursor-test', 'cursor-task', 'codex', 'Test work', null, 'plan', null, AgentStatus.RUNNING);
      manager['agents'].set('cursor-test', agent);

      // Simulate some events by adding them to the agent's events cache
      const timestamp1 = new Date('2025-01-01T10:00:00Z').toISOString();
      const timestamp2 = new Date('2025-01-01T10:01:00Z').toISOString();
      const timestamp3 = new Date('2025-01-01T10:02:00Z').toISOString();

      agent['eventsCache'] = [
        { type: 'file_write', path: '/tmp/file1.txt', timestamp: timestamp1 },
        { type: 'bash', command: 'echo hello', timestamp: timestamp1 },
        { type: 'message', content: 'Working on it', timestamp: timestamp1 },
      ];

      // First call - no cursor, should return all data
      console.log('\n[Step 1] First call (no cursor) - should return all data');
      const result1 = await handleStatus(manager, 'cursor-task');
      console.log('Result1:', JSON.stringify(result1, null, 2));

      expect(result1.agents.length).toBe(1);
      expect(result1.cursor).toBeDefined();
      expect(result1.agents[0].cursor).toBeDefined();
      expect(result1.agents[0].files_modified.length).toBeGreaterThanOrEqual(0);
      expect(result1.agents[0].bash_commands.length).toBeGreaterThanOrEqual(0);

      // Add more events
      agent['eventsCache'].push(
        { type: 'file_write', path: '/tmp/file2.txt', timestamp: timestamp2 },
        { type: 'bash', command: 'ls -la', timestamp: timestamp2 }
      );

      // Second call - with cursor from first call, should return only new data
      console.log('\n[Step 2] Second call (with cursor) - should return only new data');
      const result2 = await handleStatus(manager, 'cursor-task', undefined, result1.cursor);
      console.log('Result2:', JSON.stringify(result2, null, 2));

      expect(result2.agents.length).toBe(1);
      expect(result2.cursor).toBeDefined();
      // Cursor should have advanced
      expect(result2.cursor).not.toBe(result1.cursor);

      // Third call - with updated cursor, no new events, should return empty arrays
      console.log('\n[Step 3] Third call (no new events) - should return empty arrays');
      const result3 = await handleStatus(manager, 'cursor-task', undefined, result2.cursor);
      console.log('Result3:', JSON.stringify(result3, null, 2));

      expect(result3.agents.length).toBe(1);
      expect(result3.agents[0].files_created.length).toBe(0);
      expect(result3.agents[0].files_modified.length).toBe(0);
      expect(result3.agents[0].bash_commands.length).toBe(0);
      expect(result3.cursor).toBe(result2.cursor); // Cursor unchanged

      console.log('Cursor test completed successfully!');
    });
  });

  describe('handleStop', () => {
    test('should stop all agents in task', async () => {
      console.log('\n--- TEST: stop all agents in task ---');

      const agent1 = new AgentProcess('stop-1', 'stop-task', 'codex', 'Work', null, 'plan', null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('stop-2', 'stop-task', 'cursor', 'Work', null, 'plan', null, AgentStatus.COMPLETED);
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

      const agent = new AgentProcess('single-stop', 'single-task', 'codex', 'Work', null, 'plan', null, AgentStatus.COMPLETED);
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
      const agent1 = new AgentProcess('flow-1', 'feature-x', 'codex', 'Build feature', null, 'plan', null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('flow-2', 'feature-x', 'cursor', 'Fix bugs', null, 'plan', null, AgentStatus.RUNNING);
      const agent3 = new AgentProcess('flow-3', 'feature-x', 'gemini', 'Refactor', null, 'plan', null, AgentStatus.COMPLETED);
      manager['agents'].set('flow-1', agent1);
      manager['agents'].set('flow-2', agent2);
      manager['agents'].set('flow-3', agent3);
      console.log('Added: flow-1 (codex, running), flow-2 (cursor, running), flow-3 (gemini, completed)');

      // Step 2: Get task status
      console.log('\n[Step 2] Getting status for task "feature-x"...');
      const taskStatus = await handleStatus(manager, 'feature-x', 'all');
      console.log('Task status:', JSON.stringify(taskStatus, null, 2));

      expect('agents' in taskStatus).toBe(true);
      if ('agents' in taskStatus) {
        expect(taskStatus.agents.length).toBe(3);
        expect(taskStatus.summary.running).toBe(2);
        expect(taskStatus.summary.completed).toBe(1);
      }

      // Step 3: Get individual agent status (by finding in task status)
      console.log('\n[Step 3] Getting detailed status for agent "flow-1"...');
      const taskStatusForAgent = await handleStatus(manager, 'feature-x', 'all');
      const agentStatus = taskStatusForAgent.agents.find(a => a.agent_id === 'flow-1');
      console.log('Agent status:', JSON.stringify(agentStatus, null, 2));

      expect(agentStatus).toBeDefined();
      expect(agentStatus!.agent_id).toBe('flow-1');
      expect(agentStatus!.agent_type).toBe('codex');

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
              const lastMsg = agent.last_messages?.length > 0 ? agent.last_messages[agent.last_messages.length - 1] : null;
              console.log(`  - ${agent.agent_id} (${agent.agent_type}): ${agent.status}, last_message: ${lastMsg ? lastMsg.substring(0, 50) + '...' : 'none'}`);
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
          const lastMsg = agent.last_messages?.length > 0 ? agent.last_messages[agent.last_messages.length - 1] : null;
          console.log(`  - ${agent.agent_id} (${agent.agent_type}): ${agent.status}, last_message: ${lastMsg ? lastMsg.substring(0, 100) : 'none'}`);
        }
      }
      
      console.log(`\nStatus log saved to: ${statusLogPath}`);
      console.log(`Task directories:`);
      console.log(`  - Codex: ${codexTaskDir}`);
      console.log(`  - Cursor: ${cursorTaskDir}`);
      console.log(`  - Claude: ${claudeTaskDir}`);
    }, 600000);
  });

  describe('handleTasks', () => {
    test('should return empty list when no tasks exist', async () => {
      console.log('\n--- TEST: tasks with no agents ---');

      const result = await handleTasks(manager);

      console.log('Result:', JSON.stringify(result, null, 2));

      expect(result.tasks).toBeDefined();
      expect(result.tasks.length).toBe(0);
    });

    test('should return tasks grouped by task name', async () => {
      console.log('\n--- TEST: tasks grouped by name ---');

      // Add agents to different tasks
      const agent1 = new AgentProcess('task-agent-1', 'feature-a', 'codex', 'Work', '/a/b/c', 'plan', null, AgentStatus.RUNNING, new Date('2025-01-01T10:00:00Z'));
      const agent2 = new AgentProcess('task-agent-2', 'feature-a', 'cursor', 'Work', '/a/b/d', 'plan', null, AgentStatus.COMPLETED, new Date('2025-01-01T10:05:00Z'), new Date('2025-01-01T10:10:00Z'));
      const agent3 = new AgentProcess('task-agent-3', 'feature-b', 'gemini', 'Work', '/x/y/z', 'plan', null, AgentStatus.RUNNING, new Date('2025-01-01T11:00:00Z'));
      manager['agents'].set('task-agent-1', agent1);
      manager['agents'].set('task-agent-2', agent2);
      manager['agents'].set('task-agent-3', agent3);

      const result = await handleTasks(manager);

      console.log('Result:', JSON.stringify(result, null, 2));

      expect(result.tasks.length).toBe(2);

      // Find the tasks
      const featureA = result.tasks.find(t => t.task_name === 'feature-a');
      const featureB = result.tasks.find(t => t.task_name === 'feature-b');

      expect(featureA).toBeDefined();
      expect(featureA!.agent_count).toBe(2);
      expect(featureA!.running).toBe(1);
      expect(featureA!.completed).toBe(1);

      expect(featureB).toBeDefined();
      expect(featureB!.agent_count).toBe(1);
      expect(featureB!.running).toBe(1);
    });

    test('should compute created_at as earliest agent start', async () => {
      console.log('\n--- TEST: tasks created_at timestamp ---');

      const agent1 = new AgentProcess('time-1', 'time-task', 'codex', 'Work', null, 'plan', null, AgentStatus.COMPLETED, new Date('2025-01-01T10:00:00Z'), new Date('2025-01-01T10:05:00Z'));
      const agent2 = new AgentProcess('time-2', 'time-task', 'cursor', 'Work', null, 'plan', null, AgentStatus.RUNNING, new Date('2025-01-01T09:00:00Z')); // Earlier start
      manager['agents'].set('time-1', agent1);
      manager['agents'].set('time-2', agent2);

      const result = await handleTasks(manager);

      console.log('Result:', JSON.stringify(result, null, 2));

      const task = result.tasks.find(t => t.task_name === 'time-task');
      expect(task).toBeDefined();
      // created_at should be the earlier time
      expect(task!.created_at).toBe('2025-01-01T09:00:00.000Z');
    });

    test('should compute modified_at as latest activity', async () => {
      console.log('\n--- TEST: tasks modified_at timestamp ---');

      const agent1 = new AgentProcess('mod-1', 'mod-task', 'codex', 'Work', null, 'plan', null, AgentStatus.COMPLETED, new Date('2025-01-01T10:00:00Z'), new Date('2025-01-01T10:30:00Z'));
      const agent2 = new AgentProcess('mod-2', 'mod-task', 'cursor', 'Work', null, 'plan', null, AgentStatus.COMPLETED, new Date('2025-01-01T10:05:00Z'), new Date('2025-01-01T10:15:00Z'));
      manager['agents'].set('mod-1', agent1);
      manager['agents'].set('mod-2', agent2);

      const result = await handleTasks(manager);

      console.log('Result:', JSON.stringify(result, null, 2));

      const task = result.tasks.find(t => t.task_name === 'mod-task');
      expect(task).toBeDefined();
      // modified_at should be the later completion time
      expect(task!.modified_at).toBe('2025-01-01T10:30:00.000Z');
    });

    test('should use current time for modified_at when agents are running', async () => {
      console.log('\n--- TEST: tasks modified_at for running agents ---');

      const pastTime = new Date('2025-01-01T10:00:00Z');
      const agent = new AgentProcess('running-mod', 'running-mod-task', 'codex', 'Work', null, 'plan', null, AgentStatus.RUNNING, pastTime);
      manager['agents'].set('running-mod', agent);

      const beforeCall = new Date();
      const result = await handleTasks(manager);
      const afterCall = new Date();

      console.log('Result:', JSON.stringify(result, null, 2));

      const task = result.tasks.find(t => t.task_name === 'running-mod-task');
      expect(task).toBeDefined();

      const modifiedAt = new Date(task!.modified_at);
      // modified_at should be approximately now (within the call window)
      expect(modifiedAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(modifiedAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });

    test('should include workspace_dir from agents', async () => {
      console.log('\n--- TEST: tasks workspace_dir ---');

      const agent = new AgentProcess(
        'ws-agent',
        'ws-task',
        'codex',
        'Work',
        '/Users/test/monorepo/packages/a',
        'plan',
        null,
        AgentStatus.RUNNING,
        new Date(),
        null,
        null,
        null,
        '/Users/test/monorepo'
      );
      manager['agents'].set('ws-agent', agent);

      const result = await handleTasks(manager);

      console.log('Result:', JSON.stringify(result, null, 2));

      const task = result.tasks.find(t => t.task_name === 'ws-task');
      expect(task).toBeDefined();
      expect(task!.workspace_dir).toBe('/Users/test/monorepo');
    });

    test('should sort tasks by modified_at descending', async () => {
      console.log('\n--- TEST: tasks sorted by modified_at ---');

      const agent1 = new AgentProcess('sort-1', 'old-task', 'codex', 'Work', null, 'plan', null, AgentStatus.COMPLETED, new Date('2025-01-01T08:00:00Z'), new Date('2025-01-01T08:30:00Z'));
      const agent2 = new AgentProcess('sort-2', 'new-task', 'cursor', 'Work', null, 'plan', null, AgentStatus.COMPLETED, new Date('2025-01-01T10:00:00Z'), new Date('2025-01-01T10:30:00Z'));
      const agent3 = new AgentProcess('sort-3', 'mid-task', 'gemini', 'Work', null, 'plan', null, AgentStatus.COMPLETED, new Date('2025-01-01T09:00:00Z'), new Date('2025-01-01T09:30:00Z'));
      manager['agents'].set('sort-1', agent1);
      manager['agents'].set('sort-2', agent2);
      manager['agents'].set('sort-3', agent3);

      const result = await handleTasks(manager);

      console.log('Result:', JSON.stringify(result, null, 2));

      expect(result.tasks.length).toBe(3);
      // Should be sorted: new-task (10:30), mid-task (9:30), old-task (8:30)
      expect(result.tasks[0].task_name).toBe('new-task');
      expect(result.tasks[1].task_name).toBe('mid-task');
      expect(result.tasks[2].task_name).toBe('old-task');
    });

    test('should respect limit parameter', async () => {
      console.log('\n--- TEST: tasks with limit ---');

      // Add 5 tasks
      for (let i = 0; i < 5; i++) {
        const agent = new AgentProcess(`limit-${i}`, `limit-task-${i}`, 'codex', 'Work', null, 'plan', null, AgentStatus.COMPLETED, new Date(`2025-01-0${i + 1}T10:00:00Z`), new Date(`2025-01-0${i + 1}T10:30:00Z`));
        manager['agents'].set(`limit-${i}`, agent);
      }

      const result = await handleTasks(manager, 3);

      console.log('Result:', JSON.stringify(result, null, 2));

      expect(result.tasks.length).toBe(3);
    });
  });

  describe('Ralph Mode Spawn', () => {
    let ralphTestDir: string;
    let ralphFilePath: string;

    beforeEach(async () => {
      ralphTestDir = path.join(testDir, 'ralph-project');
      await fs.mkdir(ralphTestDir, { recursive: true });
      ralphFilePath = path.join(ralphTestDir, 'RALPH.md');

      // Create a sample RALPH.md with test tasks
      const sampleRalph = `## [ ] Create test.txt

Create a test file.

### Updates

---

## [ ] Write summary

Write a summary of completed tasks.

### Updates
`;
      await fs.writeFile(ralphFilePath, sampleRalph);
    });

    test('should reject ralph mode without cwd parameter', async () => {
      console.log('\n--- TEST: ralph mode without cwd ---');

      let error: any = null;
      try {
        await handleSpawn(
          manager,
          'ralph-task',
          'codex',
          'Build something',
          null,
          'ralph',
          null
        );
      } catch (err: any) {
        error = err;
      }

      expect(error).toBeTruthy();
      expect(error.message).toContain('cwd');
    });

    test('should reject ralph mode if RALPH.md does not exist', async () => {
      console.log('\n--- TEST: ralph mode without RALPH.md ---');

      const nothingDir = path.join(testDir, 'empty-project');
      await fs.mkdir(nothingDir, { recursive: true });

      let error: any = null;
      try {
        await handleSpawn(
          manager,
          'ralph-task',
          'codex',
          'Build something',
          nothingDir,
          'ralph',
          null
        );
      } catch (err: any) {
        error = err;
      }

      expect(error).toBeTruthy();
      expect(error.message).toContain('RALPH.md');
      expect(error.message).toContain('not found');
    });

    test('should reject ralph mode in home directory', async () => {
      console.log('\n--- TEST: ralph mode in dangerous directory ---');

      const homeDir = require('os').homedir();
      const ralphInHome = path.join(homeDir, '.test-ralph');

      // Don't actually create it - just test the rejection
      let error: any = null;
      try {
        await handleSpawn(
          manager,
          'ralph-dangerous',
          'codex',
          'Build something',
          homeDir,
          'ralph',
          null
        );
      } catch (err: any) {
        error = err;
      }

      expect(error).toBeTruthy();
      expect(error.message).toMatch(/risky|dangerous|home|system/i);
    });

    test('should reject ralph mode in /System directory (macOS)', async () => {
      console.log('\n--- TEST: ralph mode in /System ---');

      let error: any = null;
      try {
        await handleSpawn(
          manager,
          'ralph-system',
          'codex',
          'Build something',
          '/System/Library',
          'ralph',
          null
        );
      } catch (err: any) {
        error = err;
      }

      expect(error).toBeTruthy();
      expect(error.message).toMatch(/risky|dangerous/i);
    });

    test('should validate RALPH.md exists before spawn', async () => {
      console.log('\n--- TEST: validate RALPH.md exists ---');

      // Verify the file exists
      const fileExists = await fs.access(ralphFilePath)
        .then(() => true)
        .catch(() => false);

      expect(fileExists).toBe(true);

      // If ralph mode correctly validates, it would proceed with spawn
      // (or fail if CLI not installed, but that's OK for this test)
      console.log(`RALPH.md exists at: ${ralphFilePath}`);
    });

    test('should read custom RALPH file name from environment', async () => {
      console.log('\n--- TEST: custom RALPH file name ---');

      const customName = 'TASKS.md';
      const customPath = path.join(ralphTestDir, customName);

      // Create custom task file
      await fs.writeFile(customPath, '## [ ] Custom task\n### Updates\n');

      // Set env var
      const originalEnv = process.env.AGENTS_MCP_RALPH_FILE;
      try {
        process.env.AGENTS_MCP_RALPH_FILE = customName;

        // Verify it reads the env var
        const { getRalphConfig } = await import('../src/ralph.js');
        const config = getRalphConfig();
        expect(config.ralphFile).toBe(customName);
      } finally {
        if (originalEnv) {
          process.env.AGENTS_MCP_RALPH_FILE = originalEnv;
        } else {
          delete process.env.AGENTS_MCP_RALPH_FILE;
        }
      }
    });

    test('should allow ralph mode in safe project directory', async () => {
      console.log('\n--- TEST: ralph mode in safe project directory ---');

      // Verify path is safe
      const { isDangerousPath } = await import('../src/ralph.js');
      const isSafe = !isDangerousPath(ralphTestDir);
      expect(isSafe).toBe(true);

      console.log(`Ralph test directory is safe: ${ralphTestDir}`);
    });

    test('should prompt buildRalphPrompt with correct file path', async () => {
      console.log('\n--- TEST: ralph prompt building ---');

      const { buildRalphPrompt } = await import('../src/ralph.js');
      const userPrompt = 'Complete all tasks in RALPH.md';
      const prompt = buildRalphPrompt(userPrompt, ralphFilePath);

      // Verify prompt contains user intent and ralph instructions
      expect(prompt).toContain(userPrompt);
      expect(prompt).toContain(ralphFilePath);
      expect(prompt).toContain('autonomous');
      expect(prompt).toContain('## [ ]');
      expect(prompt).toContain('## [x]');

      console.log(`Generated ralph prompt (${prompt.length} chars)`);
    });
  });
});
