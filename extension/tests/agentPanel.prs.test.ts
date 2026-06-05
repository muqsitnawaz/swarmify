import { describe, test, expect } from 'bun:test';
import * as path from 'path';
import { extractPrUrls, parseWorktreeListPorcelain } from '../src/core/panel.helpers';

describe('extractPrUrls', () => {
  test('returns every distinct PR URL across many lines, preserving order', () => {
    const lines = [
      'Opened https://github.com/phnx-labs/agents-cli/pull/144',
      'Also see https://github.com/phnx-labs/agents-cli/pull/145 — usage badge.',
      'Linked PR: https://www.github.com/muqsitnawaz/swarmify/pull/67',
      // Duplicate — must be deduped.
      'echo "https://github.com/phnx-labs/agents-cli/pull/144"',
    ];
    const out = extractPrUrls(lines);
    expect(out.map((p) => `${p.ownerRepo}#${p.number}`)).toEqual([
      'phnx-labs/agents-cli#144',
      'phnx-labs/agents-cli#145',
      'muqsitnawaz/swarmify#67',
    ]);
    // Canonicalized: no `www.` and forced https.
    expect(out[2].url).toBe('https://github.com/muqsitnawaz/swarmify/pull/67');
  });

  test('picks up multiple PR URLs on the same line', () => {
    const lines = [
      'Created https://github.com/x/y/pull/1 and https://github.com/x/y/pull/2 in one go',
    ];
    expect(extractPrUrls(lines).map((p) => p.number)).toEqual([1, 2]);
  });

  test('returns empty when no PR URLs appear', () => {
    expect(extractPrUrls(['just text', 'https://example.com/foo'])).toEqual([]);
  });

  test('ignores PR-like URLs with non-numeric IDs', () => {
    expect(extractPrUrls(['https://github.com/x/y/pull/abc'])).toEqual([]);
  });
});

describe('parseWorktreeListPorcelain', () => {
  const sample =
    'worktree /Users/me/proj\n' +
    'HEAD abc123\n' +
    'branch refs/heads/main\n' +
    '\n' +
    'worktree /Users/me/proj/.agents/worktrees/fix-foo\n' +
    'HEAD def456\n' +
    'branch refs/heads/fix-foo\n' +
    '\n' +
    'worktree /Users/me/proj/.agents/worktrees/detached-hotfix\n' +
    'HEAD ghi789\n' +
    'detached\n';

  test('parses all three records with main + active flags + detached', () => {
    const main = '/Users/me/proj';
    const active = '/Users/me/proj/.agents/worktrees/fix-foo';
    const out = parseWorktreeListPorcelain(sample, active, main, path.basename, path.resolve);
    expect(out.length).toBe(3);
    expect(out[0]).toEqual({ path: main, name: 'proj', branch: 'main', isActive: false, isMain: true });
    expect(out[1].isActive).toBe(true);
    expect(out[1].branch).toBe('fix-foo');
    expect(out[2].branch).toBeUndefined();   // detached has no branch
    expect(out[2].isMain).toBe(false);
  });

  test('returns empty when stdout is empty', () => {
    expect(parseWorktreeListPorcelain('', undefined, '/', path.basename, path.resolve)).toEqual([]);
  });

  test('tolerates CRLF line endings (Windows git output)', () => {
    const crlf = sample.replace(/\n/g, '\r\n');
    const main = '/Users/me/proj';
    const out = parseWorktreeListPorcelain(crlf, undefined, main, path.basename, path.resolve);
    // Without the \r-tolerant splitter, every record would be coalesced and
    // we'd parse 1 worktree (or 0); the fix gives us all 3 cleanly.
    expect(out.length).toBe(3);
    expect(out[0].name).toBe('proj');
    expect(out[1].name).toBe('fix-foo');
    expect(out[2].branch).toBeUndefined();
  });
});
