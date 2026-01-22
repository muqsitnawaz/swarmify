import { test, expect } from 'bun:test';
import * as path from 'path';
import { fileURLToPath } from 'url';

async function runScript(scriptPath: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: [process.execPath, 'run', scriptPath],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

test('hello script prints hello world', async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(testDir, '..');
  const scriptPath = path.join(repoRoot, 'src', 'hello.ts');
  const { exitCode, stdout, stderr } = await runScript(scriptPath);
  expect(exitCode).toBe(0);
  expect(stderr.trim()).toBe('');
  expect(stdout.trim()).toBe('hello world');
});

test('hello-world script prints hello world once', async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(testDir, '..');
  const scriptPath = path.join(repoRoot, 'src', 'hello-world.ts');
  const { exitCode, stdout, stderr } = await runScript(scriptPath);
  expect(exitCode).toBe(0);
  expect(stderr.trim()).toBe('');
  expect(stdout.trim()).toBe('hello world');
});
