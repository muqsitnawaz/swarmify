import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

const execAsync = promisify(exec);

export type TrackedAgentType = 'claude' | 'codex' | 'gemini' | 'opencode';

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
// Bound for `lastWriteMs`: every fs.watch event on a watched session dir adds
// an entry, but we only delete entries for tracked files. Without an upper
// bound the map grows for the entire extension-host lifetime — over a long
// day it accumulates thousands of stale paths.
const LAST_WRITE_MAX = 5000;

let initialized = false;
let listeners: SessionChangeListener[] = [];
const tracked = new Map<vscode.Terminal, TrackedTerminal>();
const watchersByDir = new Map<string, SharedWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
const lastWriteMs = new Map<string, number>();
const codexAdoptionClaims = new Set<string>();
let midnightTimer: NodeJS.Timeout | undefined;

function homeDir(): string {
  return os.homedir();
}

function workspaceToClaudeFolder(workspacePath: string): string {
  return workspacePath.replace(/[\/\.]/g, '-');
}

// Cached enumeration of installed Claude versions. Without this, every
// terminal registration runs a synchronous readdir on the extension-host
// thread.
let cachedClaudeVersions: string[] | undefined;

function claudeVersionDirs(): string[] {
  if (cachedClaudeVersions) return cachedClaudeVersions;
  const versionsDir = path.join(homeDir(), '.agents', 'versions', 'claude');
  const versions: string[] = [];
  if (fs.existsSync(versionsDir)) {
    try {
      for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) versions.push(entry.name);
      }
    } catch {
      /* ignore */
    }
  }
  cachedClaudeVersions = versions;
  return versions;
}

function claudeRootsFor(workspacePath: string): string[] {
  const folder = workspaceToClaudeFolder(workspacePath);
  const roots: string[] = [path.join(homeDir(), '.claude', 'projects', folder)];
  const versionsDir = path.join(homeDir(), '.agents', 'versions', 'claude');
  for (const ver of claudeVersionDirs()) {
    roots.push(path.join(versionsDir, ver, 'home', '.claude', 'projects', folder));
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

function workspaceHash(workspacePath: string): string {
  return createHash('sha256').update(workspacePath).digest('hex');
}

function geminiRootsFor(workspacePath: string): string[] {
  const base = path.basename(workspacePath);
  const hash = workspaceHash(workspacePath);
  const roots: string[] = [
    path.join(homeDir(), '.gemini', 'tmp', hash, 'chats'),
    path.join(homeDir(), '.gemini', 'tmp', base, 'chats'),
  ];
  return [...new Set(roots)];
}

function opencodeRootsFor(workspacePath: string): string[] {
  const projectRoot = path.join(homeDir(), '.local', 'share', 'opencode', 'storage', 'project');
  const sessionRoot = path.join(homeDir(), '.local', 'share', 'opencode', 'storage', 'session');
  const roots: string[] = [];
  try {
    for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const fullPath = path.join(projectRoot, entry.name);
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const worktree = parsed?.worktree;
        const id = parsed?.id;
        if (worktree === workspacePath && typeof id === 'string' && id.length > 0) {
          roots.push(path.join(sessionRoot, id));
        }
      } catch {
        /* ignore malformed project json */
      }
    }
  } catch {
    /* ignore missing opencode storage */
  }
  return [...new Set(roots)];
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
  switch (t.agentType) {
    case 'claude':
      return claudeRootsFor(t.workspacePath);
    case 'codex':
      return [codexRootToday()];
    case 'gemini':
      return geminiRootsFor(t.workspacePath);
    case 'opencode':
      return opencodeRootsFor(t.workspacePath);
    default:
      return [];
  }
}

