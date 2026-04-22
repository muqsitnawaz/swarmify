// Shared cross-window registry of live agent terminals.
//
// Each VS Code / Codium / Cursor window runs its own extension host, so
// `vscode.window.terminals` only tells us what's open in THIS window. The
// foreman needs to see every agent across every IDE window. We solve that
// by having each extension host write its own terminals to a shared JSON
// file; readers merge entries and filter out ones whose pid is dead.
//
// File: ~/.agents/swarmify/live-terminals.json
// Shape: { <windowId>: { at: ISO, entries: LiveTerminal[] } }
//   - Writer owns its windowId slice. Reads are merges of all slices.
//   - Stale entries (pid dead) are filtered at read time, not pruned. The
//     owning window prunes on its own terminal close/exit events.
//   - If a whole window crashed, its slice is dropped when `at` is older
//     than 10 minutes AND any entry's pid is dead.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

const REGISTRY_DIR = path.join(os.homedir(), '.agents', 'swarmify');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'live-terminals.json');
const STALE_WINDOW_MS = 10 * 60_000;

export interface LiveTerminal {
  sessionId: string;
  pid: number;
  kind: string;              // 'claude' | 'codex' | 'gemini' | ...
  label?: string | null;
  cwd?: string | null;
  startedAtMs: number;
}

interface RegistryFile {
  [windowId: string]: { at: string; entries: LiveTerminal[] };
}

/**
 * Build a windowId string from the available identifiers. Exported so it can
 * be unit-tested against real-world inputs (notably VSCodium's redacted
 * sessionId placeholder, which collides across windows).
 */
export function computeWindowId(sessionId: string | undefined, pid: number): string {
  return `${sessionId || pid}`;
}

let ownWindowId: string | undefined;
function getOwnWindowId(): string {
  if (ownWindowId) return ownWindowId;
  // sessionId is a VS Code per-window unique id; machineId would merge all
  // windows, which is the opposite of what we want.
  ownWindowId = computeWindowId(vscode.env.sessionId, process.pid);
  return ownWindowId;
}

function readRegistry(): RegistryFile {
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRegistry(reg: RegistryFile): void {
  try {
    if (!fs.existsSync(REGISTRY_DIR)) {
      fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    }
    const tmp = `${REGISTRY_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(reg, null, 2));
    fs.renameSync(tmp, REGISTRY_FILE);
  } catch {
    /* best effort */
  }
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid < 1) return false;
  try {
    // signal 0 doesn't kill; throws ESRCH if pid is gone, EPERM if alive but
    // owned by another user (not our case for IDE-spawned terminals).
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

// Publish this window's live terminals. Call on terminal open/close and every
// few seconds as a keepalive. Only writes if the set changed or the keepalive
// window is due.
export function publishLiveTerminals(terminals: LiveTerminal[]): void {
  const reg = readRegistry();
  reg[getOwnWindowId()] = {
    at: new Date().toISOString(),
    entries: terminals,
  };
  // Garbage-collect peer slices that look crashed (old timestamp + all pids dead).
  const cutoff = Date.now() - STALE_WINDOW_MS;
  for (const [winId, slice] of Object.entries(reg)) {
    if (winId === getOwnWindowId()) continue;
    const at = Date.parse(slice?.at ?? '');
    if (!Number.isFinite(at) || at > cutoff) continue;
    const anyAlive = (slice.entries ?? []).some((e) => isPidAlive(e.pid));
    if (!anyAlive) delete reg[winId];
  }
  writeRegistry(reg);
}

// Read all live terminals across every IDE window, filtered to pid-alive only.
// Deduped by sessionId - the self-window entries take precedence over peer ones.
export function readLiveTerminals(): LiveTerminal[] {
  const reg = readRegistry();
  const selfId = getOwnWindowId();
  const selfSlice = reg[selfId]?.entries ?? [];
  const peerSlices = Object.entries(reg)
    .filter(([id]) => id !== selfId)
    .flatMap(([, v]) => v?.entries ?? []);

  const merged = new Map<string, LiveTerminal>();
  // Peers first, self overwrites.
  for (const t of peerSlices) {
    if (!t?.sessionId || !isPidAlive(t.pid)) continue;
    merged.set(t.sessionId, t);
  }
  for (const t of selfSlice) {
    if (!t?.sessionId || !isPidAlive(t.pid)) continue;
    merged.set(t.sessionId, t);
  }
  return Array.from(merged.values());
}

// Scan vscode.window.terminals and build a LiveTerminal array for this window.
// Returns [] if no agent terminals are open here.
export async function snapshotOwnTerminals(): Promise<LiveTerminal[]> {
  const out: LiveTerminal[] = [];
  for (const t of vscode.window.terminals) {
    if (t.exitStatus !== undefined) continue;
    const opts = t.creationOptions as vscode.TerminalOptions;
    const env = opts?.env as Record<string, string | undefined> | undefined;
    const sid = env?.AGENT_SESSION_ID;
    const tid = env?.AGENT_TERMINAL_ID;
    if (!sid) continue;
    const pid = await t.processId;
    if (!pid) continue;
    const kind = tid ? kindFromTerminalId(tid) : kindFromName(t.name);
    out.push({
      sessionId: sid,
      pid,
      kind,
      label: deriveLabel(t.name),
      cwd: env?.AGENT_WORKSPACE_DIR ?? null,
      startedAtMs: Date.now(),
    });
  }
  return out;
}

function kindFromTerminalId(terminalId: string): string {
  const prefix = terminalId.split('-')[0]?.toUpperCase() ?? '';
  switch (prefix) {
    case 'CC': case 'CL': return 'claude';
    case 'CX': return 'codex';
    case 'GX': return 'gemini';
    case 'OC': return 'opencode';
    case 'CR': return 'cursor';
    case 'SH': return 'shell';
    default: return prefix.toLowerCase() || 'unknown';
  }
}

function kindFromName(name: string): string {
  const head = name.trim().split(/\s+|-/)[0]?.toLowerCase() ?? '';
  if (['claude', 'cc'].includes(head)) return 'claude';
  if (['codex', 'cx'].includes(head)) return 'codex';
  if (['gemini', 'gx'].includes(head)) return 'gemini';
  if (['opencode', 'oc'].includes(head)) return 'opencode';
  if (['cursor', 'cr'].includes(head)) return 'cursor';
  return head || 'unknown';
}

function deriveLabel(name: string): string | null {
  const m = name.match(/-\s+(.+)$/);
  return m ? m[1].trim() : null;
}
