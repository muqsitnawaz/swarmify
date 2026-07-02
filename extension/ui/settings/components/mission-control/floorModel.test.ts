import { describe, test, expect } from 'bun:test'
import type { UnifiedTask } from '../../types'
import {
  derivePhase,
  deriveNeeds,
  deriveStalled,
  heartbeatLevel,
  latestTodos,
  todoProgress,
  parseStructuredQuestion,
  groupAgents,
  sortAgents,
  clusterByQuestion,
  sessionKey,
  toFloorTicket,
  groupTickets,
  sortTickets,
  PHASE_RANK,
  STALL_THRESHOLD_MS,
  type FloorAgent,
  type FloorPhase,
  type StructuredQuestion,
} from './floorModel'

function makeAgent(overrides: Partial<FloorAgent> = {}): FloorAgent {
  return {
    id: 'a1',
    host: 'this-mac',
    project: 'swarmify',
    name: 'auth-refactor',
    abbr: 'CC',
    phase: 'running',
    verb: 'Editing',
    target: 'src/core/tasks.ts',
    tok: 0,
    since: '2s',
    lastActivityMs: 0,
    files: 0,
    tools: 0,
    needs: false,
    pinned: false,
    pr: null,
    ticket: null,
    branch: 'feat-auth',
    resp: '',
    question: null,
    todos: [],
    ...overrides,
  }
}

function makeTask(overrides: Partial<UnifiedTask> = {}): UnifiedTask {
  return {
    id: 'raw-id',
    source: 'linear',
    title: 'Some ticket',
    status: 'todo',
    metadata: {},
    ...overrides,
  }
}

describe('derivePhase — precedence waiting > failed > running > done > idle', () => {
  test('waitingForInput wins over a failed status', () => {
    expect(
      derivePhase({ status: 'failed', waitingForInput: true, active: true, prOpenUnreviewed: false }),
    ).toBe('waiting')
  })

  test('failed wins over a running status', () => {
    expect(
      derivePhase({ status: 'failed', waitingForInput: false, active: true, prOpenUnreviewed: false }),
    ).toBe('failed')
  })

  test('running requires the process to be active', () => {
    expect(
      derivePhase({ status: 'running', waitingForInput: false, active: true, prOpenUnreviewed: false }),
    ).toBe('running')
  })

  test('a stale running (process gone) settles to idle', () => {
    expect(
      derivePhase({ status: 'running', waitingForInput: false, active: false, prOpenUnreviewed: false }),
    ).toBe('idle')
  })

  test('completed maps to done', () => {
    expect(
      derivePhase({ status: 'completed', waitingForInput: false, active: false, prOpenUnreviewed: true }),
    ).toBe('done')
  })

  test('stopped and idle both settle to idle', () => {
    expect(
      derivePhase({ status: 'stopped', waitingForInput: false, active: false, prOpenUnreviewed: false }),
    ).toBe('idle')
    expect(
      derivePhase({ status: 'idle', waitingForInput: false, active: true, prOpenUnreviewed: false }),
    ).toBe('idle')
  })
})

describe('deriveNeeds', () => {
  test('waiting and failed always need attention', () => {
    expect(deriveNeeds('waiting', false)).toBe(true)
    expect(deriveNeeds('failed', false)).toBe(true)
  })

  test('done needs attention only when its PR is unreviewed', () => {
    expect(deriveNeeds('done', true)).toBe(true)
    expect(deriveNeeds('done', false)).toBe(false)
  })

  test('running and idle never need attention', () => {
    expect(deriveNeeds('running', true)).toBe(false)
    expect(deriveNeeds('idle', true)).toBe(false)
  })

  test('a stalled agent needs attention', () => {
    expect(deriveNeeds('stalled', false)).toBe(true)
  })
})

