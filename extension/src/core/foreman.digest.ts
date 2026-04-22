// Foreman digest: pure function that compresses floor state into a
// short, spoken-friendly summary the voice model can narrate.
//
// Input: list of live terminals (name, elapsed, last-tool, label).
// Output: a compact object the realtime model reads as a function result.
// Keep fields short — every extra token costs latency when the model reads
// back.

import { getTerminalDisplayInfo, prefixToAgentType, SHELL_TITLE } from './utils';

export interface ForemanTerminal {
  name: string;                    // used when kind is not provided (legacy path)
  kind?: string;                   // preferred: 'claude' | 'codex' | 'gemini' | 'opencode' | 'openclaw'
  label?: string | null;
  sessionId?: string | null;
  project?: string | null;
  openInIde?: boolean;             // true if a live VS Code terminal owns this session
  startedAtMs?: number | null;
  lastActivityMs?: number | null;
  lastTool?: string | null;
  status?: 'idle' | 'working' | 'waiting' | 'blocked' | null;
  task?: string | null;            // first user message or session topic
  recentFiles?: string[];
  recentTools?: string[];
  lastFilePath?: string | null;
  filesEdited?: number;
  toolCalls?: number;
}

export interface ForemanAgentDigest {
  id: string;
  kind: string;
  label: string | null;
  project: string | null;
  open_in_ide: boolean;
  elapsed: string;
  status: 'idle' | 'working' | 'waiting' | 'blocked';
  last_tool: string | null;
  task: string | null;
  recent_files: string[];
  recent_tools: string[];
  last_file: string | null;
  files_edited: number;
  tool_calls: number;
}

export interface ForemanCloudTask {
  id: string;
  provider: string;
  agent: string;
  status: string;
  prompt: string;
  repo: string | null;
  updated: string;
}

export interface ForemanTeamRollup {
  name: string;
  running: number;
  pending: number;
  completed: number;
  failed: number;
}

export interface ForemanDigest {
  when: string;
  summary: string;
  agents: ForemanAgentDigest[];
  cloud: ForemanCloudTask[];
  teams: ForemanTeamRollup[];
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
  cloud: ForemanCloudTask[] = [],
  teams: ForemanTeamRollup[] = [],
  now: number = Date.now()
): ForemanDigest {
  const agents: ForemanAgentDigest[] = [];
  const kindCounts: Record<string, number> = {};
  const statusCounts = { idle: 0, working: 0, waiting: 0, blocked: 0 };
  const concerns: string[] = [];

  for (const t of terminals) {
    let kind: string;
    if (t.kind) {
      kind = t.kind.toLowerCase();
    } else {
      const info = getTerminalDisplayInfo({ name: t.name });
      if (!info.isAgent || !info.prefix) continue;
      if (info.prefix === SHELL_TITLE) continue;
      kind = prefixToAgentType(info.prefix) ?? info.prefix.toLowerCase();
    }
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;

    const startedMs = t.startedAtMs ?? t.lastActivityMs ?? now;
    const elapsedMs = Math.max(0, now - startedMs);
    const status = deriveStatus(t, now);
    statusCounts[status] += 1;

    agents.push({
      id: t.sessionId ?? t.name,
      kind,
      label: t.label ?? null,
      project: t.project ?? null,
      open_in_ide: !!t.openInIde,
      elapsed: humanElapsed(elapsedMs),
      status,
      last_tool: t.lastTool ?? null,
      task: (t.task ?? '').slice(0, 200) || null,
      recent_files: (t.recentFiles ?? []).slice(0, 4).map(shortenPath),
      recent_tools: (t.recentTools ?? []).slice(0, 4),
      last_file: t.lastFilePath ? shortenPath(t.lastFilePath) : null,
      files_edited: t.filesEdited ?? 0,
      tool_calls: t.toolCalls ?? 0,
    });

    if (status === 'waiting' && elapsedMs > 10 * 60_000) {
      concerns.push(`${kind}${t.label ? ` "${t.label}"` : ''} waiting ${humanElapsed(elapsedMs)}`);
    }
    if (status === 'blocked') {
      concerns.push(`${kind}${t.label ? ` "${t.label}"` : ''} blocked${t.lastTool ? ` on ${t.lastTool}` : ''}`);
    }
  }

  // Active cloud tasks stand out: they're running even when you close the IDE.
  for (const c of cloud) {
    if (c.status === 'running' || c.status === 'needs_review') {
      concerns.push(`cloud ${c.agent} ${c.status} - ${(c.prompt || '').slice(0, 60)}`);
    }
  }

  const summary = buildSummary(agents.length, kindCounts, statusCounts, cloud);

  return {
    when: new Date(now).toISOString(),
    summary,
    agents,
    cloud,
    teams,
    concerns,
  };
}

function shortenPath(p: string): string {
  if (!p) return p;
  const parts = p.split('/');
  if (parts.length <= 3) return p;
  return '.../' + parts.slice(-2).join('/');
}

function buildSummary(
  total: number,
  kindCounts: Record<string, number>,
  statusCounts: { idle: number; working: number; waiting: number; blocked: number },
  cloud: ForemanCloudTask[]
): string {
  if (total === 0 && cloud.length === 0) return 'floor is empty';
  const parts: string[] = [];
  if (total > 0) {
    const kinds = Object.entries(kindCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => (n > 1 ? `${n} ${k}` : k))
      .join(', ');
    parts.push(`${total} agent${total === 1 ? '' : 's'} local`);
    parts.push(kinds);
  }
  const activeCloud = cloud.filter((c) => c.status === 'running' || c.status === 'needs_review').length;
  if (activeCloud > 0) parts.push(`${activeCloud} cloud`);
  if (statusCounts.blocked > 0) parts.push(`${statusCounts.blocked} blocked`);
  else if (statusCounts.waiting > 0) parts.push(`${statusCounts.waiting} waiting`);
  return parts.join(' - ');
}
