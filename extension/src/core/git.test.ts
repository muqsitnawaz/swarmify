import { describe, expect, test } from 'bun:test';
import {
  buildCommitPrompt,
  buildSystemPrompt,
  detectDirectoryMoves,
  formatChangeStatus,
  getApiEndpoint,
  parseIgnorePatterns,
  prepareCommitContext,
  shouldIgnoreFile,
  summarizeDiff
} from './git';

describe('getApiEndpoint', () => {
  test('returns openai endpoint for openai provider', () => {
    expect(getApiEndpoint('openai')).toBe('https://api.openai.com/v1/chat/completions');
  });

  test('returns openrouter endpoint for openrouter provider', () => {
    expect(getApiEndpoint('openrouter')).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  test('returns custom URL if provider starts with http', () => {
    const customUrl = 'https://custom-api.example.com/v1/chat';
    expect(getApiEndpoint(customUrl)).toBe(customUrl);
  });

  test('returns openai endpoint as default', () => {
    expect(getApiEndpoint('unknown')).toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('parseIgnorePatterns', () => {
  test('returns empty array for empty string', () => {
    expect(parseIgnorePatterns('')).toEqual([]);
  });

  test('parses single pattern', () => {
    expect(parseIgnorePatterns('node_modules')).toEqual(['node_modules']);
  });

  test('parses multiple patterns', () => {
    expect(parseIgnorePatterns('node_modules,dist,build')).toEqual(['node_modules', 'dist', 'build']);
  });

  test('trims whitespace from patterns', () => {
    expect(parseIgnorePatterns('  node_modules  ,  dist  ')).toEqual(['node_modules', 'dist']);
  });

  test('filters out empty patterns', () => {
    expect(parseIgnorePatterns('node_modules,,dist,')).toEqual(['node_modules', 'dist']);
  });
});

describe('shouldIgnoreFile', () => {
  test('ignores files matching extension pattern', () => {
    expect(shouldIgnoreFile('/src/app.lock', ['*.lock'])).toBe(true);
    expect(shouldIgnoreFile('/src/bun.lock', ['*.lock'])).toBe(true);
  });

  test('does not ignore files not matching extension pattern', () => {
    expect(shouldIgnoreFile('/src/app.ts', ['*.lock'])).toBe(false);
  });

  test('ignores files in node_modules directory', () => {
    expect(shouldIgnoreFile('/node_modules/foo/bar.js', ['node_modules'])).toBe(true);
  });

  test('ignores dist directory', () => {
    expect(shouldIgnoreFile('/dist/bundle.js', ['dist'])).toBe(true);
  });

  test('does not ignore source files', () => {
    expect(shouldIgnoreFile('/src/app.ts', ['node_modules', 'dist'])).toBe(false);
  });

  test('handles multiple patterns', () => {
    const patterns = ['node_modules', '*.lock', 'dist'];
    expect(shouldIgnoreFile('/node_modules/pkg/index.js', patterns)).toBe(true);
    expect(shouldIgnoreFile('/bun.lock', patterns)).toBe(true);  // *.lock matches files ending in .lock
    expect(shouldIgnoreFile('/dist/out.js', patterns)).toBe(true);
    expect(shouldIgnoreFile('/src/main.ts', patterns)).toBe(false);
    expect(shouldIgnoreFile('/package-lock.json', patterns)).toBe(false);  // .json doesn't match *.lock
  });
});

describe('buildSystemPrompt', () => {
  test('returns base prompt without examples', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('helpful assistant');
    expect(prompt).toContain('commit messages');
    expect(prompt).not.toContain('examples');
  });

  test('includes examples when provided', () => {
    const prompt = buildSystemPrompt(['fix: bug fix', 'feat: new feature']);
    expect(prompt).toContain('2 examples');
    expect(prompt).toContain('fix: bug fix');
    expect(prompt).toContain('feat: new feature');
  });

  test('calculates max length from examples', () => {
    const prompt = buildSystemPrompt(['short', 'this is a much longer commit message example']);
    expect(prompt).toContain('no longer than');
  });
});

describe('formatChangeStatus', () => {
  test('formats new file status', () => {
    expect(formatChangeStatus(7, true)).toBe('Staged New');
    expect(formatChangeStatus(7, false)).toBe('Unstaged New');
  });

  test('formats modified file status', () => {
    expect(formatChangeStatus(5, true)).toBe('Staged Modified');
    expect(formatChangeStatus(5, false)).toBe('Unstaged Modified');
  });

  test('formats deleted file status', () => {
    expect(formatChangeStatus(6, true)).toBe('Staged Deleted');
    expect(formatChangeStatus(6, false)).toBe('Unstaged Deleted');
  });

  test('formats unknown status as Changed', () => {
    expect(formatChangeStatus(99, true)).toBe('Staged Changed');
    expect(formatChangeStatus(99, false)).toBe('Unstaged Changed');
  });
});

describe('detectDirectoryMoves', () => {
  test('returns null when not enough files', () => {
    const deleted = ['cli-ts/file1.ts', 'cli-ts/file2.ts'];
    const added = ['file1.ts', 'file2.ts'];
    expect(detectDirectoryMoves(deleted, added)).toBeNull();
  });

  test('detects simple directory move', () => {
    const deleted = [
      'cli-ts/bun.lock',
      'cli-ts/package.json',
      'cli-ts/src/agents.ts',
      'cli-ts/src/api.ts',
      'cli-ts/src/file_ops.ts',
      'cli-ts/tsconfig.json'
    ];
    const added = [
      'bun.lock',
      'package.json',
      'src/agents.ts',
      'src/api.ts',
      'src/file_ops.ts',
      'tsconfig.json'
    ];
    const result = detectDirectoryMoves(deleted, added);
    expect(result).not.toBeNull();
    expect(result?.fromPrefix).toBe('cli-ts/');
    expect(result?.toPrefix).toBe('');
    expect(result?.fileCount).toBe(6);
    expect(result?.dirName).toBe('cli-ts');
  });

  test('returns null when files do not match', () => {
    const deleted = [
      'cli-ts/file1.ts',
      'cli-ts/file2.ts',
      'cli-ts/file3.ts',
      'cli-ts/file4.ts',
      'cli-ts/file5.ts',
      'cli-ts/file6.ts'
    ];
    const added = [
      'different1.ts',
      'different2.ts',
      'different3.ts',
      'different4.ts',
      'different5.ts',
      'different6.ts'
    ];
    expect(detectDirectoryMoves(deleted, added)).toBeNull();
  });

  test('detects move with nested paths', () => {
    const deleted = [
      'cli-ts/src/agents.ts',
      'cli-ts/src/api.ts',
      'cli-ts/tests/test1.ts',
      'cli-ts/tests/test2.ts',
      'cli-ts/package.json'
    ];
    const added = [
      'src/agents.ts',
      'src/api.ts',
      'tests/test1.ts',
      'tests/test2.ts',
      'package.json'
    ];
    const result = detectDirectoryMoves(deleted, added);
    expect(result).not.toBeNull();
    expect(result?.fromPrefix).toBe('cli-ts/');
    expect(result?.fileCount).toBe(5);
  });

  test('returns null when partial match below threshold', () => {
    const deleted = [
      'cli-ts/file1.ts',
      'cli-ts/file2.ts',
      'cli-ts/file3.ts',
      'cli-ts/file4.ts',
      'cli-ts/file5.ts',
      'cli-ts/file6.ts'
    ];
    const added = [
      'file1.ts',
      'file2.ts',
      'file3.ts',
      'different4.ts',
      'different5.ts',
      'different6.ts'
    ];
    expect(detectDirectoryMoves(deleted, added, 5)).toBeNull();
  });

  test('handles empty arrays', () => {
    expect(detectDirectoryMoves([], [])).toBeNull();
    expect(detectDirectoryMoves(['file1.ts'], [])).toBeNull();
    expect(detectDirectoryMoves([], ['file1.ts'])).toBeNull();
  });

  test('detects move to parent directory', () => {
    const deleted = [
      'swarm/cli-ts/bun.lock',
      'swarm/cli-ts/package.json',
      'swarm/cli-ts/src/agents.ts',
      'swarm/cli-ts/src/api.ts',
      'swarm/cli-ts/src/file_ops.ts',
      'swarm/cli-ts/tsconfig.json'
    ];
    const added = [
      'swarm/bun.lock',
      'swarm/package.json',
      'swarm/src/agents.ts',
      'swarm/src/api.ts',
      'swarm/src/file_ops.ts',
      'swarm/tsconfig.json'
    ];
    const result = detectDirectoryMoves(deleted, added);
    expect(result).not.toBeNull();
    expect(result?.fromPrefix).toBe('swarm/cli-ts/');
    expect(result?.toPrefix).toBe('swarm/');
    expect(result?.fileCount).toBe(6);
    expect(result?.dirName).toBe('cli-ts');
  });
});

describe('buildCommitPrompt', () => {
  test('includes git status in prompt', () => {
    const prompt = buildCommitPrompt('Unstaged Modified: src/index.ts', '', []);
    expect(prompt).toContain('Git status:');
    expect(prompt).toContain('Unstaged Modified: src/index.ts');
  });

  test('includes diff preview when provided', () => {
    const diff = '+const x = 1;\n-const y = 2;';
    const prompt = buildCommitPrompt('Modified: file.ts', diff, []);
    expect(prompt).toContain('Diff preview:');
    expect(prompt).toContain('+const x = 1;');
    expect(prompt).toContain('-const y = 2;');
  });

  test('excludes diff section when empty', () => {
    const prompt = buildCommitPrompt('Modified: file.ts', '', []);
    expect(prompt).not.toContain('Diff preview:');
  });

  test('includes commit message style examples', () => {
    const examples = [
      'feat: add user authentication with jwt tokens',
      'fix: resolve null pointer in payment handler'
    ];
    const prompt = buildCommitPrompt('Modified: auth.ts', '', examples);
    expect(prompt).toContain('Commit message style examples:');
    expect(prompt).toContain('- feat: add user authentication with jwt tokens');
    expect(prompt).toContain('- fix: resolve null pointer in payment handler');
  });

  test('excludes examples section when none provided', () => {
    const prompt = buildCommitPrompt('Modified: file.ts', '', []);
    expect(prompt).not.toContain('Commit message style examples:');
  });

  test('includes format instructions', () => {
    const prompt = buildCommitPrompt('Modified: file.ts', '', []);
    expect(prompt).toContain('Format: <type>: <description>');
    expect(prompt).toContain('Types: feat, fix, docs, refactor, test, build, release');
    expect(prompt).toContain('Return only the commit message, no explanation');
  });

  test('generates complete prompt structure', () => {
    const status = 'Staged Modified: src/auth.ts\nStaged New: src/login.ts';
    const diff = '+export function login() {\n+  return true;\n+}';
    const examples = ['feat: add authentication', 'fix: login bug'];

    const prompt = buildCommitPrompt(status, diff, examples);

    // Check overall structure
    expect(prompt).toMatch(/^Generate a concise git commit message/);
    expect(prompt.indexOf('Git status:')).toBeLessThan(prompt.indexOf('Diff preview:'));
    expect(prompt.indexOf('Diff preview:')).toBeLessThan(prompt.indexOf('Commit message style examples:'));
    expect(prompt.indexOf('Commit message style examples:')).toBeLessThan(prompt.indexOf('Return only'));
  });
});

describe('summarizeDiff', () => {
  test('returns empty string for empty diff', () => {
    expect(summarizeDiff('')).toBe('');
  });

  test('extracts file path from diff', () => {
    const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';

 export function main() {}`;

    const summary = summarizeDiff(diff);
    expect(summary).toContain('File: src/index.ts');
  });

  test('counts added and removed lines', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
+const c = 3;
-const old = 0;`;

    const summary = summarizeDiff(diff);
    expect(summary).toContain('lines changed');
  });

  test('handles multiple files in diff', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
 const a = 1;
+const b = 2;
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +1,2 @@
 export {};
+export const x = 1;`;

    const summary = summarizeDiff(diff);
    expect(summary).toContain('File: a.ts');
    expect(summary).toContain('File: b.ts');
  });

  test('includes preview of changes', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1,2 @@
+const newCode = true;`;

    const summary = summarizeDiff(diff);
    expect(summary).toContain('+const newCode = true;');
  });
});

describe('prepareCommitContext', () => {
  test('creates context for normal changes', () => {
    const result = prepareCommitContext(
      'Modified: src/index.ts\nNew: src/utils.ts',
      [],
      []
    );
    expect(result.isMove).toBe(false);
    expect(result.context).toContain('Status:');
    expect(result.context).toContain('Modified: src/index.ts');
    expect(result.context).toContain('New: src/utils.ts');
  });

  test('includes diff summary when provided', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1,2 @@
+const x = 1;`;

    const result = prepareCommitContext('Modified: file.ts', [], [], diff);
    expect(result.context).toContain('Diff Summary:');
  });

  test('truncates large status lists', () => {
    const statusLines = Array.from({ length: 150 }, (_, i) => `Modified: file${i}.ts`);
    const result = prepareCommitContext(statusLines.join('\n'), [], []);
    expect(result.context).toContain('and 50 more files');
  });

  test('detects directory moves', () => {
    // Paths without leading slash - matches how detectDirectoryMoves parses paths
    const deleted = Array.from({ length: 10 }, (_, i) => `old/dir/file${i}.ts`);
    const added = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
    const result = prepareCommitContext('status', deleted, added);
    expect(result.isMove).toBe(true);
    expect(result.moveInfo).toBeDefined();
    expect(result.context).toContain('Move detected:');
  });

  test('generates user prompt', () => {
    const result = prepareCommitContext('Modified: file.ts', [], []);
    expect(result.userPrompt).toContain('generate a concise commit message');
  });
});
