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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const execAsync = promisify(exec);
const TIMEOUT_MS = 3_000;

// VS Code extensions launched from Dock/Finder inherit a minimal PATH that
// usually doesn't include ~/.agents/shims or nvm. We resolve the absolute path
// to `agents` once at first call and reuse it. Falls through to a login shell
// lookup if the canonical locations miss.
let cachedAgentsBin: string | undefined;
let lastResolveError: string | undefined;

async function resolveAgentsBin(): Promise<string> {
  if (cachedAgentsBin) return cachedAgentsBin;

  // FIRST: use the user's login shell. Its PATH reflects their own preference
  // (nvm over brew etc) and it picks the version they're actively updating.
  // A stale copy in /opt/homebrew/bin can lack recent subcommands (cloud,
  // teams) even though it resolves as "a valid binary" - trusting the shell
  // avoids that trap.
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const { stdout } = await execAsync(`${shell} -lc 'command -v agents'`, { timeout: 5_000 });
    const p = stdout.trim();
    if (p && fs.existsSync(p)) {
      cachedAgentsBin = p;
      return p;
    }
  } catch { /* fall through to filesystem probes */ }

  // FALLBACKS: probe common locations. nvm before brew because brew copies
  // go stale; shims first because that's the canonical agents-cli install.
  const candidates: string[] = [path.join(os.homedir(), '.agents', 'shims', 'agents')];
  try {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    const versions = fs.readdirSync(nvmDir).sort().reverse();
    for (const v of versions) candidates.push(path.join(nvmDir, v, 'bin', 'agents'));
  } catch { /* no nvm */ }
  candidates.push('/opt/homebrew/bin/agents', '/usr/local/bin/agents');

  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        cachedAgentsBin = p;
        return p;
      }
    } catch { /* next */ }
  }

  lastResolveError = 'agents CLI not found via login shell or common locations (~/.agents/shims, nvm, /opt/homebrew, /usr/local)';
  throw new Error(lastResolveError);
}

export function getLastSourcesError(): string | undefined {
  return lastResolveError;
}

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
  const args = ['sessions', '--json', '--since', since, '--limit', String(limit)];
  if (all) args.push('--all', '--teams');
  return runJson<SessionLite[]>(args, []);
}

export async function readSessionEvents(sessionId: string, lastN = 20): Promise<SessionEvent[]> {
  return runJson<SessionEvent[]>(['sessions', sessionId, '--json', '--last', String(lastN)], []);
}

export async function listCloudTasks(): Promise<CloudTaskLite[]> {
  const raw = await runJson<any[]>(['cloud', 'list', '--json'], []);
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
  const raw = await runJson<any>(['teams', 'list', '--json'], { teams: [] });
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

async function runJson<T>(args: string[], fallback: T): Promise<T> {
  try {
    const bin = await resolveAgentsBin();
    const cmd = [shellQuote(bin), ...args.map(shellQuote)].join(' ');
    // The agents binary is a `#!/usr/bin/env node` script. The extension host
    // on macOS inherits a minimal PATH (no nvm, no homebrew) so the shebang
    // can't find `node`. Augment PATH with the directory of the resolved
    // binary plus common node locations so shebang + any transitive shell-outs
    // (git, etc.) resolve.
    const { stdout } = await execAsync(cmd, {
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PATH: buildAugmentedPath(bin) },
    });
    const trimmed = stdout.trim();
    if (!trimmed) return fallback;
    return JSON.parse(trimmed) as T;
  } catch (err: any) {
    lastResolveError = `agents ${args.join(' ')}: ${err?.message ?? String(err)}`;
    return fallback;
  }
}

function buildAugmentedPath(binPath: string): string {
  const binDir = path.dirname(binPath);
  const extras = [
    binDir,
    path.join(os.homedir(), '.agents', 'shims'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  // Also pick up the active nvm node bin dir if binPath isn't already there.
  try {
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    const versions = fs.readdirSync(nvmDir).sort().reverse();
    if (versions[0]) extras.unshift(path.join(nvmDir, versions[0], 'bin'));
  } catch { /* no nvm */ }
  const existing = process.env.PATH ?? '';
  const seen = new Set<string>();
  const combined: string[] = [];
  for (const p of [...extras, ...existing.split(':')]) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    combined.push(p);
  }
  return combined.join(':');
}

function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
