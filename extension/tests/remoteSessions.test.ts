import { describe, test, expect } from 'bun:test';
import {
  normalizeActiveSessions,
  buildHostGroups,
  sessionIdFromFile,
} from '../src/core/remoteSessions';

// Real-shaped `agents sessions --active --json` output (one remote host).
const REMOTE_JSON = JSON.stringify([
  {
    context: 'terminal',
    kind: 'claude',
    host: 'tmux',
    pid: 632745,
    cwd: '/home/muqsit/src/github.com/muqsitnawaz',
    topic: 'Audit the rush product for linux gaps',
    sessionFile: '/home/muqsit/.claude/projects/-home-muqsit-src/42856d13-98f2-42d1-87c8-3662ecb4f7e5.jsonl',
    status: 'running',
  },
  {
    context: 'terminal',
    kind: 'CODEX',
    pid: 5,
    cwd: '/home/muqsit/x',
    status: 'idle',
    sessionFile: '/home/muqsit/.codex/sessions/2026/06/30/rollout-abc.jsonl',
  },
]);

describe('normalizeActiveSessions', () => {
  test('maps real CLI fields and tags the host', () => {
    const out = normalizeActiveSessions(REMOTE_JSON, 'yosemite-s0');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      host: 'yosemite-s0',
      agentType: 'claude',
      status: 'running',
      title: 'Audit the rush product for linux gaps',
      context: 'terminal',
      sessionId: '42856d13-98f2-42d1-87c8-3662ecb4f7e5',
    });
    // agentType is lowercased from CODEX; title falls back to cwd basename.
    expect(out[1].agentType).toBe('codex');
    expect(out[1].sessionId).toBe('rollout-abc');
  });

  test('tolerates SSH MOTD / shell noise around the JSON array', () => {
    const noisy = `Welcome to Ubuntu\nLast login: ...\n${REMOTE_JSON}\nlogout\n`;
    expect(normalizeActiveSessions(noisy, 'h')).toHaveLength(2);
  });

  test('returns [] on non-JSON or empty', () => {
    expect(normalizeActiveSessions('command not found', 'h')).toEqual([]);
    expect(normalizeActiveSessions('', 'h')).toEqual([]);
    expect(normalizeActiveSessions('{}', 'h')).toEqual([]); // not an array
  });
});

describe('sessionIdFromFile', () => {
  test('strips dir and extension', () => {
    expect(sessionIdFromFile('/a/b/c5c6e538.jsonl')).toBe('c5c6e538');
    expect(sessionIdFromFile(undefined)).toBeUndefined();
  });
});

describe('buildHostGroups', () => {
  test('preserves order, counts running, marks offline hosts with their error', () => {
    const groups = buildHostGroups([
      { host: 'yosemite-s0', ok: true, stdout: REMOTE_JSON },
      { host: 'win-mini', ok: false, error: 'no route to host' },
    ]);
    expect(groups.map((g) => g.host)).toEqual(['yosemite-s0', 'win-mini']);
    expect(groups[0]).toMatchObject({ online: true, running: 1 });
    expect(groups[0].sessions).toHaveLength(2);
    expect(groups[1]).toMatchObject({ online: false, running: 0, error: 'no route to host' });
    expect(groups[1].sessions).toEqual([]);
  });
});
