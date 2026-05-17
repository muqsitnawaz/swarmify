// VS Code glue for the terminalReadiness state machine.
//
// One global registry keyed by vscode.Terminal instance. Each entry owns its
// own probes/watchers/listeners and is torn down when the terminal closes.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

// Diagnostic file logger for shell adoption — VS Code's console.log doesn't
// land in any persisted log file, so we mirror adoption events to disk for
// post-hoc debugging. Path: ~/.cache/swarmify/shell-adoption.log
const ADOPTION_LOG_PATH = path.join(os.homedir(), '.cache', 'swarmify', 'shell-adoption.log');
let adoptionLogReady = false;
function adoptLog(msg: string): void {
  try {
    if (!adoptionLogReady) {
      fs.mkdirSync(path.dirname(ADOPTION_LOG_PATH), { recursive: true });
      adoptionLogReady = true;
    }
    fs.appendFileSync(ADOPTION_LOG_PATH, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* ignore */ }
}
import {
  ReadinessEntry,
  ReadinessEvent,
  createEntry,
  markEvent,
  resetFrom,
  waitFor as coreWaitFor,
  dispose as coreDispose,
  hasFired,
  AgentLauncherKey,
  detectAgentKeyFromArgs,
  extractSessionIdFromArgs,
} from '../core/terminalReadiness';

const execAsync = promisify(exec);

const KNOWN_SHELLS = new Set([
  'zsh', '-zsh', 'bash', '-bash', 'fish', '-fish', 'sh', '-sh',
]);

const PS_POLL_MS = 50;
const PS_TIMEOUT_MS = 2000;

const IDLE_POLL_MS = 150;
const IDLE_DEBOUNCE_COUNT = 2;
const PROMPT_READY_TIMEOUT_MS = 30_000;
const AGENT_READY_TIMEOUT_MS = 60_000;

// The agent process (Node-based TUIs like Claude/Codex/Gemini) will sit in
// 'S' state during ANY I/O wait — including auto-update network calls that
// fire before the TUI renders. A short idle debounce is not sufficient to
// distinguish "idle at prompt" from "idle on network." We defend with a
// minimum wall-clock floor since the child appeared, and a longer continuous
// idle window than promptReady uses.
const AGENT_IDLE_DEBOUNCE_COUNT = 10;    // 1500ms of continuous S-state
const AGENT_MIN_CHILD_RUNTIME_MS = 2500; // child has existed at least 2.5s

interface Registered {
  entry: ReadinessEntry;
  terminal: vscode.Terminal;
  pid: number | null;
  disposables: vscode.Disposable[];
  timers: NodeJS.Timeout[];
  watchers: fs.FSWatcher[];
  fastPathDisposers: Array<() => void>;
  agentArmed: boolean;
}

const registry = new Map<vscode.Terminal, Registered>();

// Singleton watcher per session-root path. Without this, every terminal would
// mount its own recursive fs.watch on ~/.claude/projects (and per-version
// homes), and on macOS each subscription re-arms FSEvents over a multi-GB
// tree. With 20+ terminals open, the duplication caused observable system
// load. Refcounted: the watcher closes when the last callback unregisters.
interface SharedReadinessWatcher {
  watcher: fs.FSWatcher;
  callbacks: Set<(filename: string) => void>;
}
const sharedWatchers = new Map<string, SharedReadinessWatcher>();

function addSharedWatcher(
  root: string,
  callback: (filename: string) => void,
): () => void {
  let entry = sharedWatchers.get(root);
  if (!entry) {
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        const e = sharedWatchers.get(root);
        if (!e) return;
        for (const cb of e.callbacks) {
          try { cb(name); } catch { /* ignore */ }
        }
      });
    } catch {
      return () => { /* noop */ };
    }
    entry = { watcher, callbacks: new Set() };
    sharedWatchers.set(root, entry);
  }
  entry.callbacks.add(callback);
  return () => {
    const e = sharedWatchers.get(root);
    if (!e) return;
    e.callbacks.delete(callback);
    if (e.callbacks.size === 0) {
      try { e.watcher.close(); } catch { /* ignore */ }
      sharedWatchers.delete(root);
    }
  };
}

