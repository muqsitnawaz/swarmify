# Swarmify dashboard — performance diagnosis and fix design

Why the machine stutters with ~15 agents open, and the exact code change for each cause.
Every claim is quoted from current `main`. Pseudocode shows current vs proposed.

---

## 0. Scope: this cost is gated on the UI being VISIBLE (important)

"The dashboard" is two webview surfaces, each backed by extension-host code that does the file
reading: the **side panel** (`agentPanel.vscode.ts`, a `WebviewView`) and the **Factory Floor**
dashboard tab (`settings.vscode.ts`, a `WebviewPanel`). The heavy all-15 read lives behind the
Floor (`getFloorTerminalDetails`, `terminals.vscode.ts:1150` → `getSessionPreviewInfo` `:1038`).

The expensive polls are **gated on visibility** — they are NOT a 24/7 background drain:

| State | Effect |
|---|---|
| Side panel hidden/collapsed | 4 s poll cleared (`agentPanel.vscode.ts:190-197`, `:362-367`) |
| Side panel closed | disposed → poll cleared (`:199-203`) |
| Floor tab hidden behind another editor tab | 10 s all-15 poll cleared via `panelVisible` gate (`ui/settings/App.tsx:385`; signal from `settings.vscode.ts:2012-2017`) |
| Dashboard on a non-Floor sub-tab | Floor poll off (`activeTab !== 'floor'`) |
| Dashboard tab closed | all session watchers torn down (`settings.vscode.ts:2019-2026`, `cleanupSessionWatchers`) |

**So P1/P2 below are "while you are looking at the Floor" costs, not background costs.** That is
still the moment you most want the UI responsive, so the fixes stand — but the framing matters.

**One genuine leak (open-but-hidden):** the per-agent-type drill-down's write-watcher
(`settings.vscode.ts:636-650`) is gated on *subscription*, not visibility:
`if (!settingsPanel || currentlySubscribedAgentType !== agentType) return;` (`:640`). If the panel
is open + subscribed but hidden, JSONL writes still run `getTerminalsByAgentType` for a UI nobody
sees. Fix: add the same `panelVisible` gate the Floor poll already has.

**Truly always-on (independent of any UI):** the P4 process work — shell-adoption tree-walk every
2 s for 10 min/tab (`terminalReadiness.ts:306`), per-focus `ps` (`liveSession.ts:70`), and the
Foreman 60 s keepalive (`extension.ts:4098`). These run with everything hidden; they are the
smaller costs.

---

## 1. How the dashboard spends CPU — the three triggers (when visible)

When the relevant surface is visible, transcripts get re-read from **three independent triggers**,
each on its own clock. None of them is the launch — they fire for the life of every running agent.

1. **The 4 s panel poll** (`src/vscode/agentPanel.vscode.ts:357-359`):
   ```ts
   this.pollTimer = setInterval(() => { void this.refresh(); }, 4000);
   ```
2. **The file-write watcher** (`src/vscode/settings.vscode.ts:636-650`) — fires whenever an agent
   appends a line to its JSONL:
   ```ts
   const watcher = fs.watch(sessionPath, { persistent: false }, () => {
     if (sessionUpdateTimeout) clearTimeout(sessionUpdateTimeout);
     sessionUpdateTimeout = setTimeout(async () => {
       const updatedTerminals = await terminals.getTerminalsByAgentType(agentType, workspacePath);
       settingsPanel.webview.postMessage({ type: 'agentTerminalsData', agentType, terminals: updatedTerminals });
     }, 500);
   });
   ```
3. **The webview's own 10 s poll** (`ui/settings/App.tsx:386-391`):
   ```ts
   const interval = setInterval(() => {
     vscode.postMessage({ type: 'fetchTasks' })
     vscode.postMessage({ type: 'fetchAllTerminals' })
   }, 10_000)
   ```

**The shared data path** all three walk:

```
timer/watcher  ->  refresh()  ->  build snapshot  ->  getSessionPreviewInfo(file)  ->  countNonEmptyLines(file)
                                                                                        ^ reads the WHOLE file
```

That last hop is the problem.

---

## 2. P1 — whole-transcript re-read on every tick (the dominant cost)

### Current code

`getSessionPreviewInfo` (`src/vscode/sessions.vscode.ts:654-698`) caches on `(mtime, size)`:

