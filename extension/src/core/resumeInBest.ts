// Pure logic for picking the best-available agent version to resume a session
// into. Consumes the shape emitted by `agents view <agent> --json` (agents-cli
// >= 1.13.0). Lives in core/ so it can be unit-tested without VS Code.

export interface AgentsViewJsonVersion {
  version: string;
  isDefault: boolean;
  signedIn: boolean;
  email: string | null;
  plan: string | null;
  usageStatus: 'available' | 'rate_limited' | 'out_of_credits' | null;
  windows: Array<{ key: string; usedPercent: number; resetsAt: string | null }>;
  lastActive: string | null;
  path: string;
}

export interface AgentsViewJsonAgent {
  agent: string;
  versions: AgentsViewJsonVersion[];
}

function statusRank(status: AgentsViewJsonVersion['usageStatus']): number {
  if (status === 'available') return 0;
  if (status === 'rate_limited' || status === null) return 1;
  return 2; // out_of_credits
}

export function sessionUsedPercent(v: AgentsViewJsonVersion): number {
  const w = v.windows.find(w => w.key === 'session');
  return w ? w.usedPercent : 100;
}

/**
 * Pick the best signed-in version to resume into.
 *
 * Ranking:
 *   1. Must be signed-in.
 *   2. Prefer anything that is not out_of_credits (if every signed-in version
 *      is out_of_credits, fall through to the full list — better to resume
 *      somewhere than nowhere).
 *   3. Lowest 5-hour session usedPercent wins — that is the window that
 *      actually blocks the next turn.
 *   4. Tie-break on usageStatus (available > rate_limited > out_of_credits).
 *   5. Final tie-break on most recent lastActive.
 *
 * Returns null if no signed-in versions exist.
 */
export function pickBestVersion(
  versions: AgentsViewJsonVersion[]
): AgentsViewJsonVersion | null {
  const signedIn = versions.filter(v => v.signedIn);
  if (signedIn.length === 0) return null;

  const usable = signedIn.some(v => v.usageStatus !== 'out_of_credits')
    ? signedIn.filter(v => v.usageStatus !== 'out_of_credits')
    : signedIn;

  const sorted = [...usable].sort((a, b) => {
    const sa = sessionUsedPercent(a);
    const sb = sessionUsedPercent(b);
    if (sa !== sb) return sa - sb;
    const ra = statusRank(a.usageStatus);
    const rb = statusRank(b.usageStatus);
    if (ra !== rb) return ra - rb;
    const ta = a.lastActive ? Date.parse(a.lastActive) : 0;
    const tb = b.lastActive ? Date.parse(b.lastActive) : 0;
    return tb - ta;
  });

  return sorted[0] ?? null;
}
