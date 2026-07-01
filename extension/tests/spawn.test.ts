import { describe, test, expect } from 'bun:test';
import { parseSpawnRequest } from '../src/core/spawn';

describe('parseSpawnRequest', () => {
  test('parses command, cwd, and a valid split (percent-decoded)', () => {
    const q = new URLSearchParams({
      cwd: '/Users/me/my project',
      command: 'claude --resume cad0e546',
      split: 'right',
    }).toString();
    expect(parseSpawnRequest(q)).toEqual({
      command: 'claude --resume cad0e546',
      cwd: '/Users/me/my project',
      split: 'right',
    });
  });

  test('returns null when no command (nothing to run)', () => {
    expect(parseSpawnRequest('cwd=%2Ftmp')).toBeNull();
    expect(parseSpawnRequest('command=%20%20')).toBeNull();
  });

  test('cwd is optional; omitted when absent', () => {
    const r = parseSpawnRequest('command=claude');
    expect(r).toEqual({ command: 'claude', cwd: undefined, split: undefined });
  });

  test('drops an unsupported split value rather than trusting it', () => {
    const r = parseSpawnRequest('command=claude&split=diagonal');
    expect(r?.split).toBeUndefined();
    expect(parseSpawnRequest('command=claude&split=down')?.split).toBe('down');
  });
});
