import { describe, test, expect } from 'bun:test'
import {
  abbrFor,
  splitActivity,
  deriveProject,
  sinceFromMs,
  floorPrLabel,
  toFloorAgentFromUnified,
  toFloorAgentFromRemote,
  adaptTickets,
  type UnifiedAgentLike,
  type RemoteSessionLike,
} from './floorAdapter'
import type { UnifiedTask } from '../../types'

const NOW = 1_700_000_000_000

describe('abbrFor', () => {
  test('maps known agent types to their tab prefix', () => {
    expect(abbrFor('claude')).toBe('CC')
    expect(abbrFor('Codex')).toBe('CX')
    expect(abbrFor('gemini')).toBe('GX')
    expect(abbrFor('cursor')).toBe('CR')
    expect(abbrFor('opencode')).toBe('OC')
  })
  test('unknown types fall back to Shell', () => {
    expect(abbrFor('mystery')).toBe('SH')
    expect(abbrFor('')).toBe('SH')
  })
})

describe('splitActivity', () => {
  test('a shell command reads as Running <cmd>', () => {
    expect(splitActivity('$ bun test core/')).toEqual({ verb: 'Running', target: 'bun test core/' })
  })
  test('first word is the verb, the rest the target', () => {
    expect(splitActivity('Editing src/core/tasks.ts')).toEqual({ verb: 'Editing', target: 'src/core/tasks.ts' })
  })
  test('a lone word is all verb, no target', () => {
    expect(splitActivity('idle')).toEqual({ verb: 'idle', target: '' })
  })
  test('empty stays empty', () => {
    expect(splitActivity('')).toEqual({ verb: '', target: '' })
  })
})

describe('deriveProject', () => {
  test('a repo name always wins', () => {
    expect(deriveProject('/anything/here', 'swarmify', 'fallback')).toBe('swarmify')
  })
  test('folds a worktree path back to its repo', () => {
    expect(deriveProject('/Users/x/src/github.com/o/swarmify/.agents/worktrees/floor-port', null, 'fb')).toBe('swarmify')
  })
  test('plain cwd uses the last path segment', () => {
    expect(deriveProject('/Users/x/src/github.com/o/prix-api', null, 'fb')).toBe('prix-api')
  })
  test('no cwd and no repo uses the fallback', () => {
    expect(deriveProject(null, null, 'fb')).toBe('fb')
  })
})

describe('sinceFromMs', () => {
  test('renders human units and rejects negatives', () => {
    expect(sinceFromMs(5_000)).toBe('5s')
    expect(sinceFromMs(90_000)).toBe('1m')
    expect(sinceFromMs(3 * 3600_000)).toBe('3h')
    expect(sinceFromMs(2 * 86_400_000)).toBe('2d')
    expect(sinceFromMs(-1)).toBe('')
  })
})

describe('floorPrLabel', () => {
  test('extracts the PR number from a github url', () => {
    expect(floorPrLabel('https://github.com/o/r/pull/142')).toBe('#142')
  })
  test('accepts a bare #number', () => {
    expect(floorPrLabel('#412')).toBe('#412')
  })
  test('null in, null out', () => {
    expect(floorPrLabel(null)).toBeNull()
    expect(floorPrLabel(undefined)).toBeNull()
  })
})

function baseUnified(over: Partial<UnifiedAgentLike>): UnifiedAgentLike {
  return {
    id: 'term-1',
    agentType: 'claude',
    displayName: 'auth-refactor',
    activity: 'Editing src/auth.ts',
    active: true,
    timestamp: new Date(NOW - 5000).toISOString(),
    status: 'running',
    files: ['a.ts', 'b.ts'],
    toolCalls: 7,
    ...over,
  }
}

