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
import { deriveHostLoad, parseRemoteCpuRatio } from '../core/dispatchRanking';

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
// The local-only fast path polls ~3s; a sub-poll TTL keeps two near-simultaneous
// local ticks from double-spawning the local `agents` subprocess.
const LOCAL_CACHE_TTL_MS = 1500;
const LOAD_PROBE_TIMEOUT_MS = 4000;
// Cap on concurrent host fan-out. Offline hosts are skipped before this, so the
// online set is usually small; the cap just stops a large tailnet from spawning a
// thundering herd of ssh handshakes at once (the M5-freeze failure mode).
const FANOUT_CONCURRENCY = 4;
// Reuse one SSH connection per host across probes instead of a fresh handshake
// each time. First connect pays the handshake; the rest ride the warm tunnel.
const SSH_MUX_OPTS = [
  '-o', 'ControlMaster=auto',
  '-o', 'ControlPath=~/.ssh/cm-%r@%h:%p',
  '-o', 'ControlPersist=60s',
];

/** Run `tasks` with at most `limit` in flight at once, preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

// Common CLI install dirs a GUI-launched editor's PATH usually MISSES. A raw
// exec (no login shell) on macOS often has only /usr/bin:/bin, so `which agents`
// and `ssh` fail even though a terminal finds them. We prepend these to PATH for
// every shell-out here. (Homebrew first so the running install wins over the
// stale ~/.hermes copy that triggers the CLI's "multiple installs" warning.)
const EXTRA_BIN_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(homedir(), '.local', 'bin'),
  path.join(homedir(), '.bun', 'bin'),
];
function pathAugmentedEnv(): NodeJS.ProcessEnv {
  const extra = EXTRA_BIN_DIRS.join(':');
  return { ...process.env, PATH: `${extra}:${process.env.PATH || ''}` };
}

/** Resolve `p`, or `fallback` after `ms` — guards against a child that ignores its
 *  own timeout (a hung ssh) and would otherwise block the whole fan-out forever. */
function withHardTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// Resolve the `agents` binary once. The extension-host PATH can differ from an
// interactive shell's, so try `which` with an augmented PATH, then fall back to
// probing known install dirs directly (mirrors linear.vscode.ts:findLinearCli).
let cachedAgentsPath: string | null = null;
async function findAgentsCli(): Promise<string> {
  if (cachedAgentsPath !== null) return cachedAgentsPath || 'agents';
  try {
    const { stdout } = await execAsync('which agents', { env: pathAugmentedEnv() });
    const p = stdout.trim();
    if (p) {
      cachedAgentsPath = p;
      return p;
    }
  } catch {
    // fall through to direct probing
  }
  for (const dir of EXTRA_BIN_DIRS) {
    const candidate = path.join(dir, 'agents');
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
      cachedAgentsPath = candidate;
      return candidate;
    } catch {
      // keep probing
    }
  }
  cachedAgentsPath = '';
  return 'agents';
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
      env: pathAugmentedEnv(),
    });
    const data = JSON.parse(stdout);
    const out: HostInfo[] = [];
    const peers = data?.Peer && typeof data.Peer === 'object' ? Object.values(data.Peer) : [];
    for (const peer of peers as any[]) {
      const name = typeof peer?.HostName === 'string' ? peer.HostName : '';
      if (!name) continue;
      const online = peer?.Online === true;
      // Pre-probe placeholders; fetchHostSessions overwrites with measured load.
      out.push({ name, online, agents: 0, load: online ? 'idle' : 'off', uses: 0 });
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
  // Pre-probe placeholders (agents/load/uses); fetchHostSessions overwrites them
  // with measured live load before the roster crosses to the webview.
  byName.set(LOCAL_HOST, { name: LOCAL_HOST, online: true, agents: 0, load: 'idle', uses: 0 });
  for (const h of sshHosts) {
    if (h === LOCAL_HOST || byName.has(h)) continue;
    byName.set(h, { name: h, online: true, agents: 0, load: 'idle', uses: 0 });
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

/**
 * Live CPU load ratio (1-min loadavg / cores) for one host. Local reads
 * os.loadavg()/os.cpus() directly (no shell-out); remote runs a single
 * `uptime; getconf _NPROCESSORS_ONLN` over the SAME ssh path the session fetch
 * uses. Returns null when the probe fails or the output can't be parsed — the
 * caller then derives load from agent count alone. Only called for reachable
 * hosts, so dead machines are never probed.
 */
async function probeCpuRatio(host: string, isLocal: boolean): Promise<number | null> {
  if (isLocal) {
    const cores = os.cpus().length;
    if (cores <= 0) return null;
    return os.loadavg()[0] / cores;
  }
  try {
    const { stdout } = await execFileAsync(
      'ssh',
      [...SSH_MUX_OPTS, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=4', host, 'uptime; getconf _NPROCESSORS_ONLN'],
      { timeout: LOAD_PROBE_TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024, env: pathAugmentedEnv() },
    );
    return parseRemoteCpuRatio(stdout);
  } catch {
    return null;
  }
}

/** Run `agents sessions --active --json`, locally or on one remote via --host.
 *  `probeCpu` gates the second (CPU-load) SSH round-trip: the live feed poll passes
 *  false to fetch sessions with ONE connection per host; the Dispatch panel passes
 *  true when it needs fresh load for ranking. */
async function fetchActiveForHost(host: string, isLocal: boolean, fetchedAt: number, probeCpu: boolean): Promise<{
  host: string;
  online: boolean;
  sessions: RemoteSession[];
  cpuRatio: number | null;
}> {
  const agentsBin = await findAgentsCli();
  const args = ['sessions', '--active', '--json'];
  if (!isLocal) args.push('--host', host);
  try {
    const { stdout } = await execFileAsync(agentsBin, args, {
      timeout: isLocal ? ACTIVE_TIMEOUT_LOCAL_MS : ACTIVE_TIMEOUT_REMOTE_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: pathAugmentedEnv(),
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
    // Host answered, so it is reachable. Local CPU is free (os.loadavg, no shell-out)
    // so always read it; a remote probe is a second SSH, so only when asked. Guarded
    // by its own hard timeout so a slow ssh can never extend the fan-out.
    const cpuRatio = (probeCpu || isLocal)
      ? await withHardTimeout(probeCpuRatio(host, isLocal), LOAD_PROBE_TIMEOUT_MS + 1000, null)
      : null;
    return { host, online: true, sessions, cpuRatio };
  } catch {
    // Dead / slow / unreachable host — never throw the whole fan-out.
    return { host, online: false, sessions: [], cpuRatio: null };
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
// `hasCpu` records whether this cached result carries live CPU load. A CPU-less feed
// result must NOT satisfy a Dispatch call that needs load for ranking, so a probeCpu
// caller treats a CPU-less cache as a miss.
let activeCache: { at: number; hasCpu: boolean; result: HostSessionsResult } | null = null;
let activeInFlight: Promise<HostSessionsResult> | null = null;
let localCache: { at: number; result: HostSessionsResult } | null = null;
let localInFlight: Promise<HostSessionsResult> | null = null;

export interface FetchHostSessionsOptions {
  /** Also probe each remote host's CPU load (a second SSH per host). The live feed
   *  poll leaves this false; the Dispatch panel sets it true for load ranking. */
  probeCpu?: boolean;
}

/** A discovered host offline at discovery time (Tailscale said so) becomes an
 *  offline roster entry WITHOUT an SSH attempt — this is the single biggest cost
 *  cut, since an unreachable host otherwise hangs a process up to the full
 *  ACTIVE_TIMEOUT_REMOTE_MS on every poll. */
function offlineHostInfo(name: string): HostInfo {
  return { name, online: false, agents: 0, load: 'off', uses: 0 };
}

/**
 * Tier-1: enumerate hosts and fetch active sessions from each ONLINE host in
 * parallel (bounded by FANOUT_CONCURRENCY). Offline hosts are skipped entirely and
 * appear as empty offline roster entries. One dead host yields {online:false} with
 * no sessions instead of failing the batch. Cached for CACHE_TTL_MS; concurrent
 * callers share the in-flight promise.
 */
export async function fetchHostSessions(
  fetchedAt: number = Date.now(),
  opts: FetchHostSessionsOptions = {},
): Promise<HostSessionsResult> {
  const probeCpu = opts.probeCpu === true;
  if (activeCache && fetchedAt - activeCache.at < CACHE_TTL_MS && (activeCache.hasCpu || !probeCpu)) {
    return activeCache.result;
  }
  if (activeInFlight) return activeInFlight;

  activeInFlight = (async () => {
    const hosts = await discoverHosts();
    // Only fan out to hosts believed reachable. SSH-config-only hosts are optimistically
    // online (discoverHosts default) so they are still probed; Tailscale-known-offline
    // peers are the ones we skip — the freeze culprit.
    const online = hosts.filter((h) => h.online);
    const offline = hosts.filter((h) => !h.online);
    const onlineResults = await mapWithConcurrency(online, FANOUT_CONCURRENCY, (h) => {
      const isLocal = h.name === LOCAL_HOST;
      const label = isLocal ? LOCAL_LABEL : h.name;
      // execFile's own timeout sends SIGTERM, which a hung ssh can ignore (stuck
      // on connect / host-key / auth). Race every host against a hard wall-clock
      // timeout that always resolves, so ONE unreachable machine can never block
      // the batch — which was leaving the whole Floor empty. Label local sessions
      // 'this-mac' for the UI; still no --host (isLocal).
      return withHardTimeout(
        fetchActiveForHost(label, isLocal, fetchedAt, probeCpu),
        isLocal ? ACTIVE_TIMEOUT_LOCAL_MS + 2000 : ACTIVE_TIMEOUT_REMOTE_MS + 2000,
        { host: label, online: false, sessions: [], cpuRatio: null }
      );
    });
    const sessions: RemoteSession[] = [];
    const resolvedHosts: HostInfo[] = onlineResults.map((r) => {
      sessions.push(...r.sessions);
      // agents = this host's active-session count (== HostGroup.sessions.length);
      // load = derived from that plus the live CPU ratio ('off' when offline);
      // uses = the same active count, the ranking tiebreak we can source today.
      const agents = r.sessions.length;
      const load = r.online ? deriveHostLoad(agents, r.cpuRatio) : 'off';
      return { name: r.host, online: r.online, agents, load, uses: agents };
    });
    // Keep skipped hosts visible in the roster so the sidebar still lists them offline.
    for (const h of offline) resolvedHosts.push(offlineHostInfo(h.name === LOCAL_HOST ? LOCAL_LABEL : h.name));
    const groups = groupByHost(sessions, resolvedHosts, fetchedAt);
    const result: HostSessionsResult = { hosts: resolvedHosts, sessions, groups, fetchedAt };
    activeCache = { at: fetchedAt, hasCpu: probeCpu, result };
    return result;
  })();

  try {
    return await activeInFlight;
  } finally {
    activeInFlight = null;
  }
}

/**
 * Local-only fast path: fetch just THIS machine's sessions (no SSH, no host
 * discovery). Feeds the 3s local poll so the feed feels live without paying the
 * remote fan-out cost. Returns a single-host ('this-mac') HostSessionsResult.
 */
export async function fetchLocalSessions(fetchedAt: number = Date.now()): Promise<HostSessionsResult> {
  if (localCache && fetchedAt - localCache.at < LOCAL_CACHE_TTL_MS) return localCache.result;
  if (localInFlight) return localInFlight;

  localInFlight = (async () => {
    const r = await withHardTimeout(
      fetchActiveForHost(LOCAL_LABEL, true, fetchedAt, false),
      ACTIVE_TIMEOUT_LOCAL_MS + 2000,
      { host: LOCAL_LABEL, online: false, sessions: [], cpuRatio: null },
    );
    const agents = r.sessions.length;
    const host: HostInfo = {
      name: LOCAL_LABEL,
      online: r.online,
      agents,
      load: r.online ? deriveHostLoad(agents, r.cpuRatio) : 'off',
      uses: agents,
    };
    const groups = groupByHost(r.sessions, [host], fetchedAt);
    const result: HostSessionsResult = { hosts: [host], sessions: r.sessions, groups, fetchedAt };
    localCache = { at: fetchedAt, result };
    return result;
  })();

  try {
    return await localInFlight;
  } finally {
    localInFlight = null;
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
      env: pathAugmentedEnv(),
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
