import { test, expect } from 'bun:test';
import { buildForemanDigest, humanElapsed } from './foreman.digest';

test('empty floor', () => {
  const d = buildForemanDigest([]);
  expect(d.summary).toBe('floor is empty');
  expect(d.agents).toHaveLength(0);
  expect(d.concerns).toHaveLength(0);
});

test('single working claude', () => {
  const now = 1_700_000_000_000;
  const d = buildForemanDigest(
    [
      {
        name: 'Claude 12345678',
        label: 'auth refactor',
        sessionId: 'abc',
        startedAtMs: now - 12 * 60_000,
        lastActivityMs: now - 30_000,
      },
    ],
    now
  );
  expect(d.agents).toHaveLength(1);
  expect(d.agents[0].kind).toBe('claude');
  expect(d.agents[0].label).toBe('auth refactor');
  expect(d.agents[0].status).toBe('working');
  expect(d.agents[0].elapsed).toBe('12 min');
  expect(d.summary).toContain('claude');
});

test('two claudes rolls up to plural count', () => {
  const now = 1_700_000_000_000;
  const d = buildForemanDigest(
    [
      { name: 'Claude - auth', lastActivityMs: now - 5_000 },
      { name: 'Claude - api', lastActivityMs: now - 5_000 },
      { name: 'Codex - ui', lastActivityMs: now - 5_000 },
    ],
    now
  );
  expect(d.summary).toContain('2 claude');
  expect(d.summary).toContain('codex');
});

test('long idle agent becomes concern', () => {
  const now = 1_700_000_000_000;
  const d = buildForemanDigest(
    [
      {
        name: 'Gemini - staging',
        startedAtMs: now - 15 * 60_000,
        lastActivityMs: now - 5 * 60_000,
      },
    ],
    now
  );
  expect(d.agents[0].status).toBe('waiting');
  expect(d.concerns.length).toBeGreaterThan(0);
});

test('humanElapsed formatting', () => {
  expect(humanElapsed(5_000)).toBe('5s');
  expect(humanElapsed(90_000)).toBe('1 min');
  expect(humanElapsed(45 * 60_000)).toBe('45 min');
  expect(humanElapsed(60 * 60_000)).toBe('1h');
  expect(humanElapsed(75 * 60_000)).toBe('1h 15m');
});

test('non-agent terminals are ignored', () => {
  const d = buildForemanDigest([{ name: 'zsh' }, { name: 'bash' }]);
  expect(d.agents).toHaveLength(0);
});
