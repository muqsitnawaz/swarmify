import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  mapStatusToPhase,
  normalizeHost,
  projectFromCwd,
  resolveProject,
  normalizeActiveSession,
  normalizeActiveSessions,
  dedupeSessions,
  enrichWithSessionContent,
  groupByHost,
  type RemoteSession,
  type RawActiveSession,
  type ProjectRule,
} from './remoteSessions';

const TESTDATA = path.join(__dirname, 'testdata');
const ACTIVE = JSON.parse(
  fs.readFileSync(path.join(TESTDATA, 'active-sessions.json'), 'utf-8')
) as RawActiveSession[];

// Fixed fetch clock so sinceMs assertions are deterministic. Chosen just after
// the newest startedAtMs in the fixture.
const FETCHED_AT = 1782865920000;

describe('normalizeHost', () => {
  test('collapses FQDN, case, and separators to the agents-cli device label', () => {
    // Matches an `agents devices` registry name for the local machine so the
    // HOSTS sidebar folds this-mac into it instead of double-listing.
    expect(normalizeHost('zion')).toBe('zion');
    expect(normalizeHost('zion.local')).toBe('zion');
    expect(normalizeHost('ZION')).toBe('zion');
    expect(normalizeHost('zion.tail1a85a1.ts.net')).toBe('zion');
    expect(normalizeHost("Muqsit's Mac mini")).toBe('muqsit-s-mac-mini');
    expect(normalizeHost('')).toBe('');
  });
});

describe('mapStatusToPhase', () => {
  test('maps the real CLI status values', () => {
    expect(mapStatusToPhase('running')).toBe('running');
    expect(mapStatusToPhase('queued')).toBe('running');
    expect(mapStatusToPhase('input_required')).toBe('waiting');
    expect(mapStatusToPhase('failed')).toBe('failed');
    expect(mapStatusToPhase('completed')).toBe('done');
    expect(mapStatusToPhase('idle')).toBe('idle');
    expect(mapStatusToPhase(undefined)).toBe('idle');
    expect(mapStatusToPhase('nonsense')).toBe('idle');
  });
});

describe('projectFromCwd', () => {
  test('folds a worktree path to its repo', () => {
    expect(
      projectFromCwd('/Users/muqsit/src/github.com/muqsitnawaz/swarmify/.agents/worktrees/factory-floor-port')
    ).toBe('swarmify');
  });
  test('uses the basename for a plain repo path', () => {
    expect(projectFromCwd('/Users/muqsit/src/github.com/muqsitnawaz/agents')).toBe('agents');
  });
  test('tolerates trailing slashes and empty input', () => {
    expect(projectFromCwd('/a/b/repo/')).toBe('repo');
    expect(projectFromCwd('')).toBe('');
  });
});