// Insertion-order eviction: Map keeps insertion order, so the first key is
// the oldest. Drop one when we exceed the cap, then re-insert (which moves
// existing keys to the end).
function recordWrite(filePath: string): void {
  if (lastWriteMs.has(filePath)) {
    lastWriteMs.delete(filePath);
  } else if (lastWriteMs.size >= LAST_WRITE_MAX) {
    const oldest = lastWriteMs.keys().next().value;
    if (oldest !== undefined) lastWriteMs.delete(oldest);
  }
  lastWriteMs.set(filePath, Date.now());
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
      if (event === 'change') {
        recordWrite(path.join(dir, name));
      }
      if (event === 'rename' || event === 'change') {
        onRename(dir, name, agentType);
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
  const isJsonlAgent = agentType === 'claude' || agentType === 'codex';
  if (isJsonlAgent && !filename.endsWith('.jsonl')) return;
  if (!isJsonlAgent && !filename.endsWith('.json')) return;
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
  geminiProjectHash?: string;
  geminiSessionId?: string;
  opencodeDirectory?: string;
  opencodeSessionId?: string;
}

async function parseHead(file: string, agentType: TrackedAgentType): Promise<ParseResult> {
  const result: ParseResult = {};
  if (agentType === 'gemini' || agentType === 'opencode') {
    try {
      const raw = await fs.promises.readFile(file, 'utf-8');
      const parsed = JSON.parse(raw);
      if (agentType === 'gemini') {
        if (typeof parsed?.projectHash === 'string') {
          result.geminiProjectHash = parsed.projectHash;
        }
        if (typeof parsed?.sessionId === 'string') {
          result.geminiSessionId = parsed.sessionId;
        }
      } else {
        if (typeof parsed?.directory === 'string') {
          result.opencodeDirectory = parsed.directory;
        }
        if (typeof parsed?.id === 'string') {
          result.opencodeSessionId = parsed.id;
        }
      }
    } catch {
      /* ignore malformed json */
    }
    return result;
  }

  let stream: fs.ReadStream | undefined;
  let rl: readline.Interface | undefined;
  let count = 0;
  try {
    stream = fs.createReadStream(file, { encoding: 'utf-8' });
    rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
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
  } catch {
    /* ignore transient read errors (deleted/rotated files) */
  } finally {
    rl?.close();
    stream?.destroy();
  }
  return result;
}

function sessionIdFromFile(file: string): string {
  return path.basename(file).replace(/\.jsonl$/, '');
}

async function processNewFile(file: string, agentType: TrackedAgentType): Promise<void> {
  let newId = sessionIdFromFile(file);
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
    if (parsed.codexCwd) {
      const match = candidates.find(
        t => t.workspacePath === parsed.codexCwd && (!t.sessionId || t.sessionId === newId)
      );
      if (match) {
        applyChange(match, newId, file);
        return;
      }
    }
  }

  if (agentType === 'gemini') {
    if (parsed.geminiSessionId) newId = parsed.geminiSessionId;
    if (parsed.geminiProjectHash) {
      const candidates = [...tracked.values()].filter(t =>
        t.agentType === 'gemini' && workspaceHash(t.workspacePath) === parsed.geminiProjectHash
      );
      const match = candidates.find(t => !t.sessionId || t.sessionId === newId);
      if (match) {
        applyChange(match, newId, file);
        return;
      }
    }
  }

  if (agentType === 'opencode') {
    if (parsed.opencodeSessionId) newId = parsed.opencodeSessionId;
    if (parsed.opencodeDirectory) {
      const candidates = [...tracked.values()].filter(t =>
        t.agentType === 'opencode' && t.workspacePath === parsed.opencodeDirectory
      );
      const match = candidates.find(t => !t.sessionId || t.sessionId === newId);
      if (match) {
        applyChange(match, newId, file);
        return;
      }
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

  const picked = await newestDormantTerminal(dormant);
  if (picked) applyChange(picked, newId, file);
}

async function newestDormantTerminal(
  terms: TrackedTerminal[],
): Promise<TrackedTerminal | undefined> {
  let newest: { terminal: TrackedTerminal; start: number } | undefined;
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
          if (!isNaN(start) && (!newest || start > newest.start)) {
            newest = { terminal: t, start };
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
  return newest?.terminal;
}

function applyChange(t: TrackedTerminal, newId: string, file: string): void {
  const current = tracked.get(t.terminal);
  if (current !== t) return;
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

function isSessionIdAlreadyTracked(
  agentType: TrackedAgentType,
  sessionId: string,
  exclude?: vscode.Terminal,
): boolean {
  for (const t of tracked.values()) {
    if (exclude && t.terminal === exclude) continue;
    if (t.agentType !== agentType) continue;
    if (t.sessionId === sessionId) return true;
  }
  return false;
}

async function adoptExistingCodexSession(
  t: TrackedTerminal,
  rootsOverride?: string[],
): Promise<void> {
  if (t.agentType !== 'codex' || t.sessionId) return;

  const roots = rootsOverride && rootsOverride.length > 0 ? rootsOverride : rootsFor(t);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    let files: Array<{ file: string; mtimeMs: number }> = [];
    try {
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      const jsonlFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
        .map((e) => path.join(root, e.name));
      const stats = await Promise.all(
        jsonlFiles.map(async (file) => {
          try {
            const stat = await fs.promises.stat(file);
            return { file, mtimeMs: stat.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      files = stats.filter((v): v is { file: string; mtimeMs: number } => v !== null);
    } catch {
      continue;
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const candidate of files.slice(0, 120)) {
      const candidateId = sessionIdFromFile(candidate.file);
      if (isSessionIdAlreadyTracked('codex', candidateId, t.terminal)) continue;
      if (codexAdoptionClaims.has(candidateId)) continue;

      codexAdoptionClaims.add(candidateId);
      try {
        if (isSessionIdAlreadyTracked('codex', candidateId, t.terminal)) continue;

        const parsed = await parseHead(candidate.file, 'codex');
        if (parsed.codexCwd !== t.workspacePath) continue;
        applyChange(t, candidateId, candidate.file);
        return;
      } finally {
        codexAdoptionClaims.delete(candidateId);
      }
    }
  }
}

async function adoptExistingClaudeFork(
  t: TrackedTerminal,
  rootsOverride?: string[],
): Promise<void> {
  if (t.agentType !== 'claude' || !t.sessionId) return;

  const roots = rootsOverride && rootsOverride.length > 0 ? rootsOverride : rootsFor(t);
  const expectedForkFrom = t.sessionId;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    let files: Array<{ file: string; mtimeMs: number }> = [];
    try {
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      const jsonlFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
        .map((e) => path.join(root, e.name));
      const stats = await Promise.all(
        jsonlFiles.map(async (file) => {
          try {
            const stat = await fs.promises.stat(file);
            return { file, mtimeMs: stat.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      files = stats.filter((v): v is { file: string; mtimeMs: number } => v !== null);
    } catch {
      continue;
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const candidate of files.slice(0, 120)) {
      const parsed = await parseHead(candidate.file, 'claude');
      if (parsed.forkedFromId !== expectedForkFrom) continue;
      const candidateId = sessionIdFromFile(candidate.file);
      if (isSessionIdAlreadyTracked('claude', candidateId, t.terminal)) continue;
      applyChange(t, candidateId, candidate.file);
      return;
    }
  }
}

async function adoptExistingGeminiSession(
  t: TrackedTerminal,
  rootsOverride?: string[],
): Promise<void> {
  if (t.agentType !== 'gemini' || t.sessionId) return;

  const roots = rootsOverride && rootsOverride.length > 0 ? rootsOverride : rootsFor(t);
  const expectedHash = workspaceHash(t.workspacePath);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    let files: Array<{ file: string; mtimeMs: number }> = [];
    try {
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      const jsonFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => path.join(root, e.name));
      const stats = await Promise.all(
        jsonFiles.map(async (file) => {
          try {
            const stat = await fs.promises.stat(file);
            return { file, mtimeMs: stat.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      files = stats.filter((v): v is { file: string; mtimeMs: number } => v !== null);
    } catch {
      continue;
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const candidate of files.slice(0, 120)) {
      const parsed = await parseHead(candidate.file, 'gemini');
      const candidateId = parsed.geminiSessionId;
      if (!candidateId) continue;
      if (parsed.geminiProjectHash !== expectedHash) continue;
      if (isSessionIdAlreadyTracked('gemini', candidateId, t.terminal)) continue;
      applyChange(t, candidateId, candidate.file);
      return;
    }
  }
}

async function adoptExistingOpencodeSession(
  t: TrackedTerminal,
  rootsOverride?: string[],
): Promise<void> {
  if (t.agentType !== 'opencode' || t.sessionId) return;

  const roots = rootsOverride && rootsOverride.length > 0 ? rootsOverride : rootsFor(t);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;

    let files: Array<{ file: string; mtimeMs: number }> = [];
    try {
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      const jsonFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => path.join(root, e.name));
      const stats = await Promise.all(
        jsonFiles.map(async (file) => {
          try {
            const stat = await fs.promises.stat(file);
            return { file, mtimeMs: stat.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      files = stats.filter((v): v is { file: string; mtimeMs: number } => v !== null);
    } catch {
      continue;
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const candidate of files.slice(0, 120)) {
      const parsed = await parseHead(candidate.file, 'opencode');
      const candidateId = parsed.opencodeSessionId;
      if (!candidateId) continue;
      if (parsed.opencodeDirectory !== t.workspacePath) continue;
      if (isSessionIdAlreadyTracked('opencode', candidateId, t.terminal)) continue;
      applyChange(t, candidateId, candidate.file);
      return;
    }
  }
}

async function adoptExistingSessionForTerminal(
  t: TrackedTerminal,
  rootsOverride?: string[],
): Promise<void> {
  if (t.agentType === 'claude') {
    await adoptExistingClaudeFork(t, rootsOverride);
    return;
  }
  if (t.agentType === 'codex') {
    await adoptExistingCodexSession(t, rootsOverride);
    return;
  }
  if (t.agentType === 'gemini') {
    await adoptExistingGeminiSession(t, rootsOverride);
    return;
  }
  if (t.agentType === 'opencode') {
    await adoptExistingOpencodeSession(t, rootsOverride);
  }
}

function scheduleAdoptionRetry(
  terminal: vscode.Terminal,
  entry: TrackedTerminal,
  rootsOverride?: string[],
): void {
  const delays = [450, 1200];
  for (const delayMs of delays) {
    setTimeout(() => {
      if (tracked.get(terminal) !== entry) return;
      void adoptExistingSessionForTerminal(entry, rootsOverride);
    }, delayMs);
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
      codexAdoptionClaims.clear();
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

  // VS Code may restore terminals without AGENT_SESSION_ID in env.
  // Recover immediately by scanning existing session files for this workspace
  // instead of waiting only for brand-new file events.
  if ((agentType === 'claude' && currentSessionId) || (agentType !== 'claude' && !currentSessionId)) {
    void adoptExistingSessionForTerminal(entry);
    // Fallback for environments where fs.watch may miss/deny create events.
    scheduleAdoptionRetry(terminal, entry);
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
  codexAdoptionClaims.clear();
  listeners = [];
  initialized = false;
  cachedClaudeVersions = undefined;
}

export function __testRegister(
  terminal: vscode.Terminal,
  agentType: TrackedAgentType,
  rootDirs: string[],
  currentSessionId?: string,
  workspacePath: string = '/__test__',
): void {
  const entry: TrackedTerminal = {
    terminal,
    agentType,
    workspacePath,
    sessionId: currentSessionId,
  };
  tracked.set(terminal, entry);
  for (const root of rootDirs) mountWatcher(root, agentType);
  if ((agentType === 'claude' && currentSessionId) || (agentType !== 'claude' && !currentSessionId)) {
    void adoptExistingSessionForTerminal(entry, rootDirs);
    scheduleAdoptionRetry(terminal, entry, rootDirs);
  }
}
