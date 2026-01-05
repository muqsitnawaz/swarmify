import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { tmpdir } from 'os';
import {
  AgentManager,
  AgentProcess,
  AgentStatus,
  AGENT_COMMANDS,
  EFFORT_MODEL_MAP,
  resolveMode,
} from '../src/agents.js';
import type { EffortLevel } from '../src/agents.js';

const TESTDATA_DIR = path.join(__dirname, 'testdata');

describe('Mode Resolution', () => {
  test('should use default mode when no flags provided', () => {
    const mode = resolveMode(null, 'edit');
    expect(mode).toBe('edit');
  });

  test('should return plan mode by default', () => {
    const mode = resolveMode(null, 'plan');
    expect(mode).toBe('plan');
  });

  test('should reject invalid mode values', () => {
    expect(() => {
      resolveMode('invalid' as any, 'plan');
    }).toThrow('Invalid mode');
  });

  test('should reject invalid default modes', () => {
    expect(() => {
      resolveMode(null, 'fast' as any);
    }).toThrow('Invalid default mode');
  });
});

describe('AgentProcess', () => {
  test('should serialize to dict correctly', () => {
    const agent = new AgentProcess(
      'test-1',
      'my-task',
      'codex',
      'Test prompt',
      null,
      'plan',
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
    expect(result.mode).toBe('plan');
    expect(result.duration).toBeDefined();
  });

  test('should reflect edit mode in serialization', () => {
    const agent = new AgentProcess(
      'test-edit',
      'my-task',
      'codex',
      'Test prompt',
      null,
      'edit',
      null,
      AgentStatus.RUNNING,
      new Date('2024-01-01T00:00:00Z')
    );

    const result = agent.toDict();
    expect(result.mode).toBe('edit');
  });

  test('should calculate duration for completed agent', () => {
    const started = new Date('2024-01-01T00:00:00Z');
    const completed = new Date('2024-01-01T00:00:05Z');

    const agent = new AgentProcess(
      'test-2',
      'my-task',
      'codex',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.COMPLETED,
      started,
      completed
    );

    const duration = agent.duration();
    expect(duration).toBe('5 seconds');
  });

  test('should calculate duration for running agent', () => {
    const started = new Date();

    const agent = new AgentProcess(
      'test-3',
      'my-task',
      'codex',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.RUNNING,
      started
    );

    const duration = agent.duration();
    expect(duration).not.toBeNull();
    expect(duration).toMatch(/seconds|minutes/);
  });
});

describe('Effort Model Mapping', () => {
  test('should have mappings for all effort levels', () => {
    expect('fast' in EFFORT_MODEL_MAP).toBe(true);
    expect('default' in EFFORT_MODEL_MAP).toBe(true);
    expect('detailed' in EFFORT_MODEL_MAP).toBe(true);
  });

  test('should have models for all agent types at each effort level', () => {
    const agentTypes = ['codex', 'cursor', 'gemini', 'claude'] as const;
    const effortLevels: EffortLevel[] = ['fast', 'default', 'detailed'];

    for (const effort of effortLevels) {
      for (const agentType of agentTypes) {
        expect(EFFORT_MODEL_MAP[effort][agentType]).toBeDefined();
        expect(typeof EFFORT_MODEL_MAP[effort][agentType]).toBe('string');
        expect(EFFORT_MODEL_MAP[effort][agentType].length).toBeGreaterThan(0);
      }
    }
  });

  test('should have correct fast effort models', () => {
    expect(EFFORT_MODEL_MAP.fast.codex).toBe('gpt-5.2-codex');
    expect(EFFORT_MODEL_MAP.fast.gemini).toBe('gemini-3-flash-preview');
    expect(EFFORT_MODEL_MAP.fast.claude).toBe('claude-haiku-4-5-20251001');
    expect(EFFORT_MODEL_MAP.fast.cursor).toBe('composer-1');
  });

  test('should have correct default effort models', () => {
    expect(EFFORT_MODEL_MAP.default.codex).toBe('gpt-5.2-codex');
    expect(EFFORT_MODEL_MAP.default.gemini).toBe('gemini-3-flash-preview');
    expect(EFFORT_MODEL_MAP.default.claude).toBe('claude-sonnet-4-5');
    expect(EFFORT_MODEL_MAP.default.cursor).toBe('composer-1');
  });

  test('should have correct detailed effort models', () => {
    expect(EFFORT_MODEL_MAP.detailed.codex).toBe('gpt-5.1-codex-max');
    expect(EFFORT_MODEL_MAP.detailed.gemini).toBe('gemini-3-pro-preview');
    expect(EFFORT_MODEL_MAP.detailed.claude).toBe('claude-opus-4-5');
    expect(EFFORT_MODEL_MAP.detailed.cursor).toBe('composer-1');
  });

  test('cursor should use composer-1 for all effort levels', () => {
    expect(EFFORT_MODEL_MAP.fast.cursor).toBe('composer-1');
    expect(EFFORT_MODEL_MAP.default.cursor).toBe('composer-1');
    expect(EFFORT_MODEL_MAP.detailed.cursor).toBe('composer-1');
  });
});

describe('AgentCommands', () => {
  test('should have commands for all agent types', () => {
    expect('codex' in AGENT_COMMANDS).toBe(true);
    expect('cursor' in AGENT_COMMANDS).toBe(true);
    expect('gemini' in AGENT_COMMANDS).toBe(true);
    expect('claude' in AGENT_COMMANDS).toBe(true);
  });

  test('should have prompt placeholder in command templates', () => {
    for (const cmdTemplate of Object.values(AGENT_COMMANDS)) {
      const cmdStr = cmdTemplate.join(' ');
      expect(cmdStr).toContain('{prompt}');
    }
  });

  test('should have correct Codex command structure', () => {
    const cmd = AGENT_COMMANDS.codex;
    expect(cmd[0]).toBe('codex');
    expect(cmd).toContain('exec');
    expect(cmd).toContain('--json');
    // --full-auto is only added in edit mode, not in plan mode base command
    expect(cmd).not.toContain('--full-auto');
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

  test('should initialize with empty agent list', async () => {
    const all = await manager.listAll();
    expect(all.length).toBe(0);
  });

  test('should return null for nonexistent agent', async () => {
    const agent = await manager.get('nonexistent');
    expect(agent).toBeNull();
  });

  test('should list running agents correctly', async () => {
    const running1 = new AgentProcess(
      'running-1',
      'task-1',
      'codex',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.RUNNING
    );
    const running2 = new AgentProcess(
      'running-2',
      'task-1',
      'gemini',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.RUNNING
    );
    const completed = new AgentProcess(
      'completed-1',
      'task-1',
      'codex',
      'Test',
      null,
      'plan',
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

  test('should list completed agents correctly', async () => {
    const running = new AgentProcess(
      'running-1',
      'task-1',
      'codex',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.RUNNING
    );
    const completed1 = new AgentProcess(
      'completed-1',
      'task-1',
      'codex',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.COMPLETED
    );
    const completed2 = new AgentProcess(
      'completed-2',
      'task-1',
      'codex',
      'Test',
      null,
      'plan',
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

  test('should stop nonexistent agent and return false', async () => {
    const success = await manager.stop('nonexistent');
    expect(success).toBe(false);
  });

  test('should stop already completed agent and return false', async () => {
    const agent = new AgentProcess(
      'completed-1',
      'task-1',
      'codex',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.COMPLETED
    );
    manager['agents'].set('completed-1', agent);

    const success = await manager.stop('completed-1');
    expect(success).toBe(false);
  });

  test('should list agents by task name', async () => {
    const agent1 = new AgentProcess(
      'agent-1',
      'task-a',
      'codex',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.RUNNING
    );
    const agent2 = new AgentProcess(
      'agent-2',
      'task-a',
      'gemini',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.RUNNING
    );
    const agent3 = new AgentProcess(
      'agent-3',
      'task-b',
      'codex',
      'Test',
      null,
      'plan',
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

  test('should stop all agents in a task', async () => {
    const agent1 = new AgentProcess(
      'agent-1',
      'task-stop',
      'codex',
      'Test',
      null,
      'plan',
      12345,
      AgentStatus.RUNNING
    );
    const agent2 = new AgentProcess(
      'agent-2',
      'task-stop',
      'gemini',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.COMPLETED
    );
    const agent3 = new AgentProcess(
      'agent-3',
      'other-task',
      'codex',
      'Test',
      null,
      'plan',
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