describe('resolveProject', () => {
  const RULES: ProjectRule[] = [
    { pattern: '**/agents/prix/api', project: 'Prix API' },
    { pattern: '**/agents/prix/app', project: 'Prix App' },
    { pattern: '/home/muqsit/src/monorepo', project: 'Monorepo Root' },
  ];

  test('a user rule wins over every default (glob match, first match wins)', () => {
    // Both prix rules could conceptually apply to a deep path; the FIRST listed wins.
    expect(resolveProject('/home/muqsit/src/github.com/o/agents/prix/api', RULES)).toBe('Prix API');
    expect(resolveProject('/home/muqsit/src/github.com/o/agents/prix/app', RULES)).toBe('Prix App');
  });

  test('a glob rule also captures work inside the matched directory', () => {
    expect(resolveProject('/x/y/agents/prix/api/src/routes', RULES)).toBe('Prix API');
  });

  test('a path-prefix rule (no glob) matches the dir and its descendants', () => {
    expect(resolveProject('/home/muqsit/src/monorepo', RULES)).toBe('Monorepo Root');
    expect(resolveProject('/home/muqsit/src/monorepo/packages/api', RULES)).toBe('Monorepo Root');
    // A sibling that only shares a prefix string but not a path boundary must NOT match.
    expect(resolveProject('/home/muqsit/src/monorepo-two', RULES)).toBe('monorepo-two');
  });

  test('rules take precedence over the git-repo-root default', () => {
    expect(
      resolveProject('/home/muqsit/src/github.com/o/agents/prix/api', RULES, '/home/muqsit/src/github.com/o/agents')
    ).toBe('Prix API');
  });

  test('a monorepo subdir with no rule folds to its git repo root basename', () => {
    // Without a rule, the leaf-dir default would say "api"; repoRoot folds it to the repo.
    expect(resolveProject('/home/muqsit/src/github.com/o/agents/prix/api', [], '/home/muqsit/src/github.com/o/agents')).toBe('agents');
  });

  test('worktree folding beats the git-repo-root default', () => {
    // A git worktree root basename is the slug; the path fold must win and yield the repo.
    expect(
      resolveProject(
        '/Users/muqsit/src/github.com/muqsitnawaz/swarmify/.agents/worktrees/floor-port',
        [],
        '/Users/muqsit/src/github.com/muqsitnawaz/swarmify/.agents/worktrees/floor-port'
      )
    ).toBe('swarmify');
  });

  test('with no rules and no repoRoot it is the legacy last-segment behavior', () => {
    expect(resolveProject('/home/muqsit/src/github.com/o/prix-api')).toBe('prix-api');
    expect(resolveProject('')).toBe('');
  });

  test('normalizeActiveSession applies the rules to the session project', () => {
    const s = normalizeActiveSession(
      { kind: 'claude', status: 'running', cwd: '/x/y/agents/prix/api', sessionFile: '/x/aaaaaaaa.jsonl' } as RawActiveSession,
      'zion',
      FETCHED_AT,
      RULES
    );
    expect(s.project).toBe('Prix API');
  });
});

describe('normalizeActiveSession', () => {
  test('uses the queried host, not the payload host field', () => {
    // The terminal record carries host:"ghostty" (the emulator). Identity must
    // come from the machine we queried.
    const terminal = ACTIVE.find((r) => r.context === 'terminal')!;
    const s = normalizeActiveSession(terminal, 'mac-mini', FETCHED_AT);
    expect(s.host).toBe('mac-mini');
    expect(s.agentType).toBe('codex');
  });

  test('input_required becomes waiting + waitingForInput', () => {
    const terminal = ACTIVE.find((r) => r.status === 'input_required')!;
    const s = normalizeActiveSession(terminal, 'this-mac', FETCHED_AT);
    expect(s.phase).toBe('waiting');
    expect(s.waitingForInput).toBe(true);
  });

  test('derives sessionId from the session file when absent', () => {
    const terminal = ACTIVE.find((r) => r.context === 'terminal')!;
    expect(terminal.sessionId).toBeUndefined();
    const s = normalizeActiveSession(terminal, 'this-mac', FETCHED_AT);
    expect(s.sessionId).toBe('d71b62ce-01d1-40ae-af9d-8ed34275234b');
  });

  test('falls back to cloudTaskId for cloud records with no sessionId/file', () => {
    const cloud = ACTIVE.find((r) => r.context === 'cloud' && r.status === 'queued')!;
    const s = normalizeActiveSession(cloud, 'cloud', FETCHED_AT);
    expect(s.sessionId).toBe('task_e');
    expect(s.phase).toBe('running');
  });

  test('carries cloud task id + provider + context through for the reply channel', () => {
    const cloud = ACTIVE.find((r) => r.context === 'cloud' && r.status === 'queued')!;
    const s = normalizeActiveSession(cloud, 'cloud', FETCHED_AT);
    expect(s.context).toBe('cloud');
    expect(s.cloudTaskId).toBe('task_e');
    expect(s.cloudProvider).toBe(cloud.cloudProvider ?? '');
  });

  test('carries pid for terminal records (0 when absent)', () => {
    const terminal = ACTIVE.find((r) => r.context === 'terminal')!;
    const s = normalizeActiveSession(terminal, 'this-mac', FETCHED_AT);
    expect(s.pid).toBe(typeof terminal.pid === 'number' ? terminal.pid : 0);
    expect(s.teamName).toBe(terminal.teamName ?? '');
  });

  test('captures the tmux reply rail (socket + pane) from provenance', () => {
    const s = normalizeActiveSession(
      { context: 'terminal', kind: 'claude', sessionId: 'abc', status: 'running',
        provenance: { transport: 'ssh', reply: { rail: 'tmux', target: '%65', socket: '/tmp/tmux-1000/default' } } },
      'yosemite-s0', FETCHED_AT,
    );
    expect(s.transport).toBe('ssh');
    expect(s.replyRail).toBe('tmux');
    expect(s.replyMuxTarget).toBe('%65');
    expect(s.replyMuxSocket).toBe('/tmp/tmux-1000/default');
  });

  test('a raw TTY with reply=null carries no rail', () => {
    const s = normalizeActiveSession(
      { context: 'terminal', kind: 'claude', sessionId: 'ghost', status: 'running',
        provenance: { transport: 'local', reply: null } },
      'this-mac', FETCHED_AT,
    );
    expect(s.replyRail).toBe('');
    expect(s.replyMuxTarget).toBe('');
  });

  test('extracts a ticket id from label/topic', () => {
    const backend = ACTIVE.find((r) => r.label === 'backend')!;
    const s = normalizeActiveSession(backend, 'this-mac', FETCHED_AT);
    expect(s.ticket).toBe('RUSH-812');
  });

  test('computes skew-free elapsed from the fetch clock', () => {
    const backend = ACTIVE.find((r) => r.label === 'backend')!;
    const s = normalizeActiveSession(backend, 'this-mac', FETCHED_AT);
    expect(s.sinceMs).toBe(FETCHED_AT - 1782865917676);
    expect(s.startedAtMs).toBe(1782865917676);
  });
});

