import { test, expect } from 'bun:test';
import { getAgentResources, invalidateAgentResourcesCache, RESOURCE_KINDS } from './agentResources';

// Real-service test: shells the actual `agents inspect <target> --json` CLI.
// Skips gracefully when the agents CLI is not installed in this environment.
test('getAgentResources returns DotAgents repos with numeric capability counts', async () => {
  invalidateAgentResourcesCache();
  const repos = await getAgentResources(undefined, true);
  expect(Array.isArray(repos)).toBe(true);

  if (repos.length === 0) {
    // agents CLI unavailable (e.g. CI without it) — nothing to assert.
    return;
  }

  const user = repos.find((r) => r.repo === 'user');
  expect(user).toBeTruthy();
  expect(typeof user!.root).toBe('string');
  expect(user!.root.length).toBeGreaterThan(0);

  for (const kind of RESOURCE_KINDS) {
    expect(typeof user!.counts[kind]).toBe('number');
    expect(Number.isFinite(user!.counts[kind])).toBe(true);
    expect(user!.counts[kind]).toBeGreaterThanOrEqual(0);
  }
});

test('getAgentResources caches within the TTL window', async () => {
  invalidateAgentResourcesCache();
  const first = await getAgentResources(undefined, true);
  const second = await getAgentResources(undefined, false);
  // Same cached reference (no re-shell) within the 60s window.
  expect(second).toBe(first);
});
