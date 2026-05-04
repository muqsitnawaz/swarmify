import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type * as vscode from 'vscode';

mock.module('vscode', () => ({
  window: { onDidCloseTerminal: () => ({ dispose: () => {} }) },
  workspace: { workspaceFolders: undefined },
}));

const {
  __reset,
  __testRegister,
  onSessionChanged,
  registerTerminal,
  unregisterTerminal,
} = await import('./sessionTracker');

function fakeTerminal(name: string): vscode.Terminal {
  return { name, processId: Promise.resolve(undefined) } as unknown as vscode.Terminal;
}

function waitMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-tracker-'));
  __reset();
});

afterEach(() => {
  __reset();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('sessionTracker — Claude fork detection', () => {
  test('fires onSessionChanged when a new jsonl with forkedFrom.sessionId appears', async () => {
    const oldSessionId = '11111111-1111-1111-1111-111111111111';
    const newSessionId = '22222222-2222-2222-2222-222222222222';
    const term = fakeTerminal('CC-test');

    const events: Array<{ oldId: string | undefined; newId: string }> = [];
    onSessionChanged((_t, oldId, newId) => {
      events.push({ oldId, newId });
    });

    __testRegister(term, 'claude', [tmpDir], oldSessionId);

    const newFile = path.join(tmpDir, `${newSessionId}.jsonl`);
    const line = JSON.stringify({
      type: 'user',
      forkedFrom: { sessionId: oldSessionId },
      sessionId: newSessionId,
    });
    fs.writeFileSync(newFile, line + '\n');

    await waitMs(600);

    expect(events.length).toBe(1);
    expect(events[0].oldId).toBe(oldSessionId);
    expect(events[0].newId).toBe(newSessionId);

    unregisterTerminal(term);
  });

  test('ignores files without forkedFrom that do not match a dormant terminal', async () => {
    const oldSessionId = '33333333-3333-3333-3333-333333333333';
    const term = fakeTerminal('CC-live');

    const events: Array<string> = [];
    onSessionChanged((_t, _oldId, newId) => {
      events.push(newId);
    });

    __testRegister(term, 'claude', [tmpDir], oldSessionId);

    const trackedFile = path.join(tmpDir, `${oldSessionId}.jsonl`);
    fs.writeFileSync(trackedFile, '');
    await waitMs(500);
    fs.appendFileSync(trackedFile, '{"type":"user"}\n');
    await waitMs(100);

    const unrelatedFile = path.join(tmpDir, `44444444-4444-4444-4444-444444444444.jsonl`);
    fs.writeFileSync(unrelatedFile, '{"type":"user","sessionId":"unrelated"}\n');

    await waitMs(600);

    expect(events.length).toBe(0);

    unregisterTerminal(term);
  });
});

describe('sessionTracker — Codex rollout adoption (no prior sessionId)', () => {
  test('adopts existing rollout file on register when cwd matches', async () => {
    const existingSessionId = '019dcbf2-eeee-7fe1-aa30-1eede3d9e796';
    const term = fakeTerminal('CX-existing');

    const events: Array<{ oldId: string | undefined; newId: string }> = [];
    onSessionChanged((_t, oldId, newId) => {
      events.push({ oldId, newId });
    });

    const rollout = path.join(tmpDir, `rollout-2026-04-26T00-00-00-${existingSessionId}.jsonl`);
    fs.writeFileSync(rollout, JSON.stringify({
      timestamp: '2026-04-26T07:36:40.810Z',
      type: 'session_meta',
      payload: {
        id: existingSessionId,
        cwd: '/__test__',
        originator: 'codex-tui',
        cli_version: '0.124.0',
      },
    }) + '\n');

    // Register after file already exists — verifies proactive backfill.
    __testRegister(term, 'codex', [tmpDir], undefined);

    await waitMs(600);

    expect(events.length).toBe(1);
    expect(events[0].oldId).toBeUndefined();
    expect(events[0].newId).toBe(`rollout-2026-04-26T00-00-00-${existingSessionId}`);

    unregisterTerminal(term);
  });

  test('adopts session id from new rollout-*.jsonl when cwd matches', async () => {
    const newSessionId = '019dcbf2-e44c-7fe1-aa30-1eede3d9e796';
    const term = fakeTerminal('CX-test');

    const events: Array<{ oldId: string | undefined; newId: string }> = [];
    onSessionChanged((_t, oldId, newId) => {
      events.push({ oldId, newId });
    });

    // Register codex terminal with NO sessionId — simulates Codex 0.124+ banner
    // with no session id printed. workspacePath is '/__test__' via __testRegister.
    __testRegister(term, 'codex', [tmpDir], undefined);

    const rollout = path.join(tmpDir, `rollout-2026-04-26T00-00-00-${newSessionId}.jsonl`);
    const meta = JSON.stringify({
      timestamp: '2026-04-26T07:36:40.810Z',
      type: 'session_meta',
      payload: {
        id: newSessionId,
        cwd: '/__test__',
        originator: 'codex-tui',
        cli_version: '0.124.0',
      },
    });
    fs.writeFileSync(rollout, meta + '\n');

    await waitMs(600);

    expect(events.length).toBe(1);
    expect(events[0].oldId).toBeUndefined();
    // Filename-derived id matches payload id
    expect(events[0].newId).toBe(`rollout-2026-04-26T00-00-00-${newSessionId}`);

    unregisterTerminal(term);
  });

  test('ignores rollout when cwd does not match any tracked terminal', async () => {
    const term = fakeTerminal('CX-mismatch');

    const events: string[] = [];
    onSessionChanged((_t, _oldId, newId) => events.push(newId));

    __testRegister(term, 'codex', [tmpDir], undefined);

    const otherSessionId = '019dcbf2-aaaa-7fe1-aa30-1eede3d9e796';
    const rollout = path.join(tmpDir, `rollout-2026-04-26T00-00-00-${otherSessionId}.jsonl`);
    fs.writeFileSync(rollout, JSON.stringify({
      type: 'session_meta',
      payload: { id: otherSessionId, cwd: '/some/other/workspace', originator: 'codex-tui' },
    }) + '\n');

    await waitMs(600);

    expect(events.length).toBe(0);
    unregisterTerminal(term);
  });
});

describe('sessionTracker — lifecycle', () => {
  test('registerTerminal is idempotent', () => {
    const term = fakeTerminal('CC-idemp');
    registerTerminal(term, 'claude', '/nonexistent/workspace', 'abc');
    registerTerminal(term, 'claude', '/nonexistent/workspace', 'abc');
    unregisterTerminal(term);
  });

  test('unregisterTerminal without register is a no-op', () => {
    const term = fakeTerminal('CC-noop');
    unregisterTerminal(term);
  });
});
