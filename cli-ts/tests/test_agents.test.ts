import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import {
  AgentManager,
  AgentProcess,
  AgentStatus,
  AGENT_COMMANDS,
  resolveModeFlags,
} from '../src/agents.js';

const TESTDATA_DIR = path.join(__dirname, 'testdata');

describe('Mode Resolution', () => {
  it('should use default mode when no flags provided', () => {
    const [mode, yolo] = resolveModeFlags(null, null, 'yolo');
    expect(mode).toBe('yolo');
    expect(yolo).toBe(true);
  });

  it('should reject non-boolean yolo values', () => {
    expect(() => {
      resolveModeFlags(null, 'yes' as any, 'safe');
    }).toThrow('boolean');
  });

  it('should reject invalid default modes', () => {
    expect(() => {
      resolveModeFlags(null, null, 'fast' as any);
    }).toThrow('default mode');
  });
});

describe('AgentProcess', () => {
  it('should serialize to dict correctly', () => {
    const agent = new AgentProcess(
      'test-1',
      'my-task',
      'codex',
      'Test prompt',
      null,
      false,
      null,
      AgentStatus.RUNNING,
      new Date('2024-01-01T00:00:00Z')
    );

    const result = agent.toDict();

    expect(result.agent_id).toBe('test-1');
    expect(result.task_name).toBe('my-task');
    expect(result.agent_type).toBe('codex');
    expect(result.status).toBe('running');
    expect(result.event_count).toBe(0);
    expect(result.completed_at).toBeNull();
    expect(result.mode).toBe('safe');
    expect(result.yolo).toBe(false);
    expect(result.duration).toBeDefined();
  });

  it('should reflect yolo mode in serialization', () => {
    const agent = new AgentProcess(
      'test-yolo',
      'my-task',
      'codex',
      'Test prompt',
      null,
      true,
      null,
      AgentStatus.RUNNING,
      new Date('2024-01-01T00:00:00Z')
    );

    const result = agent.toDict();
    expect(result.mode).toBe('yolo');
  });

  it('should calculate duration for completed agent', () => {
    const started = new Date('2024-01-01T00:00:00Z');
    const completed = new Date('2024-01-01T00:00:05Z');

    const agent = new AgentProcess(
      'test-2',
      'my-task',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.COMPLETED,
      started,
      completed
    );

    const duration = agent.duration();
    expect(duration).toBe('5 seconds');
  });

  it('should calculate duration for running agent', () => {
    const started = new Date();

    const agent = new AgentProcess(
      'test-3',
      'my-task',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.RUNNING,
      started
    );

    const duration = agent.duration();
    expect(duration).not.toBeNull();
    expect(duration).toMatch(/seconds|minutes/);
  });
});

describe('AgentCommands', () => {
  it('should have commands for all agent types', () => {
    expect('codex' in AGENT_COMMANDS).toBe(true);
    expect('cursor' in AGENT_COMMANDS).toBe(true);
    expect('gemini' in AGENT_COMMANDS).toBe(true);
    expect('claude' in AGENT_COMMANDS).toBe(true);
  });

  it('should have prompt placeholder in command templates', () => {
    for (const cmdTemplate of Object.values(AGENT_COMMANDS)) {
      const cmdStr = cmdTemplate.join(' ');
      expect(cmdStr).toContain('{prompt}');
    }
  });

  it('should have correct Codex command structure', () => {
    const cmd = AGENT_COMMANDS.codex;
    expect(cmd[0]).toBe('codex');
    expect(cmd).toContain('exec');
    expect(cmd).toContain('--full-auto');
    expect(cmd).toContain('--json');
  });
});