describe('deriveStalled — a running agent gone quiet', () => {
  const now = 1_000_000_000_000

  test('running past the threshold is stalled; just under is not', () => {
    expect(deriveStalled(now - STALL_THRESHOLD_MS, 'running', now)).toBe(true)
    expect(deriveStalled(now - (STALL_THRESHOLD_MS - 1), 'running', now)).toBe(false)
  })

  test('an already-stalled agent that is still quiet stays stalled', () => {
    expect(deriveStalled(now - 5 * STALL_THRESHOLD_MS, 'stalled', now)).toBe(true)
  })

  test('waiting / failed / done / idle never become stalled', () => {
    const old = now - 10 * STALL_THRESHOLD_MS
    for (const phase of ['waiting', 'failed', 'done', 'idle'] as const) {
      expect(deriveStalled(old, phase, now)).toBe(false)
    }
  })

  test('unknown last-activity (0 or non-finite) never raises a false stall', () => {
    expect(deriveStalled(0, 'running', now)).toBe(false)
    expect(deriveStalled(Number.NaN, 'running', now)).toBe(false)
  })
})

describe('heartbeatLevel — live / stale / dead by silence age', () => {
  test('fresh is live, past 1x is stale (amber), past 2x is dead (red)', () => {
    expect(heartbeatLevel(0)).toBe('live')
    expect(heartbeatLevel(STALL_THRESHOLD_MS - 1)).toBe('live')
    expect(heartbeatLevel(STALL_THRESHOLD_MS)).toBe('stale')
    expect(heartbeatLevel(2 * STALL_THRESHOLD_MS - 1)).toBe('stale')
    expect(heartbeatLevel(2 * STALL_THRESHOLD_MS)).toBe('dead')
  })

  test('a non-finite age reads as live', () => {
    expect(heartbeatLevel(Number.NaN)).toBe('live')
  })
})

describe('parseStructuredQuestion — one kind per shape', () => {
  test('failed phase yields a retry, question mark or not', () => {
    const q = parseStructuredQuestion('bun test exited 1 — 2 tests fail. Stopping so you can look.', 'failed')
    expect(q).not.toBeNull()
    expect(q!.kind).toBe('retry')
    expect(q!.options).toEqual([])
    expect(q!.clusterKey).toBe('retry')
  })

  test('running chatter (no question) returns null', () => {
    expect(
      parseStructuredQuestion('Editing the incremental counter now; running the suite.', 'running'),
    ).toBeNull()
  })

  test('destructive keyword + question -> destructive with Confirm/Cancel', () => {
    const q = parseStructuredQuestion('This will DROP the legacy_tokens column on prod. Confirm?', 'waiting')
    expect(q!.kind).toBe('destructive')
    expect(q!.options).toEqual(['Confirm', 'Cancel'])
  })

  test('"X or Y?" -> choice with both alternatives extracted', () => {
    const q = parseStructuredQuestion('Token bucket per-user, or a sliding window?', 'waiting')
    expect(q!.kind).toBe('choice')
    expect(q!.options).toEqual(['Token bucket per-user', 'Sliding window'])
  })

  test('"X vs Y?" -> choice', () => {
    const q = parseStructuredQuestion('Postgres vs SQLite?', 'waiting')
    expect(q!.kind).toBe('choice')
    expect(q!.options).toEqual(['Postgres', 'SQLite'])
  })

  test('lettered options -> choice', () => {
    const q = parseStructuredQuestion('Which path: A) Rollback B) Fix forward?', 'waiting')
    expect(q!.kind).toBe('choice')
    expect(q!.options).toEqual(['Rollback', 'Fix forward'])
  })

  test('plain yes/no question -> confirm with Confirm/Hold', () => {
    const q = parseStructuredQuestion('Tests pass and the PR is green — merge it?', 'waiting')
    expect(q!.kind).toBe('confirm')
    expect(q!.options).toEqual(['Confirm', 'Hold'])
  })

  test('identical questions produce identical clusterKeys; different ones differ', () => {
    const a = parseStructuredQuestion('Token bucket per-user, or a sliding window?', 'waiting')!
    const b = parseStructuredQuestion('Token bucket per-user, or a sliding window?', 'waiting')!
    const c = parseStructuredQuestion('Tests pass and the PR is green — merge it?', 'waiting')!
    expect(a.clusterKey).toBe(b.clusterKey)
    expect(a.clusterKey).not.toBe(c.clusterKey)
    expect(a.clusterKey.length).toBeGreaterThan(0)
  })
})