```ts
const cached = PREVIEW_CACHE.get(filePath);
if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
  return cached.preview;                       // hit
}
const [headLines, tailLines, messageCount] = await Promise.all([
  firstMsgEntry ? Promise.resolve([]) : readHeadLines(filePath, 60),  // immutable, cached forever
  readTailLines(filePath, 20),                                        // bounded: 20 lines, 64KB seek
  countNonEmptyLines(filePath),                                       // UNBOUNDED: byte 0 -> EOF
]);
```

And `countNonEmptyLines` (`:613-625`) streams the entire file every call:

```ts
async function countNonEmptyLines(filePath: string): Promise<number> {
  const stream = createReadStream(filePath, { encoding: 'utf-8' });   // no `start` => byte 0
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) { if (line.trim()) count++; }           // runs to EOF, no cap
  return count;
}
```

### Why the cache never helps a working agent

The cache key is `(mtimeMs, size)`. A *working* agent appends to its JSONL constantly, so **both
`size` and `mtimeMs` change between every refresh** — the guard on `:663` fails every single time.
Result: every active agent takes the slow path on every trigger. Head is already cached (immutable
first message) and tail is bounded, so the entire cost reduces to one thing: **`countNonEmptyLines`
re-reading the full transcript just to produce a message count.**

At 15 active agents, 4 s poll, largest transcript 14.86 MB (measured corpus: 677 files / 328 MB):
up to **~225 MB of file I/O + line-scan, every 4 seconds, on the extension-host (UI) thread —
*while the Floor dashboard is visible*** (see §0; the poll is cleared when hidden). The busier the
agents, the larger the files, the slower the dashboard exactly when you are watching it — backwards.

### The fix: incremental tail-delta count

JSONL is **append-only** and every record is written as `<json>\n`. So the byte length at any
moment is a whole number of complete records, and new content only ever appears *after* the old EOF.
That means we never need to re-read bytes we've already counted — read only `[oldSize, newSize)` and
add. Count **newline bytes** (= records) rather than "non-empty lines": it's what `messageCount`
actually wants, and it's race-safe (a half-written record has no `\n` yet, so it's simply counted on
the next tick — never missed, never double-counted).

```ts
// Per-file incremental line-count cache. Keyed on (filePath); validated by (ino, size).
interface LineCountEntry { ino: number; size: number; count: number; }
const LINE_COUNT_CACHE = new Map<string, LineCountEntry>();

async function countRecords(filePath: string, stat: Stats): Promise<number> {
  const prev = LINE_COUNT_CACHE.get(filePath);

  // Fast path: same file (ino), grew or unchanged -> count only the appended bytes.
  if (prev && prev.ino === stat.ino && stat.size >= prev.size) {
    const added = stat.size === prev.size
      ? 0
      : await countNewlinesInRange(filePath, prev.size, stat.size);   // reads only the delta
    const total = prev.count + added;
    LINE_COUNT_CACHE.set(filePath, { ino: stat.ino, size: stat.size, count: total });
    return total;
  }

  // Cold start, OR file shrank/rotated/replaced -> one full scan, then cache.
  const total = await countNewlinesFull(filePath);
  LINE_COUNT_CACHE.set(filePath, { ino: stat.ino, size: stat.size, count: total });
  return total;
}

async function countNewlinesInRange(filePath: string, start: number, end: number): Promise<number> {
  let count = 0;
  const stream = createReadStream(filePath, { start, end: end - 1 });  // bytes [start, end)
  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) if (chunk[i] === 0x0a /* \n */) count++;
  }
  return count;
}
```

Then in `getSessionPreviewInfo`, replace the `countNonEmptyLines(filePath)` arm of the `Promise.all`
with `countRecords(filePath, stat)` (we already have `stat`). Nothing else in that function changes.

**Complexity:** `O(total history)` → `O(bytes appended since last tick)`. A working agent adds a few
KB between refreshes, not 15 MB. The ~225 MB/4 s collapses to kilobytes.

### Edge cases (handled above)

- **Mid-write race** (we `stat` while a record is half-flushed): the partial record has no trailing
  `\n`, so it isn't counted until the tick after it completes. Monotonic, self-correcting.
