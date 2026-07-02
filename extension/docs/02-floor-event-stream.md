# 02 -- Factory Floor: a unified, time-ordered session event stream (design)

Status: **Proposal / research.** Not scheduled. This documents the target
architecture for how the Floor consumes session updates. The current two-tier
poll (PR #116) stands until -- and if -- this lands. No code changes are implied by
this doc.

## Why

The Floor's fragile part is not *fetching* data, it is *reconciling* it. Today
`UnifiedAgentsPane` builds its view by hand-merging heterogeneous sources arriving
over **roughly nine distinct host->webview message paths** (see appendix) and
de-duplicating them with bespoke logic. Conceptually the sources are:

- `items` = `buildUnifiedList(terminals, tasks)` -- local terminals + tasks, pushed
  as props from the host.
- `remoteSessions` -- the SSH cross-host sweep (local + remote hosts), polled.
- `pendingDispatches` -- optimistic cards for just-dispatched work.
- cloud SSE patches -- `cloudSummaryUpdate` mutating individual tasks.
- the synthetic watchdog row.

...plus `localTabSessionIds` to stop this-mac rows double-listing
(`UnifiedAgentsPane.tsx:1039-1057`). Every new source widens that merge.

A single **time-ordered event log** replaces the merge with one code path:
`store.get(sessionKey)`, apply the delta, render. Two payoffs:

1. **Legibility.** One stream, ordered by a single clock, can be read
   top-to-bottom to understand how the whole system's state evolved -- versus
   reasoning about five sources racing. This is the primary argument; it is about
   comprehension, not just tidiness.
2. **Extensibility.** A new source becomes "emit into the bus," not "add a merge
   branch + a dedup rule."

This is a direction, not a fire drill. The current code works; this is where the
architecture should head.

## What already exists (reuse, don't invent)

Two of the five sources are **already event streams**, and the repo already
contains a single-queue multi-source bus. The design is mostly *generalization*.

| Capability | Exists? | Where | Reuse |
|---|---|---|---|
| Unix-socket pub/sub bus, many sources -> one queue | Yes | `src/monitor/broadcast.ts` (`MonitorBroadcastServer/Client`), `src/monitor/host.ts:162-198,249-251` | The model to generalize: 4 detectors already funnel into one `broadcast()`. |
| Wire event carrying a timestamp | Yes | `src/monitor/broadcastTypes.ts:15-21` -- `MonitorEvent { type, sessionId?, pid?, payload, ts }` | Has `ts`; add a sequence. |
| Typed discriminated union + type guards | Yes (monitor only) | `src/monitor/protocol.ts` (9 fact types, `isTuplesSnapshot`, ...) | Copy the pattern for `FloorEvent`. |
| Full-resync-on-(re)connect | Yes | `broadcast.ts:347-357`, `extension.ts:4232-4242` | The snapshot half of snapshot+delta. |
| rAF-buffered coalescing of high-rate updates | Yes | `App.tsx:189-224` (`pendingCloudRef`, `scheduleCloudFlush`) | Generalize to per-session-key coalescing. |
| Append-only delta cache (committed-chars) | Yes | `cloudActivity.ts:121-158` (`CloudParseCache.committedChars`) | Prior art for incremental parse. |
| Local push: fs.watch -> floor update | Yes | `settings.vscode.ts:855-898` (`pushFloorUpdate`, 500ms debounce) | Becomes an event emitter. |
| Cloud SSE stream | Yes | `swarm.vscode.ts:1202-1230` (raw `fetch`, `Accept: text/event-stream`) | Becomes an event emitter. |
| A source already carrying a required per-event `ts` | Yes | `core/watchdogLog.ts:8` (`WatchdogEvent.ts`) | Proof the shape is natural; the target for all sources. |
| Sequence numbers / `lastEventId` | **No** | -- | Introduce (host ingest counter). |
| Central webview store (zustand/useReducer) | **No** | -- | All `useState` in `App.tsx` (~35). Introduce a Floor reducer. |
| Typed webview<->host message union | **No** | -- | Ad-hoc `switch(message.type)`, ~50 cases each side. |

Full per-source inventory is in the appendix.

## The three facts that shape the design

Grounded in the research (file:line in the appendix):

1. **There is no stable session key across origins.** The Floor key differs per
   origin: `term-${AGENT_TERMINAL_ID}` (local; activation-scoped, and *not* the CLI
   UUID), `remote-${host}-${sessionId}` (host sweep), `agent-${agent_id}` (teams),
   `cloudTaskId` (cloud; a provider-opaque string, not a UUID). Dedup today leans on
   `EditorTerminal.sessionId` (the CLI UUID) which is populated *lazily*, so there is
   a startup race window where one session can appear twice.
2. **There are no sequence numbers, only heterogeneous wall clocks.** Local
   sessions coalesce three timestamps via `pickMostRecentTimestamp`; remote sessions
   carry **only** `startedAtMs` (no last-activity epoch at all,
   `floorAdapter.ts:239-241`). Cross-host clocks skew -- the code already mitigates
   this narrowly by computing `sinceMs` against the *fetch* clock, not the host's.
3. **An event bus already exists** (`MonitorBroadcast`) with a `ts` field, no
   sequence, and a resync-on-connect model. And one Floor source is *already* in the
   target shape: `watchdogLogData` -- every `WatchdogEvent` carries a required,
   parser-validated numeric `ts` (`core/watchdogLog.ts:8`). It is the proof that a
   per-event-timestamped feed is natural here; the rest just need to match it. By
   contrast the `cloudSummaryUpdate` SSE patch carries **no** timestamp at all -- a
   concrete gap to close in phase 2.

Fact 2 is the load-bearing one for "order by timestamps," and it has a wrinkle
worth stating plainly.

## Design

### The primary consumer: a per-session summary

The point of all this is a concrete user-facing operation: **show, per agent
session, a summary of what it is doing** -- its status, its recent messages / tool
calls, grouped by session id. So the *product* of the pipeline is a **per-session
accumulator**, and the global time-ordered stream is the *transport* that feeds it
(and, incidentally, the cross-session LIVE ACTIVITY feed). Design the store around
the session, not around a global log.

Concretely, the store's value per session is richer than the at-a-glance card:

```
SessionState = {
  key: string            // canonical sessionKey
  origin, host, agent, status, branch, pr, ticket
  summary: string        // the "what is it doing" line (derived / CLI-provided)
  recent: SessionEvent[] // rolling window of this session's messages / tool calls
  lastActivityTs, tok, needs, ...   // the FloorAgent card fields, derived
}
```

Grouping "messages by session id" is then not a feature to build -- it is the
store's key. The summary is a fold over `recent`.

Good news from the code: this summary largely **already exists** for local
sessions. `extractSessionQuickDetails()` (`session.summary.ts`) produces a
`quickSummary` + `recentToolCalls`, and `terminals.vscode.ts:1000-1162` already
ships them on `TerminalDetail`. The gaps are (a) remote sessions skip that
enrichment, (b) the Floor does not yet surface it as a grouped per-session view,
and (c) there is no canonical key to group by. That is what makes a summary-first
**Phase 0** cheap (see roadmap).

### Core shape

```
  sources --emit-->  FloorEventBus (host)  --floorEvent-->  useFloorStore (webview)
  local fs.watch                                            Map<sessionKey,
  cloud SSE          stamps ingestSeq + ingestTs               SessionState>
  remote sweep diff  message/activity/status events         summary = fold(recent)
  terminal open/close                                       feed = order by ingestSeq
```

One host-side `FloorEventBus` that every source emits into; one `floorEvent`
message type to the webview; a webview reducer keyed by the canonical session key
that owns a `SessionState` per session. `UnifiedAgentsPane` reads the store instead
of hand-merging props + `remoteSessions` + pending + cloud; the per-session detail
pane folds `recent` into a summary; the LIVE ACTIVITY feed orders sessions by their
latest `ingestSeq`.

### Decision 1 -- a canonical `sessionKey()`

Define one identity function used everywhere:

```
sessionKey = origin === 'remote'
  ? `${host}:${cliSessionUuid ?? sessionFileStem}`
  : cliSessionUuid ?? `provisional:${terminalId | cloudTaskId | agentId}`
```

Prefer the CLI session UUID (collision-free within an agent type); namespace remote
by host; fall back to a **provisional** key (terminal/cloud/agent id) when the UUID
is not yet known, and *reconcile* -- re-key -- once it arrives. This kills the
`localTabSessionIds` hand-dedup: same session, same key, regardless of the origin
that reported it.

### Decision 2 -- order by the host's *ingest* clock, not source wall clocks

This is the crux and the correction to a naive "order by each event's timestamp."
Because sources skew (fact 2), a single global order must come from **one** clock.
Make it the extension host's: as each event is ingested, the bus stamps it with a
monotonic `ingestSeq` (a simple counter) and `ingestTs` (host `Date.now()`). The
source's own timestamp rides along as `sourceTs` metadata (for display and for
per-session "last activity"), but **ordering and dedup use `ingestSeq`.**

