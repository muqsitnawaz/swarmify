# Swarmify extension — why 15 agents slow the machine

**18 cores, 128 GB, yet it stutters.** Not a launch spike (you stagger launches). It's
**steady-state cost** — work that recurs every poll/refresh/write for each agent's whole life —
running on **one thread** while 17 cores idle (verified: 0 `worker_threads`, 0 `os.cpus()`, 0
concurrency limiters in 33,178 LOC). Monorepo agents make it worst: biggest transcripts, most churn.

The root cause, one sentence: **the dashboard re-reads whole transcripts on a 4 s timer because its
cache key changes on every write, so every working agent always misses.**

| # | Problem | Evidence (current `main`) | Cost @ 15 agents | Fix |
|---|---|---|---|---|
| **P1** | Whole-transcript re-parse on a timer | `countNonEmptyLines` reads from byte 0, no cap (`sessions.vscode.ts:613-625`); cache keys on `(mtime,size)` so active agents always miss (`:662-663`); 4 s poll (`agentPanel.vscode.ts:357`) | **~225 MB I/O every 4 s**, on the UI thread; busier = slower | Incremental tail-delta count (logs are append-only): O(history)→O(bytes added). Make Cursor `readFileSync` (`:776`) async |
| **P2** | Full snapshot pushed every 10 s + every write, no diff | Posts entire list incl. **untruncated** tool inputs ×24/agent (`session.summary.ts:315`, `:31`); no delta (`settings.vscode.ts:644`, `App.tsx:386`) | Constant serialize + IPC + re-render even when nothing changed | Copy the existing `cloudSummaryUpdate` delta patch (`App.tsx:215-239`); drop raw inputs from list payload |
| **P3** | One token re-renders all 15 cards | `AgentCard` not memoized + inline `onSelect` (`UnifiedAgentsPane.tsx:2227`, `:1140`); feed re-parses whole buffer per token (`CloudActivityFeed.tsx:76`) | Webview render lag under token streams | `React.memo` + stable `useCallback`; debounce + incremental parse |
| **P4** | Recurring `ps`/`pgrep` via shell wrapper | `exec` not `execFile` (`terminalReadiness.ts:41`); 2 s tree-walk for 10 min/tab (`:306`); per-focus `ps` with no TTL cache (`liveSession.ts:70`) | Spawns pile on slow efficiency cores | `exec`→`execFile` (**measured 4.2→2.0 ms**); add TTL cache; backoff. *Don't* batch one `ps -axo` (**measured 59 ms** — worse) |
| **P5** | Mechanical waste | `console.log` on hottest accessor, 24 calls (`terminals.vscode.ts:200`); sync fs scan every 10 s (`swarm.vscode.ts:887`); hidden-panel timers (`:2327`,`:2463`) | Continuous small drips | Strip logs; async fs; gate intervals on `panelVisible` (pattern already at `:849`) |

**Corrections from re-verification:** the "O(N²) reprocess" is actually O(N) (shared 500 ms debounce);
`claude` prewarm spawns nothing; one React re-parse claim was refuted. Honest numbers only.

**Already correct — don't touch:** singleton refcounted `fs.watch` (`terminalReadiness.ts:77`), 256 KB
tail caps, mtime-gated summary cache, the `cloudSummaryUpdate` delta patch.

**Order (CPU saved ÷ risk):** P1 → P5 quick wins → P4 → P2 → P3 → then a `worker_threads` pool for the
residual parse (the only change that uses the other 17 cores). Each tier ships and measures independently.
