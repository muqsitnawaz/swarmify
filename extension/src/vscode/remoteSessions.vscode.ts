// Cross-host session aggregation — SSH fan-out + host discovery (extension host).
//
// Discovers reachable machines (SSH config + Tailscale), then shells out to the
// `agents` CLI on each — locally for this machine, over SSH (`--host`) for the
// rest — to list active sessions (Tier-1) and, on demand, render one session as
// markdown (Tier-2). All parsing/normalizing lives in the pure core module
// (src/core/remoteSessions.ts); this file only does I/O + fan-out + caching.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { homedir } from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import {
  RemoteSession,
  HostInfo,
  HostGroup,
  normalizeActiveSession,
  dedupeSessions,
  enrichWithSessionContent,
  groupByHost,
} from '../core/remoteSessions';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/** This machine's name — its local sessions are queried directly (no SSH). */
export const LOCAL_HOST = os.hostname();
/** Canonical label the webview uses for this machine. The real os.hostname() is
 *  kept only for SSH/isLocal detection; every host string that crosses to the UI
 *  is normalized to this so the 'this-mac' checks there actually match. */
export const LOCAL_LABEL = 'this-mac';

const ACTIVE_TIMEOUT_LOCAL_MS = 6000;
const ACTIVE_TIMEOUT_REMOTE_MS = 10000;
const DETAIL_TIMEOUT_MS = 15000;
const TAILSCALE_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 4000;

// Resolve the `agents` binary once. The extension-host PATH can differ from an
// interactive shell's, so `which` beats assuming it is on PATH (mirrors
// linear.vscode.ts:findLinearCli).
let cachedAgentsPath: string | null = null;
async function findAgentsCli(): Promise<string> {
  if (cachedAgentsPath !== null) return cachedAgentsPath || 'agents';
  try {
    const { stdout } = await execAsync('which agents');
    cachedAgentsPath = stdout.trim();
    return cachedAgentsPath || 'agents';
  } catch {
    cachedAgentsPath = '';
    return 'agents';
  }
}

// --- Host discovery ---------------------------------------------------------

/** Parse `Host` aliases out of ~/.ssh/config, skipping wildcard patterns. */
async function readSshConfigHosts(): Promise<string[]> {
  const cfg = path.join(homedir(), '.ssh', 'config');
  let text: string;
  try {
    text = await fs.promises.readFile(cfg, 'utf-8');
  } catch {
    return [];
  }
  const hosts: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*Host\s+(.+?)\s*$/i);
    if (!m) continue;
    for (const name of m[1].split(/\s+/)) {
      if (!name || name.includes('*') || name.includes('?')) continue;
      hosts.push(name);
    }
  }
  return hosts;
}