Result: exactly the legible, top-to-bottom, skew-free time-ordered log the proposal
wants -- one authority clock, one sequence, every origin folded in.

### Decision 3 -- snapshot + delta, with resync

A pure delta stream drifts permanently on one missed event. Mirror the existing
`MonitorBroadcast` model: on subscribe the bus emits a **snapshot** (all current
sessions, `ingestSeq = N`); thereafter **deltas** (`ingestSeq > N`); on a detected
gap or reconnect, re-snapshot. Note the snapshot primitive for remote *is a poll* --
so polling does not disappear, it becomes the periodic resync floor beneath the
event stream. (This is why PR #116's sweep efficiency work stays relevant.)

### Decision 4 -- coalescing / backpressure

A busy agent writes its JSONL many times per second; raw per-write events would
flood the webview. The codebase already coalesces in **two stages** for cloud --
a 750ms host-side notify debounce (`swarm.vscode.ts`, `scheduleNotify`) *and* the
rAF webview buffer (`App.tsx:189-224`) -- and debounces every fs.watch push at 500ms
(`settings.vscode.ts:855-858`). Generalize the same instinct: the store coalesces
deltas **per `sessionKey` per frame**, keeping only the latest patch. Coalescing is
safe precisely because ordering is by `ingestSeq` (Decision 2) -- dropping
intermediate patches for the same key never reorders the log.

### Decision 5 -- a typed `FloorEvent` union, at message granularity

Because the priority is grouping *messages*, the event granularity is
message/activity-level appends, not only card-field patches. A session's `recent`
list is built from `activity` events; `status`/`upsert` carry the card fields.

```ts
type FloorEvent =
  | { kind: 'snapshot'; ingestSeq: number; sessions: SessionState[] }
  | { kind: 'upsert';   ingestSeq: number; ingestTs: number; key: string; origin: Origin; sourceTs: number; patch: Partial<SessionState> }
  | { kind: 'activity'; ingestSeq: number; ingestTs: number; key: string; sourceTs: number; event: SessionEvent } // append to recent[]
  | { kind: 'remove';   ingestSeq: number; ingestTs: number; key: string }
```

Copy the `src/monitor/protocol.ts` type-guard style. This finally gives the Floor
slice of the webview<->host protocol a real typed contract instead of an ad-hoc
string switch -- a side win.

### Decision 6 -- rolling window in the webview, full transcript on-demand

A summary needs the last N events per session, not the whole transcript. The store
keeps a bounded `recent` window per session (drop oldest past the cap) so it never
bloats. The **full** transcript stays on-demand: the Tier-2 path already exists --
`fetchHostSessionDetail` -> `hostSessionDetail` renders one session as markdown
(`settings.vscode.ts:1755`). "Open this session" pulls the full thread; the stream
only carries the rolling window + summary.

### The remote reality check

Remote host sessions are **fundamentally pull** (SSH fan-out). The bus wraps the
sweep's diff (`upsert`/`remove` vs the previous sweep) as events; the sweep, its
cost, and PR #116's optimizations stay. Separately, remote sessions have **no
last-activity epoch** today -- so remote events are `upsert`-on-sweep only until a
Tier-2 enrichment (or a lightweight last-event probe) gives them a real activity
timestamp. Worth being explicit: this design makes remote *consistent with* local,
it does not make remote *push*.

## Proposed phasing (each phase shippable, no big-bang)

**Phase 0 -- ship the per-session summary first (no event stream).** The immediate
user value does not need the rearchitecture. Two small pieces: (a) a canonical
`sessionKey()` used by the Floor for grouping/dedup, and (b) surface the *already
computed* `quickSummary` + `recentToolCalls` (`TerminalDetail`, from
`extractSessionQuickDetails`) as a grouped per-session summary view, and extend that
same enrichment to remote sweep rows (run `enrichWithSessionContent` / a light probe
for non-local hosts). Low blast radius, delivers the priority now. Detailed plan:
`03-floor-session-summary.md`. Phases 1-5 adopt the event stream later, if and when
legibility/extensibility earn it.

1. **Introduce `FloorEvent` + `useFloorStore` behind an adapter.** Convert today's
   messages (`allTerminalsData`, `tasksData`, `hostSessions`, `localSessions`,
   `cloudSummaryUpdate`) into events at the boundary. No behavior change; the store
   produces the same `floorAgents`. This de-risks the reducer in isolation.
2. **Emit natively from local + cloud** (fs.watch and SSE already produce events;
   route them through the bus with `ingestSeq`).
3. **Wrap the remote sweep as diff-events.**
4. **Retire the hand-merge + `localTabSessionIds`** in `UnifiedAgentsPane`; it reads
   the store.
5. **Add a last-activity epoch for remote** (Tier-2), enabling real remote heartbeats.

## Risks / open questions

- **sessionKey during the startup race.** The CLI UUID is lazy; the provisional-key
  -> re-key reconciliation (Decision 1) is the riskiest bit and needs its own tests.
- **Snapshot cost.** The resync snapshot for remote is a full sweep; keep it on the
  slow cadence (45s) and only on gap/reconnect, not per-delta.
- **Blast radius.** This refactors the Floor's reconciliation core -- medium. The
  phased adapter (phase 1) is what keeps it safe.
- **Two buses?** `MonitorBroadcast` is cross-*window* (Unix socket between editor
  windows); the Floor bus is host->*webview* (postMessage). They are different
  transports. Decide whether the Floor bus is a new lightweight in-host emitter that
  *also* subscribes to `MonitorBroadcast`, or a genuine extension of it. Leaning:
  new in-host `FloorEventBus`, fed partly by `MonitorBroadcast` events -- reuse the
  types/guards, not the socket.

## Non-goals

- Not removing polling for remote (SSH is pull; poll becomes the resync floor).
- Not a rewrite now -- the current two-tier poll stands until this is scheduled.
- Not touching the cross-window `MonitorBroadcast` transport.

## Appendix -- current update-path + timestamp inventory

Every host->webview path that feeds the Floor today, with its trigger, coalescing,
shape, and whether the payload already carries a per-item timestamp. This is the
surface a `FloorEvent` stream would unify. (Cadence for the two host-sweep rows
reflects merged `main` / PR #116; the rest are independent of it.)

| # | Path / message | Trigger | Coalesce | Shape | Per-item timestamp |
|---|---|---|---|---|---|
| 1 | `allTerminalsData` + `tasksData` (`pushFloorUpdate`) | fs.watch on session JSONL + `teams/config.json`, armed by `subscribeFloor` | 500ms debounce | full replace | `createdAt` (ms), `lastActivityTimestamp` / `firstMessageTimestamp` (ISO, optional); `latest_activity` / `started_at` on tasks |
| 2 | `allTerminalsData` + `tasksData` + `updateRunningCounts` | `onDidOpen/CloseTerminal` | 500ms debounce | full replace | same as #1 |
| 3 | `cloudSummaryUpdate` | cloud SSE (`fetch` + `text/event-stream`) | 750ms host + rAF webview | per-task patch | **none on the wire** (only `started_at` via the tasks poll) |
| 4 | `localSessions` | webview poll 3s, visibility-gated (PR #116) | 1.5s backend cache | this-mac replace | `startedAtMs` (+ local session-file enrichment) |
| 5 | `hostSessions` | webview poll 45s, visibility-gated (PR #116) | 4s backend cache | full replace + host roster | `startedAtMs` only (no last-activity); `fetchedAt` |
| 6 | `tasksData` + `allTerminalsData` (backstop) | 30s timer, floor tab + visible | -- | full replace | same as #1 |
| 7 | `agentTerminalsData` | fs.watch per agent type, `subscribeAgentTerminals` | 500ms debounce | full replace per type | same as #1 |
| 8 | `floorThroughputData` | webview poll 2.5s, `activeItems>0` + visible | `(mtime,size)` cache | scalar tok/s | none (scalar) |
| 9 | `watchdogLogData` | webview poll 15s, watchdog on + visible | -- | full replace | **`WatchdogEvent.ts` -- required numeric epoch** |
| -- | foreman `publishLiveTerminals` | terminal events, 300ms | 4min keepalive | disk file (cross-window) | `startedAtMs` = `Date.now()` at snapshot (drifts on restart); slice `at` ISO |

Observations that drove the design:
- **7 of 9 are full-array replaces**, not patches -- the store's per-key `upsert`
  makes them deltas for free.
- **Timestamps are inconsistent**: some ISO, some epoch-ms, some absent (#3, #8);
  remote (#5) has only *start*. Only #9 is already per-event epoch. This is why the
  authoritative order must be the host `ingestSeq`, not the payload timestamps.
- The foreman registry is **cross-window (disk), not a webview path** -- out of scope
  for the Floor bus, but a candidate event source to subscribe to later.