- **Log rotation / truncation** (`size < prev.size`): `ino`/size guard fails → full rescan.
- **File replaced** (delete + recreate at same path): inode differs → full rescan.
- **Count semantics:** switches from "non-empty lines" to "records (`\n` count)". JSONL has no blank
  lines, so for these files the two are identical; the record count is the truer `messageCount`.

### Second edge in the same file: synchronous Cursor read

`getCursorSessionPreviewInfo` (`sessions.vscode.ts:776-778`) blocks the event loop:

```ts
const fsSync = await import('fs');
const fileBuffer = fsSync.readFileSync(dbPath);   // SYNC -> stalls the whole host + UI
const db = new SQL.Database(fileBuffer);
```

Fix is one line — go async so it yields the thread:

```ts
const fileBuffer = await fs.readFile(dbPath);     // fs = node:fs/promises (already imported)
const db = new SQL.Database(fileBuffer);
```

### Test plan

- Unit (`sessions.vscode.test.ts`): write a JSONL fixture, count; append N lines, assert
  `countRecords` returns `prev + N` and that `countNewlinesInRange` was given `start === oldSize`;
  truncate, assert full rescan; replace file (new inode), assert full rescan.
- E2E: 15 real agents under load, sample `process.cpu` of the host before/after for 60 s.

---

## 3. P2 — full snapshot pushed on every write + every 10 s, with no diff

### Mechanism

Both the write-watcher (§1.2) and the 10 s poll (§1.3) push the **entire** terminal list to the
webview. Each terminal carries up to 24 tool calls, and the tool-call **`input` is never truncated**
— only `output` is (`src/core/session.summary.ts:31`, `:315`):

```ts
const MAX_RECENT_TOOL_CALLS = 24;
const MAX_TOOL_OUTPUT_CHARS = 4000;                       // caps output only
{ name: toolName, input: blockRecord.input, timestamp }   // input shipped raw (file bodies, diffs)
```

So large objects get serialized → structured-cloned across the extension↔webview boundary → re-rendered,
ten times a minute, whether or not anything changed.

### Fix — copy the delta pattern the codebase already has

`cloudSummaryUpdate` (`ui/settings/App.tsx:215-239`) already does the right thing for one channel:
patch one row by id, skip when unchanged:

```ts
if (agent.cloud_summary === summary && agent.status === status) return task;  // no-op skip
```

Apply the same shape to `agentTerminalsData` / `allTerminalsData`:

```ts
// Extension side: only send rows whose content hash changed since last push.
const next = buildRows(agentType);
const changed = next.filter(r => rowHash(r) !== lastHash.get(r.id));
changed.forEach(r => lastHash.set(r.id, rowHash(r)));
if (changed.length) post({ type: 'agentTerminalsDelta', agentType, rows: changed });

// And drop recentToolCalls[].input from the LIST payload; lazy-load full input
// only when a card is expanded (a dedicated 'fetchToolInput' message).
```

Cuts both payload size (no raw inputs) and frequency (skip unchanged).

---

## 4. P3 — one agent's token re-renders all 15 cards

### Mechanism

`AgentCard` is a plain function (no `React.memo`) handed a fresh inline `onSelect` and fresh item
objects each render (`ui/settings/components/mission-control/UnifiedAgentsPane.tsx:2227`, `:1140`):

```tsx
{visibleActive.map((item) => (
  <AgentCard key={item.id} item={item} selected={selected?.id === item.id}
    onSelect={(id) => setExpandedAgentId(id)} />   // new closure every render -> memo can't help
))}
```

So when one agent streams a token and state updates, **all 15 cards re-render**. Separately, the
cloud feed re-parses its whole buffer per token (`CloudActivityFeed.tsx:76` → `cloudActivity.ts:90`).

### Fix

```tsx
const AgentCard = React.memo(function AgentCard({ item, selected, onSelect }) { ... });
const handleSelect = useCallback((id: string) => setExpandedAgentId(id), []);   // stable identity
// ...pass onSelect={handleSelect}; keep item refs stable (only rebuild the changed agent).
```

```tsx
// CloudActivityFeed: debounce + parse only appended lines, not the whole buffer.
const debounced = useDebouncedValue(summary, 250);
const events = useMemo(() => parseCloudSummaryIncremental(prevEvents, debounced), [debounced]);
```

`React.memo` + a stable `useCallback` means a token touching one agent re-renders **one** card.

---

