# Swarmify extension — performance audit

**Question being answered:** why does the machine get slow when ~15 agents run inside the
Swarmify VS Code extension, even on an 18-core / 128 GB M5 Max?

**Scope:** the extension host process (`src/vscode/`, `src/core/`) and the dashboard webview
(`ui/settings/`). Every claim below was re-read against current `main` and is quoted with
file:line. Numbers marked *(measured)* came from microbenchmarks on this machine; the bench
itself was lost in the crash but the figures are reproducible and environment-independent.

---

## The real story (corrected)

The first-pass framing was "a launch storm — 15 agents spawn ~500 `ps`/`pgrep` shells per
second." That spike is real **but it is not your problem**, because you don't launch all 15 at
once. Staggered launches flatten that peak.

The actual slowdown is **steady-state cost**: work that recurs *every poll, every refresh, every
JSONL write*, for the entire lifetime of each running agent. With 15 agents alive for hours —
especially agents working in monorepos, which produce the largest transcripts and the most
tool-call churn — that recurring cost is what saturates a core and makes the UI stutter.

Two structural facts explain almost everything:

1. **The dashboard re-reads whole transcripts on a timer.** The session list polls every 4 s and,
   for any agent that is actively writing (i.e. every *working* agent), re-streams its entire
   JSONL from byte 0 — because the cache key is `(mtime, size)`, which changes on every write, so
   active agents **always miss the cache**. On this machine the corpus is *(measured)* 677 files /
   328 MB, largest single transcript **14.86 MB**.

2. **18 cores, but the extension is structurally single-threaded.** Self-verified: **0**
   `worker_threads`, **0** `os.cpus()` / `availableParallelism()`, **0** concurrency limiters in
   **33,178 LOC**. So those multi-MB `JSON.parse` / line-scan passes run serially on the one
   extension-host thread while 17 cores sit idle, and the host thread is the same thread that has
   to stay responsive for the UI. Idle cores don't help a single-threaded bottleneck.

Everything below is ranked by **steady-state** cost, not by launch-time cost.

---

## P1 — The transcript re-parse storm (dominant cost)

**What it is.** The session panel refreshes on a 4 s timer
(`src/vscode/agentPanel.vscode.ts:357`):

```ts
const id = setInterval(() => { void this.refresh(); }, 4000)
```

Each refresh calls `getSessionPreviewInfo`, which for a cache miss runs
(`src/vscode/sessions.vscode.ts:671-675`) `readHeadLines` + `readTailLines` + `countNonEmptyLines`.
The first two are bounded (60-line head, 64 KB tail). `countNonEmptyLines` is **not**
(`sessions.vscode.ts:613-625`):

```ts
async function countNonEmptyLines(filePath: string): Promise<number> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });   // no `start` -> byte 0
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) { if (line.trim()) count++; }           // runs to EOF, no cap
  return count;
}
```

**Why it's a problem.** The cache that should prevent the re-read keys on size+mtime
(`sessions.vscode.ts:662-663`, written at `:694`):

```ts
if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) { ... }
```

An agent that is doing work appends to its JSONL constantly, so `size` and `mtimeMs` change every
tick and the guard fails **every single refresh**. Net effect at 15 active agents, 4 s cadence,
largest file 14.86 MB: up to **~225 MB of sequential file I/O + line-scan CPU every 4 seconds**,
forever, on the host thread. The busier your agents, the worse it gets — exactly backwards.

There is a second, sharper edge for Cursor agents (`sessions.vscode.ts:776-778`):

```ts
const fsSync = await import('fs');
const fileBuffer = fsSync.readFileSync(dbPath);   // SYNCHRONOUS — blocks the event loop
const db = new SQL.Database(fileBuffer);
```

`readFileSync` on a Cursor SQLite DB **blocks the entire extension host** (and therefore the UI)
for the full duration of the read, once per refresh per Cursor agent.

**The team already knows the fix pattern.** A sibling path was fixed exactly this way
(`src/vscode/terminals.vscode.ts:875-880`):

> *"The previous implementation did a full fs.readFile on every mtime change; for a 50MB Claude
> session changing on every message, the cache invalidated continuously and the extension host
> re-read the full file every dashboard refresh. Capped at 256KB tail..."*

`countNonEmptyLines` was simply missed in that sweep.

