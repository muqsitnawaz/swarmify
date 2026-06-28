import { describe, test, expect } from 'bun:test';
import {
  parseLstart,
  captureProcessStartTime,
  pickNewestStartTime,
} from '../src/core/processStartTime';

describe('parseLstart', () => {
  test('parses a ps lstart string to epoch ms', () => {
    const ms = parseLstart('Sat Jun 28 11:02:13 2026');
    expect(ms).toBe(new Date('Sat Jun 28 11:02:13 2026').getTime());
  });

  test('returns undefined for unparseable input', () => {
    expect(parseLstart('not a date')).toBeUndefined();
    expect(parseLstart('')).toBeUndefined();
  });
});

describe('captureProcessStartTime (real ps subprocess)', () => {
  test('returns a plausible start time for this process', async () => {
    const start = await captureProcessStartTime(process.pid);
    expect(typeof start).toBe('number');
    // The test process started before now and within the last day.
    const now = Date.now();
    expect(start!).toBeLessThanOrEqual(now);
    expect(start!).toBeGreaterThan(now - 24 * 60 * 60 * 1000);
  });

  test('returns undefined for a non-existent pid', async () => {
    // PID 0 has no `ps` row on macOS/Linux for `-p 0`.
    const start = await captureProcessStartTime(2_147_483_646);
    expect(start).toBeUndefined();
  });
});

describe('pickNewestStartTime', () => {
  test('selects the item with the largest start time', () => {
    const a = { id: 'a', startTimeMs: 100 };
    const b = { id: 'b', startTimeMs: 300 };
    const c = { id: 'c', startTimeMs: 200 };
    expect(pickNewestStartTime([a, b, c])).toBe(b);
  });

  test('ignores items without a captured start time', () => {
    const a = { id: 'a', startTimeMs: undefined };
    const b = { id: 'b', startTimeMs: 50 };
    expect(pickNewestStartTime([a, b])).toBe(b);
  });

  test('returns undefined when no item has a start time', () => {
    expect(pickNewestStartTime([{ startTimeMs: undefined }, {}])).toBeUndefined();
    expect(pickNewestStartTime([])).toBeUndefined();
  });
});