// Cache version-directory enumeration. Without this, every terminal
// registration runs a synchronous readdir over ~/.agents/versions/claude on
// the extension-host thread.
let cachedClaudeRoots: string[] | undefined;

let shellIntegrationDisposable: vscode.Disposable | null = null;
let closeDisposable: vscode.Disposable | null = null;

// Call once during extension activation.
export function initReadiness(context: vscode.ExtensionContext): void {
  if (shellIntegrationDisposable) return;

  shellIntegrationDisposable = vscode.window.onDidChangeTerminalShellIntegration(
    ({ terminal }) => {
      const r = registry.get(terminal);
      if (!r) return;
      markEvent(r.entry, 'promptReady');
    }
  );

  closeDisposable = vscode.window.onDidCloseTerminal((terminal) => {
    disposeTerminal(terminal);
  });

  context.subscriptions.push(shellIntegrationDisposable);
  context.subscriptions.push(closeDisposable);
}

export interface RegisterOptions {
  // When true, the terminal was restored after an IDE reload and its agent is
  // already running. Mark all events as fired immediately; do not probe.
  restored?: boolean;
}

// Register a terminal at creation time. Kicks off tabReady + shellReady probes.
// Idempotent: calling twice on the same terminal is a no-op.
export function registerTerminal(
  terminal: vscode.Terminal,
  opts: RegisterOptions = {}
): void {
  if (registry.has(terminal)) return;

  const r: Registered = {
    entry: createEntry(),
    terminal,
    pid: null,
    disposables: [],
    timers: [],
    watchers: [],
    fastPathDisposers: [],
    agentArmed: opts.restored === true,
  };
  registry.set(terminal, r);

  if (opts.restored) {
    // Resolve pid for completeness but skip all probes — the agent is up.
    Promise.resolve(terminal.processId).then((pid) => {
      if (pid) r.pid = pid;
    }, () => { /* ignore */ });
    markEvent(r.entry, 'agentReady');
    return;
  }

  // tabReady: resolves as soon as the pty is allocated.
  Promise.resolve(terminal.processId).then((pid) => {
    if (!pid) return;
    r.pid = pid;
    markEvent(r.entry, 'tabReady');
    startShellReadyProbe(r);
    startPromptReadyFallbackProbe(r);
  }, () => {
    // Terminal was disposed before pid resolved.
  });
}

// Called by Resume/Reload flows after ^C^C: we want to re-await promptReady
// fresh because the agent CLI needs to release the pty and the shell prompt
// needs to reappear.
export function resetAfterAgentExit(terminal: vscode.Terminal): void {
  const r = registry.get(terminal);
  if (!r) return;
  r.agentArmed = false;
  resetFrom(r.entry, 'promptReady');
  startPromptReadyFallbackProbe(r);
}

// Arm agentReady detection. Call this right after sending the agent launch
// command.
//
// Two detection paths run in parallel; whichever fires first wins:
//   1) Process-state probe: stable 'S' state + minimum child runtime.
//   2) Session-file fast path: if agentKey + sessionId provided, fs.watch
//      for the agent's session file to appear. Claude/Codex/Gemini/OpenCode
//      all write a session file when the TUI is up.
export type FastPathAgentKey = AgentLauncherKey;
export { detectAgentKeyFromArgs, extractSessionIdFromArgs };

export interface ArmAgentOptions {
  // Any string is accepted for ergonomics; only known agent keys get the
  // session-file fast path. Unknown keys (e.g. 'shell') fall through to the
  // process-state probe.
  agentKey?: string;
  sessionId?: string;
  cwd?: string;
}

const FAST_PATH_KEYS = new Set<FastPathAgentKey>([
  'claude', 'codex', 'gemini', 'cursor', 'opencode',
]);

function isFastPathKey(k: string | undefined): k is FastPathAgentKey {
  return k !== undefined && FAST_PATH_KEYS.has(k as FastPathAgentKey);
}

export function armAgentReady(terminal: vscode.Terminal, opts: ArmAgentOptions = {}): void {
  const r = registry.get(terminal);
  if (!r) return;
  if (r.agentArmed) return;
  if (hasFired(r.entry, 'agentReady')) return;
  r.agentArmed = true;

  if (isFastPathKey(opts.agentKey) && opts.sessionId) {
    armSessionFileFastPath(r, opts.agentKey, opts.sessionId, opts.cwd);
  }
  startAgentReadyProbe(r);
}

