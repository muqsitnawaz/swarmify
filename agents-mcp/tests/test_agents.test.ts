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
  resolveEffortModelMap,
  resolveMode,
  computePathLCA,
} from '../src/agents.js';
import type { EffortLevel } from '../src/agents.js';

const TESTDATA_DIR = path.join(__dirname, 'testdata');

describe('computePathLCA', () => {
  test('returns null for empty array', () => {
    expect(computePathLCA([])).toBeNull();
  });

  test('returns the path itself for single path', () => {
    expect(computePathLCA(['/Users/test/project'])).toBe('/Users/test/project');
  });

  test('finds LCA for paths with common ancestor', () => {
    const paths = [
      '/Users/test/monorepo/packages/a',
      '/Users/test/monorepo/packages/b',
      '/Users/test/monorepo/packages/c',
    ];
    expect(computePathLCA(paths)).toBe('/Users/test/monorepo/packages');
  });

  test('finds LCA at root level for divergent paths', () => {
    const paths = [
      '/Users/test/project-a/src',
      '/Users/test/project-b/src',
    ];
    expect(computePathLCA(paths)).toBe('/Users/test');
  });

  test('returns null for paths with no common segments', () => {
    const paths = [
      '/home/user/project',
      '/var/log/app',
    ];
    // These paths have no common directory segments (home vs var)
    const lca = computePathLCA(paths);
    expect(lca).toBeNull();
  });

  test('handles nested paths correctly', () => {
    const paths = [
      '/a/b/c/d/e',
      '/a/b/c/d',
      '/a/b/c',
    ];
    expect(computePathLCA(paths)).toBe('/a/b/c');
  });

  test('filters out empty paths', () => {
    const paths = [
      '/Users/test/project',
      '',
      '  ',
      '/Users/test/project/src',
    ];
    expect(computePathLCA(paths)).toBe('/Users/test/project');
  });

  test('returns null when all paths are empty', () => {
    expect(computePathLCA(['', '  ', ''])).toBeNull();
  });
});

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

  test('uses stdout log mtime for completion when events lack timestamps', async () => {
    const baseDir = path.join(TESTDATA_DIR, `agent_process_${Date.now()}`);
    const agentId = 'agent-mtime';
    const agentDir = path.join(baseDir, agentId);
    const logPath = path.join(agentDir, 'stdout.log');
    const startedAt = new Date('2024-01-01T00:00:00Z');
    const logTime = new Date('2024-01-02T03:04:05Z');

    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(logPath, 'plain text line without json\n');
    await fs.utimes(logPath, logTime, logTime);

    const agent = new AgentProcess(
      agentId,
      'mtime-task',
      'codex',
      'Test prompt',
      null,
      'plan',
      999999,
      AgentStatus.RUNNING,
      startedAt,
      null,
      baseDir
    );

    try {
      await agent.updateStatusFromProcess();
      expect(agent.completedAt).not.toBeNull();
      const delta = Math.abs((agent.completedAt as Date).getTime() - logTime.getTime());
      expect(delta).toBeLessThan(1000);
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  test('persists parent_session_id in metadata', async () => {
    const baseDir = path.join(TESTDATA_DIR, `agent_meta_${Date.now()}`);
    const agent = new AgentProcess(
      'meta-1',
      'meta-task',
      'codex',
      'Test prompt',
      null,
      'plan',
      123,
      AgentStatus.RUNNING,
      new Date('2024-01-01T00:00:00Z'),
      null,
      baseDir,
      'session-xyz'
    );

    try {
      await agent.saveMeta();
      const metaPath = await agent.getMetaPath();
      const metaRaw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw);
      expect(meta.parent_session_id).toBe('session-xyz');
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  test('loads parent_session_id from disk', async () => {
    const baseDir = path.join(TESTDATA_DIR, `agent_meta_load_${Date.now()}`);
    const agent = new AgentProcess(
      'meta-2',
      'meta-task',
      'codex',
      'Test prompt',
      null,
      'plan',
      123,
      AgentStatus.RUNNING,
      new Date('2024-01-01T00:00:00Z'),
      null,
      baseDir,
      'session-abc'
    );

    try {
      await agent.saveMeta();
      const loaded = await AgentProcess.loadFromDisk(agent.agentId, baseDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.parentSessionId).toBe('session-abc');
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  test('stores null parent_session_id when missing', async () => {
    const baseDir = path.join(TESTDATA_DIR, `agent_meta_null_${Date.now()}`);
    const agent = new AgentProcess(
      'meta-3',
      'meta-task',
      'codex',
      'Test prompt',
      null,
      'plan',
      123,
      AgentStatus.RUNNING,
      new Date('2024-01-01T00:00:00Z'),
      null,
      baseDir,
      null
    );

    try {
      await agent.saveMeta();
      const metaPath = await agent.getMetaPath();
      const metaRaw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw);
      expect(meta.parent_session_id).toBeNull();
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  test('persists workspace_dir in metadata', async () => {
    const baseDir = path.join(TESTDATA_DIR, `agent_workspace_${Date.now()}`);
    const agent = new AgentProcess(
      'workspace-1',
      'workspace-task',
      'codex',
      'Test prompt',
      '/Users/test/monorepo/packages/a',
      'plan',
      123,
      AgentStatus.RUNNING,
      new Date('2024-01-01T00:00:00Z'),
      null,
      baseDir,
      null,
      '/Users/test/monorepo'
    );

    try {
      await agent.saveMeta();
      const metaPath = await agent.getMetaPath();
      const metaRaw = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaRaw);
      expect(meta.workspace_dir).toBe('/Users/test/monorepo');
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  test('loads workspace_dir from disk', async () => {
    const baseDir = path.join(TESTDATA_DIR, `agent_workspace_load_${Date.now()}`);
    const agent = new AgentProcess(
      'workspace-2',
      'workspace-task',
      'codex',
      'Test prompt',
      '/Users/test/project/src',
      'plan',
      123,
      AgentStatus.RUNNING,
      new Date('2024-01-01T00:00:00Z'),
      null,
      baseDir,
      null,
      '/Users/test/project'
    );

    try {
      await agent.saveMeta();
      const loaded = await AgentProcess.loadFromDisk(agent.agentId, baseDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.workspaceDir).toBe('/Users/test/project');
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  test('includes workspace_dir in toDict output', () => {
    const agent = new AgentProcess(
      'dict-test',
      'dict-task',
      'codex',
      'Test prompt',
      '/Users/test/project/src',
      'plan',
      null,
      AgentStatus.RUNNING,
      new Date('2024-01-01T00:00:00Z'),
      null,
      null,
      null,
      '/Users/test/project'
    );

    const result = agent.toDict();
    expect(result.workspace_dir).toBe('/Users/test/project');
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
    expect(EFFORT_MODEL_MAP.fast.codex).toBe('gpt-4o-mini');
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

describe('Effort Model Overrides', () => {
  test('should apply overrides for a specific agent and effort level', () => {
    const overrides = {
      codex: {
        fast: 'gpt-5.2-codex-mini',
      },
    };

    const resolved = resolveEffortModelMap(EFFORT_MODEL_MAP, overrides);

    expect(resolved.fast.codex).toBe('gpt-5.2-codex-mini');
    expect(resolved.default.codex).toBe('gpt-5.2-codex');
    expect(resolved.detailed.codex).toBe('gpt-5.1-codex-max');
  });

  test('should apply multiple level overrides for one agent', () => {
    const overrides = {
      claude: {
        fast: 'claude-haiku-custom',
        detailed: 'claude-opus-custom',
      },
    };

    const resolved = resolveEffortModelMap(EFFORT_MODEL_MAP, overrides);

    expect(resolved.fast.claude).toBe('claude-haiku-custom');
    expect(resolved.default.claude).toBe(EFFORT_MODEL_MAP.default.claude);
    expect(resolved.detailed.claude).toBe('claude-opus-custom');
  });

  test('should ignore empty model strings', () => {
    const overrides = {
      gemini: {
        fast: '',
      },
    };

    const resolved = resolveEffortModelMap(EFFORT_MODEL_MAP, overrides);

    expect(resolved.fast.gemini).toBe('gemini-3-flash-preview');
  });

  test('should ignore unknown agent types', () => {
    const overrides = {};

    const resolved = resolveEffortModelMap(EFFORT_MODEL_MAP, overrides);

    expect(resolved.fast.codex).toBe('gpt-4o-mini');
    expect(resolved.fast.gemini).toBe('gemini-3-flash-preview');
    expect(resolved.fast.claude).toBe('claude-haiku-4-5-20251001');
    expect(resolved.fast.cursor).toBe('composer-1');
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

  test('should list agents by parent session id', async () => {
    const agent1 = new AgentProcess(
      'agent-1',
      'task-a',
      'codex',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.RUNNING,
      new Date(),
      null,
      null,
      'session-1'
    );
    const agent2 = new AgentProcess(
      'agent-2',
      'task-b',
      'cursor',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.RUNNING,
      new Date(),
      null,
      null,
      'session-1'
    );
    const agent3 = new AgentProcess(
      'agent-3',
      'task-c',
      'gemini',
      'Test',
      null,
      'plan',
      null,
      AgentStatus.RUNNING,
      new Date(),
      null,
      null,
      'session-2'
    );

    manager['agents'].set('agent-1', agent1);
    manager['agents'].set('agent-2', agent2);
    manager['agents'].set('agent-3', agent3);

    const session1Agents = await manager.listByParentSession('session-1');
    expect(session1Agents.length).toBe(2);
    expect(session1Agents.every(a => a.parentSessionId === 'session-1')).toBe(true);

    const session2Agents = await manager.listByParentSession('session-2');
    expect(session2Agents.length).toBe(1);
    expect(session2Agents[0].agentId).toBe('agent-3');

    const missingAgents = await manager.listByParentSession('session-3');
    expect(missingAgents.length).toBe(0);
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