describe('toFloorAgentFromUnified', () => {
  test('a terminal awaiting input becomes a waiting, needs-you agent with a parsed question', () => {
    const a = toFloorAgentFromUnified(
      baseUnified({
        activity: 'idle',
        status: 'idle',
        active: false,
        terminal: { id: 't1', waitingForInput: true },
        agent: null,
        // last response is a real choice question
      }),
      { pinned: new Set(), workspaceRepo: 'swarmify', nowMs: NOW },
    )
    // no agent.last_messages, so resp falls back to activity 'idle' -> not a question,
    // but phase is waiting from the flag; needs is still true.
    expect(a.phase).toBe('waiting')
    expect(a.needs).toBe(true)
    expect(a.host).toBe('this-mac')
    expect(a.abbr).toBe('CC')
  })

  test('a failed agent needs you and gets a retry question', () => {
    const a = toFloorAgentFromUnified(
      baseUnified({ status: 'failed', active: false, activity: 'build broke' }),
      { pinned: new Set(), workspaceRepo: null, nowMs: NOW },
    )
    expect(a.phase).toBe('failed')
    expect(a.needs).toBe(true)
    expect(a.question?.kind).toBe('retry')
  })

  test('a running agent does not need you', () => {
    const a = toFloorAgentFromUnified(baseUnified({}), { pinned: new Set(), workspaceRepo: null, nowMs: NOW })
    expect(a.phase).toBe('running')
    expect(a.needs).toBe(false)
    expect(a.files).toBe(2)
    expect(a.tools).toBe(7)
  })

  test('a completed agent with an open PR is done + unreviewed (needs you)', () => {
    const a = toFloorAgentFromUnified(
      baseUnified({ status: 'completed', active: false, prUrl: 'https://github.com/o/r/pull/9' }),
      { pinned: new Set(['term-1']), workspaceRepo: null, nowMs: NOW },
    )
    expect(a.phase).toBe('done')
    expect(a.needs).toBe(true)
    expect(a.pr).toBe('#9')
    expect(a.pinned).toBe(true)
  })

  test('a headless agent parses its last message into a structured choice question', () => {
    const a = toFloorAgentFromUnified(
      baseUnified({
        id: 'agent-x',
        activity: 'working',
        status: 'idle',
        active: false,
        terminal: null,
        agent: {
          status: 'input_required',
          repo_name: 'prix-api',
          branch: 'feat-rl',
          last_messages: ['Token bucket per-user, or a sliding window?'],
        },
      }),
      { pinned: new Set(), workspaceRepo: null, nowMs: NOW },
    )
    expect(a.phase).toBe('waiting')
    expect(a.project).toBe('prix-api')
    expect(a.branch).toBe('feat-rl')
    expect(a.question?.kind).toBe('choice')
    expect(a.question?.options.length).toBeGreaterThanOrEqual(2)
  })
})

describe('toFloorAgentFromRemote', () => {
  test('carries the remote host and normalized fields through', () => {
    const r: RemoteSessionLike = {
      host: 'yosemite-s0',
      sessionId: 'abcd1234efgh',
      agentType: 'codex',
      cwd: '/home/u/src/prix-api',
      project: 'prix-api',
      phase: 'waiting',
      activity: 'Running cargo build',
      tokPerSec: 88,
      waitingForInput: true,
      lastResponse: 'Merge the green PR?',
      prUrl: 'https://github.com/o/r/pull/50',
      ticket: 'RUSH-812',
      branch: 'feat-x',
      sinceMs: 42_000,
      startedAtMs: NOW - 42_000,
    }
    const a = toFloorAgentFromRemote(r, new Set())
    expect(a.host).toBe('yosemite-s0')
    expect(a.id).toBe('remote-yosemite-s0-abcd1234efgh')
    expect(a.abbr).toBe('CX')
    expect(a.tok).toBe(88)
    expect(a.since).toBe('42s')
    expect(a.needs).toBe(true)
    expect(a.pr).toBe('#50')
    expect(a.ticket).toBe('RUSH-812')
    expect(a.question?.kind).toBe('confirm')
  })
})

describe('adaptTickets', () => {
  test('maps UnifiedTask fields onto FloorTicket', () => {
    const tasks: UnifiedTask[] = [
      {
        id: 'lin-1',
        source: 'linear',
        title: 'Fix the thing',
        description: 'details',
        status: 'in_progress',
        priority: 'high',
        metadata: { identifier: 'RUSH-1', repo: 'swarmify', labels: ['bug'] },
      },
    ]
    const [t] = adaptTickets(tasks)
    expect(t.id).toBe('RUSH-1')
    expect(t.source).toBe('LN')
    expect(t.pri).toBe('high')
    expect(t.status).toBe('in-progress')
    expect(t.project).toBe('swarmify')
    expect(t.labels).toEqual(['bug'])
  })
})