/** Tailscale MagicDNS peers + their online state (empty if tailscale absent). */
async function readTailscaleHosts(): Promise<HostInfo[]> {
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], {
      timeout: TAILSCALE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    const data = JSON.parse(stdout);
    const out: HostInfo[] = [];
    const peers = data?.Peer && typeof data.Peer === 'object' ? Object.values(data.Peer) : [];
    for (const peer of peers as any[]) {
      const name = typeof peer?.HostName === 'string' ? peer.HostName : '';
      if (!name) continue;
      out.push({ name, online: peer?.Online === true });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Enumerate reachable hosts: local machine (always, online) + SSH config aliases
 * + Tailscale peers. Deduped by name; the local machine is never double-listed.
 * SSH-config-only hosts are optimistically online:true — the Tier-1 fetch marks
 * them offline if the query fails.
 */
export async function discoverHosts(): Promise<HostInfo[]> {
  const [sshHosts, tsHosts] = await Promise.all([
    readSshConfigHosts(),
    readTailscaleHosts(),
  ]);

  const byName = new Map<string, HostInfo>();
  byName.set(LOCAL_HOST, { name: LOCAL_HOST, online: true });
  for (const h of sshHosts) {
    if (h === LOCAL_HOST || byName.has(h)) continue;
    byName.set(h, { name: h, online: true });
  }
  for (const h of tsHosts) {
    if (h.name === LOCAL_HOST) continue;
    // Tailscale's Online flag is authoritative; let it overwrite an SSH default.
    byName.set(h.name, h);
  }
  return [...byName.values()];
}

// --- Tier-1: active fetch ---------------------------------------------------

/** Read the tail of a local session file for activity/throughput enrichment. */
async function readSessionTail(sessionFile: string, agentType: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(sessionFile);
    const size = stat.size;
    const fh = await fs.promises.open(sessionFile, 'r');
    try {
      // Gemini is a single JSON object — must read the whole file. Claude/Codex
      // are JSONL; the last 256KB covers the rolling throughput window + latest
      // activity without re-reading multi-MB logs.
      const readStart = agentType === 'gemini' ? 0 : Math.max(0, size - 256 * 1024);
      const buf = Buffer.alloc(size - readStart);
      await fh.read(buf, 0, buf.length, readStart);
      return buf.toString('utf-8');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/** Run `agents sessions --active --json`, locally or on one remote via --host. */
async function fetchActiveForHost(host: string, isLocal: boolean, fetchedAt: number): Promise<{
  host: string;
  online: boolean;
  sessions: RemoteSession[];
}> {
  const agentsBin = await findAgentsCli();
  const args = ['sessions', '--active', '--json'];
  if (!isLocal) args.push('--host', host);
  try {
    const { stdout } = await execFileAsync(agentsBin, args, {
      timeout: isLocal ? ACTIVE_TIMEOUT_LOCAL_MS : ACTIVE_TIMEOUT_REMOTE_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    const raw: any[] = Array.isArray(parsed) ? parsed : [];
    const normalized = raw
      .filter((rec) => rec && typeof rec === 'object')
      .map((rec) => normalizeActiveSession(rec, host, fetchedAt));
    // Collapse the many-processes-per-session records to one card BEFORE enriching,
    // so each session file is read once (not once per duplicate pid) and the header
    // count matches what the feed renders.
    const unique = dedupeSessions(normalized);
    const sessions: RemoteSession[] = [];
    for (let session of unique) {
      // Only the local host can cheaply read session files to enrich activity,
      // throughput, and waiting. Remote hosts stay status-only until Tier-2.
      if (isLocal && session.sessionFile) {
        const content = await readSessionTail(session.sessionFile, session.agentType);
        if (content) session = enrichWithSessionContent(session, content, fetchedAt);
      }
      sessions.push(session);
    }
    return { host, online: true, sessions };
  } catch {
    // Dead / slow / unreachable host — never throw the whole fan-out.
    return { host, online: false, sessions: [] };
  }
}

export interface HostSessionsResult {
  hosts: HostInfo[];
  sessions: RemoteSession[];
  groups: HostGroup[];
  fetchedAt: number;
}

// Short-TTL cache + in-flight guard so the webview polling this does not launch
// overlapping SSH fan-outs (mirrors the throughputCache intent in
// settings.vscode.ts).
let activeCache: { at: number; result: HostSessionsResult } | null = null;
let activeInFlight: Promise<HostSessionsResult> | null = null;

/**
 * Tier-1: enumerate hosts and fetch active sessions from each in parallel. One
 * dead host yields {online:false} with no sessions instead of failing the batch.
 * Cached for CACHE_TTL_MS; concurrent callers share the in-flight promise.
 */
export async function fetchHostSessions(fetchedAt: number = Date.now()): Promise<HostSessionsResult> {
  if (activeCache && fetchedAt - activeCache.at < CACHE_TTL_MS) return activeCache.result;
  if (activeInFlight) return activeInFlight;

  activeInFlight = (async () => {
    const hosts = await discoverHosts();
    const results = await Promise.all(
      hosts.map((h) => {
        const isLocal = h.name === LOCAL_HOST;
        // Label local sessions 'this-mac' for the UI; still no --host (isLocal).
        return fetchActiveForHost(isLocal ? LOCAL_LABEL : h.name, isLocal, fetchedAt);
      })
    );
    const sessions: RemoteSession[] = [];
    const resolvedHosts: HostInfo[] = results.map((r) => {
      sessions.push(...r.sessions);
      return { name: r.host, online: r.online };
    });
    const groups = groupByHost(sessions, resolvedHosts, fetchedAt);
    const result: HostSessionsResult = { hosts: resolvedHosts, sessions, groups, fetchedAt };
    activeCache = { at: fetchedAt, result };
    return result;
  })();

  try {
    return await activeInFlight;
  } finally {
    activeInFlight = null;
  }
}

// --- Tier-2: rich detail ----------------------------------------------------

export interface HostSessionDetail {
  host: string;
  sessionId: string;
  markdown: string;
  error?: string;
}

/**
 * Tier-2: render one remote (or local) session as markdown on demand. Runs
 * `agents sessions <id> --markdown --include tools`, over SSH via --host for
 * remote machines. Returns an error string rather than throwing.
 */
export async function fetchHostSessionDetail(
  host: string,
  sessionId: string
): Promise<HostSessionDetail> {
  const agentsBin = await findAgentsCli();
  const isLocal = host === LOCAL_HOST || host === LOCAL_LABEL;
  const args = ['sessions', sessionId, '--markdown', '--include', 'tools'];
  if (!isLocal) args.push('--host', host);
  try {
    const { stdout } = await execFileAsync(agentsBin, args, {
      timeout: DETAIL_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { host, sessionId, markdown: stdout };
  } catch (err) {
    return {
      host,
      sessionId,
      markdown: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
