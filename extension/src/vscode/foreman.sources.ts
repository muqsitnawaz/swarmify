// Data sources for the Foreman digest.
//
// We do NOT re-parse session JSONL ourselves any more. agents-cli already owns
// that (SQLite + FTS5 + normalized events, 5 agent formats). We shell out,
// parse the JSON, and cross-reference against the live VS Code terminal map
// for the "open in IDE right now" flag.
//
// Three cohorts:
//   1. Local sessions      -> `agents sessions --json --all --since <x> --limit <n>`
//   2. Cloud dispatches    -> `agents cloud list --json`
//   3. Team DAGs           -> `agents teams list --json`
//
// Each wrapper has a 3-second timeout and returns [] on any failure so a
// single slow source can't stall the voice turn.

import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execAsync = promisify(exec);
const TIMEOUT_MS = 3_000;

export interface SessionLite {
  id: string;
  shortId: string;
  agent: string;          // 'claude' | 'codex' | 'gemini' | 'opencode' | 'openclaw'
  version?: string;
  account?: string;
  timestamp: string;
  project?: string;
  cwd?: string;
  gitBranch?: string;
  topic?: string;         // the session's headline (often the first prompt)
  label?: string;         // user-set name via Claude /rename
  messageCount?: number;
  tokenCount?: number;
  isTeamOrigin?: boolean;
  teamOrigin?: { handle?: string; mode?: string };
  // Joined-in at runtime:
  openInIde?: boolean;    // true when a live VS Code terminal owns this sessionId
}

export interface CloudTaskLite {
  id: string;
  provider: string;
  agent: string;
  status: string;         // running | needs_review | completed | cancelled | failed
  prompt: string;
  repo?: string | null;
  updatedAt?: string;
}

export interface TeamLite {
  task_name: string;
  agent_count: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  stopped: number;
  workspace_dir?: string;
  modified_at?: string;
}

export interface SessionEvent {
  type: string;           // message | tool_use | tool_result | thinking | usage | ...
  timestamp?: string;
  role?: 'user' | 'assistant';
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  path?: string;
  success?: boolean;
  output?: string;
}

export async function listLocalSessions(opts: { since?: string; limit?: number; all?: boolean } = {}): Promise<SessionLite[]> {
  const since = opts.since ?? '2h';
  const limit = opts.limit ?? 30;
  const all = opts.all !== false;
  const cmd = `agents sessions --json --since ${shellArg(since)} --limit ${limit}${all ? ' --all --teams' : ''}`;
  return runJson<SessionLite[]>(cmd, []);
}

export async function readSessionEvents(sessionId: string, lastN = 20): Promise<SessionEvent[]> {
  // --last keeps only the last N turns from each agent; --json emits the event array.
  const cmd = `agents sessions ${shellArg(sessionId)} --json --last ${lastN}`;
  return runJson<SessionEvent[]>(cmd, []);
}

export async function listCloudTasks(): Promise<CloudTaskLite[]> {
  const raw = await runJson<any[]>('agents cloud list --json', []);
  return raw.map((r) => ({
    id: String(r.id ?? ''),
    provider: String(r.provider ?? ''),
    agent: String(r.agent ?? ''),
    status: String(r.status ?? ''),
    prompt: String(r.prompt ?? '').slice(0, 200),
    repo: r.repo ? String(r.repo) : null,
    updatedAt: r.updatedAt ? String(r.updatedAt) : undefined,
  }));
}

export async function listTeams(): Promise<TeamLite[]> {
  const raw = await runJson<any>('agents teams list --json', { teams: [] });
  const teams = Array.isArray(raw) ? raw : Array.isArray(raw?.teams) ? raw.teams : [];
  return teams.filter((t: any) => (t.running ?? 0) + (t.pending ?? 0) > 0);
}

// Collect live session ids from the VS Code terminal environment so we can
// mark which sessions are "open in the IDE" without re-reading JSONL.
export function openSessionIdsFromIde(): Set<string> {
  const ids = new Set<string>();
  for (const t of vscode.window.terminals) {
    if (t.exitStatus !== undefined) continue;
    const opts = t.creationOptions as vscode.TerminalOptions;
    const env = opts?.env as Record<string, string | undefined> | undefined;
    const sid = env?.AGENT_SESSION_ID;
    if (sid) ids.add(sid);
  }
  return ids;
}

async function runJson<T>(cmd: string, fallback: T): Promise<T> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    const trimmed = stdout.trim();
    if (!trimmed) return fallback;
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

function shellArg(s: string): string {
  // agents-cli options are tame values; still quote to be safe.
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
