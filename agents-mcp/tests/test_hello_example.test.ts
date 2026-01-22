import { test, expect } from 'bun:test';
import * as path from 'path';
import { fileURLToPath } from 'url';

test('examples hello-world prints hello world', async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(testDir, '..', '..');
  const scriptPath = path.join(workspaceRoot, 'examples', 'hello-world.ts');
  const proc = Bun.spawn({
    cmd: [process.execPath, 'run', scriptPath],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
  expect(stderr.trim()).toBe('');
  expect(stdout.trim()).toBe('hello world');
});