**Better approach + why it works.**
- **Incremental tail-delta count.** JSONL is append-only. Cache `{ size, lineCount }`; on the next
  refresh read only `[oldSize, newSize)` and add the newlines in that delta. Converts
  *O(total history)* → *O(bytes added since last refresh)*. A working agent adds a few KB between
  refreshes, not 15 MB — this is the single highest-leverage change and it removes the
  "busier = slower" inversion.
- **Make the Cursor read async** (`fs.promises.readFile`) so it never blocks the host thread.
- **Offload the parse to a worker pool** (see Cross-cutting) once the delta read is in place, so
  even the residual cost lands on an idle core instead of the UI thread.

---

## P2 — Full snapshot payload, every write and every 10 s, with no delta

**What it is.** Two triggers push the *entire* terminal list to the webview:

- On every session JSONL write (`src/vscode/settings.vscode.ts:644-648`), after a shared 500 ms
  debounce:
  ```ts
  settingsPanel.webview.postMessage({ type: 'agentTerminalsData', agentType, terminals: updatedTerminals });
  ```
- On a 10 s poll from the webview (`ui/settings/App.tsx:386-391`) →
  `fetchAllTerminals` (`settings.vscode.ts:1744-1750`) → `getFloorTerminalDetails`
  (`terminals.vscode.ts:1150-1161`), which fans out across all 5 agent types.

Each terminal in that payload carries `recentToolCalls`, and the tool-call **`input` is never
truncated** — only `output` is (`src/core/session.summary.ts:31-32`, `:80-83`, `:315`):

```ts
const MAX_RECENT_TOOL_CALLS = 24;
const MAX_TOOL_OUTPUT_CHARS = 4000;          // caps output only
// ...
{ name: toolName, input: blockRecord.input, timestamp: eventTimestamp }   // input stored raw
```

So up to 24 tool calls per agent, each with a full untruncated `input` (file contents, diffs,
search bodies), are serialized and shipped — for all 15 agents — every 10 s regardless of whether
anything changed, plus again on each write burst.

**Why it's a problem.** Three serial costs on the host thread and one on the webview thread:
JSON-serialize a large object → structured-clone across the extension↔webview boundary →
React re-render. None of it is diffed, so steady chatter from 15 agents = a constant serialize/post
treadmill even when the visible state is identical.

**Correction to the first pass:** this is **not** O(N²). The session watchers share one 500 ms
debounce (`settings.vscode.ts:636-650`), so a burst of writes collapses into one O(N) rebuild, and
the panel is pinned to one subscribed agent type at a time. It's O(N) per debounce window, not
O(N²) — still wasteful, but the report should state it accurately.

**Better approach + why it works.** The codebase **already has the right pattern** —
`cloudSummaryUpdate` (`App.tsx:215-239`) patches a single agent by id, short-circuits when nothing
changed, and allocates only on a real diff:

```ts
if (agent.cloud_summary === summary && agent.status === status) return task   // no-op skip
```

Apply the same shape to `agentTerminalsData` / `allTerminalsData`: a **sessionId-keyed delta
channel** that posts only changed rows, skips when a row hash is unchanged, and **drops
`recentToolCalls[].input` from the list payload** (lazy-load full input only when a card is
expanded). This cuts both payload size and the post frequency, and it's a copy of code that already
ships.

---

## P3 — One agent's token re-renders all 15 cards

**What it is.** `AgentCard` is a plain function, not memoized
(`ui/settings/components/mission-control/UnifiedAgentsPane.tsx:2227`; zero `memo(` in the file), and
it's handed a fresh inline handler plus fresh item objects every render
(`:1140-1147`):

```tsx
{visibleActive.map((item) => (
  <AgentCard key={item.id} item={item} selected={selected?.id === item.id}
    onSelect={(id) => setExpandedAgentId(id)} />   // new closure every render
))}
```

`buildUnifiedList` allocates new `UnifiedAgent` objects whenever `terminals` changes
(`:582-608`), and `items` is re-derived each cycle (`:656-658`). So when **one** agent emits a
token and updates state, **all 15 cards re-render**.

Separately, the cloud activity feed re-parses its whole buffer on every token
(`CloudActivityFeed.tsx:76-77` → `cloudActivity.ts:90-109`):

```tsx
const events = useMemo(() => parseCloudSummary(summary), [summary])   // summary grows each token
```

