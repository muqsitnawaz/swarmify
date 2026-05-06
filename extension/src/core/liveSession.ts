import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

const STATE_DIR = path.join(os.homedir(), '.agents-system', 'state', 'sessions');

export interface SessionStateRecord {
  session_id: string;
  cwd?: string;
  pid: number;
  ts: number;
}

async function descendantPids(rootPid: number): Promise<number[]> {
  const seen = new Set<number>();
  const queue = [rootPid];
  const result: number[] = [];
  while (queue.length) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const { stdout } = await execAsync(`pgrep -P ${pid}`, { timeout: 1000 });
      const children = stdout.trim().split('\n').filter(Boolean).map(Number).filter(Number.isFinite);
      for (const c of children) {
        if (!seen.has(c)) {
          result.push(c);
          queue.push(c);
        }
      }
    } catch {
      // pgrep returns non-zero when no children — not an error.
    }
  }
  return result;
}

async function readState(pid: number): Promise<SessionStateRecord | null> {
  try {
    const raw = await fs.readFile(path.join(STATE_DIR, `${pid}.json`), 'utf8');
    const parsed = JSON.parse(raw) as SessionStateRecord;
    return parsed?.session_id ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Find the live session UUID for a running agent process under the given shell.
 * Reads state files written by the SessionStart hook
 * (~/.agents-system/state/sessions/<agent-pid>.json), keyed by agent process id.
 *
 * Returns null when no agent process is currently running under the shell — caller
 * decides whether to fall back to a spawn-time env var or report "no session".
 */
export async function liveSessionIdForShell(shellPid: number | undefined): Promise<string | null> {
  if (!shellPid) return null;
  const pids = await descendantPids(shellPid);
  for (const pid of pids) {
    const rec = await readState(pid);
    if (rec) return rec.session_id;
  }
  return null;
}