// Public wait. If timeoutMs is undefined, sensible defaults are picked per event.
export function waitFor(
  terminal: vscode.Terminal,
  event: ReadinessEvent,
  opts: { timeoutMs?: number } = {}
): Promise<void> {
  const r = registry.get(terminal);
  if (!r) {
    return Promise.reject(new Error(`terminal not registered for readiness: ${terminal.name}`));
  }

  const timeoutMs = opts.timeoutMs ?? defaultTimeoutFor(event);
  return coreWaitFor(r.entry, event, { timeoutMs });
}

function defaultTimeoutFor(event: ReadinessEvent): number | undefined {
  switch (event) {
    case 'tabReady': return 10_000;
    case 'shellReady': return 10_000;
    case 'promptReady': return PROMPT_READY_TIMEOUT_MS;
    case 'agentReady': return AGENT_READY_TIMEOUT_MS;
  }
}

export function disposeTerminal(terminal: vscode.Terminal): void {
  const r = registry.get(terminal);
  if (!r) return;
  registry.delete(terminal);
  shellAdoptions.delete(terminal);
  for (const d of r.disposables) d.dispose();
  for (const t of r.timers) clearTimeout(t);
  for (const w of r.watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  for (const d of r.fastPathDisposers) {
    try { d(); } catch { /* ignore */ }
  }
  coreDispose(r.entry, 'terminal closed');
}

// --- Shell adoption ------------------------------------------------------
//
// Polls the descendant process tree of an SH terminal looking for known
// agent CLIs. Fires `onAdopted` once with the detected agent and its
// session id (when resolvable). Stops itself after firing.
//
// Detection handles:
//   - direct invocation: `claude`, `codex`, `gemini`, `cursor-agent`, `opencode`
//   - node-wrapped binaries (where comm shows `node`) via args inspection
//   - `agents run <agent>` wrappers from agents-cli
//
// Session id resolution:
//   1. Inspect the agent process args for `--session-id <uuid>`
//   2. Fall back to scanning the agent's session-file root for a file with
//      mtime >= the agent process start time

const SHELL_ADOPTION_POLL_MS = 2000;
const SHELL_ADOPTION_MAX_LIFETIME_MS = 10 * 60 * 1000;
const SHELL_ADOPTION_TREE_DEPTH = 5;
const SHELL_ADOPTION_SESSION_LOOKBACK_MS = 60 * 1000;

const SESSION_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface ShellAdoptionInfo {
  agentKey: FastPathAgentKey;
  sessionId: string | undefined;
  childPid: number;
}

export type ShellAdoptionCallback = (info: ShellAdoptionInfo) => void;

interface ShellAdoptionState {
  startedAt: number;
  armed: boolean;
}

const shellAdoptions = new WeakMap<vscode.Terminal, ShellAdoptionState>();

export function armShellAdoption(
  terminal: vscode.Terminal,
  onAdopted: ShellAdoptionCallback
): void {
  const r = registry.get(terminal);
  if (!r) {
    adoptLog(`armShellAdoption: terminal "${terminal.name}" not in readiness registry — bailing`);
    return;
  }
  if (shellAdoptions.has(terminal)) {
    adoptLog(`armShellAdoption: terminal "${terminal.name}" already armed — skipping`);
    return;
  }
  const state: ShellAdoptionState = { startedAt: Date.now(), armed: true };
  shellAdoptions.set(terminal, state);
  adoptLog(`armShellAdoption: armed for terminal "${terminal.name}" (pid=${r.pid})`);

  let tickCount = 0;
  const tick = async () => {
    tickCount++;
    if (!state.armed) return;
    if (r.entry.disposed) {
      adoptLog(`tick #${tickCount} for "${terminal.name}": entry disposed, stopping`);
      shellAdoptions.delete(terminal);
      return;
    }
    if (Date.now() - state.startedAt > SHELL_ADOPTION_MAX_LIFETIME_MS) {
      adoptLog(`tick #${tickCount} for "${terminal.name}": max lifetime exceeded, dropping`);
      shellAdoptions.delete(terminal);
      return;
    }
    if (r.pid === null) {
      adoptLog(`tick #${tickCount} for "${terminal.name}": pid not yet resolved, retrying`);
      const t = setTimeout(tick, SHELL_ADOPTION_POLL_MS);
      r.timers.push(t);
      return;
    }

    try {
      const match = await findAgentInTree(r.pid, SHELL_ADOPTION_TREE_DEPTH);
      if (match) {
        adoptLog(`tick #${tickCount} for "${terminal.name}" (shellPid=${r.pid}): MATCH agentKey=${match.agentKey} childPid=${match.childPid} sessionIdFromArgs=${match.sessionId}`);
        const sessionId = match.sessionId
          ?? await locateSessionIdForAgent(match.agentKey, match.childPid);
        adoptLog(`tick #${tickCount} for "${terminal.name}": resolved sessionId=${sessionId}`);
        state.armed = false;
        shellAdoptions.delete(terminal);
        try {
          onAdopted({ agentKey: match.agentKey, sessionId, childPid: match.childPid });
          adoptLog(`tick #${tickCount} for "${terminal.name}": onAdopted callback returned cleanly`);
        } catch (err) {
          adoptLog(`tick #${tickCount} for "${terminal.name}": onAdopted callback threw: ${err}`);
          console.error('[READINESS] shell adoption callback threw', err);
        }
        return;
      } else if (tickCount % 5 === 1) {
        // log every ~10s while idle so we can see polling is alive
        adoptLog(`tick #${tickCount} for "${terminal.name}" (shellPid=${r.pid}): no agent CLI in descendant tree`);
      }
    } catch (err) {
      adoptLog(`tick #${tickCount} for "${terminal.name}": probe threw ${err}`);
    }

    const t = setTimeout(tick, SHELL_ADOPTION_POLL_MS);
    r.timers.push(t);
  };

  const first = setTimeout(tick, SHELL_ADOPTION_POLL_MS);
  r.timers.push(first);
}

interface AgentInTreeMatch {
  agentKey: FastPathAgentKey;
  childPid: number;
  sessionId?: string;
}

async function findAgentInTree(
  rootPid: number,
  maxDepth: number
): Promise<AgentInTreeMatch | null> {
  let frontier = [rootPid];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const childrenResults = await Promise.all(
      frontier.map(async (pid) => {
        try {
          const { stdout } = await execAsync(`pgrep -P ${pid}`);
          return stdout.trim().split(/\s+/).filter(Boolean).map((s) => parseInt(s, 10));
        } catch {
          return [];
        }
      })
    );
    const nextFrontier = childrenResults.flat().filter((n) => Number.isFinite(n));
    for (const childPid of nextFrontier) {
      try {
        const { stdout: argsOut } = await execAsync(`ps -p ${childPid} -o args=`);
        const args = argsOut.trim();
        const agentKey = detectAgentKeyFromArgs(args);
        if (agentKey) {
          return { agentKey, childPid, sessionId: extractSessionIdFromArgs(args) };
        }
      } catch {
        // child may have exited; skip
      }
    }
    frontier = nextFrontier;
  }
  return null;
}

