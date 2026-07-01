// Cross-host session aggregation — pure types + normalize/group.
//
// This module has NO VS Code imports so it is unit-testable in isolation. The
// SSH fan-out + host discovery live in src/vscode/remoteSessions.vscode.ts;
// this file only turns the raw `agents sessions --active --json` payload into a
// normalized RemoteSession and groups records by host.
//
// A RemoteSession is the cross-host analog of a local agent, shaped so the
// webview can fold it into a FloorAgent (ui/settings/components/mission-control/
// floorModel.ts). Field names are mirrored, but the two types are NOT shared —
// data crosses the webview boundary via postMessage.

import {
  extractCurrentActivity,
  detectWaitingForInput,
  computeOutputTokensPerSec,
  formatActivity,
} from './session.activity';

/** Mirror of floorModel.FloorPhase (kept in sync by hand; not imported). */
export type RemotePhase = 'running' | 'idle' | 'waiting' | 'failed' | 'done';

/** Agent types whose session files session.activity.ts knows how to parse. */
type ParsableAgentType = 'claude' | 'codex' | 'gemini';

/**
 * The cross-host analog of a local agent. One record per active session on one
 * machine. `host` is the machine we queried ('this-mac' locally, an ssh/tailscale
 * name remotely) — never the raw `host` field of the CLI payload, which is the
 * terminal-emulator name (e.g. "ghostty").
 */
export interface RemoteSession {
  host: string;
  sessionId: string;
  agentType: string;
  cwd: string;
  project: string;
  phase: RemotePhase;
  activity: string;
  tokPerSec: number;
  waitingForInput: boolean;
  lastResponse: string;
  prUrl: string | null;
  ticket: string | null;
  branch: string;
  /** Elapsed ms since the session started, computed against the fetch clock so
   *  host clock skew does not distort it. */
  sinceMs: number;
  /** Host-reported wall-clock start (epoch ms). Carried verbatim so the UI can
   *  recompute freshness without trusting the remote clock for elapsed. */
  startedAtMs: number;
  /** The session's task/prompt line from the CLI payload (`topic`/`label`). Shown
   *  on the card when Tier-1 has no enriched activity yet (remote hosts). */
  topic: string;
  /** Absolute session-file path, kept so the fan-out can enrich the deduped
   *  survivor without re-reading the raw record. */
  sessionFile: string;
  /** The CLI record's `context` ('terminal' | 'cloud' | 'teams' | ...). Lets the
   *  webview treat cloud rows differently from terminal-backed agents. */
  context: string;
}

/** One machine's worth of sessions plus its reachability + freshness stamp. */
export interface HostGroup {
  host: string;
  online: boolean;
  /** When this host's data was fetched (epoch ms) — freshness for the UI. */
  fetchedAt: number;
  sessions: RemoteSession[];
}

/** Reachability of a discovered host. */
export interface HostInfo {
  name: string;
  online: boolean;
}

/**
 * The subset of `agents sessions --active --json` records we consume. Every
 * field is optional because the payload shape varies by context (terminal /
 * teams / cloud). Unknown fields are ignored.
 */
export interface RawActiveSession {
  context?: string;
  kind?: string;
  pid?: number;
  sessionId?: string;
  cwd?: string;
  label?: string;
  topic?: string;
  sessionFile?: string;
  startedAtMs?: number;
  status?: string;
  teamName?: string;
  agentId?: string;
  cloudProvider?: string;
  cloudTaskId?: string;
  cloudStatus?: string;
  branch?: string;
  prUrl?: string;
  ticket?: string;
}

const TICKET_RE = /\b[A-Z][A-Z0-9]*-\d+\b/;

/**
 * Map the CLI `status` string onto a FloorPhase.
 *   running            -> running
 *   input_required     -> waiting   (the cheap Tier-1 "needs you" signal)
 *   queued             -> running   (dispatched, work in the pipeline)
 *   failed / error     -> failed
 *   completed / done   -> done
 *   idle / stopped / _ -> idle
 */
export function mapStatusToPhase(status: string | undefined): RemotePhase {
  switch ((status || '').toLowerCase()) {
    case 'running':
    case 'queued':
    case 'in_progress':
      return 'running';
    case 'input_required':
    case 'waiting':
    case 'waiting_for_input':
      return 'waiting';
    case 'failed':
    case 'error':
      return 'failed';
    case 'completed':
    case 'done':
    case 'success':
      return 'done';
    case 'idle':
    case 'stopped':
    default:
      return 'idle';
  }
}

/**
 * Derive a display project from a working directory. Worktrees are folded to
 * their repo: `.../<repo>/.agents/worktrees/<slug>` -> `<repo>`. Otherwise the
 * cwd basename.
 */
