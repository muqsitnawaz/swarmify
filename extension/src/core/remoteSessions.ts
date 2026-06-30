// Cross-host Factory Floor: normalize `agents sessions --active --json` output
// (local or fetched from a remote host over SSH) into the shape the Floor
// renders, and group it by host. Pure functions — no VS Code, no child_process
// — so they unit-test against real CLI output.

export interface ActiveSessionRaw {
  context?: string; // 'terminal' | 'headless' | 'cloud'
  kind?: string; // agent type: claude | codex | gemini | ...
  status?: string; // running | idle | queued | input_required | ...
  label?: string;
  topic?: string;
  cwd?: string;
  pid?: number;
  sessionFile?: string;
  startedAtMs?: number;
  cloudProvider?: string;
  cloudTaskId?: string;
}

export interface RemoteSession {
  host: string; // machine alias (the --host target, or 'local')
  agentType: string;
  status: string;
  title: string; // topic || label || cwd basename
  cwd?: string;
  context: string;
  sessionId?: string; // derived from sessionFile basename
  pid?: number;
  startedAtMs?: number;
  cloudTaskId?: string;
}

export interface HostGroup {
  host: string;
  online: boolean;
  error?: string; // populated when the SSH query failed/timed out
  sessions: RemoteSession[];
  running: number; // count of status === 'running'
}

export function sessionIdFromFile(sessionFile: string | undefined): string | undefined {
  if (!sessionFile) return undefined;
  const base = sessionFile.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base || undefined;
}

function titleFor(s: ActiveSessionRaw): string {
  const t = (s.topic ?? s.label ?? '').trim();
  if (t) return t;
  const cwd = (s.cwd ?? '').replace(/\/+$/, '');
  const base = cwd.split('/').pop();
  return base || 'session';
}

// Parse one host's `agents sessions --active --json` stdout into RemoteSessions
// tagged with that host. Tolerant of junk before/after the JSON array (SSH MOTD,
// shell noise) by slicing to the first '[' .. last ']'.
export function normalizeActiveSessions(stdout: string, host: string): RemoteSession[] {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return (raw as ActiveSessionRaw[])
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      host,
      agentType: (s.kind ?? 'agent').toLowerCase(),
      status: s.status ?? 'unknown',
      title: titleFor(s),
      cwd: s.cwd,
      context: s.context ?? 'terminal',
      sessionId: sessionIdFromFile(s.sessionFile),
      pid: s.pid,
      startedAtMs: s.startedAtMs,
      cloudTaskId: s.cloudTaskId,
    }));
}

export interface HostFetchResult {
  host: string;
  ok: boolean;
  stdout?: string;
  error?: string;
}

// Build the grouped, render-ready view. Hosts keep the caller's order so the
// local host can lead and the rest follow the user's selection order.
export function buildHostGroups(results: HostFetchResult[]): HostGroup[] {
  return results.map((r) => {
    if (!r.ok) {
      return { host: r.host, online: false, error: r.error ?? 'unreachable', sessions: [], running: 0 };
    }
    const sessions = normalizeActiveSessions(r.stdout ?? '', r.host);
    return {
      host: r.host,
      online: true,
      sessions,
      running: sessions.filter((s) => s.status === 'running').length,
    };
  });
}