describe('AgentManager', () => {
  let manager: AgentManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `agent_manager_tests_${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    manager = new AgentManager(5, 10, testDir);
    await manager['initialize']();
    manager['agents'].clear();
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
    }
  });

  it('should initialize with empty agent list', async () => {
    const all = await manager.listAll();
    expect(all.length).toBe(0);
  });

  it('should return null for nonexistent agent', async () => {
    const agent = await manager.get('nonexistent');
    expect(agent).toBeNull();
  });

  it('should list running agents correctly', async () => {
    const running1 = new AgentProcess(
      'running-1',
      'task-1',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.RUNNING
    );
    const running2 = new AgentProcess(
      'running-2',
      'task-1',
      'gemini',
      'Test',
      null,
      false,
      null,
      AgentStatus.RUNNING
    );
    const completed = new AgentProcess(
      'completed-1',
      'task-1',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.COMPLETED
    );

    manager['agents'].set('running-1', running1);
    manager['agents'].set('running-2', running2);
    manager['agents'].set('completed-1', completed);

    const running = await manager.listRunning();
    expect(running.length).toBe(2);
    expect(running.every(a => a.status === AgentStatus.RUNNING)).toBe(true);
  });

  it('should list completed agents correctly', async () => {
    const running = new AgentProcess(
      'running-1',
      'task-1',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.RUNNING
    );
    const completed1 = new AgentProcess(
      'completed-1',
      'task-1',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.COMPLETED
    );
    const completed2 = new AgentProcess(
      'completed-2',
      'task-1',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.FAILED
    );

    manager['agents'].set('running-1', running);
    manager['agents'].set('completed-1', completed1);
    manager['agents'].set('completed-2', completed2);

    const completed = await manager.listCompleted();
    expect(completed.length).toBe(2);
    expect(completed.every(a => a.status !== AgentStatus.RUNNING)).toBe(true);
  });

  it('should stop nonexistent agent and return false', async () => {
    const success = await manager.stop('nonexistent');
    expect(success).toBe(false);
  });

  it('should stop already completed agent and return false', async () => {
    const agent = new AgentProcess(
      'completed-1',
      'task-1',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.COMPLETED
    );
    manager['agents'].set('completed-1', agent);

    const success = await manager.stop('completed-1');
    expect(success).toBe(false);
  });

  it('should list agents by task name', async () => {
    const agent1 = new AgentProcess(
      'agent-1',
      'task-a',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.RUNNING
    );
    const agent2 = new AgentProcess(
      'agent-2',
      'task-a',
      'gemini',
      'Test',
      null,
      false,
      null,
      AgentStatus.RUNNING
    );
    const agent3 = new AgentProcess(
      'agent-3',
      'task-b',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.RUNNING
    );

    manager['agents'].set('agent-1', agent1);
    manager['agents'].set('agent-2', agent2);
    manager['agents'].set('agent-3', agent3);

    const taskAAgents = await manager.listByTask('task-a');
    expect(taskAAgents.length).toBe(2);
    expect(taskAAgents.every(a => a.taskName === 'task-a')).toBe(true);

    const taskBAgents = await manager.listByTask('task-b');
    expect(taskBAgents.length).toBe(1);
    expect(taskBAgents[0].agentId).toBe('agent-3');

    const taskCAgents = await manager.listByTask('task-c');
    expect(taskCAgents.length).toBe(0);
  });

  it('should stop all agents in a task', async () => {
    const agent1 = new AgentProcess(
      'agent-1',
      'task-stop',
      'codex',
      'Test',
      null,
      false,
      12345,
      AgentStatus.RUNNING
    );
    const agent2 = new AgentProcess(
      'agent-2',
      'task-stop',
      'gemini',
      'Test',
      null,
      false,
      null,
      AgentStatus.COMPLETED
    );
    const agent3 = new AgentProcess(
      'agent-3',
      'other-task',
      'codex',
      'Test',
      null,
      false,
      null,
      AgentStatus.RUNNING
    );

    manager['agents'].set('agent-1', agent1);
    manager['agents'].set('agent-2', agent2);
    manager['agents'].set('agent-3', agent3);

    const result = await manager.stopByTask('task-stop');

    // agent-1 would be in stopped list if the process existed
    // agent-2 is already completed so goes to alreadyStopped
    expect(result.alreadyStopped).toContain('agent-2');

    // agent-3 should not be affected
    const otherAgent = manager['agents'].get('agent-3');
    expect(otherAgent?.status).toBe(AgentStatus.RUNNING);
  });
});