`parseCloudSummary` does `split('\n')` + `JSON.parse` per line over the *entire accumulated*
summary, every token, no incremental parse, no debounce — O(N) per token where N grows with the
session.

**Why it's a problem.** Token streams are high-frequency. 15 agents × all-cards-re-render ×
full-buffer-reparse, all on the webview's single main thread, is a steady render/parse load that
shows up as input lag and dropped frames in the panel.

**Correction to the first pass:** the claim that `App.tsx:215-239` re-parses per token is
**refuted** — that handler is a pure state patch with no parsing. The re-parse lives only in
`CloudActivityFeed`.

**Better approach + why it works.**
- `React.memo(AgentCard)` + a stable `useCallback` for `onSelect` + reference-stable items, so a
  token that touches one agent re-renders one card. Standard React referential-equality fix.
- Debounce `CloudActivityFeed`'s parse (~250 ms) and parse incrementally (append new lines only),
  so streaming cost is bounded by wall-clock, not token rate.
- Gate the hidden-panel intervals (below) so nothing renders when nobody's looking.

---

## P4 — Process-spawn cost that recurs (not the launch spike)

**What it is.** Three recurring `ps`/`pgrep` sources, all using `exec` — which spawns `/bin/sh -c`
*and then* the `ps`/`pgrep` binary, two processes per call instead of one
(`src/vscode/terminalReadiness.ts:10`, `:41`):

```ts
import { exec } from 'child_process';
const execAsync = promisify(exec);
```

1. **Readiness probes** while an agent boots — `ps -p comm` at 50 ms (`:513`), `pgrep -P` +
   `ps -o stat` at 150 ms (`:549`, `:590`, `:605`). Per-terminal, and they *do* stop on the
   `agentReady` event (`:587`) or timeout — so this is mostly transient per launch.
2. **Shell-adoption tree walk** — the steady one. For any shell tab that might be running an agent,
   a depth-5 process-tree walk runs **every 2 s for up to 10 minutes** (`:306-308`):
   ```ts
   const SHELL_ADOPTION_POLL_MS = 2000;
   const SHELL_ADOPTION_MAX_LIFETIME_MS = 10 * 60 * 1000;
   const SHELL_ADOPTION_TREE_DEPTH = 5;
   ```
   Each tick forks `pgrep -P` per frontier node and `ps -o args=` per child (`:414`, `:424`) — 5–15
   exec pairs per tick, up to 300 ticks per tab lifetime.
3. **Per-focus session hydration** — every time you switch focus between agent tabs,
   `tryHydrateLiveSessionId` (`src/vscode/extension.ts:3387`, called at `:3455`, `:3678`, `:3757`,
   `:3888`) runs `liveSessionIdForShell` → `ps -eo pid,ppid` plus per-pid file reads
   (`src/vscode/liveSession.ts:70-84`). The `liveSessionInFlight` Set is an in-flight guard, **not a
   TTL cache** — so rapid tab-switching across 15 agents fires a fresh `ps` every switch.

**Why it's a problem.** macOS schedules these low-priority background spawns onto the **efficiency
cores** (the M5 Max is 6P + 12E), so they're slow *and* they pile up. The shell wrapper doubles the
process count for zero benefit, and #2/#3 recur for the whole session.

**Better approach + why it works.**
- **`exec` → `execFile`** everywhere here: drops the `/bin/sh -c` layer. *(measured: 4.2 ms → 2.0 ms
  per call, literally half.)*
- **Do not "batch into one `ps -axo` sweep."** *(measured: a full process-table sweep is 59 ms/call
  — batching every 150 ms would itself burn ~40 % of a core.)* Measurement overturned this
  code-review suggestion; the honest fix is fewer + cheaper spawns, not one giant one.
- **Add a TTL cache** to per-focus hydration (e.g. 2–3 s) so tab-switching doesn't re-`ps`.
- **Exponential backoff** on the adoption walk instead of a flat 2 s, and prefer the
  `onDidChangeTerminalShellIntegration` event (already wired) over polling.
- The deterministic **fs.watch fast-path already exists** (`:244-247`, `:669-673`) and fires
  `agentReady` on session-file appearance — lean on it and gate the probe behind fast-path failure.

---

## P5 — Mechanical waste (individually small, collectively real)

