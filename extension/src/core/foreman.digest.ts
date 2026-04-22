// Foreman digest: pure function that compresses floor state into a
// short, spoken-friendly summary the voice model can narrate.
//
// Input: list of live terminals (name, elapsed, last-tool, label).
// Output: a compact object the realtime model reads as a function result.
// Keep fields short — every extra token costs latency when the model reads
// back.

import { getTerminalDisplayInfo } from './utils';

export interface ForemanTerminal {
  name: string;
  label?: string | null;
  sessionId?: string | null;
  startedAtMs?: number | null;
  lastActivityMs?: number | null;
  lastTool?: string | null;
  status?: 'idle' | 'working' | 'waiting' | 'blocked' | null;
}

export interface ForemanAgentDigest {
  id: string;
  kind: string;
  label: string | null;
  elapsed: string;
  status: 'idle' | 'working' | 'waiting' | 'blocked';
  last_tool: string | null;
}

export interface ForemanDigest {
  when: string;
  summary: string;
  agents: ForemanAgentDigest[];
  concerns: string[];
}

export function humanElapsed(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function deriveStatus(t: ForemanTerminal, now: number): 'idle' | 'working' | 'waiting' | 'blocked' {
  if (t.status) return t.status;
  if (!t.lastActivityMs) return 'idle';
  const sinceActivityMs = now - t.lastActivityMs;
  if (sinceActivityMs > 10 * 60_000) return 'idle';
  if (sinceActivityMs > 3 * 60_000) return 'waiting';
  return 'working';
}

export function buildForemanDigest(
  terminals: ForemanTerminal[],
  now: number = Date.now()
): ForemanDigest {
  const agents: ForemanAgentDigest[] = [];
  const kindCounts: Record<string, number> = {};
  const statusCounts = { idle: 0, working: 0, waiting: 0, blocked: 0 };
  const concerns: string[] = [];

  for (const t of terminals) {
    const info = getTerminalDisplayInfo({ name: t.name });
    if (!info.isAgent || !info.prefix) continue;
    const kind = info.prefix.toLowerCase();
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;

    const startedMs = t.startedAtMs ?? t.lastActivityMs ?? now;
    const elapsedMs = Math.max(0, now - startedMs);
    const status = deriveStatus(t, now);
    statusCounts[status] += 1;

    agents.push({
      id: t.sessionId ?? t.name,
      kind,
      label: t.label ?? null,
      elapsed: humanElapsed(elapsedMs),
      status,
      last_tool: t.lastTool ?? null,
    });

    if (status === 'waiting' && elapsedMs > 10 * 60_000) {
      concerns.push(`${kind} has been waiting for ${humanElapsed(elapsedMs)}`);
    }
    if (status === 'blocked') {
      concerns.push(`${kind} blocked${t.lastTool ? ` on ${t.lastTool}` : ''}`);
    }
  }

  const summary = buildSummary(agents.length, kindCounts, statusCounts);

  return {
    when: new Date(now).toISOString(),
    summary,
    agents,
    concerns,
  };
}

function buildSummary(
  total: number,
  kindCounts: Record<string, number>,
  statusCounts: { idle: number; working: number; waiting: number; blocked: number }
): string {
  if (total === 0) return 'floor is empty';
  const kinds = Object.entries(kindCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => (n > 1 ? `${n} ${k}` : k))
    .join(', ');
  const parts: string[] = [`${total} agent${total === 1 ? '' : 's'} on the floor`];
  parts.push(kinds);
  if (statusCounts.blocked > 0) parts.push(`${statusCounts.blocked} blocked`);
  else if (statusCounts.waiting > 0) parts.push(`${statusCounts.waiting} waiting`);
  return parts.join(' - ');
}