describe('groupAgents', () => {
  const agents = [
    makeAgent({ id: 'a', host: 'this-mac', project: 'swarmify', abbr: 'CC', phase: 'running' }),
    makeAgent({ id: 'b', host: 'yosemite-s0', project: 'prix-api', abbr: 'CX', phase: 'waiting' }),
    makeAgent({ id: 'c', host: 'this-mac', project: 'prix-api', abbr: 'CC', phase: 'running' }),
  ]

  test('groups by host, preserving first-seen key order', () => {
    const g = groupAgents(agents, 'host')
    expect([...g.keys()]).toEqual(['this-mac', 'yosemite-s0'])
    expect(g.get('this-mac')!.map((a) => a.id)).toEqual(['a', 'c'])
  })

  test('groups by project / status / agent dimensions', () => {
    expect([...groupAgents(agents, 'project').keys()]).toEqual(['swarmify', 'prix-api'])
    expect([...groupAgents(agents, 'status').keys()]).toEqual(['running', 'waiting'])
    expect([...groupAgents(agents, 'agent').keys()]).toEqual(['CC', 'CX'])
  })
})

describe('sortAgents', () => {
  test("'needs' orders by PHASE_RANK (waiting < failed < stalled < running < done < idle)", () => {
    const agents = [
      makeAgent({ id: 'idle', phase: 'idle' }),
      makeAgent({ id: 'done', phase: 'done' }),
      makeAgent({ id: 'running', phase: 'running' }),
      makeAgent({ id: 'stalled', phase: 'stalled' }),
      makeAgent({ id: 'failed', phase: 'failed' }),
      makeAgent({ id: 'waiting', phase: 'waiting' }),
    ]
    const ordered = sortAgents(agents, 'needs').map((a) => a.id)
    expect(ordered).toEqual(['waiting', 'failed', 'stalled', 'running', 'done', 'idle'])
    const ranks = sortAgents(agents, 'needs').map((a) => PHASE_RANK[a.phase])
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y))
  })

  test("'tok' orders by throughput descending", () => {
    const agents = [makeAgent({ id: 'lo', tok: 10 }), makeAgent({ id: 'hi', tok: 200 }), makeAgent({ id: 'mid', tok: 90 })]
    expect(sortAgents(agents, 'tok').map((a) => a.id)).toEqual(['hi', 'mid', 'lo'])
  })

  test("'recent' orders by elapsed time ascending (freshest first)", () => {
    const agents = [makeAgent({ id: 'h', since: '3h' }), makeAgent({ id: 's', since: '2s' }), makeAgent({ id: 'm', since: '14m' })]
    expect(sortAgents(agents, 'recent').map((a) => a.id)).toEqual(['s', 'm', 'h'])
  })

  test("'name' orders alphabetically and does not mutate input", () => {
    const agents = [makeAgent({ id: '1', name: 'zeta' }), makeAgent({ id: '2', name: 'alpha' })]
    expect(sortAgents(agents, 'name').map((a) => a.name)).toEqual(['alpha', 'zeta'])
    expect(agents.map((a) => a.name)).toEqual(['zeta', 'alpha'])
  })
})

describe('clusterByQuestion', () => {
  function waitingAgent(id: string, clusterKey: string | null): FloorAgent {
    const question: StructuredQuestion | null = clusterKey
      ? { kind: 'choice', text: 'q', options: ['A', 'B'], clusterKey }
      : null
    return makeAgent({ id, phase: 'waiting', question })
  }

  test('collapses agents sharing a clusterKey into one card, keeps singletons as [agent]', () => {
    const waiting = [
      waitingAgent('a', 'ratelimit'),
      waitingAgent('b', 'ratelimit'),
      waitingAgent('c', 'mergegreen'),
    ]
    const clusters = clusterByQuestion(waiting)
    expect(clusters.length).toBe(2)
    expect(clusters[0].map((a) => a.id)).toEqual(['a', 'b'])
    expect(clusters[1].map((a) => a.id)).toEqual(['c'])
  })

  test('agents without a parsed question never batch together', () => {
    const clusters = clusterByQuestion([waitingAgent('x', null), waitingAgent('y', null)])
    expect(clusters.length).toBe(2)
    expect(clusters.every((c) => c.length === 1)).toBe(true)
  })
})

