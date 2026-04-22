// VS Code glue for the terminalReadiness state machine.
//
// One global registry keyed by vscode.Terminal instance. Each entry owns its
// own probes/watchers/listeners and is torn down when the terminal closes.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  ReadinessEntry,
  ReadinessEvent,
  createEntry,
  markEvent,
  resetFrom,
  waitFor as coreWaitFor,
  dispose as coreDispose,
  hasFired,
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

interface Registered {
  entry: ReadinessEntry;
  terminal: vscode.Terminal;
  pid: number | null;
  disposables: vscode.Disposable[];
  timers: NodeJS.Timeout[];
  watchers: fs.FSWatcher[];
  agentArmed: boolean;
}

const registry = new Map<vscode.Terminal, Registered>();

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
// command. `sessionFilePath` is optional; if supplied we use fs.watch as the
// fast path, otherwise we rely purely on the pgrep idle probe.
export interface ArmAgentOptions {
  sessionFilePath?: string;
}

export function armAgentReady(terminal: vscode.Terminal, opts: ArmAgentOptions = {}): void {
  const r = registry.get(terminal);
  if (!r) return;
  if (r.agentArmed) return;
  if (hasFired(r.entry, 'agentReady')) return;
  r.agentArmed = true;

  if (opts.sessionFilePath) {
    watchSessionFile(r, opts.sessionFilePath);
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
  for (const d of r.disposables) d.dispose();
  for (const t of r.timers) clearTimeout(t);
  for (const w of r.watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  coreDispose(r.entry, 'terminal closed');
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

  const tick = async () => {
    if (r.entry.disposed) return;
    if (hasFired(r.entry, 'agentReady')) return;

    try {
      const { stdout: childrenOut } = await execAsync(`pgrep -P ${pid}`);
      const childPid = childrenOut.trim().split(/\s+/)[0];
      if (!childPid) {
        consecutiveIdle = 0;
        const t = setTimeout(tick, IDLE_POLL_MS);
        r.timers.push(t);
        return;
      }

      const { stdout: statOut } = await execAsync(`ps -p ${childPid} -o stat=`);
      const state = statOut.trim();
      // Sleeping on I/O: first char 'S' means interruptible sleep (waiting on pty read).
      const idle = state.startsWith('S');
      if (idle) {
        consecutiveIdle++;
        if (consecutiveIdle >= IDLE_DEBOUNCE_COUNT) {
          markEvent(r.entry, 'agentReady');
          return;
        }
      } else {
        consecutiveIdle = 0;
      }
    } catch {
      // Missing processes just reset the counter and keep polling.
      consecutiveIdle = 0;
    }

    const t = setTimeout(tick, IDLE_POLL_MS);
    r.timers.push(t);
  };

  const first = setTimeout(tick, IDLE_POLL_MS);
  r.timers.push(first);
}

function watchSessionFile(r: Registered, filePath: string): void {
  // Walk up to find an existing parent directory; the file itself likely
  // doesn't exist yet.
  let dir = path.dirname(filePath);
  while (!fs.existsSync(dir) && dir !== path.dirname(dir)) {
    dir = path.dirname(dir);
  }
  if (!fs.existsSync(dir)) return;

  try {
    const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const changed = path.join(dir, filename.toString());
      if (changed !== filePath) return;
      if (hasFired(r.entry, 'agentReady')) return;
      if (fs.existsSync(filePath)) {
        markEvent(r.entry, 'agentReady');
      }
    });
    r.watchers.push(watcher);

    // Also check immediately in case the file already exists.
    if (fs.existsSync(filePath)) {
      markEvent(r.entry, 'agentReady');
    }
  } catch {
    // Best-effort; pgrep probe will still fire.
  }
}

// --- Test-only helpers ---------------------------------------------------

export function __clearRegistryForTests(): void {
  for (const r of registry.values()) {
    for (const d of r.disposables) d.dispose();
    for (const t of r.timers) clearTimeout(t);
    for (const w of r.watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
  }
  registry.clear();
}
