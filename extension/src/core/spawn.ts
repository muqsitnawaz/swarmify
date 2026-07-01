// Pure parsing for the `…/spawn?…` URI verb (no VS Code dependencies - testable).
// The VS Code glue that turns a SpawnRequest into an editor-tab terminal lives
// in vscode/extension.ts (spawnCommandTerminal).

export type SpawnSplit = 'right' | 'down';

export interface SpawnRequest {
  // Exact command line to run in the spawned terminal (e.g. "claude --resume <id>").
  command: string;
  // Working directory; falls back to the workspace root when absent.
  cwd?: string;
  // When set, split beside the previously spawned pane instead of a new tab.
  split?: SpawnSplit;
}

// Parse the query of a `…/spawn?…` URI into a spawn request. Returns null when
// no command is present (nothing to run). `split` is honoured only for the two
// supported directions; any other value is dropped rather than trusted.
export function parseSpawnRequest(query: string): SpawnRequest | null {
  const params = new URLSearchParams(query);
  const command = (params.get('command') ?? '').trim();
  if (!command) return null;
  const cwd = params.get('cwd')?.trim() || undefined;
  const rawSplit = params.get('split');
  const split: SpawnSplit | undefined =
    rawSplit === 'right' || rawSplit === 'down' ? rawSplit : undefined;
  return { command, cwd, split };
}
