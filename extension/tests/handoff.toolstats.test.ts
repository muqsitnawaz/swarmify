import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { getCachedToolStats } from '../src/core/handoff';

const TMP_ROOT = path.join(__dirname, 'testdata', `handoff-toolstats-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

const STATS = (n: number) => ({ toolCalls: n, filesEdited: 0, filesRead: 0, recentFiles: [] });

describe('getCachedToolStats (mtime+size cache + in-flight guard)', () => {
  test('recomputes only when the session file changes', async () => {
    const file = path.join(TMP_ROOT, `${Date.now()}-a.jsonl`);
    fs.writeFileSync(file, 'line1\n');
    let calls = 0;
    const compute = () => { calls++; return Promise.resolve(STATS(calls)); };

    const first = await getCachedToolStats('sess-a', file, compute);
    expect(first.toolCalls).toBe(1);
    expect(calls).toBe(1);

    // Unchanged file -> served from cache, no recompute.
    const second = await getCachedToolStats('sess-a', file, compute);
    expect(second.toolCalls).toBe(1);
    expect(calls).toBe(1);

    // Mutate the file (size + mtime change) -> recompute.
    fs.appendFileSync(file, 'line2\n');
    const third = await getCachedToolStats('sess-a', file, compute);
    expect(third.toolCalls).toBe(2);
    expect(calls).toBe(2);
  });

  test('size change invalidates the cache even with mtime pinned back', async () => {
    const file = path.join(TMP_ROOT, `${Date.now()}-b.jsonl`);
    fs.writeFileSync(file, 'x\n');
    let calls = 0;
    const compute = () => { calls++; return Promise.resolve(STATS(calls)); };

    await getCachedToolStats('sess-b', file, compute);
    expect(calls).toBe(1);

    // Grow the file, then pin mtime back toward the original. fs mtime float
    // precision makes an exact-equal mtime unreliable, so the size component of
    // the key is what guarantees invalidation here.
    const original = fs.statSync(file);
    fs.writeFileSync(file, 'xxxxxxxxxx\n');
    fs.utimesSync(file, original.atime, original.mtime);

    await getCachedToolStats('sess-b', file, compute);
    expect(calls).toBe(2);
  });

  test('in-flight guard coalesces concurrent callers onto one compute', async () => {
    const file = path.join(TMP_ROOT, `${Date.now()}-c.jsonl`);
    fs.writeFileSync(file, 'c\n');
    let calls = 0;
    let release: (v: ReturnType<typeof STATS>) => void = () => {};
    let signalStarted: () => void = () => {};
    const started = new Promise<void>((r) => { signalStarted = r; });
    const compute = () => {
      calls++;
      signalStarted();
      return new Promise<ReturnType<typeof STATS>>((resolve) => { release = resolve; });
    };

    const p1 = getCachedToolStats('sess-c', file, compute);
    const p2 = getCachedToolStats('sess-c', file, compute);
    await started; // both callers have resolved the stat and attached
    release(STATS(42));
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(calls).toBe(1);
    expect(r1.toolCalls).toBe(42);
    expect(r2.toolCalls).toBe(42);
  });

  test('without a file path it always recomputes (no key to cache on)', async () => {
    let calls = 0;
    const compute = () => { calls++; return Promise.resolve(STATS(calls)); };
    await getCachedToolStats('sess-nofile', undefined, compute);
    await getCachedToolStats('sess-nofile', undefined, compute);
    expect(calls).toBe(2);
  });
});
