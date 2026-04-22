import { describe, test, expect } from 'bun:test'
import type { TaskSummary, TerminalDetail, AgentDetail } from '../../types'
import {
  isTerminalJustSpawned,
  isTerminalActive,
  reconcilePending,
  pruneExpiredPending,
  filterDispatchedTaskIds,
  optimisticActivityLabel,
  resolveReposFromLabels,
  PENDING_DISPATCH_TTL_MS,
  JUST_SPAWNED_WINDOW_MS,
  type PendingDispatch,
} from './dispatch'

const FIXED_NOW = 1_700_000_000_000

function makeTerminal(overrides: Partial<TerminalDetail> = {}): TerminalDetail {
  return {
    id: 'cl-1',
    agentType: 'claude',
    label: null,
    autoLabel: null,
    createdAt: FIXED_NOW,
    index: 1,
    sessionId: null,
    approvalStatus: 'pending',
    ...overrides,
  }
}

function makeAgent(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    agent_id: 'a1',
    agent_type: 'claude',
    status: 'running',
    duration: null,
    started_at: new Date(FIXED_NOW).toISOString(),
    completed_at: null,
    prompt: '',
    cwd: null,
    files_created: [],
    files_modified: [],
    files_deleted: [],
    bash_commands: [],
    last_messages: [],
    ...overrides,
  }
}

function makeTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    task_name: 'task',
    agent_count: 1,
    status_counts: { running: 1, completed: 0, failed: 0, stopped: 0 },
    latest_activity: new Date(FIXED_NOW).toISOString(),
    agents: [makeAgent()],
    ...overrides,
  }
}

function makePending(overrides: Partial<PendingDispatch> = {}): PendingDispatch {
  return {
    id: 'p-1',
    agentType: 'claude',
    target: 'local',
    taskId: 'rush-362',
    taskIdentifier: 'RUSH-362',
    title: 'Group-chat agent',
    createdAt: FIXED_NOW,
    ...overrides,
  }
}

describe('isTerminalJustSpawned', () => {
  test('true for terminal created this instant', () => {
    expect(isTerminalJustSpawned(FIXED_NOW, FIXED_NOW)).toBe(true)
  })

  test('true at 14s old', () => {
    expect(isTerminalJustSpawned(FIXED_NOW - 14_000, FIXED_NOW)).toBe(true)
  })

  test('false at 15s boundary (exclusive)', () => {
    expect(isTerminalJustSpawned(FIXED_NOW - JUST_SPAWNED_WINDOW_MS, FIXED_NOW)).toBe(false)
  })

  test('false for older terminal', () => {
    expect(isTerminalJustSpawned(FIXED_NOW - 60_000, FIXED_NOW)).toBe(false)
  })

  test('false for future createdAt (clock skew, treat as not spawned)', () => {
    expect(isTerminalJustSpawned(FIXED_NOW + 5_000, FIXED_NOW)).toBe(false)
  })

  test('false when createdAt is undefined', () => {
    expect(isTerminalJustSpawned(undefined, FIXED_NOW)).toBe(false)
  })

  test('false when createdAt is 0', () => {
    expect(isTerminalJustSpawned(0, FIXED_NOW)).toBe(false)
  })
})

describe('isTerminalActive', () => {
  test('just-spawned idle terminal is active (trust window)', () => {
    const t = makeTerminal({ status: 'idle', createdAt: FIXED_NOW - 5_000 })
    expect(isTerminalActive(t, FIXED_NOW)).toBe(true)
  })

  test('old idle terminal with no activity is not active', () => {
    const t = makeTerminal({ status: 'idle', createdAt: FIXED_NOW - 60_000, currentActivity: undefined })
    expect(isTerminalActive(t, FIXED_NOW)).toBe(false)
  })

  test('running terminal is active even when old', () => {
    const t = makeTerminal({ status: 'running', createdAt: FIXED_NOW - 60_000 })
    expect(isTerminalActive(t, FIXED_NOW)).toBe(true)
  })

  test('old terminal with currentActivity is active', () => {
    const t = makeTerminal({
      status: 'idle',
      createdAt: FIXED_NOW - 60_000,
      currentActivity: 'Reading auth.ts',
    })
    expect(isTerminalActive(t, FIXED_NOW)).toBe(true)
  })

  test('just-spawned terminal without status still active (regression: new terminal spawn)', () => {
    const t = makeTerminal({ status: undefined, createdAt: FIXED_NOW - 1_000 })
    expect(isTerminalActive(t, FIXED_NOW)).toBe(true)
  })
})

