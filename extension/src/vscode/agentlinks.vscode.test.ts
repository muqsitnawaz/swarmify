import { describe, test, expect, mock } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// agentlinks.vscode imports 'vscode' at module load. createSymlinksInDirectory
// itself only touches fs/path, so an empty stub satisfies the import without
// needing the (cross-file) ripgrep mock.
mock.module('vscode', () => ({}));

const { createSymlinksInDirectory } = await import('./agentlinks.vscode');

function freshTmpDir(): string {
  // realpath so path.relative inside createSymlink matches (/tmp -> /private/tmp).
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agentlinks-'));
}

describe('createSymlinksInDirectory (async fs.promises, real fs)', () => {
  test('creates the configured alias symlinks pointing at the source file', async () => {
    const dir = freshTmpDir();
    const source = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(source, '# agents');

    const { created, errors } = await createSymlinksInDirectory(source, ['CLAUDE.md', 'GEMINI.md']);

    expect(errors).toEqual([]);
    expect(created).toBe(2);
    for (const alias of ['CLAUDE.md', 'GEMINI.md']) {
      const aliasPath = path.join(dir, alias);
      expect(fs.lstatSync(aliasPath).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(aliasPath)).toBe('AGENTS.md');
      expect(fs.readFileSync(aliasPath, 'utf8')).toBe('# agents');
    }
  });

  test('does not overwrite an alias that already exists', async () => {
    const dir = freshTmpDir();
    const source = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(source, '# agents');
    // Pre-existing real file at the alias path must be left untouched.
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'do not clobber');

    const { errors } = await createSymlinksInDirectory(source, ['CLAUDE.md', 'GEMINI.md']);

    expect(errors).toEqual([]);
    // CLAUDE.md stays a regular file with its original contents.
    expect(fs.lstatSync(path.join(dir, 'CLAUDE.md')).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('do not clobber');
    // GEMINI.md is still created as a symlink.
    expect(fs.lstatSync(path.join(dir, 'GEMINI.md')).isSymbolicLink()).toBe(true);
  });

  test('reuses the existence cache instead of re-stat-ing the same path', async () => {
    const dir = freshTmpDir();
    const source = path.join(dir, 'AGENTS.md');
    fs.writeFileSync(source, '# agents');
    const cache = new Map<string, boolean>();

    await createSymlinksInDirectory(source, ['CLAUDE.md'], cache);

    // After creation the alias is recorded as existing in the cache.
    expect(cache.get(path.join(dir, 'CLAUDE.md'))).toBe(true);
  });
});
