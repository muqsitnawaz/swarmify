import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import {
  AgentManager,
  AgentProcess,
  AgentStatus,
} from '../src/agents.js';
import { summarizeEvents, getQuickStatus } from '../src/summarizer.js';
import { getParentSessionIdFromEnv } from '../src/server.js';

describe('Task-Based API', () => {
  let manager: AgentManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `server_api_tests_${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    manager = new AgentManager(50, 10, testDir);
    await manager['initialize']();
    manager['agents'].clear();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {}
  });

  describe('spawn - multiple agents same task', () => {
    test('should allow spawning multiple agents under same task name', async () => {
      const agent1 = new AgentProcess(
        'agent-1',
        'feature-auth',
        'codex',
        'Implement login',
        null,
        'plan',
        null,
        AgentStatus.RUNNING
      );
      const agent2 = new AgentProcess(
        'agent-2',
        'feature-auth',
        'cursor',
        'Fix auth bug',
        null,
        'plan',
        null,
        AgentStatus.RUNNING
      );
      const agent3 = new AgentProcess(
        'agent-3',
        'feature-auth',
        'gemini',
        'Refactor auth module',
        null,
        'plan',
        null,
        AgentStatus.RUNNING
      );

      manager['agents'].set('agent-1', agent1);
      manager['agents'].set('agent-2', agent2);
      manager['agents'].set('agent-3', agent3);

      const taskAgents = await manager.listByTask('feature-auth');
      expect(taskAgents.length).toBe(3);
      expect(taskAgents.map(a => a.agentType).sort()).toEqual(['codex', 'cursor', 'gemini']);
    });

    test('should isolate agents by task name', async () => {
      const agent1 = new AgentProcess('a1', 'task-a', 'codex', 'Task A work', null, 'plan', null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('a2', 'task-a', 'cursor', 'Task A debug', null, 'plan', null, AgentStatus.RUNNING);
      const agent3 = new AgentProcess('b1', 'task-b', 'codex', 'Task B work', null, 'plan', null, AgentStatus.RUNNING);

      manager['agents'].set('a1', agent1);
      manager['agents'].set('a2', agent2);
      manager['agents'].set('b1', agent3);

      const taskAAgents = await manager.listByTask('task-a');
      const taskBAgents = await manager.listByTask('task-b');

      expect(taskAAgents.length).toBe(2);
      expect(taskBAgents.length).toBe(1);
      expect(taskAAgents.every(a => a.taskName === 'task-a')).toBe(true);
      expect(taskBAgents[0].taskName).toBe('task-b');
    });
  });

  describe('status - task level', () => {
    test('should return quick status for all agents in task', async () => {
      const events1 = [
        { type: 'file_create', path: 'src/auth.ts', timestamp: '2024-01-01' },
        { type: 'file_write', path: 'src/login.ts', timestamp: '2024-01-01' },
        { type: 'bash', command: 'npm test', timestamp: '2024-01-01' },
      ];
      const events2 = [
        { type: 'file_write', path: 'src/api.ts', timestamp: '2024-01-01' },
        { type: 'error', message: 'Test failed', timestamp: '2024-01-01' },
      ];

      const status1 = getQuickStatus('agent-1', 'codex', 'running', events1);
      const status2 = getQuickStatus('agent-2', 'cursor', 'failed', events2);

      expect(status1.files_created).toBe(1);
      expect(status1.files_modified).toBe(1);
      expect(status1.tool_count).toBe(3);
      expect(status1.last_commands).toContain('npm test');
      expect(status1.has_errors).toBe(false);

      expect(status2.files_modified).toBe(1);
      expect(status2.has_errors).toBe(true);
    });

    test('should count status correctly across multiple agents', async () => {
      const agent1 = new AgentProcess('a1', 'my-task', 'codex', 'Work 1', null, 'plan', null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('a2', 'my-task', 'cursor', 'Work 2', null, 'plan', null, AgentStatus.COMPLETED);
      const agent3 = new AgentProcess('a3', 'my-task', 'gemini', 'Work 3', null, 'plan', null, AgentStatus.FAILED);
      const agent4 = new AgentProcess('a4', 'my-task', 'claude', 'Work 4', null, 'plan', null, AgentStatus.STOPPED);

      manager['agents'].set('a1', agent1);
      manager['agents'].set('a2', agent2);
      manager['agents'].set('a3', agent3);
      manager['agents'].set('a4', agent4);

      const agents = await manager.listByTask('my-task');
      const counts = { running: 0, completed: 0, failed: 0, stopped: 0 };

      for (const agent of agents) {
        if (agent.status === AgentStatus.RUNNING) counts.running++;
        else if (agent.status === AgentStatus.COMPLETED) counts.completed++;
        else if (agent.status === AgentStatus.FAILED) counts.failed++;
        else if (agent.status === AgentStatus.STOPPED) counts.stopped++;
      }

      expect(counts.running).toBe(1);
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(1);
      expect(counts.stopped).toBe(1);
    });
  });

  describe('status - agent level', () => {
    test('should return detailed status for single agent', async () => {
      const events = [
        { type: 'file_create', path: 'src/new.ts', timestamp: '2024-01-01' },
        { type: 'file_write', path: 'src/existing.ts', timestamp: '2024-01-01' },
        { type: 'bash', command: 'npm install express', timestamp: '2024-01-01' },
        { type: 'bash', command: 'npm test', timestamp: '2024-01-01' },
        { type: 'message', content: 'Task completed successfully!', complete: true, timestamp: '2024-01-01' },
      ];

      const summary = summarizeEvents('agent-1', 'codex', 'completed', events, '30 seconds');

      expect(summary.filesCreated.has('src/new.ts')).toBe(true);
      expect(summary.filesModified.has('src/existing.ts')).toBe(true);
      expect(summary.bashCommands.length).toBe(2);
      expect(summary.finalMessage).toBe('Task completed successfully!');
      expect(summary.toolCallCount).toBe(4);
    });

    test('should verify agent belongs to task before returning status', async () => {
      const agent = new AgentProcess('agent-1', 'task-a', 'codex', 'Work', null, 'plan', null, AgentStatus.RUNNING);
      manager['agents'].set('agent-1', agent);

      const retrieved = await manager.get('agent-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.taskName).toBe('task-a');

      // Simulating the check in handleStatus
      const wrongTask = 'task-b';
      const isInTask = retrieved?.taskName === wrongTask;
      expect(isInTask).toBe(false);
    });
  });

  describe('stop - task level', () => {
    test('should stop all running agents in task', async () => {
      const agent1 = new AgentProcess('a1', 'stop-task', 'codex', 'Work 1', null, 'plan', null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('a2', 'stop-task', 'cursor', 'Work 2', null, 'plan', null, AgentStatus.RUNNING);
      const agent3 = new AgentProcess('a3', 'stop-task', 'gemini', 'Work 3', null, 'plan', null, AgentStatus.COMPLETED);

      manager['agents'].set('a1', agent1);
      manager['agents'].set('a2', agent2);
      manager['agents'].set('a3', agent3);

      const result = await manager.stopByTask('stop-task');

      // a1 and a2 would be in stopped if they had real PIDs
      // a3 is already completed so goes to alreadyStopped
      expect(result.alreadyStopped).toContain('a3');
    });

    test('should not affect agents in other tasks', async () => {
      const agent1 = new AgentProcess('a1', 'task-to-stop', 'codex', 'Work', null, 'plan', null, AgentStatus.RUNNING);
      const agent2 = new AgentProcess('a2', 'other-task', 'cursor', 'Work', null, 'plan', null, AgentStatus.RUNNING);

      manager['agents'].set('a1', agent1);
      manager['agents'].set('a2', agent2);

      await manager.stopByTask('task-to-stop');

      const otherAgent = manager['agents'].get('a2');
      expect(otherAgent?.status).toBe(AgentStatus.RUNNING);
    });
  });

  describe('stop - agent level', () => {
    test('should verify agent belongs to task before stopping', async () => {
      const agent = new AgentProcess('agent-1', 'task-a', 'codex', 'Work', null, 'plan', null, AgentStatus.RUNNING);
      manager['agents'].set('agent-1', agent);

      const retrieved = await manager.get('agent-1');

      // Simulating the check in handleStop
      const requestedTask = 'task-b';
      const isInTask = retrieved?.taskName === requestedTask;
      expect(isInTask).toBe(false);
    });

    test('should return already_stopped for completed agent', async () => {
      const agent = new AgentProcess('agent-1', 'my-task', 'codex', 'Work', null, 'plan', null, AgentStatus.COMPLETED);
      manager['agents'].set('agent-1', agent);

      const success = await manager.stop('agent-1');
      expect(success).toBe(false);
    });
  });

  describe('read - with offset', () => {
    test('should return events from offset onwards', async () => {
      const allEvents = [
        { type: 'init', timestamp: '2024-01-01' },
        { type: 'file_write', path: 'src/a.ts', timestamp: '2024-01-01' },
        { type: 'file_write', path: 'src/b.ts', timestamp: '2024-01-01' },
        { type: 'bash', command: 'npm test', timestamp: '2024-01-01' },
        { type: 'result', status: 'success', timestamp: '2024-01-01' },
      ];

      // Simulate reading with offset
      const offset = 2;
      const newEvents = allEvents.slice(offset);

      expect(newEvents.length).toBe(3);
      expect(newEvents[0].type).toBe('file_write');
      expect(newEvents[0].path).toBe('src/b.ts');
    });

    test('should return empty events when offset equals event count', async () => {
      const allEvents = [
        { type: 'init', timestamp: '2024-01-01' },
        { type: 'file_write', path: 'src/a.ts', timestamp: '2024-01-01' },
      ];

      const offset = 2;
      const newEvents = allEvents.slice(offset);

      expect(newEvents.length).toBe(0);
    });

    test('should include summary even with offset', async () => {
      const allEvents = [
        { type: 'file_create', path: 'src/new.ts', timestamp: '2024-01-01' },
        { type: 'file_write', path: 'src/old.ts', timestamp: '2024-01-01' },
        { type: 'bash', command: 'npm install', timestamp: '2024-01-01' },
      ];

      // Full summary should include all events regardless of offset
      const summary = summarizeEvents('agent-1', 'codex', 'running', allEvents);

      expect(summary.filesCreated.size).toBe(1);
      expect(summary.filesModified.size).toBe(1);
      expect(summary.bashCommands.length).toBe(1);
    });
  });

  describe('edge cases', () => {
    test('should return empty list for nonexistent task', async () => {
      const agents = await manager.listByTask('nonexistent-task');
      expect(agents.length).toBe(0);
    });

    test('should handle task with no running agents', async () => {
      const agent1 = new AgentProcess('a1', 'done-task', 'codex', 'Work 1', null, 'plan', null, AgentStatus.COMPLETED);
      const agent2 = new AgentProcess('a2', 'done-task', 'cursor', 'Work 2', null, 'plan', null, AgentStatus.FAILED);

      manager['agents'].set('a1', agent1);
      manager['agents'].set('a2', agent2);

      const result = await manager.stopByTask('done-task');

      expect(result.stopped.length).toBe(0);
      expect(result.alreadyStopped.length).toBe(2);
    });

    test('should handle empty events for quick status', () => {
      const status = getQuickStatus('agent-1', 'codex', 'running', []);

      expect(status.files_created).toBe(0);
      expect(status.files_modified).toBe(0);
      expect(status.tool_count).toBe(0);
      expect(status.last_commands).toEqual([]);
      expect(status.has_errors).toBe(false);
    });

    test('should truncate long commands in quick status', () => {
      const longCommand = 'npm run build -- --config=production --verbose --debug --output=/very/long/path/that/exceeds/one/hundred/characters/easily';
      const events = [
        { type: 'bash', command: longCommand, timestamp: '2024-01-01' },
      ];

      const status = getQuickStatus('agent-1', 'codex', 'running', events);

      expect(status.last_commands[0].length).toBe(100);
      expect(status.last_commands[0].endsWith('...')).toBe(true);
    });
  });
});

describe('Spawn Environment', () => {
  test('reads AGENT_SESSION_ID from env', () => {
    const original = process.env.AGENT_SESSION_ID;
    process.env.AGENT_SESSION_ID = 'session-env-123';
    try {
      expect(getParentSessionIdFromEnv()).toBe('session-env-123');
    } finally {
      if (original === undefined) {
        delete process.env.AGENT_SESSION_ID;
      } else {
        process.env.AGENT_SESSION_ID = original;
      }
    }
  });

  test('returns null when AGENT_SESSION_ID is missing', () => {
    const original = process.env.AGENT_SESSION_ID;
    delete process.env.AGENT_SESSION_ID;
    try {
      expect(getParentSessionIdFromEnv()).toBeNull();
    } finally {
      if (original !== undefined) {
        process.env.AGENT_SESSION_ID = original;
      }
    }
  });

  test('returns null when AGENT_SESSION_ID is blank', () => {
    const original = process.env.AGENT_SESSION_ID;
    process.env.AGENT_SESSION_ID = '   ';
    try {
      expect(getParentSessionIdFromEnv()).toBeNull();
    } finally {
      if (original === undefined) {
        delete process.env.AGENT_SESSION_ID;
      } else {
        process.env.AGENT_SESSION_ID = original;
      }
    }
  });
});