describe('reconcilePending', () => {
  test('empty pending list returned unchanged', () => {
    const out = reconcilePending([], [makeTerminal()], [makeTask()])
    expect(out).toEqual([])
  })

  test('local pending reconciled when matching terminal appears after dispatch', () => {
    const pending = [makePending({ createdAt: FIXED_NOW - 1_000 })]
    const terminals = [makeTerminal({ createdAt: FIXED_NOW })]
    const out = reconcilePending(pending, terminals, [])
    expect(out).toHaveLength(0)
  })

  test('local pending reconciled within slack window (terminal stamped slightly before dispatch)', () => {
    const pending = [makePending({ createdAt: FIXED_NOW })]
    const terminals = [makeTerminal({ createdAt: FIXED_NOW - 500 })]
    const out = reconcilePending(pending, terminals, [])
    expect(out).toHaveLength(0)
  })

  test('local pending NOT reconciled by older terminal outside slack', () => {
    const pending = [makePending({ createdAt: FIXED_NOW })]
    const terminals = [makeTerminal({ createdAt: FIXED_NOW - 5_000 })]
    const out = reconcilePending(pending, terminals, [])
    expect(out).toHaveLength(1)
  })

  test('local pending NOT reconciled by different agent type', () => {
    const pending = [makePending({ agentType: 'claude' })]
    const terminals = [makeTerminal({ agentType: 'codex', createdAt: FIXED_NOW })]
    const out = reconcilePending(pending, terminals, [])
    expect(out).toHaveLength(1)
  })

  test('cloud pending reconciled by matching swarm task agent', () => {
    const pending = [makePending({ target: 'cloud', createdAt: FIXED_NOW - 1_000 })]
    const task = makeTask({
      agents: [makeAgent({ started_at: new Date(FIXED_NOW).toISOString() })],
    })
    const out = reconcilePending(pending, [], [task])
    expect(out).toHaveLength(0)
  })

  test('cloud pending NOT reconciled by local terminal', () => {
    const pending = [makePending({ target: 'cloud' })]
    const terminals = [makeTerminal({ createdAt: FIXED_NOW })]
    const out = reconcilePending(pending, terminals, [])
    expect(out).toHaveLength(1)
  })

  test('multiple pending: only matching ones are consumed', () => {
    const p1 = makePending({ id: 'p-1', agentType: 'claude', createdAt: FIXED_NOW - 1_000 })
    const p2 = makePending({ id: 'p-2', agentType: 'codex', createdAt: FIXED_NOW - 1_000 })
    const terminals = [makeTerminal({ agentType: 'claude', createdAt: FIXED_NOW })]
    const out = reconcilePending([p1, p2], terminals, [])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('p-2')
  })

  test('returns same reference when nothing consumed (enables React bail-out)', () => {
    const pending = [makePending()]
    const out = reconcilePending(pending, [], [])
    expect(out).toBe(pending)
  })
})

describe('pruneExpiredPending', () => {
  test('keeps fresh entries', () => {
    const pending = [makePending({ createdAt: FIXED_NOW - 5_000 })]
    const out = pruneExpiredPending(pending, FIXED_NOW)
    expect(out).toHaveLength(1)
  })

  test('drops entries past TTL', () => {
    const pending = [makePending({ createdAt: FIXED_NOW - PENDING_DISPATCH_TTL_MS - 1 })]
    const out = pruneExpiredPending(pending, FIXED_NOW)
    expect(out).toHaveLength(0)
  })

  test('exact-TTL entry is dropped (inclusive boundary)', () => {
    const pending = [makePending({ createdAt: FIXED_NOW - PENDING_DISPATCH_TTL_MS })]
    const out = pruneExpiredPending(pending, FIXED_NOW)
    expect(out).toHaveLength(0)
  })

  test('mixed list keeps only fresh', () => {
    const fresh = makePending({ id: 'fresh', createdAt: FIXED_NOW - 10_000 })
    const stale = makePending({ id: 'stale', createdAt: FIXED_NOW - 60_000 })
    const out = pruneExpiredPending([fresh, stale], FIXED_NOW)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('fresh')
  })
})

describe('filterDispatchedTaskIds', () => {
  test('returns all tasks when pending set is empty', () => {
    const tasks = [{ id: 'a' }, { id: 'b' }]
    const out = filterDispatchedTaskIds(tasks, new Set())
    expect(out).toBe(tasks)
  })

  test('filters out dispatched task id', () => {
    const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const out = filterDispatchedTaskIds(tasks, new Set(['b']))
    expect(out.map((t) => t.id)).toEqual(['a', 'c'])
  })

  test('filters multiple', () => {
    const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const out = filterDispatchedTaskIds(tasks, new Set(['a', 'c']))
    expect(out.map((t) => t.id)).toEqual(['b'])
  })
})

describe('optimisticActivityLabel', () => {
  test('local uses "Starting..." prefix with identifier', () => {
    expect(optimisticActivityLabel(makePending({ taskIdentifier: 'RUSH-362' })))
      .toBe('Starting... (RUSH-362)')
  })

  test('cloud uses "Queuing on Rush Cloud..." prefix', () => {
    expect(
      optimisticActivityLabel(makePending({ target: 'cloud', taskIdentifier: 'RUSH-362' }))
    ).toBe('Queuing on Rush Cloud... (RUSH-362)')
  })

  test('falls back to title when no identifier', () => {
    const p = makePending({ taskIdentifier: '', title: 'Fix the login bug please' })
    expect(optimisticActivityLabel(p)).toBe('Starting... (Fix the login bug please)')
  })

  test('truncates long titles to 40 chars', () => {
    const p = makePending({
      taskIdentifier: '',
      title: 'x'.repeat(100),
    })
    const label = optimisticActivityLabel(p)
    const inner = label.slice('Starting... ('.length, -1)
    expect(inner).toHaveLength(40)
  })
})
