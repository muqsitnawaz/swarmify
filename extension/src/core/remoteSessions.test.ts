import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  mapStatusToPhase,
  projectFromCwd,
  normalizeActiveSession,
  normalizeActiveSessions,
  enrichWithSessionContent,
  groupByHost,
  type RemoteSession,
  type RawActiveSession,
} from './remoteSessions';

const TESTDATA = path.join(__dirname, 'testdata');
const ACTIVE = JSON.parse(
  fs.readFileSync(path.join(TESTDATA, 'active-sessions.json'), 'utf-8')
) as RawActiveSession[];

// Fixed fetch clock so sinceMs assertions are deterministic. Chosen just after
// the newest startedAtMs in the fixture.
const FETCHED_AT = 1782865920000;

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
