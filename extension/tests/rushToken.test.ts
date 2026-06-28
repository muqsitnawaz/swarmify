import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { readRushTokenCached, resetRushTokenCache } from '../src/core/rushToken';

const TMP_ROOT = path.join(__dirname, 'testdata', `rush-token-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  resetRushTokenCache();
});

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe('readRushTokenCached', () => {
  test('parses the access_token and trims it', async () => {
    const file = path.join(TMP_ROOT, `${Date.now()}-a.yaml`);
    fs.writeFileSync(file, 'user: x\naccess_token:   abc123  \nother: y\n');
    expect(await readRushTokenCached(file)).toBe('abc123');
  });

  test('returns null when the file is missing', async () => {
    expect(await readRushTokenCached(path.join(TMP_ROOT, 'nope.yaml'))).toBeNull();
  });

  test('returns null when there is no access_token line', async () => {
    const file = path.join(TMP_ROOT, `${Date.now()}-b.yaml`);
    fs.writeFileSync(file, 'user: x\n');
    expect(await readRushTokenCached(file)).toBeNull();
  });

  test('does not re-read the file until it changes (mtime+size cache)', async () => {
    const file = path.join(TMP_ROOT, `${Date.now()}-c.yaml`);
    // Pin mtime to an integer-millisecond value so the cached key compares
    // exactly (fs mtimeMs carries sub-ms float precision otherwise).
    const pinned = new Date(1_700_000_000_000);
    fs.writeFileSync(file, 'access_token: tok1\n');
    fs.utimesSync(file, pinned, pinned);

    expect(await readRushTokenCached(file)).toBe('tok1');

    // Overwrite the on-disk token but restore the exact same mtime + byte
    // length. Nothing observably changed, so the cache must keep serving the
    // old value -- proving the read is skipped on the steady-state poll.
    const original = fs.statSync(file);
    fs.writeFileSync(file, 'access_token: tok2\n'); // identical length to tok1 line
    fs.utimesSync(file, pinned, pinned);
    expect(fs.statSync(file).size).toBe(original.size);
    expect(fs.statSync(file).mtimeMs).toBe(original.mtimeMs);

    expect(await readRushTokenCached(file)).toBe('tok1');
  });

  test('re-reads after a real change (size differs)', async () => {
    const file = path.join(TMP_ROOT, `${Date.now()}-d.yaml`);
    fs.writeFileSync(file, 'access_token: tok1\n');
    expect(await readRushTokenCached(file)).toBe('tok1');

    fs.writeFileSync(file, 'access_token: a-much-longer-token-value\n');
    expect(await readRushTokenCached(file)).toBe('a-much-longer-token-value');
  });
});