describe('sessionKey — one canonical identity across origins', () => {
  const uuid = '4a78949e-1111-2222-3333-444455556666'

  test('same session via local tab + local sweep collapse to one key', () => {
    const fromTab = sessionKey({ origin: 'local', host: 'this-mac', cliSessionUuid: uuid, terminalId: 'CC-1705-1' })
    const fromSweep = sessionKey({ origin: 'local', host: 'this-mac', cliSessionUuid: uuid })
    expect(fromTab).toBe(uuid)
    expect(fromSweep).toBe(uuid)
    expect(fromTab).toBe(fromSweep)
  })

  test('provisional key re-keys once the UUID appears', () => {
    const provisional = sessionKey({ origin: 'local', terminalId: 'CC-1705-1' })
    const resolved = sessionKey({ origin: 'local', cliSessionUuid: uuid, terminalId: 'CC-1705-1' })
    expect(provisional).toBe('provisional:CC-1705-1')
    expect(resolved).toBe(uuid)
    expect(provisional).not.toBe(resolved)
  })

  test('provisional falls back through terminal -> cloud -> agent id', () => {
    expect(sessionKey({ origin: 'cloud', cloudTaskId: 'task-abc' })).toBe('provisional:task-abc')
    expect(sessionKey({ origin: 'local', agentId: 'agent-xyz' })).toBe('provisional:agent-xyz')
    expect(sessionKey({ origin: 'local' })).toBe('provisional:unknown')
  })

  test('remote keys namespaced by host do not collide across hosts', () => {
    const onHostA = sessionKey({ origin: 'remote', host: 'yosemite-s0', cliSessionUuid: uuid })
    const onHostB = sessionKey({ origin: 'remote', host: 'zion-m1', cliSessionUuid: uuid })
    expect(onHostA).toBe(`yosemite-s0:${uuid}`)
    expect(onHostB).toBe(`zion-m1:${uuid}`)
    expect(onHostA).not.toBe(onHostB)
  })

  test('remote falls back to the session file stem when the UUID is unknown', () => {
    expect(sessionKey({ origin: 'remote', host: 'zion-m1', sessionFileStem: 'rollout-2024' })).toBe('zion-m1:rollout-2024')
  })

  test('a genuinely remote UUID does not collide with the same session seen locally', () => {
    const local = sessionKey({ origin: 'local', host: 'this-mac', cliSessionUuid: uuid })
    const remote = sessionKey({ origin: 'remote', host: 'yosemite-s0', cliSessionUuid: uuid })
    expect(local).not.toBe(remote)
  })
})

describe('toFloorTicket — field mapping', () => {
  test('medium priority remaps to med', () => {
    expect(toFloorTicket(makeTask({ priority: 'medium' })).pri).toBe('med')
  })

  test('missing priority defaults to med; urgent/high/low pass through', () => {
    expect(toFloorTicket(makeTask({ priority: undefined })).pri).toBe('med')
    expect(toFloorTicket(makeTask({ priority: 'urgent' })).pri).toBe('urgent')
    expect(toFloorTicket(makeTask({ priority: 'high' })).pri).toBe('high')
    expect(toFloorTicket(makeTask({ priority: 'low' })).pri).toBe('low')
  })

  test('source remaps linear->LN, github->GH', () => {
    expect(toFloorTicket(makeTask({ source: 'linear' })).source).toBe('LN')
    expect(toFloorTicket(makeTask({ source: 'github' })).source).toBe('GH')
  })

  test('status remaps in_progress->in-progress, done->done, else todo', () => {
    expect(toFloorTicket(makeTask({ status: 'in_progress' })).status).toBe('in-progress')
    expect(toFloorTicket(makeTask({ status: 'done' })).status).toBe('done')
    expect(toFloorTicket(makeTask({ status: 'todo' })).status).toBe('todo')
  })

  test('id prefers metadata.identifier, falls back to id; project from repo; labels/desc defaulted', () => {
    const withId = toFloorTicket(
      makeTask({ id: 'raw', metadata: { identifier: 'RUSH-812', repo: 'prix-api', labels: ['bug'] }, description: 'd' }),
    )
    expect(withId.id).toBe('RUSH-812')
    expect(withId.project).toBe('prix-api')
    expect(withId.labels).toEqual(['bug'])
    expect(withId.desc).toBe('d')

    const bare = toFloorTicket(makeTask({ id: 'raw', metadata: {} }))
    expect(bare.id).toBe('raw')
    expect(bare.project).toBe('')
    expect(bare.labels).toEqual([])
    expect(bare.desc).toBe('')
  })
})

