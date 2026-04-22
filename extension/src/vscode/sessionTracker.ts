import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type TrackedAgentType = 'claude' | 'codex';

type SessionChangeListener = (
  terminal: vscode.Terminal,
  oldId: string | undefined,
  newId: string,
) => void;

interface TrackedTerminal {
  terminal: vscode.Terminal;
  agentType: TrackedAgentType;
  workspacePath: string;
  sessionId?: string;
  trackedFile?: string;
}

interface SharedWatcher {
  watcher: fs.FSWatcher;
  refCount: number;
  dir: string;
  agentType: TrackedAgentType;
}

const DEBOUNCE_MS = 300;
const LINE_CAP = 100;
const DORMANT_THRESHOLD_MS = 10_000;

let initialized = false;
let listeners: SessionChangeListener[] = [];
const tracked = new Map<vscode.Terminal, TrackedTerminal>();
const watchersByDir = new Map<string, SharedWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
const lastWriteMs = new Map<string, number>();
let midnightTimer: NodeJS.Timeout | undefined;

function homeDir(): string {
  return os.homedir();
}

function workspaceToClaudeFolder(workspacePath: string): string {
  return workspacePath.replace(/[\/\.]/g, '-');
}

function claudeRootsFor(workspacePath: string): string[] {
  const folder = workspaceToClaudeFolder(workspacePath);
  const roots: string[] = [];
  const canonical = path.join(homeDir(), '.claude', 'projects', folder);
  roots.push(canonical);
  const versionsDir = path.join(homeDir(), '.agents', 'versions', 'claude');
  if (fs.existsSync(versionsDir)) {
    try {
      for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        roots.push(
          path.join(versionsDir, entry.name, 'home', '.claude', 'projects', folder),
        );
      }
    } catch {
      /* ignore */
    }
  }
  return roots;
}

function codexRootToday(): string {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return path.join(homeDir(), '.codex', 'sessions', y, m, d);
}

function msUntilNextMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 30, 0);
  return next.getTime() - now.getTime();
}

function ensureDirExists(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return fs.existsSync(dir);
  }
}

function rootsFor(t: TrackedTerminal): string[] {
  return t.agentType === 'claude' ? claudeRootsFor(t.workspacePath) : [codexRootToday()];
}

function mountWatcher(dir: string, agentType: TrackedAgentType): void {
  if (watchersByDir.has(dir)) {
    watchersByDir.get(dir)!.refCount++;
    return;
  }
  if (!ensureDirExists(dir)) return;
  try {
    const watcher = fs.watch(dir, { recursive: false }, (event, filename) => {
      if (!filename) return;
      const name = filename.toString();
      if (event === 'rename') {
        onRename(dir, name, agentType);
      } else if (event === 'change') {
        lastWriteMs.set(path.join(dir, name), Date.now());
      }
    });
    watchersByDir.set(dir, { watcher, refCount: 1, dir, agentType });
  } catch {
    /* ignore */
  }
}

function releaseWatcher(dir: string): void {
  const w = watchersByDir.get(dir);
  if (!w) return;
  w.refCount--;
  if (w.refCount <= 0) {
    try {
      w.watcher.close();
    } catch {
      /* ignore */
    }
    watchersByDir.delete(dir);
  }
}

function onRename(dir: string, filename: string, agentType: TrackedAgentType): void {
  if (!filename.endsWith('.jsonl')) return;
  const full = path.join(dir, filename);
  const existing = debounceTimers.get(full);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(full);
    if (!fs.existsSync(full)) return;
    void processNewFile(full, agentType).catch(() => {});
  }, DEBOUNCE_MS);
  debounceTimers.set(full, timer);
}

interface ParseResult {
  forkedFromId?: string;
  codexCwd?: string;
}