## 5. P4 — recurring `ps`/`pgrep` through a shell wrapper

### Mechanism

`exec` spawns `/bin/sh -c <cmd>` *and then* the `ps`/`pgrep` binary — two processes per call
(`src/vscode/terminalReadiness.ts:41`). Three recurring sources: readiness probes (mostly transient),
the shell-adoption tree-walk every 2 s for 10 min/tab (`:306-308`), and per-focus `ps` with no TTL
cache (`liveSession.ts:70`, in-flight guard only).

### Fix

```ts
import { execFile } from 'child_process';           // was: exec
const run = promisify(execFile);
await run('ps', ['-p', String(pid), '-o', 'comm=']); // no /bin/sh layer
```

- **Measured:** `exec` 4.2 ms → `execFile` 2.0 ms per call (half).
- **Measured counter-result:** batching into one `ps -axo` table sweep is **59 ms/call** (walks the
  whole process table) — at 150 ms cadence that alone burns ~40% of a core. So the fix is fewer +
  cheaper spawns, **not** one big sweep. (This overturns a code-review suggestion.)
- Add a 2–3 s TTL cache to per-focus hydration; exponential backoff on the adoption walk; prefer the
  already-wired `onDidChangeTerminalShellIntegration` event and the existing fs.watch fast-path.

---

## 6. P5 — mechanical waste (small individually, constant in aggregate)

- **`console.log` on the hottest accessor.** `getByTerminal` logs every call
  (`terminals.vscode.ts:200`), called 24× in `extension.ts`; plus per-terminal logs at `:958-1020`.
  Delete them. (Flagged by 4 of 6 audit agents.)
- **Sync fs scan every 10 s.** `fetchTasks` does `readdirSync` + `readFileSync` + per-line
  `JSON.parse` over the whole `~/.agents` tree (`swarm.vscode.ts:664-670`, `:887`). → async + cache.
- **`sessionId → path` re-walk.** `getSessionPathBySessionId` `readdir`s all project dirs per call
  (`sessions.vscode.ts:485-500`), once per terminal per push. → cache the map.
- **Hidden-panel timers.** 15 s and 5 s intervals tick while the webview is hidden
  (`UnifiedAgentsPane.tsx:2327`, `:2463`). → gate on `panelVisible` (the pattern already exists at
  `:849`: `if (!panelVisible) return`).

---

## 7. Cross-cutting: use the other 17 cores

After P1 shrinks the per-tick work, the residual transcript parse is still the largest CPU item and
is embarrassingly parallel. The extractors (`src/core/session.activity.ts`, `session.summary.ts`) are
already pure `string → object` with no VS Code dependency, so they port to a `worker_threads` pool
sized `availableParallelism() - 1` with almost no refactor. This is the only change that turns "1
core pinned, 17 idle" into real parallelism. Verified today: the codebase currently has **0**
`worker_threads`, **0** `os.cpus()`, **0** concurrency limiters across **33,178 LOC**.

---

## 8. Sequence and how we measure

Ranked by (steady-state CPU saved ÷ risk). Each tier ships and is measured independently —
host-thread CPU sampled over 60 s under a fixed 15-agent load, before vs after.

1. **P1** incremental count + async Cursor read — biggest win, append-only makes it safe.
2. **P5** quick wins — strip logs, async fs, path cache, gate hidden timers. Mechanical.
3. **P4** `exec → execFile` + TTL cache + backoff — measured 2× per call.
4. **P2** delta channel + drop raw tool inputs — copies an existing pattern.
5. **P3** `React.memo` + stable handlers + debounced incremental parse.
6. **Worker pool** for the residual parse — last, after P1 shrinks its input.

### Corrections from re-verification (honest numbers only)
- The "O(N²) reprocess" is actually **O(N)** — a shared 500 ms debounce collapses bursts.
- `claude` prewarm spawns **nothing** (`method: 'none'`), not a CLI.
- One React re-parse claim was **refuted** — `App.tsx:215-239` is a pure state patch, no parsing.
- The "batch one `ps -axo` sweep" idea is **measured-wrong** (59 ms/call).

### Don't touch — already correct
Singleton refcounted `fs.watch` (`terminalReadiness.ts:77`), 256 KB tail caps, mtime-gated summary
cache, the `cloudSummaryUpdate` delta patch, the visibility-gated throughput poll.