describe('normalizeActiveSessions', () => {
  test('parses the whole fixture (string or array) to one record each', () => {
    const fromArray = normalizeActiveSessions(ACTIVE, 'this-mac', FETCHED_AT);
    const fromString = normalizeActiveSessions(
      JSON.stringify(ACTIVE),
      'this-mac',
      FETCHED_AT
    );
    expect(fromArray.length).toBe(ACTIVE.length);
    expect(fromString.length).toBe(ACTIVE.length);
    expect(fromString[0].sessionId).toBe(fromArray[0].sessionId);
  });

  test('malformed payload yields [] rather than throwing', () => {
    expect(normalizeActiveSessions('not json', 'h', FETCHED_AT)).toEqual([]);
    expect(normalizeActiveSessions('{"not":"an array"}', 'h', FETCHED_AT)).toEqual([]);
    expect(normalizeActiveSessions([null as unknown as object, 42 as unknown as object], 'h', FETCHED_AT)).toEqual([]);
  });
});

describe('enrichWithSessionContent', () => {
  const now = Date.parse('2026-06-30T12:00:30.000Z');
  const base: RemoteSession = {
    host: 'this-mac',
    sessionId: 'x',
    agentType: 'claude',
    cwd: '/repo',
    project: 'repo',
    phase: 'running',
    activity: '',
    tokPerSec: 0,
    waitingForInput: false,
    lastResponse: '',
    prUrl: null,
    ticket: null,
    branch: '',
    sinceMs: 0,
    startedAtMs: 0,
  };

  test('derives activity + throughput from real Claude JSONL', () => {
    const content = fs.readFileSync(path.join(TESTDATA, 'claude-session.jsonl'), 'utf-8');
    const s = enrichWithSessionContent(base, content, now);
    expect(s.activity).toBe('bun test');
    expect(s.tokPerSec).toBe(3); // (120 + 80) / 60 rounded
    expect(s.waitingForInput).toBe(false);
    expect(s.phase).toBe('running');
  });

  test('promotes a trailing question to waiting', () => {
    const content = fs.readFileSync(path.join(TESTDATA, 'claude-waiting.jsonl'), 'utf-8');
    const s = enrichWithSessionContent(base, content, now);
    expect(s.waitingForInput).toBe(true);
    expect(s.phase).toBe('waiting');
  });

  test('leaves non-parsable agent types untouched', () => {
    const cursor = { ...base, agentType: 'cursor' };
    const s = enrichWithSessionContent(cursor, 'irrelevant', now);
    expect(s).toEqual(cursor);
  });
});

