/**
 * E2E: the P1 Jarvis read tools depend on specific fields in the live
 * `agents <cmd> --json` output. This suite runs the REAL commands (no mocks)
 * and pins the exact shape foreman.sources.ts parses, so a schema drift in
 * agents-cli fails here at test time instead of at "tap the orb" time.
 *
 * Mirrors the philosophy of foreman.realtime.e2e.test.ts (which pins the
 * OpenAI Realtime contract). Skips gracefully if the `agents` CLI is absent.
 */

import { describe, test, expect } from 'bun:test';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import * as path from 'path';

function resolveAgents(): string | null {
  const candidates = [
    path.join(homedir(), '.agents', 'shims', 'agents'),
    '/opt/homebrew/bin/agents',
    '/usr/local/bin/agents',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

const AGENTS = resolveAgents();
const describeIfCli = AGENTS ? describe : describe.skip;

function runJson(args: string[]): any {
  const out = execFileSync(AGENTS as string, args, {
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}` },
  }).toString().trim();
  return out ? JSON.parse(out) : null;
}

describeIfCli('foreman P1 tool contracts (live agents CLI)', () => {
  test('view --json carries the fields quota parses', () => {
    const data = runJson(['view', '--json']);
    expect(Array.isArray(data)).toBe(true);
    for (const entry of data) {
      expect(typeof entry.agent).toBe('string');
      expect(Array.isArray(entry.versions)).toBe(true);
      // windows[].usedPercent + resetsAt are what getUsage reads for the
      // tightest-window rate-limit answer. Assert on any signed-in version
      // that exposes windows.
      const v = entry.versions.find((x: any) => x.signedIn) ?? entry.versions[0];
      if (v && Array.isArray(v.windows) && v.windows.length) {
        for (const w of v.windows) {
          expect(w).toHaveProperty('usedPercent');
        }
      }
    }
  });

  test('routines list --json carries the fields routines parses', () => {
    const data = runJson(['routines', 'list', '--json']);
    expect(Array.isArray(data)).toBe(true);
    for (const r of data) {
      expect(typeof r.name).toBe('string');
      expect(r).toHaveProperty('schedule');
      expect(r).toHaveProperty('enabled');
    }
  });

  test('devices list --json carries the fields fleet parses', () => {
    const data = runJson(['devices', 'list', '--json']);
    expect(Array.isArray(data)).toBe(true);
    for (const d of data) {
      expect(typeof d.name).toBe('string');
      expect(d).toHaveProperty('platform');
      // fleet reads d.tailscale.online; the key must exist to report online.
      expect(d).toHaveProperty('tailscale');
    }
  });

  test('cloud status <id> --json carries the fields cloud_status parses', () => {
    // Pull a real task id from the list, then exercise the ACTUAL command
    // getCloudTask depends on (cloud status <id>), whose single-object shape
    // can drift independently of the list-element shape.
    const list = runJson(['cloud', 'list', '--json']);
    expect(Array.isArray(list)).toBe(true);
    if (list.length === 0) return; // nothing to inspect on a clean account
    const id = String(list[0].id);
    const task = runJson(['cloud', 'status', id, '--json']);
    expect(task && typeof task).toBe('object');
    expect(task).toHaveProperty('id');
    expect(task).toHaveProperty('status');
    expect(task).toHaveProperty('provider');
  });
});
