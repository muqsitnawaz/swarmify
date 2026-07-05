# Session Index — unified subsystem design

A design for one session-data source of truth, replacing the scattered reads/caches/watchers that
make the dashboard slow with many agents. Companion to `performance-fixes.md` (the diagnosis); this
doc is the **feature**. Every claim is quoted from current `main`.

---

## 1. The core finding: there is no session index

We do **not** index session content anywhere.

- **No content DB of our own.** The only SQLite in the codebase is us *reading Cursor's* database
  (`src/vscode/sessions.vscode.ts:776-778`), and it's a **synchronous** read that blocks the host:
  ```ts
  const fileBuffer = fsSync.readFileSync(dbPath);   // blocks the extension host + UI
  const db = new SQL.Database(fileBuffer);
  ```
- **The only thing we persist** is terminal-restore metadata, `~/.swarmify/agents/sessions.yaml`
  (`src/core/sessions.persist.ts:59-67`) — `terminalId`, `sessionId`, `label`, `agentType`. It holds
  no message count, no preview, no activity. Written debounced 500 ms on terminal lifecycle events;
  read once on activation.

So every consumer re-derives everything from raw transcript files on every refresh. That absence is
the root cause behind P1, P2, and most of P5 in the diagnosis.

---

## 2. The current surface — every consumer (this is what the fix must cover)

### 2a. Readers (each re-reads raw files)

| Reader | Reads | Bounded? | Drives | file:line |
|---|---|---|---|---|
| `getSessionPreviewInfo` | head 60 + tail 20 + **full-file count** | count is **UNBOUNDED** | Floor, side panel, goToTerminal | `sessions.vscode.ts:654`, count at `:613` |
| `getSessionQuickDetailsCached` → `readSessionContent` | tail 256 KB | bounded | Floor (file/tool stats) | `terminals.vscode.ts:914`, `:881` |
| `extractCurrentActivity` | tail 20 (string) | bounded | Floor (activity) | `terminals.vscode.ts:1051` |
| `getFloorThroughput` inline | tail 256 KB / **full for Gemini** | **UNBOUNDED (Gemini)** | Floor 2.5 s poll | `settings.vscode.ts:1401` |
| side panel `collectRecentActivity` | tail 80 | bounded | side panel 4 s | `agentPanel.vscode.ts:461` |
| `getCursorSessionPreviewInfo` | **full DB, SYNC** | UNBOUNDED + blocking | Floor | `sessions.vscode.ts:768,777` |
| `getOpenCodeSessionPreviewInfo` | per-message JSON files | bounded | Floor | `sessions.vscode.ts:705` |
| watchdog stall check | mtime + content | — | watchdog 120 s | `watchdog.vscode.ts:422` |
| recap | resolves + reads | — | recap | `recap.vscode.ts:84` |
| auto-label poller | session content | — | per-terminal 5 min | `terminals.vscode.ts:329` |

**Redundancy:** for one active session, a single Floor refresh issues **4-5 independent
`open/read/close` calls on the same file** (preview, tail-20, tail-256 KB, panel tail-80, throughput),
none reusing another's bytes. A `PREVIEW_CACHE` hit does not prevent the summary read, and vice versa.

### 2b. Path resolution (no cache at all)

`getSessionPathBySessionId` (`sessions.vscode.ts:478-565`) walks the filesystem per call:
Claude → `getClaudeProjectRoots` (2 readdirs) + `readdir`+`stat` per project per root; Codex →
depth-4 recursive `findFileBySessionId`; Gemini → readdir + JSON fallback reads. Callers:
`getTerminalsByAgentType` (`terminals.vscode.ts:1007`), `getFloorTerminalDetails` ×5
(`:1153`), `subscribeToAgentSessions` (`settings.vscode.ts:633`), throughput (`:1387`), side panel
(`agentPanel.vscode.ts:447`), recap, watchdog.

**Quantified:** ~**370 `readdir`/`stat` syscalls per `getFloorTerminalDetails`** at 15 agents;
`getClaudeProjectRoots` re-walked once per Claude terminal (identical results); and
`subscribeToAgentSessions` re-resolves paths `getTerminalsByAgentType` just resolved and discarded.

### 2c. Watchers (two systems, overlapping paths)

| Watcher | Scope | Watches | file:line |
|---|---|---|---|
| `sessionTracker` `mountWatcher` | refcounted per dir | `fs.watch` + `fs.watchFile`@100 ms on the workspace session dir | `sessionTracker.ts:209,234` |
| `terminalReadiness` `sharedWatchers` | refcounted per root | recursive `fs.watch` on the **parent** projects dir | `terminalReadiness.ts:96` |
| `settings` `sessionWatchers` | per session file (panel open) | `fs.watch` per `.jsonl` | `settings.vscode.ts:636` |

The first two subscribe to **overlapping path scopes for different consumers** (session-ID
correlation vs. `agentReady` signal), so each session-file event is delivered to the OS-watch layer
**twice**.

### 2d. Caches (six, uncoordinated)

`PREVIEW_CACHE`, `FIRST_MSG_CACHE` (`sessions.vscode.ts:633,643`), `sessionSummaryCache`,
`gitInfoCache` (`terminals.vscode.ts:862,821`), `throughputCache` (`settings.vscode.ts`),
`sqlJsPromise` (`sessions.vscode.ts:11`). Different keys, different invalidation, no shared result.

---

## 3. Proposed architecture: one `SessionIndex`