describe('groupTickets / sortTickets', () => {
  const tickets = [
    toFloorTicket(makeTask({ id: 'RUSH-2', source: 'linear', priority: 'low', metadata: { repo: 'web' } })),
    toFloorTicket(makeTask({ id: '#1', source: 'github', priority: 'urgent', metadata: { repo: 'swarmify' } })),
    toFloorTicket(makeTask({ id: 'RUSH-3', source: 'linear', priority: 'high', metadata: { repo: 'web' } })),
  ]

  test('sortTickets by priority uses PRI_RANK', () => {
    expect(sortTickets(tickets, 'priority').map((t) => t.pri)).toEqual(['urgent', 'high', 'low'])
  })

  test('sortTickets by id uses localeCompare', () => {
    expect(sortTickets(tickets, 'id').map((t) => t.id)).toEqual(['#1', 'RUSH-2', 'RUSH-3'])
  })

  test('groupTickets by source renders human labels', () => {
    expect([...groupTickets(tickets, 'source').keys()].sort()).toEqual(['GitHub', 'Linear'])
  })

  test('groupTickets by project buckets by repo', () => {
    const g = groupTickets(tickets, 'project')
    expect(g.get('web')!.map((t) => t.id)).toEqual(['RUSH-2', 'RUSH-3'])
    expect(g.get('swarmify')!.map((t) => t.id)).toEqual(['#1'])
  })
})

describe('latestTodos -- the checklist from the newest TodoWrite', () => {
  const tw = (todos: unknown) => ({ name: 'TodoWrite', input: { todos } })

  test('reads the NEWEST TodoWrite, superseding earlier ones', () => {
    // recentToolCalls is NEWEST-FIRST (session.summary.ts unshifts each call), so the
    // most recent TodoWrite (the 3-item list) sits ahead of the older one-item list.
    const calls = [
      { name: 'Bash', input: { command: 'bun test' } },
      tw([
        { content: 'read code', status: 'completed' },
        { content: 'write code', status: 'in_progress' },
        { content: 'open PR', status: 'pending' },
      ]),
      { name: 'Edit', input: { file: 'a.ts' } },
      tw([{ content: 'first plan', status: 'completed' }]),
    ]
    expect(latestTodos(calls)).toEqual([
      { content: 'read code', status: 'completed' },
      { content: 'write code', status: 'in_progress' },
      { content: 'open PR', status: 'pending' },
    ])
  })

  test('returns [] when there is no TodoWrite', () => {
    expect(latestTodos([{ name: 'Edit', input: {} }, { name: 'Bash', input: {} }])).toEqual([])
  })

  test('returns [] for undefined / empty input', () => {
    expect(latestTodos(undefined)).toEqual([])
    expect(latestTodos([])).toEqual([])
  })

  test('falls back to activeForm for content and defaults unknown status to pending', () => {
    expect(latestTodos([tw([
      { activeForm: 'Migrating token store', status: 'weird' },
      { content: '', status: 'completed' },        // dropped: no content
      { content: 'ok', status: 'in_progress' },
    ])])).toEqual([
      { content: 'Migrating token store', status: 'pending' },
      { content: 'ok', status: 'in_progress' },
    ])
  })

  test('tolerates malformed todos payload', () => {
    expect(latestTodos([tw('not-an-array')])).toEqual([])
    expect(latestTodos([{ name: 'TodoWrite', input: null }])).toEqual([])
  })

  test('todoProgress tallies completed vs total', () => {
    expect(todoProgress([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
      { content: 'c', status: 'in_progress' },
      { content: 'd', status: 'pending' },
    ])).toEqual({ done: 2, total: 4 })
    expect(todoProgress([])).toEqual({ done: 0, total: 0 })
  })
})