export function projectFromCwd(cwd: string): string {
  if (!cwd) return '';
  const norm = cwd.replace(/\/+$/, '');
  const wt = norm.match(/\/([^/]+)\/\.agents\/worktrees\//);
  if (wt) return wt[1];
  const parts = norm.split('/');
  return parts[parts.length - 1] || norm;
}

/** Pull the session UUID out of a session-file path (basename minus extension). */
function sessionIdFromFile(sessionFile: string | undefined): string {
  if (!sessionFile) return '';
  const base = sessionFile.split('/').pop() || '';
  return base.replace(/\.[^.]+$/, '');
}

/**
 * Turn one raw CLI record into a RemoteSession. `host` is the machine we queried;
 * `fetchedAt` is our local clock at fetch time (used for skew-free elapsed).
 */
export function normalizeActiveSession(
  raw: RawActiveSession,
  host: string,
  fetchedAt: number
): RemoteSession {
  const status = raw.status;
  const phase = mapStatusToPhase(status);
  const sessionId =
    raw.sessionId ||
    sessionIdFromFile(raw.sessionFile) ||
    raw.agentId ||
    raw.cloudTaskId ||
    '';
  const cwd = raw.cwd || '';
  const startedAtMs = typeof raw.startedAtMs === 'number' ? raw.startedAtMs : 0;
  const ticketText = `${raw.ticket || ''} ${raw.label || ''} ${raw.topic || ''}`;
  const ticketMatch = raw.ticket || ticketText.match(TICKET_RE)?.[0] || null;

  return {
    host,
    sessionId,
    agentType: (raw.kind || '').toLowerCase(),
    cwd,
    project: projectFromCwd(cwd),
    phase,
    activity: '',
    tokPerSec: 0,
    waitingForInput: phase === 'waiting',
    lastResponse: '',
    prUrl: raw.prUrl || null,
    ticket: ticketMatch,
    branch: raw.branch || '',
    sinceMs: startedAtMs > 0 ? Math.max(0, fetchedAt - startedAtMs) : 0,
    startedAtMs,
    topic: raw.topic || raw.label || '',
    sessionFile: raw.sessionFile || '',
    context: raw.context || '',
  };
}

/** Phase precedence for dedup — the most attention-worthy record wins. */
const DEDUPE_PHASE_RANK: Record<RemotePhase, number> = {
  waiting: 0,
  failed: 1,
  running: 2,
  done: 3,
  idle: 4,
};

/**
 * Collapse records that describe the SAME session into one.
 *
 * `agents sessions --active` reports one record per live *process*, but many
 * processes (login shell, node, the agent binary, extra tabs) attach to a single
 * session file — locally we've seen 9 pids resolve to one session. Left alone,
 * the header counts every process while the feed (keyed by session id) renders
 * only the distinct ids, so the count and the list diverge wildly. Dedup by
 * `sessionId` here so a "session" means a session, and keep the record whose phase
 * most needs the user (waiting > failed > running > done > idle) — e.g. one
 * waiting pane among eight running ones surfaces the whole session as waiting.
 * Records with an empty `sessionId` are passed through untouched (can't key them).
 */
export function dedupeSessions(sessions: RemoteSession[]): RemoteSession[] {
  const byId = new Map<string, RemoteSession>();
  const passthrough: RemoteSession[] = [];
  for (const s of sessions) {
    if (!s.sessionId) {
      passthrough.push(s);
      continue;
    }
    const existing = byId.get(s.sessionId);
    if (!existing || DEDUPE_PHASE_RANK[s.phase] < DEDUPE_PHASE_RANK[existing.phase]) {
      byId.set(s.sessionId, s);
    }
  }
  return [...byId.values(), ...passthrough];
}

/**
 * Parse a full `agents sessions --active --json` payload (string or array) into
 * RemoteSessions for one host. Malformed input yields an empty array rather than
 * throwing, so one bad host never sinks the whole fan-out.
 */
export function normalizeActiveSessions(
  payload: string | unknown[],
  host: string,
  fetchedAt: number
): RemoteSession[] {
  let arr: unknown[];
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      arr = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  } else if (Array.isArray(payload)) {
    arr = payload;
  } else {
    return [];
  }
  return arr
    .filter((r): r is RawActiveSession => !!r && typeof r === 'object')
    .map((r) => normalizeActiveSession(r, host, fetchedAt));
}

/**
 * Enrich a RemoteSession with activity / throughput / waiting derived from the
 * session file's JSONL content — the same derivation local agents use. Only the
 * local host can supply content cheaply (Tier-1); remote hosts stay status-only
 * until a Tier-2 rich fetch. Non-parsable agent types are returned unchanged.
 */
export function enrichWithSessionContent(
  session: RemoteSession,
  sessionContent: string,
  now: number
): RemoteSession {
  const agentType = session.agentType;
  if (agentType !== 'claude' && agentType !== 'codex' && agentType !== 'gemini') {
    return session;
  }
  const parsable = agentType as ParsableAgentType;
  const activity = extractCurrentActivity(sessionContent, parsable);
  const tokPerSec = computeOutputTokensPerSec(sessionContent, parsable, 60, now);
  const waiting = detectWaitingForInput(sessionContent, parsable);
  const nextPhase: RemotePhase =
    waiting && session.phase !== 'failed' && session.phase !== 'done'
      ? 'waiting'
      : session.phase;
  return {
    ...session,
    activity: activity ? formatActivity(activity) : session.activity,
    tokPerSec: Math.round(tokPerSec),
    waitingForInput: session.waitingForInput || waiting,
    phase: nextPhase,
  };
}

/**
 * Group normalized sessions by host into HostGroups. `hosts` supplies the full
 * roster + reachability so offline hosts still appear (with an empty session
 * list) instead of silently vanishing. `fetchedAt` stamps freshness.
 */
export function groupByHost(
  sessions: RemoteSession[],
  hosts: HostInfo[],
  fetchedAt: number
): HostGroup[] {
  const byHost = new Map<string, RemoteSession[]>();
  for (const s of sessions) {
    const list = byHost.get(s.host);
    if (list) list.push(s);
    else byHost.set(s.host, [s]);
  }
  const groups: HostGroup[] = [];
  const seen = new Set<string>();
  for (const h of hosts) {
    seen.add(h.name);
    groups.push({
      host: h.name,
      online: h.online,
      fetchedAt,
      sessions: byHost.get(h.name) || [],
    });
  }
  // Any host that produced sessions but was not in the roster (defensive).
  for (const [host, list] of byHost) {
    if (seen.has(host)) continue;
    groups.push({ host, online: true, fetchedAt, sessions: list });
  }
  return groups;
}