```
        one shared watcher  (collapses sessionTracker + terminalReadiness overlap)
                    │  emits {path, agentType} on append/create/delete
                    ▼
 ┌────────────────────────  SessionIndex  ────────────────────────────┐
 │  pathBySessionId: Map<sessionId, filePath>     ← O(1) resolution    │
 │  digestByPath:    Map<filePath, Digest>                             │
 │     Digest = {                                                      │
 │       ino, size,                  // identity + delta cursor        │
 │       recordCount,                // incremental: +newlines in delta│
 │       firstMessage,               // immutable, parsed once         │
 │       lastMessage, lastActivityMs,                                  │
 │       quickDetails,               // files/tools tallies            │
 │       activity, throughput        // derived, folded forward        │
 │     }                                                               │
 └─────────────────────────────────────────────────────────────────────┘
   reads (no raw-file access):
   Floor · side panel · throughput · watchdog · recap · goToTerminal · auto-label
```

### Update mechanism (the generalized P1 fix)

On a watch event for `path`, `stat` it. If `(ino unchanged, size grew)`: read only
`[prevSize, newSize)`, parse those records **once**, and fold every derived field forward
(`recordCount += newlines`; update `lastMessage`, `lastActivityMs`, `quickDetails`, `activity`,
`throughput` from the new records). If shrunk/rotated/replaced (ino or size mismatch): one full
rebuild, then cache. JSONL is append-only, so `[prevSize, newSize)` is always whole records; a
half-written record has no trailing `\n` yet and is simply picked up next tick (race-safe).

```ts
async function refreshDigest(path: string, agentType: AgentType): Promise<Digest> {
  const stat = await fs.stat(path);
  const prev = digestByPath.get(path);
  if (prev && prev.ino === stat.ino && stat.size >= prev.size) {
    const delta = await readRange(path, prev.size, stat.size);     // only new bytes
    const next = foldForward(prev, parseRecords(delta, agentType), stat);  // worker thread
    digestByPath.set(path, next);
    return next;
  }
  const next = await rebuildFull(path, agentType, stat);           // cold / rotated
  digestByPath.set(path, next);
  return next;
}
```

- **Non-JSONL formats** (Cursor SQLite, OpenCode per-message, Gemini single-JSON) can't delta, but
  still get a digest keyed on `(ino, mtime)` and an **async** read — killing the sync Cursor block
  and the redundant re-reads.
- **Parsing runs in a `worker_threads` pool** (`availableParallelism() - 1`). The parsers
  (`src/core/session.summary.ts`, `session.activity.ts`) are already pure `string → object`, so they
  port with no refactor — finally using the idle cores.

### Migration: strangler, no consumer rewrite

Keep the existing exported signatures and reimplement their bodies to read the index:

```ts
// before: streams the whole file. after: one map lookup.
export async function getSessionPreviewInfo(path: string): Promise<SessionPreviewInfo> {
  const d = await SessionIndex.digest(path);
  return { firstUserMessage: d.firstMessage, lastUserMessage: d.lastMessage,
           lastActivityMs: d.lastActivityMs, messageCount: d.recordCount };
}
export function getSessionPathBySessionId(id: string): string | undefined {
  return SessionIndex.pathBySessionId.get(id);     // was ~370 syscalls across a Floor refresh
}
```

Consumers (`getTerminalsByAgentType`, the side panel, throughput, watchdog, recap) don't change.
Once green, delete the dead private readers and the six caches.

---

## 4. What this subsumes

| Diagnosis item | Subsumed by |
|---|---|
| P1 full-file count | incremental `recordCount` in the digest |
| P2 raw payload on a timer | consumers ship the bounded digest; delta channel diffs digests |
| P5 `sessionId→path` re-walks | `pathBySessionId` map (O(1)) |
| Redundant 4-5 reads/refresh | one digest read per consumer |
| Double watcher system | one shared watcher feeding the index |
| Sync Cursor `readFileSync` | async digest read, cached on `(ino, mtime)` |
| Single-threaded parse | worker pool updates digests |

---

## 5. Risks and open questions

- **Correctness across 5 formats + multi-version homes.** The index must resolve the same
  `1 + N_versions` Claude roots, Codex date trees, Gemini hash dirs, OpenCode message dirs, Cursor
  workspace hashes. Validate against the real corpus (677 files / 328 MB).
- **Cold start.** First digest for a 14.86 MB file still costs one full parse — do it in the worker
  pool, off the UI thread, and show last-known/stale while it computes.
- **Watcher unification** is the trickiest part: `sessionTracker` and `terminalReadiness` have
  different consumers (session-ID correlation vs. `agentReady`). They can share one event stream but
  must keep both fan-outs. Land the index first behind existing readers; unify watchers second.
- **Eviction.** Digest map needs an LRU bound (today's caches use 200-500) keyed to open terminals,
  not unbounded.

---

## 6. Sequencing

1. Build `SessionIndex` with `pathBySessionId` + incremental `digestByPath`, fed by the existing
   watchers (don't unify watchers yet).
2. Reimplement `getSessionPathBySessionId` and `getSessionPreviewInfo` to read the index (strangler).
   Measure the Floor refresh syscall count + host CPU before/after.
3. Move `getSessionQuickDetailsCached`, throughput, side panel, watchdog onto the digest. Delete the
   redundant readers + caches.
4. Move parsing into a `worker_threads` pool.
5. Unify the two watcher systems onto the index's single event stream.

Each step ships and is measured independently against a fixed 15-agent load.
