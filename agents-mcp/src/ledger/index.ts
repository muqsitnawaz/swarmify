/**
 * Ledger module — shared substrate for cross-agent memory within a team.
 *
 * Use resolveLedger() in agents-cli code paths; it returns a LocalDiskLedger
 * by default. R2Ledger is constructed explicitly from env/config when the
 * cloud dispatch path opts in.
 */
import { LocalDiskLedger } from './local.js';
import type { LedgerStore } from './types.js';

export type { LedgerStore, LedgerArtifact, LedgerTaskView, LedgerSearchHit, LedgerRegistry, ArtifactKind } from './types.js';
export { LocalDiskLedger } from './local.js';

let cachedDefault: LedgerStore | null = null;

/**
 * Return the default ledger for this CLI/MCP process.
 *
 * Today that's LocalDiskLedger at ~/.agents/ledger. When R2 credentials are
 * configured (AGENTS_R2_* env vars), this will swap in R2Ledger — keeping
 * callers decoupled from the backend choice.
 */
export function resolveLedger(): LedgerStore {
  if (cachedDefault) return cachedDefault;
  cachedDefault = new LocalDiskLedger();
  return cachedDefault;
}

/** Test hook: reset the cached default so tests can inject a fresh root. */
export function resetLedgerCache(): void {
  cachedDefault = null;
}