async function locateSessionIdForAgent(
  agentKey: FastPathAgentKey,
  childPid: number
): Promise<string | undefined> {
  let childStartMs = Date.now() - SHELL_ADOPTION_SESSION_LOOKBACK_MS;
  try {
    const { stdout } = await execAsync(`ps -p ${childPid} -o lstart=`);
    const parsed = Date.parse(stdout.trim());
    if (!Number.isNaN(parsed)) childStartMs = parsed - 1000;
  } catch {
    // fall back to lookback window
  }

  const roots = sessionRootsForAgent(agentKey);
  let best: { sessionId: string; mtimeMs: number } | null = null;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const found = await collectRecentSessionFiles(root, childStartMs);
    for (const f of found) {
      const m = f.filename.match(SESSION_UUID_RE);
      if (!m) continue;
      if (!best || f.mtimeMs > best.mtimeMs) {
        best = { sessionId: m[0], mtimeMs: f.mtimeMs };
      }
    }
  }
  return best?.sessionId;
}

async function collectRecentSessionFiles(
  root: string,
  sinceMs: number
): Promise<Array<{ filename: string; mtimeMs: number }>> {
  const out: Array<{ filename: string; mtimeMs: number }> = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        const stat = await fs.promises.stat(full);
        if (e.isDirectory()) {
          if (stat.mtimeMs >= sinceMs - 1000) await walk(full, depth + 1);
        } else if (stat.mtimeMs >= sinceMs - 1000) {
          out.push({ filename: e.name, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // ignore stat errors
      }
    }
  };

  await walk(root, 0);
  return out;
}

