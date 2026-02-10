import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { findFileBySessionId } from '../src/vscode/sessions.vscode';

const TMP_ROOT = path.join(__dirname, 'testdata', `sessions-lookup-${Date.now()}`);

beforeAll(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

function touch(relativePath: string) {
  const full = path.join(TMP_ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '');
  return full;
}

describe('findFileBySessionId', () => {
  test('exact match: Claude-style {uuid}.jsonl', async () => {
    const uuid = '019c48ee-127d-7170-b940-aaaaaaaaaaaa';
    const file = touch(`claude/${uuid}.jsonl`);
    const found = await findFileBySessionId(path.join(TMP_ROOT, 'claude'), uuid, 0);
    expect(found).toBe(file);
  });

  test('endsWith match: Codex-style rollout-{timestamp}-{uuid}.jsonl', async () => {
    const uuid = '019c48ee-127d-7170-b940-bbbbbbbbbbbb';
    const file = touch(`codex/2026/02/10/rollout-2026-02-10T11-01-27-${uuid}.jsonl`);
    const found = await findFileBySessionId(path.join(TMP_ROOT, 'codex'), uuid, 4);
    expect(found).toBe(file);
  });

  test('prefix match: 8-char session chunk', async () => {
    const uuid = '019c48ee-127d-7170-b940-cccccccccccc';
    const chunk = uuid.slice(0, 8);
    const file = touch(`chunk/${uuid}.jsonl`);
    const found = await findFileBySessionId(path.join(TMP_ROOT, 'chunk'), chunk, 0);
    expect(found).toBe(file);
  });

  test('no match: unrelated filename', async () => {
    touch(`nomatch/unrelated-file.jsonl`);
    const found = await findFileBySessionId(path.join(TMP_ROOT, 'nomatch'), 'does-not-exist', 0);
    expect(found).toBeUndefined();
  });

  test('skips non-session extensions', async () => {
    const uuid = '019c48ee-127d-7170-b940-dddddddddddd';
    touch(`ext/${uuid}.log`);
    const found = await findFileBySessionId(path.join(TMP_ROOT, 'ext'), uuid, 0);
    expect(found).toBeUndefined();
  });

  test('respects depth limit', async () => {
    const uuid = '019c48ee-127d-7170-b940-eeeeeeeeeeee';
    touch(`deep/a/b/c/${uuid}.jsonl`);
    const notFound = await findFileBySessionId(path.join(TMP_ROOT, 'deep'), uuid, 1);
    expect(notFound).toBeUndefined();
    const found = await findFileBySessionId(path.join(TMP_ROOT, 'deep'), uuid, 3);
    expect(found).toBe(path.join(TMP_ROOT, 'deep', 'a', 'b', 'c', `${uuid}.jsonl`));
  });
});
