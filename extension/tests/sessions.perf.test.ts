// Performance regression guards for getSessionPreviewInfo.
//
// These exist because the function used to do `fs.readFile(filePath, 'utf-8')`
// three times in parallel inside Promise.all — which on a 500MB active Claude
// session spiked VSCode's extension host RSS by 1-2GB per call, and the call
// fired on every tab change, focus change, and per-terminal 5-minute poller.
//
// Each test here catches one class of regression:
//   1. Someone reverts to full fs.readFile   -> spy test
//   2. Someone removes the LRU cache         -> warm-latency test
//   3. Streaming reads regress to buffering  -> RSS-on-large-file test
//   4. Cache-miss path retains buffers       -> burst RSS test

import { describe, test, expect, beforeAll, afterAll, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { getSessionPreviewInfo } from '../src/vscode/sessions.vscode';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-perf-'));
const SMALL_FILE = path.join(TMP_DIR, 'small.jsonl');
const BIG_FILE = path.join(TMP_DIR, 'big.jsonl');

// Realistic Claude JSONL line (~500 bytes). Keep each test file as append-only
// writes so peak memory during setup stays low.
function writeSessionFile(target: string, sizeBytes: number): void {
  const line =
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'hello world ' + 'x'.repeat(400) },
      timestamp: new Date().toISOString(),
    }) + '\n';
  const lineBytes = Buffer.byteLength(line);
  const count = Math.ceil(sizeBytes / lineBytes);
  const fd = fs.openSync(target, 'w');
  try {
    for (let i = 0; i < count; i++) fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
}

function rssMB(): number {
  // Best-effort GC to reduce noise. Bun exposes Bun.gc; Node needs --expose-gc.
  const g = (globalThis as any).Bun?.gc ?? (globalThis as any).gc;
  if (typeof g === 'function') g(true);
  return process.memoryUsage().rss / 1024 / 1024;
}

describe('getSessionPreviewInfo — performance guards', () => {
  beforeAll(() => {
    writeSessionFile(SMALL_FILE, 5 * 1024 * 1024); //   5 MB
    writeSessionFile(BIG_FILE, 50 * 1024 * 1024); //   50 MB
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  test('never calls fs.readFile for the session file (streaming only)', async () => {
    const freshFile = path.join(TMP_DIR, 'spy.jsonl');
    writeSessionFile(freshFile, 512 * 1024); // 512 KB
    const readFileSpy = spyOn(fsPromises, 'readFile');
    try {
      const info = await getSessionPreviewInfo(freshFile);
      expect(info.messageCount).toBeGreaterThan(0);

      // Assert no call touched our session file via readFile. Other unrelated
      // readFile calls during module init / sql.js load are fine to ignore.
      const offenders = readFileSpy.mock.calls.filter(args => {
        const arg0 = args[0];
        return typeof arg0 === 'string' && arg0 === freshFile;
      });
      expect(offenders).toEqual([]);
    } finally {
      readFileSpy.mockRestore();
    }
  });

  test('warm reads hit cache (p95 < 1ms over 100 calls)', async () => {
    await getSessionPreviewInfo(SMALL_FILE); // prime cache

    const times: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      await getSessionPreviewInfo(SMALL_FILE);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(0.95 * times.length)];
    // If the cache regresses, warm calls will re-stream the full file and p95
    // jumps from ~0.01ms into the tens of ms.
    expect(p95).toBeLessThan(1);
  });

  test('cold call on 50MB file stays RSS-bounded', async () => {
    const before = rssMB();
    const info = await getSessionPreviewInfo(BIG_FILE);
    const after = rssMB();
    expect(info.messageCount).toBeGreaterThan(0);

    // Streaming holds a ~64KB buffer + the tail-chunk + any intermediate line
    // splits. Expect well under 40MB growth. If someone reintroduces
    // fs.readFile, three concurrent Promise.all reads of a 50MB file will
    // spike RSS by 150MB+ and fail this budget.
    expect(after - before).toBeLessThan(80);
  });

  test('50 cache-miss bursts on a 5MB file do not leak linearly', async () => {
    const churnFile = path.join(TMP_DIR, 'churn.jsonl');
    writeSessionFile(churnFile, 5 * 1024 * 1024);
    await getSessionPreviewInfo(churnFile); // warm up

    const baseline = rssMB();
    for (let i = 0; i < 50; i++) {
      fs.appendFileSync(churnFile, '\n'); // bump mtime+size -> cache miss
      await getSessionPreviewInfo(churnFile);
    }
    const after = rssMB();

    // Each iteration re-streams a 5MB file. With proper streaming + caching,
    // growth is bounded by the LRU size (one entry for this file). If buffers
    // were retained per call, after 50 iterations we'd see 250MB+ growth.
    expect(after - baseline).toBeLessThan(100);
  });
});