// --- Probes ---------------------------------------------------------------

function startShellReadyProbe(r: Registered): void {
  const pid = r.pid;
  if (pid === null) return;
  const startedAt = Date.now();

  const tick = async () => {
    if (r.entry.disposed) return;
    if (hasFired(r.entry, 'shellReady')) return;

    try {
      const { stdout } = await execAsync(`ps -p ${pid} -o comm=`);
      const comm = stdout.trim().split('/').pop() || '';
      if (KNOWN_SHELLS.has(comm)) {
        markEvent(r.entry, 'shellReady');
        return;
      }
    } catch {
      // Process may have died; nothing to do.
      return;
    }

    if (Date.now() - startedAt > PS_TIMEOUT_MS) {
      // Give up and assume shellReady — whatever's in the pty is what the user
      // picked. Don't block the pipeline forever.
      markEvent(r.entry, 'shellReady');
      return;
    }

    const t = setTimeout(tick, PS_POLL_MS);
    r.timers.push(t);
  };
  tick();
}

function startPromptReadyFallbackProbe(r: Registered): void {
  const pid = r.pid;
  if (pid === null) return;
  if (hasFired(r.entry, 'promptReady')) return;

  // Small delay so shell integration (if enabled) has first shot at marking
  // promptReady. If it fires, we detect hasFired and skip further polls.
  let consecutiveIdle = 0;

  const tick = async () => {
    if (r.entry.disposed) return;
    if (hasFired(r.entry, 'promptReady')) return;

    try {
      const { stdout } = await execAsync(`pgrep -P ${pid}`);
      const children = stdout.trim();
      if (children === '') {
        consecutiveIdle++;
        if (consecutiveIdle >= IDLE_DEBOUNCE_COUNT) {
          markEvent(r.entry, 'promptReady');
          return;
        }
      } else {
        consecutiveIdle = 0;
      }
    } catch {
      // pgrep returns exit code 1 when no matches — promisified exec rejects.
      // That means zero children; count as idle tick.
      consecutiveIdle++;
      if (consecutiveIdle >= IDLE_DEBOUNCE_COUNT) {
        markEvent(r.entry, 'promptReady');
        return;
      }
    }

    const t = setTimeout(tick, IDLE_POLL_MS);
    r.timers.push(t);
  };

  // Start the first poll after an initial delay so the fast path has room.
  const first = setTimeout(tick, IDLE_POLL_MS);
  r.timers.push(first);
}

function startAgentReadyProbe(r: Registered): void {
  const pid = r.pid;
  if (pid === null) return;
  if (hasFired(r.entry, 'agentReady')) return;

  let consecutiveIdle = 0;
  let childFirstSeenAt: number | null = null;

  const tick = async () => {
    if (r.entry.disposed) return;
    if (hasFired(r.entry, 'agentReady')) return;

    try {
      const { stdout: childrenOut } = await execAsync(`pgrep -P ${pid}`);
      const childPid = childrenOut.trim().split(/\s+/)[0];
      if (!childPid) {
        // No child yet — agent CLI hasn't started. Reset both signals.
        consecutiveIdle = 0;
        childFirstSeenAt = null;
        const t = setTimeout(tick, IDLE_POLL_MS);
        r.timers.push(t);
        return;
      }

      if (childFirstSeenAt === null) {
        childFirstSeenAt = Date.now();
      }

      const { stdout: statOut } = await execAsync(`ps -p ${childPid} -o stat=`);
      const state = statOut.trim();
      const idle = state.startsWith('S');
      if (idle) {
        consecutiveIdle++;
        const runtimeMs = Date.now() - childFirstSeenAt;
        if (
          consecutiveIdle >= AGENT_IDLE_DEBOUNCE_COUNT &&
          runtimeMs >= AGENT_MIN_CHILD_RUNTIME_MS
        ) {
          markEvent(r.entry, 'agentReady');
          return;
        }
      } else {
        // Any R/D/Z state breaks continuity. This is the main defense against
        // mistaking network-I/O sleep for TUI-idle sleep.
        consecutiveIdle = 0;
      }
    } catch {
      consecutiveIdle = 0;
    }

    const t = setTimeout(tick, IDLE_POLL_MS);
    r.timers.push(t);
  };

  const first = setTimeout(tick, IDLE_POLL_MS);
  r.timers.push(first);
}

