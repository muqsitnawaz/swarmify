/**
 * Team Ledger — shared substrate for cross-agent memory.
 *
 * The Ledger is a team-scoped, blob-per-task store that survives pod eviction
 * and lets teammates read each other's outputs by task_id. It is NOT a semantic
 * knowledge graph — just files grouped by team_id + task_id, with simple
 * read/recent/search/note operations.
 *
 * Layout:
 *   <root>/teams/<team_id>/
 *     registry.json                       teammate list + DAG snapshot
 *     team.md                             planner's running narrative
 *     sessions/<task_id>-<teammate>.jsonl full agent event stream
 *     artifacts/<task_id>/
 *       diff.patch                        git diff of the task
 *       test-output.txt                   test runner output (if any)
 *       notes.md                          teammate's own notes (append-only)
 *     bugs/<task_id>.md                   reviewer-filed bugs
 */

/** Canonical artifact kinds we know how to serialize. Free-form `kind` still works. */
export type ArtifactKind =
  | 'diff'
  | 'test-output'
  | 'notes'
  | 'session'
  | 'bug'
  | 'registry'
  | 'narrative'
  | string;

/** A single artifact stored in the ledger. */
export interface LedgerArtifact {
  team_id: string;
  task_id: string;
  teammate?: string;
  kind: ArtifactKind;
  content: string;
  created_at: string;  // ISO timestamp
  updated_at: string;  // ISO timestamp
}

/** A single task's rolled-up view: all artifacts under one task_id. */
export interface LedgerTaskView {
  team_id: string;
  task_id: string;
  teammate: string | null;
  task_type: string | null;
  status: string | null;
  artifacts: LedgerArtifact[];
  completed_at: string | null;
}

/** Search hit — includes artifact + line number for context. */
export interface LedgerSearchHit {
  team_id: string;
  task_id: string;
  teammate: string | null;
  kind: ArtifactKind;
  line_number: number;
  line: string;
  path: string;
}

/** Registry snapshot — mirrors the teammate DAG state for a team. */
export interface LedgerRegistry {
  team_id: string;
  updated_at: string;
  teammates: Array<{
    agent_id: string;
    name: string | null;
    agent_type: string;
    task_type: string | null;
    dispatch: 'local' | { cloud: string; repo?: string; branch?: string };
    after: string[];
    status: string;
    started_at: string;
    completed_at: string | null;
  }>;
}

/**
 * Contract every ledger backend implements.
 *
 * Local-disk is the default; R2 is the durable remote. Both implement the
 * same interface so cloud-evicted pods and local pods share a substrate.
 */
export interface LedgerStore {
  /** Backend identifier, for debug output. */
  readonly kind: 'local' | 'r2';

  /** Read a single artifact kind for a task, or all kinds if `kind` omitted. */
  read(team_id: string, task_id: string, kind?: ArtifactKind): Promise<LedgerTaskView>;

  /** Last N completed tasks across the team, newest first. */
  recent(team_id: string, n?: number): Promise<LedgerTaskView[]>;

  /** Case-insensitive substring search across sessions + notes + bugs + team.md. */
  search(team_id: string, query: string, limit?: number): Promise<LedgerSearchHit[]>;

  /** Append text to <task_id>'s notes.md (creates if missing). */
  note(team_id: string, task_id: string, teammate: string, text: string): Promise<void>;

  /** Write an artifact. Overwrites if (task_id, kind) already exists. */
  putArtifact(
    team_id: string,
    task_id: string,
    kind: ArtifactKind,
    content: string,
    teammate?: string
  ): Promise<void>;

  /** Append one line (JSON or text) to sessions/<task_id>-<teammate>.jsonl. */
  appendSession(team_id: string, task_id: string, teammate: string, line: string): Promise<void>;

  /** Snapshot or update the team registry. */
  putRegistry(registry: LedgerRegistry): Promise<void>;
  getRegistry(team_id: string): Promise<LedgerRegistry | null>;

  /** Append a sentence to team.md (the planner's running narrative). */
  appendNarrative(team_id: string, text: string): Promise<void>;
  getNarrative(team_id: string): Promise<string | null>;
}
