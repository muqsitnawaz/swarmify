import { describe, test, expect } from 'bun:test';
import { summarizeDiff } from './git';

describe('summarizeDiff', () => {
  test('returns empty string for empty diff', () => {
    expect(summarizeDiff('')).toBe('');
  });

  test('summarizes single file diff', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index abc..def 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,4 @@
 line 1
 line 2
+added line
`;
    const summary = summarizeDiff(diff);
    expect(summary).toContain('File: src/app.ts');
    expect(summary).toContain('1 changes');
    expect(summary).toContain('added line');
  });

  test('summarizes multiple file diffs', () => {
    const diff = `diff --git a/file1.ts b/file1.ts
index ...
--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,2 @@
+new content
diff --git a/file2.ts b/file2.ts
index ...
--- a/file2.ts
+++ b/file2.ts
@@ -1,1 +1,1 @@
-removed content
`;
    const summary = summarizeDiff(diff);
    expect(summary).toContain('File: file1.ts');
    expect(summary).toContain('File: file2.ts');
  });

  test('truncates long diffs', () => {
    let diff = `diff --git a/long.ts b/long.ts
index ...
--- a/long.ts
+++ b/long.ts
@@ -1,15 +1,15 @@
`;
    for (let i = 0; i < 20; i++) {
        diff += `+line ${i}\n`;
    }

    const summary = summarizeDiff(diff);
    expect(summary).toContain('File: long.ts');
    expect(summary).toContain('line 0');
    expect(summary).toContain('line 9');
    expect(summary).not.toContain('line 11');
    expect(summary).toContain('...');
  });
  
  test('handles staged/unstaged headers from vscode logic', () => {
      const diff = `Staged Changes:
diff --git a/staged.ts b/staged.ts
index ...
--- a/staged.ts
+++ b/staged.ts
@@ -1 +1 @@
+staged

Unstaged Changes:
diff --git a/unstaged.ts b/unstaged.ts
index ...
--- a/unstaged.ts
+++ b/unstaged.ts
@@ -1 +1 @@
+unstaged
`;
      const summary = summarizeDiff(diff);
      expect(summary).toContain('File: staged.ts');
      expect(summary).toContain('File: unstaged.ts');
  });
});