// Watch the agent's session file roots. As soon as a file named
// `{sessionId}.*` (jsonl/json) appears, the TUI has booted far enough to
// write its session metadata — a deterministic signal even when the
// process-state probe is still being fooled by network I/O.
// Hard timeout to tear down the fast-path callback even if agentReady never
// fires. Without this, an agent that fails to start leaks the watcher for the
// full terminal lifetime — death by a thousand cuts as terminals accumulate.
const FAST_PATH_SAFETY_TIMEOUT_MS = 30_000;

function armSessionFileFastPath(
  r: Registered,
  agentKey: FastPathAgentKey,
  sessionId: string,
  _cwd: string | undefined,
): void {
  const roots = sessionRootsForAgent(agentKey);
  const sessionIdLower = sessionId.toLowerCase();

  const checkFilename = (filename: string): boolean => {
    const base = filename.toLowerCase();
    // Claude/Codex/Gemini/OpenCode: filename contains sessionId (jsonl or json).
    // Cursor: {chatId}/store.db; sessionId is the chatId dir name.
    return base.includes(sessionIdLower);
  };

  const tearDown = (): void => {
    while (r.fastPathDisposers.length > 0) {
      const d = r.fastPathDisposers.pop();
      if (d) { try { d(); } catch { /* ignore */ } }
    }
  };

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dispose = addSharedWatcher(root, (filename) => {
      if (hasFired(r.entry, 'agentReady')) return;
      if (checkFilename(filename)) {
        markEvent(r.entry, 'agentReady');
        tearDown();
      }
    });
    r.fastPathDisposers.push(dispose);
  }

  const safetyTimer = setTimeout(tearDown, FAST_PATH_SAFETY_TIMEOUT_MS);
  r.timers.push(safetyTimer);
}

function sessionRootsForAgent(
  agentKey: FastPathAgentKey,
): string[] {
  const home = os.homedir();
  switch (agentKey) {
    case 'claude': {
      if (cachedClaudeRoots) return cachedClaudeRoots;
      // Shim sets CLAUDE_CONFIG_DIR per version, so files land under
      // ~/.agents/versions/claude/{v}/home/.claude/projects/... — watch both.
      const roots = [path.join(home, '.claude', 'projects')];
      const versionsDir = path.join(home, '.agents', 'versions', 'claude');
      if (fs.existsSync(versionsDir)) {
        try {
          for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            roots.push(path.join(versionsDir, entry.name, 'home', '.claude', 'projects'));
          }
        } catch { /* ignore */ }
      }
      cachedClaudeRoots = roots;
      return roots;
    }
    case 'codex':
      return [path.join(home, '.codex', 'sessions')];
    case 'gemini':
      return [path.join(home, '.gemini', 'tmp')];
    case 'opencode':
      return [path.join(home, '.local', 'share', 'opencode', 'storage', 'message')];
    case 'cursor':
      return [path.join(home, '.cursor', 'chats')];
  }
}


// --- Test-only helpers ---------------------------------------------------

export function __clearRegistryForTests(): void {
  for (const [terminal, r] of registry.entries()) {
    shellAdoptions.delete(terminal);
    for (const d of r.disposables) d.dispose();
    for (const t of r.timers) clearTimeout(t);
    for (const w of r.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    for (const d of r.fastPathDisposers) {
      try { d(); } catch { /* ignore */ }
    }
  }
  registry.clear();
  for (const [, sw] of sharedWatchers) {
    try { sw.watcher.close(); } catch { /* ignore */ }
  }
  sharedWatchers.clear();
  cachedClaudeRoots = undefined;
}