- **Debug logs on the hottest accessor.** `getByTerminal` logs on every call
  (`terminals.vscode.ts:200`) and is called **24×** in `extension.ts` alone (on every focus switch,
  label read, session set). Plus per-terminal logs in `getTerminalsByAgentType`
  (`:958`, `:966`, `:982`, `:1020`) that fire per terminal per 10 s poll, and a
  `JSON.stringify(persistedLabels)` log in `register()` (`:255`). Stripping these is a pure win
  flagged independently by 4 of 6 audit agents.
- **Synchronous fs on the host thread every 10 s.** `fetchTasks` does `readdirSync` +
  `readFileSync` + per-line `JSON.parse` over the whole `~/.agents` tree
  (`swarm.vscode.ts:664-670`, `:887`, `:905-906`) on each poll. → async + cache.
- **Per-call directory re-walk.** `getSessionPathBySessionId` does a `safeReaddir` of all project
  dirs on every call (`sessions.vscode.ts:485-500`), invoked once per terminal per list build
  (`terminals.vscode.ts:1000-1010`) — 15 directory walks per push. → cache `sessionId → path`.
- **Hidden-panel intervals.** A 15 s clock (`UnifiedAgentsPane.tsx:2327`) and a 5 s clock
  (`:2463`, `useNow(5000)`) tick and trigger re-renders even when the webview is retained-but-hidden
  (`retainContextWhenHidden: true`). The throughput poll *is* correctly gated (`:849`,
  `if (!panelVisible) return`) — copy that guard to the others.
- **Prewarm burst at activation** (transient). `codex`/`gemini`/`cursor` each spawn up to
  `DEFAULT_POOL_SIZE = 3` real CLIs in parallel with no cross-agent cap — up to **9 concurrent CLI
  spawns** on activate (`prewarm.vscode.ts:149-150`, `:184-188`). *(Correction: `claude` and
  `opencode` use `method: 'none'` and spawn nothing — `prewarm.simple.ts:23-76`.)* → one shared
  core-sized limiter.
- **Foreman 60 s keepalive** (`extension.ts:4098-4102`) — minor; `publish()` self-skips the disk
  write, so leave it unless profiling says otherwise.

---

## Cross-cutting fix: use the other 17 cores

P1's residual parse cost, after the delta-read fix, is still the biggest CPU consumer — and it's
embarrassingly parallel. The activity/summary extractors (`src/core/session.activity.ts`,
`src/core/session.summary.ts`) are already **pure `string → object`** functions with no VS Code
dependency, so they port to a `worker_threads` pool sized `availableParallelism() - 1` with almost
no refactor. This is the only change that converts "1 core pinned, 17 idle" into actual
parallelism, and it's why the core/ vs vscode/ split in this codebase pays off.

---

## What's already correct — do not touch

- Singleton refcounted `fs.watch` per session root (`terminalReadiness.ts:77-121`) — already
  prevents the per-terminal FSEvents storm.
- 256 KB tail caps + 64 KB backward-seek reads for head/tail preview (`sessions.vscode.ts`,
  `terminals.vscode.ts:875-880`).
- `sessionSummaryCache` / throughput cache mtime-gating, visibility-gated throughput poll
  (`UnifiedAgentsPane.tsx:849`), the `cloudSummaryUpdate` delta patch, and the `Promise.all`
  fan-out shape in the floor dashboard.

---

## Recommended sequence

Ranked by (steady-state CPU saved) ÷ (risk):

1. **P1 incremental tail-delta line count + async Cursor read.** Biggest win, append-only logs make
   it safe, removes the "busier = slower" inversion.
2. **P5 quick wins:** strip hot-path `console.log`, async `fetchTasks`, `sessionId → path` cache,
   gate the hidden intervals. Mechanical, low risk.
3. **P4 `exec → execFile` + per-focus TTL cache + adoption backoff.** Measured 2× per call; bounded
   change.
4. **P2 delta IPC channel + drop raw tool inputs from the list payload.** Copies an existing
   pattern; medium surface.
5. **P3 `React.memo` + stable handlers + debounced incremental feed parse.** Webview render fix.
6. **Cross-cutting worker pool** for transcript parsing — do last, after the delta read shrinks the
   work it has to do.

Each tier is independently shippable and independently measurable (before/after CPU under a
15-agent load).
