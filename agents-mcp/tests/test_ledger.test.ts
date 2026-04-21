import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { LocalDiskLedger } from '../src/ledger/local.js';

let tmpRoot: string;
let ledger: LocalDiskLedger;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ledger-'));
  ledger = new LocalDiskLedger(tmpRoot);
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('LedgerStore — MCP tool surface', () => {
  test('LedgerRead returns a diff artifact by kind', async () => {
    await ledger.putArtifact('t1', 'task-a', 'diff', 'DIFF\n');
    const view = await ledger.read('t1', 'task-a', 'diff');
    expect(view.artifacts).toHaveLength(1);
    expect(view.artifacts[0].content).toBe('DIFF\n');
  });

  test('LedgerRead without kind returns every artifact for a task', async () => {
    await ledger.putArtifact('t1', 'task-a', 'diff', 'd');
    await ledger.putArtifact('t1', 'task-a', 'test-output', 'o');
    await ledger.appendSession('t1', 'task-a', 'alice', '{"m":1}');
    const view = await ledger.read('t1', 'task-a');
    const kinds = view.artifacts.map((a) => a.kind).sort();
    expect(kinds).toEqual(['diff', 'session', 'test-output']);
  });

  test('LedgerNote attributes entries to the teammate', async () => {
    await ledger.note('t1', 'task-a', 'alice', 'first note');
    await ledger.note('t1', 'task-a', 'bob', 'second note');
    const view = await ledger.read('t1', 'task-a', 'notes');
    const text = view.artifacts[0].content;
    expect(text).toContain('alice');
    expect(text).toContain('bob');
    expect(text).toContain('first note');
    expect(text).toContain('second note');
  });

  test('LedgerSearch finds across sessions + notes + bugs', async () => {
    await ledger.appendSession('t1', 'task-a', 'alice', JSON.stringify({ msg: 'flaky test retries' }));
    await ledger.note('t1', 'task-b', 'bob', 'flaky was the wrong diagnosis');
    await ledger.putArtifact('t1', 'task-c', 'bug', '# flaky again');
    const hits = await ledger.search('t1', 'flaky');
    const kinds = new Set(hits.map((h) => h.kind));
    expect(kinds.has('notes')).toBe(true);
    expect(kinds.has('bug')).toBe(true);
    expect(kinds.has('session')).toBe(true);
  });

  test('LedgerRecent honours the registry and newest-first ordering', async () => {
    const now = Date.now();
    await ledger.putRegistry({
      team_id: 't1',
      updated_at: new Date(now).toISOString(),
      teammates: [
        {
          agent_id: 'old', name: 'old', agent_type: 'claude',
          task_type: 'implement', dispatch: 'local', after: [],
          status: 'completed',
          started_at: new Date(now - 9000).toISOString(),
          completed_at: new Date(now - 8000).toISOString(),
        },
        {
          agent_id: 'new', name: 'new', agent_type: 'claude',
          task_type: 'test', dispatch: 'local', after: [],
          status: 'completed',
          started_at: new Date(now - 2000).toISOString(),
          completed_at: new Date(now - 1000).toISOString(),
        },
      ],
    });
    await ledger.putArtifact('t1', 'old', 'diff', 'old');
    await ledger.putArtifact('t1', 'new', 'diff', 'new');
    const recent = await ledger.recent('t1');
    expect(recent.map((r) => r.task_id)).toEqual(['new', 'old']);
  });

  test('backing store uses the canonical path layout', async () => {
    await ledger.putArtifact('t1', 'task-a', 'diff', 'x');
    await ledger.putArtifact('t1', 'task-a', 'bug', 'b');
    await ledger.appendSession('t1', 'task-a', 'alice', 'z');
    await ledger.appendNarrative('t1', 'plan step');
    const base = path.join(tmpRoot, 'teams', 't1');
    expect(fs.existsSync(path.join(base, 'artifacts', 'task-a', 'diff.patch'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'bugs', 'task-a.md'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'sessions', 'task-a-alice.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'team.md'))).toBe(true);
  });
});
