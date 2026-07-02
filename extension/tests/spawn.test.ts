import { describe, test, expect } from 'bun:test';
import { parseSpawnRequest } from '../src/core/spawn';

// Build a `p=<base64url(JSON)>` query the way the vscodium-agent engine backend does.
const q = (payload: unknown): string =>
  'p=' + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

describe('parseSpawnRequest', () => {
  test('parses command, cwd, and a valid split from the base64url payload', () => {
    expect(
      parseSpawnRequest(q({ command: 'claude --resume cad0e546', cwd: '/Users/me/my project', split: 'right' })),
    ).toEqual({
      command: 'claude --resume cad0e546',
      cwd: '/Users/me/my project',
      split: 'right',
    });
  });

  test('round-trips a command containing & and = (the bug base64url fixes)', () => {
    const r = parseSpawnRequest(q({ command: 'echo a && touch b=c', cwd: '/tmp' }));
    expect(r?.command).toBe('echo a && touch b=c');
    expect(r?.cwd).toBe('/tmp');
  });

  test('returns null when no p param, malformed base64, or empty command', () => {
    expect(parseSpawnRequest('cwd=%2Ftmp')).toBeNull();
    expect(parseSpawnRequest('p=@@not-base64-json@@')).toBeNull();
    expect(parseSpawnRequest(q({ command: '   ', cwd: '/tmp' }))).toBeNull();
  });

  test('cwd is optional; omitted when absent', () => {
    expect(parseSpawnRequest(q({ command: 'claude' }))).toEqual({
      command: 'claude',
      cwd: undefined,
      split: undefined,
    });
  });

  test('drops an unsupported split value rather than trusting it', () => {
    expect(parseSpawnRequest(q({ command: 'claude', split: 'diagonal' }))?.split).toBeUndefined();
    expect(parseSpawnRequest(q({ command: 'claude', split: 'down' }))?.split).toBe('down');
  });
});