describe('groupByHost', () => {
  test('keeps offline hosts as empty groups and folds sessions in', () => {
    const sessions = normalizeActiveSessions(ACTIVE, 'this-mac', FETCHED_AT);
    const groups = groupByHost(
      sessions,
      [
        { name: 'this-mac', online: true },
        { name: 'mac-mini', online: false },
      ],
      FETCHED_AT
    );
    const local = groups.find((g) => g.host === 'this-mac')!;
    const remote = groups.find((g) => g.host === 'mac-mini')!;
    expect(local.online).toBe(true);
    expect(local.sessions.length).toBe(ACTIVE.length);
    expect(local.fetchedAt).toBe(FETCHED_AT);
    expect(remote.online).toBe(false);
    expect(remote.sessions).toEqual([]);
  });

  test('surfaces sessions from a host missing from the roster', () => {
    const orphan = normalizeActiveSessions(ACTIVE, 'rogue-host', FETCHED_AT);
    const groups = groupByHost(orphan, [{ name: 'this-mac', online: true }], FETCHED_AT);
    expect(groups.find((g) => g.host === 'rogue-host')?.sessions.length).toBe(ACTIVE.length);
  });
});

describe('normalizeActiveSession — topic', () => {
  test('carries the topic (or falls back to the cloud label) so remote cards are not blank', () => {
    const term = normalizeActiveSession(
      { kind: 'claude', status: 'running', sessionFile: '/x/aaaaaaaa.jsonl', topic: 'Add a pre-commit hook' } as RawActiveSession,
      'zion',
      FETCHED_AT
    );
    expect(term.topic).toBe('Add a pre-commit hook');
    const cloud = normalizeActiveSession(
      { kind: 'codex', status: 'queued', cloudTaskId: 'task_e', label: 'Read README and summarize' } as RawActiveSession,
      'this-mac',
      FETCHED_AT
    );
    expect(cloud.topic).toBe('Read README and summarize');
  });
});

describe('dedupeSessions', () => {
  // Real-world: `agents sessions --active` reports one record per live process,
  // but many processes (shell, node, agent binary, extra tabs) share one session
  // file. Nine pids resolving to one session must collapse to one card, or the
  // header count and the feed diverge.
  const many = (sessionFile: string, statuses: string[]): RemoteSession[] =>
    statuses.map((status) =>
      normalizeActiveSession(
        { kind: 'claude', status, sessionFile, topic: 'shared session' } as RawActiveSession,
        'zion',
        FETCHED_AT
      )
    );

  test('collapses processes that share one session file into a single session', () => {
    const sessions = many('/x/24d7304d.jsonl', ['running', 'running', 'running', 'running']);
    const unique = dedupeSessions(sessions);
    expect(unique.length).toBe(1);
    expect(unique[0].sessionId).toBe('24d7304d');
  });

  test('keeps the most attention-worthy phase (waiting beats running)', () => {
    const sessions = many('/x/24d7304d.jsonl', ['running', 'running', 'input_required', 'running']);
    const unique = dedupeSessions(sessions);
    expect(unique.length).toBe(1);
    expect(unique[0].phase).toBe('waiting');
  });

  test('does not merge distinct sessions, and passes through records with no id', () => {
    const a = many('/x/aaaaaaaa.jsonl', ['running']);
    const b = many('/x/bbbbbbbb.jsonl', ['running', 'idle']);
    const noId = normalizeActiveSession({ kind: 'claude', status: 'running' } as RawActiveSession, 'zion', FETCHED_AT);
    expect(noId.sessionId).toBe('');
    const unique = dedupeSessions([...a, ...b, noId]);
    // 2 distinct session files collapse to 2; the id-less record is kept as-is.
    expect(unique.length).toBe(3);
  });
});