async function parseHead(file: string, agentType: TrackedAgentType): Promise<ParseResult> {
  const result: ParseResult = {};
  const stream = fs.createReadStream(file, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of rl) {
      if (++count > LINE_CAP) break;
      if (!line.trim()) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (agentType === 'claude') {
        const forked = parsed?.forkedFrom?.sessionId;
        if (typeof forked === 'string' && forked.length > 0) {
          result.forkedFromId = forked;
          break;
        }
      } else {
        if (parsed?.type === 'session_meta') {
          const cwd = parsed?.payload?.cwd;
          if (typeof cwd === 'string') result.codexCwd = cwd;
          break;
        }
        if (parsed?.payload?.cwd && typeof parsed.payload.cwd === 'string') {
          result.codexCwd = parsed.payload.cwd;
          break;
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return result;
}

function sessionIdFromFile(file: string): string {
  return path.basename(file).replace(/\.jsonl$/, '');
}

async function processNewFile(file: string, agentType: TrackedAgentType): Promise<void> {
  const newId = sessionIdFromFile(file);
  const parsed = await parseHead(file, agentType);

  if (agentType === 'claude' && parsed.forkedFromId) {
    const match = findTrackedBySessionId(parsed.forkedFromId, 'claude');
    if (match) {
      applyChange(match, newId, file);
      return;
    }
  }

  if (agentType === 'codex') {
    const candidates = [...tracked.values()].filter(t => t.agentType === 'codex');
    const match = candidates.find(t => t.workspacePath === parsed.codexCwd);
    if (!match && !parsed.codexCwd) return;
    if (match && (!match.sessionId || match.sessionId === newId)) {
      applyChange(match, newId, file);
      return;
    }
  }

  await correlateKillRestart(file, newId, agentType);
}

function findTrackedBySessionId(
  sessionId: string,
  agentType: TrackedAgentType,
): TrackedTerminal | undefined {
  for (const t of tracked.values()) {
    if (t.agentType === agentType && t.sessionId === sessionId) return t;
  }
  return undefined;
}

async function correlateKillRestart(
  file: string,
  newId: string,
  agentType: TrackedAgentType,
): Promise<void> {
  const now = Date.now();
  const dormant = [...tracked.values()].filter(t => {
    if (t.agentType !== agentType) return false;
    if (!t.trackedFile) return false;
    const last = lastWriteMs.get(t.trackedFile) ?? 0;
    return now - last > DORMANT_THRESHOLD_MS;
  });

  if (dormant.length === 0) return;
  if (dormant.length === 1) {
    applyChange(dormant[0], newId, file);
    return;
  }

  const pickedPid = await newestChildPid(dormant);
  if (pickedPid === undefined) return;
  const picked = dormant.find(async t => {
    const pid = await (t.terminal.processId as Promise<number | undefined>);
    return pid === pickedPid;
  });
  if (picked) applyChange(picked, newId, file);
}

async function newestChildPid(terms: TrackedTerminal[]): Promise<number | undefined> {
  let newest: { pid: number; start: number } | undefined;
  for (const t of terms) {
    try {
      const shellPid = await t.terminal.processId;
      if (!shellPid) continue;
      const { stdout } = await execAsync(`pgrep -P ${shellPid}`);
      const pids = stdout.trim().split(/\s+/).filter(Boolean).map(Number);
      for (const pid of pids) {
        try {
          const { stdout: lstart } = await execAsync(`ps -p ${pid} -o lstart=`);
          const start = Date.parse(lstart.trim());
          if (!newest || start > newest.start) newest = { pid, start };
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  return newest?.pid;
}

function applyChange(t: TrackedTerminal, newId: string, file: string): void {
  if (t.sessionId === newId) return;
  const old = t.sessionId;
  t.sessionId = newId;
  t.trackedFile = file;
  lastWriteMs.set(file, Date.now());
  for (const l of listeners) {
    try {
      l(t.terminal, old, newId);
    } catch (err) {
      console.error('[sessionTracker] listener threw', err);
    }
  }
}

export function initSessionTracker(context: vscode.ExtensionContext): void {
  if (initialized) return;
  initialized = true;

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(term => unregisterTerminal(term)),
  );

  const rearmCodex = (): void => {
    const activeCodex = [...tracked.values()].filter(t => t.agentType === 'codex');
    if (activeCodex.length > 0) {
      mountWatcher(codexRootToday(), 'codex');
    }
    midnightTimer = setTimeout(rearmCodex, msUntilNextMidnight());
  };
  midnightTimer = setTimeout(rearmCodex, msUntilNextMidnight());

  context.subscriptions.push({
    dispose: () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      for (const [, sw] of watchersByDir) {
        try {
          sw.watcher.close();
        } catch {
          /* ignore */
        }
      }
      watchersByDir.clear();
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      tracked.clear();
      lastWriteMs.clear();
      listeners = [];
      initialized = false;
    },
  });
}

export function registerTerminal(
  terminal: vscode.Terminal,
  agentType: TrackedAgentType,
  workspacePath: string,
  currentSessionId?: string,
): void {
  const existing = tracked.get(terminal);
  if (existing) {
    if (currentSessionId) existing.sessionId = currentSessionId;
    return;
  }
  const entry: TrackedTerminal = {
    terminal,
    agentType,
    workspacePath,
    sessionId: currentSessionId,
  };
  tracked.set(terminal, entry);
  for (const root of rootsFor(entry)) {
    mountWatcher(root, agentType);
  }
}

export function unregisterTerminal(terminal: vscode.Terminal): void {
  const entry = tracked.get(terminal);
  if (!entry) return;
  tracked.delete(terminal);
  if (entry.trackedFile) lastWriteMs.delete(entry.trackedFile);
  for (const root of rootsFor(entry)) {
    releaseWatcher(root);
  }
}

export function onSessionChanged(listener: SessionChangeListener): vscode.Disposable {
  listeners.push(listener);
  return {
    dispose: () => {
      listeners = listeners.filter(l => l !== listener);
    },
  };
}

export function __reset(): void {
  for (const [, sw] of watchersByDir) {
    try {
      sw.watcher.close();
    } catch {
      /* ignore */
    }
  }
  watchersByDir.clear();
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  if (midnightTimer) clearTimeout(midnightTimer);
  midnightTimer = undefined;
  tracked.clear();
  lastWriteMs.clear();
  listeners = [];
  initialized = false;
}

export function __setClaudeRootsForTests(roots: string[]): void {
  overrideClaudeRoots = roots;
}

let overrideClaudeRoots: string[] | null = null;
const _origClaudeRootsFor = claudeRootsFor;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _useOverride(_workspacePath: string): string[] {
  return overrideClaudeRoots ?? _origClaudeRootsFor(_workspacePath);
}

export function __testRegister(
  terminal: vscode.Terminal,
  agentType: TrackedAgentType,
  rootDirs: string[],
  currentSessionId?: string,
): void {
  const entry: TrackedTerminal = {
    terminal,
    agentType,
    workspacePath: '/__test__',
    sessionId: currentSessionId,
  };
  tracked.set(terminal, entry);
  for (const root of rootDirs) mountWatcher(root, agentType);
}
