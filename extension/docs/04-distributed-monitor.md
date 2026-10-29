# 04 -- Distributed monitor: cross-window leader election + broadcast pub/sub (design)

Status: **Implemented.** This documents the `src/monitor/` subsystem as it ships:
a set of open IDE windows elect exactly one "monitor" owner, that owner runs the
heavy global detectors once, and every other window is a thin follower that
receives computed facts over a Unix-domain socket. Read the code for current
details; this is the map of how the pieces fit.

## Scope

When you open the same machine in several VS Code / Cursor windows, each window
used to run its own `ps`/`pgrep` readiness probes, its own `fs.watch` over the
session dirs, its own watchdog `fs.stat` tick, and its own 4-second panel poll.
That is N windows doing identical global work. The monitor collapses it to **one**:
a lease file elects a single leader, the leader binds a broadcast socket and runs
the detectors once, and followers subscribe to the results and resolve them back
to their own terminals. This doc covers election, the transport, the protocol, and
the leader-only detector gate.

## Architecture

```
  window A (follower)   window B (LEADER == monitor host)   window C (follower)
  ┌───────────────┐     ┌──────────────────────────────┐    ┌───────────────┐
  │ MonitorFollower│    │ MonitorLeader (holds lease)   │    │ MonitorFollower│
  │  ─ reportTuples│    │ MonitorHost                    │   │  ─ reportTuples│
  │  ─ onFacts     │    │  ├ MonitorBroadcastServer      │   │  ─ onFacts     │
  └───────┬───────┘     │  ├ ReadinessDetector   (#68)   │    └───────┬───────┘
          │             │  ├ SessionWatcher      (#69)   │            │
          │             │  ├ WatchdogDetector    (#70)   │            │
          │             │  └ SnapshotDetector    (#71)   │            │
          │             └──────────────┬────────────────┘            │
          │                            │                             │
   ┌──────┴─────────────────── two shared IPC surfaces ──────────────┴──────┐
   │                                                                        │
   │  (1) lease file  ~/.agents/.tmp/monitor-lease.json   { leaderId, pid,  │
   │                  expiresAt }   ── who is leader; TTL + PID liveness     │
   │                                                                        │
   │  (2) broadcast socket  ~/.agents/.tmp/monitor-broadcast.sock           │
   │                  NDJSON frames: event | request | response             │
   └────────────────────────────────────────────────────────────────────────┘
```

Two files on disk are the entire coordination substrate. The **lease file** decides
*who* is the leader (`lease.ts:21-22`). The **broadcast socket** is *how* the leader
talks to followers (`broadcast.ts:17-22`). Everything else is built on those two.

## The flow, end to end

### 1. Startup wiring

Activation lazily wires three pieces, in this order (`extension.ts:653-660`):
`initMonitorLeader` (start electing), `initMonitorHost` (run the server + detectors
*only while leader*), `initMonitorFollower` (always-on, connect + report + consume).

Identity is `computeWindowId(vscode.env.sessionId, process.pid)`
(`extension.ts:4273`, `extension.ts:4316`). Because `process.pid` is per
extension-host, a **window reload yields a fresh windowId, so leadership is
re-elected rather than silently continued** (`leader.ts:8-10`,
`extension.ts:4271-4273`).

### 2. Election (the lease file)

`MonitorLease` is `{ leaderId, pid, expiresAt }` (`lease.ts:24-31`). The election
decision is a pure, side-effect-free function, `canClaim(lease, selfId, now)`
(`lease.ts:83-92`):

```ts
if (!lease) return true;                    // no lease yet      -> claim (bootstrap)
if (lease.leaderId === selfId) return true; // already ours      -> renew
if (now < lease.expiresAt) return false;    // still valid       -> back off
return !isPidAlive(lease.pid);              // expired: claim iff holder is DEAD
```

The last line is the takeover rule: an **expired** lease is not enough to seize
leadership — the holder's pid must also be dead (`lease.ts:90-91`). `isPidAlive`
is `process.kill(pid, 0)`: resolves = alive, `ESRCH` = dead, `EPERM` = alive-but-
another-user (`liveness.ts:14-22`). So a merely *slow* leader (lease lapsed but
process still up) is left alone; only a genuinely gone leader is replaced.

**Why a file lease instead of an OS lock?** A flock/advisory lock dies with the
process and cannot encode *why* it is held or *who* holds it. The lease is plain
JSON any window can read to answer "who is leader, and is that pid still alive?"
without acquiring anything — the readback is what makes concurrent-claim
convergence (below) possible, and the recorded `pid` is what makes crash-takeover
possible. Writes are atomic (temp file + `rename`) so a reader never sees a
half-written JSON (`lease.ts:53-59`).

### 3. Heartbeat / renew

`MonitorLeader.start()` runs one `tick()` immediately, then every
`DEFAULT_HEARTBEAT_MS = 2_000` ms (`leader.ts:47`, `leader.ts:70-77`). The lease
lifetime `ttlMs` **defaults to 3× the heartbeat** so a healthy leader always renews
well before its own lease expires (`leader.ts:38-40`, `leader.ts:64`). The timer is
`unref`'d so the lease loop never keeps the process alive on its own
(`leader.ts:74-75`).

Each `tick()` reads the lease, asks `canClaim`, and — if allowed — writes itself as
leader with a fresh `expiresAt = now + ttlMs` (`leader.ts:104-126`).

### 4. Concurrent claims converge to one leader (last-rename-wins)

After writing, the leader **reads the lease back** and only considers itself leader
if it still sees its own id (`leader.ts:128-131`):

```ts
// Read back: under concurrent claims the last rename wins. Whoever does not
// see their own id steps down, so the cluster converges to a single leader.
const after = readLease(this.leaseFile);
this.setLeader(after?.leaderId === this.selfId);
```

**Why last-rename-wins converges.** Two windows can both pass `canClaim` in the
same instant (e.g. at bootstrap with no lease) and both write. Because each write
is a `rename` onto the same path, the filesystem serializes them — exactly one
rename lands last. Both windows then read back; the one whose id survived stays
leader, the other sees a foreign id and steps down via `setLeader(false)`. No
distributed lock, no consensus round — the atomic `rename` *is* the tiebreak. Worst
case two windows briefly both believe they lead for less than one heartbeat, then
the readback settles it.

### 5. Takeover on death

When the leader window dies without cleanup, its lease simply stops being renewed.
Within one TTL it expires; the next follower `tick()` finds `now >= expiresAt`,
probes the dead pid (`isPidAlive` → false), and claims (`lease.ts:90-91`). On a
*graceful* shutdown the leader does better than wait out the TTL: `dispose()` calls
`releaseLease`, which unlinks the file **only if we still hold it**
(`leader.ts:88-102`, `lease.ts:62-70`), so a peer takes over on its very next tick.
`extension.ts:4275-4277` disposes the elector on deactivation for exactly this fast
handoff.

### 6. The leader-only gate

`runOnLeaderOnly(start)` is the single seam every heavy starter is wrapped in
(`gate.ts:19-57`). It runs `start()` when the window **gains** leadership and
disposes the returned `Disposable` when leadership is **lost**; re-gaining starts a
fresh instance. Critically it covers the already-leader case: `onLeadershipChange`
only fires on a *flip*, so the gate calls `apply(isLeader())` once up front —
without it, a window that won the election before the gate was wired would never
start (`gate.ts:39-41`). The monitor host is wired through this gate
(`extension.ts:4289-4302`): gain leadership → `host.start()`; lose it →
`host.stop()`, and the next leader binds the same socket.

### 7. Broadcast fan-out + request/response

The leader runs one `MonitorBroadcastServer` on the socket (`broadcast.ts:46-79`).
It keeps a live `Set` of follower sockets and pushes each event to all of them
(`broadcast.ts:128-133`). **Dead sockets are self-healing:** a follower socket is
dropped from the set on `error`/`close`/`end` (`broadcast.ts:94-99`) and on any
failed or non-writable write (`broadcast.ts:139-154`), so a closed follower window
never blocks the fan-out.

Followers hold a **persistent, auto-reconnecting** `MonitorBroadcastClient`
(`broadcast.ts:216-282`). On disconnect (e.g. a leader takeover) it reconnects with
exponential backoff — default 100 ms doubling to a 5 s ceiling
(`broadcast.ts:235-236`, `broadcast.ts:348-358`). The same socket multiplexes a
correlated request/response: each `request()` tags a monotonic id, registers a
pending promise with a 5 s timeout, and resolves it when the matching `response`
frame arrives (`broadcast.ts:311-332`, `broadcast.ts:284-308`).

## The wire format (NDJSON)

The transport is newline-delimited JSON over a Unix socket. One connection
multiplexes three frame kinds (`broadcastTypes.ts:44-47`):

| Frame | Direction | Purpose |
|---|---|---|
| `event`    | server → all clients | fan-out push of a computed fact |
| `request`  | client → server      | correlated ask on the persistent connection |
| `response` | server → one client  | reply, matched to a request by `id` |

A frame is serialized as `JSON.stringify(frame) + '\n'` (`broadcastTypes.ts:50-52`).
The `MonitorEvent` carries `{ type, sessionId?, pid?, payload, ts }`
(`broadcastTypes.ts:15-21`).

**Why NDJSON over the socket?** Socket reads do not align to message boundaries — a
single `data` chunk may hold half a frame, or three and a half. A newline delimiter
lets the `FrameDecoder` buffer partial lines and emit only complete frames
(`broadcastTypes.ts:60-81`). It is also debuggable by eye: every message is one
line of JSON. **Malformed lines are dropped, not thrown** (`broadcastTypes.ts:73-77`)
— one corrupt frame can never tear down a persistent connection that many windows
depend on.

The monitor socket is deliberately **separate** from the one-shot watchdog socket
(`~/.agents/.tmp/watchdog.sock`) so this parallel pub/sub channel never disturbs the
existing request/reply bridge (`broadcast.ts:12-22`).

## The protocol (typed request/response + facts)

`protocol.ts` is the single contract shared by `host.ts`, `follower.ts`, and the
activation wiring, so neither side hand-rolls (and drifts) the same shapes
(`protocol.ts:1-9`).

**Requests** (follower → leader) are a discriminated union keyed by `op`
(`MONITOR_OP`, `protocol.ts:32-74`; `MonitorRequest`, `protocol.ts:141-147`):

| `op` | Meaning |
|---|---|
| `report-tuples`   | replace this window's terminal slice on the leader |
| `snapshot`        | pull the current merged tuple set |
| `arm-agent`       | arm agentReady detection for a shell pid (#68) |
| `arm-shell-adoption` | arm shell-adoption detection for a shell pid (#68) |
| `watchdog-watch`  | replace this window's watchdog watch slice (#70) |
| `snapshot-watch`  | replace this window's panel-snapshot watch slice (#71) |

**Facts** (leader → all) are broadcast `MonitorEvent`s whose `type` is a
`MONITOR_FACT` (`protocol.ts:172-188`), each with a payload type and a type-guard
narrower (`isTuplesSnapshot` `protocol.ts:289-297`, `isReadinessFact`,
`isShellAdoptionFact`, `isSessionFact`, `isWatchdogStall`, `isPanelSnapshot`, …
`protocol.ts:299-390`):

| Fact `type` | Emitted by | Payload |
|---|---|---|
| `monitor.tuples-snapshot` | host, on every re-report | merged `TerminalTuple[]` |
| `monitor.readiness`       | ReadinessDetector (#68) | `{ pid, event }` milestone |
| `monitor.shell-adoption`  | ReadinessDetector (#68) | `{ pid, agentKey, childPid }` |
| `monitor.session`         | SessionWatcher (#69) | parsed session head metadata |
| `monitor.session-warmth`  | SessionWatcher (#69) | `{ filePath, ts }` write signal |
| `monitor.watchdog-stall`  | WatchdogDetector (#70) | `{ sessionId, idleMs, mtimeMs }` |
| `monitor.watchdog-versions` | WatchdogDetector (#70) | parsed `agents view --json` |
| `monitor.panel-snapshot`  | SnapshotDetector (#71) | git/worktrees/usage/teams merge |

### The tuple merge

A follower reports its terminals as `TerminalTuple`s —
`(windowId, terminalId, pid, sessionId, workspacePath, agentType)`
(`protocol.ts:16-29`). The host stores **one slice per window** in a
`Map<windowId, TerminalTuple[]>`, so a re-report *replaces* (never appends) that
window's terminals (`host.ts:92-94`, `host.ts:206-210`). The union across all
slices is the global terminal set the monitor broadcasts back as a
`tuples-snapshot` (`host.ts:155-160`, `host.ts:254-257`). Followers resolve each
tuple's `pid`/`sessionId` back to their own `vscode.Terminal`; the resolution stays
window-local by design — the follower never imports the terminal maps, the wiring
layer injects a resolver closure (`follower.ts:11-14`, `follower.ts:216-228`,
`extension.ts:4320-4328`).

## Centralized detectors — only the leader runs them

When `MonitorHost` is constructed with `detectors`, it starts four detectors, each
of which does global work **once** that every window previously did on its own
(`host.ts:162-199`). They all funnel into the single `broadcast()`
(`host.ts:249-257`) — the same one-queue-many-sources shape
`02-floor-event-stream.md:45` calls out as "the model to generalize."

| Detector | Was (per window) | Now (once on leader) |
|---|---|---|
| `ReadinessDetector` (#68) | `ps`/`pgrep` probes per (window, terminal) | one probe per pid, fed the union of all windows' shell pids (`readinessDetector.ts:1-8`, `host.ts:238-247`) |
| `SessionWatcher` (#69) | per-terminal `fs.watch` + `fs.watchFile` poll | exactly ONE recursive `fs.watch` per session root, machine-wide (`sessionWatcher.ts:1-10`) |
| `WatchdogDetector` (#70) | per-window `fs.stat` + `agents view` tick | one staleness tick per session; `agents view --json` polled once machine-wide (`watchdogDetector.ts:1-14`) |
| `SnapshotDetector` (#71) | every panel's own 4 s git/worktree/usage/teams poll | one merged `panel-snapshot` per tick, in-flight-guarded (`snapshotDetector.ts:1-14`) |

Detection is centralized; **delivery stays per-window**. The leader broadcasts a
fact keyed by pid / sessionId; the window that owns that terminal resolves it back
and runs the local action (the nudge, the render). The probe primitives themselves
(`ps`/`pgrep`/`ps -o stat`) live in `probes.ts` and are shared by both the
leader-side detector and the window-local fallback so the two copies never drift
(`probes.ts:1-9`); a shared concurrency gate caps concurrent probe subprocesses at
`MAX_CONCURRENT_PROBES = 8` (`probes.ts:48`, `probes.ts:57-69`).

## Graceful degradation

Every follower request that mutates leader state returns `false` (rather than
throwing) while disconnected, so the caller keeps its window-local fallback intact —
`reportTuples` (`follower.ts:200-214`), `armAgent` (`follower.ts:126-136`),
`setWatchdogWatches` (`follower.ts:144-158`), `setSnapshotWatches`
(`follower.ts:166-180`). The client exposes `state`/`connected`
(`broadcast.ts:242-248`) so the wiring layer flips local probing back on when the
monitor connection drops (`extension.ts:4355-4361`). The foreman-registry file write
stays as the disconnected-case fallback for the tuple set (`follower.ts:5-8`,
`extension.ts:4308-4310`).

## Known gaps / limitations

- **Brief dual-leadership window.** Under simultaneous claims, two windows can both
  believe they lead until the next readback tick resolves it — bounded by one
  heartbeat (`leader.ts:128-131`). Facts are keyed by pid/sessionId and followers
  replace-by-window, so a duplicate broadcast is idempotent rather than corrupting,
  but the window is real.
- **No fencing token.** Election relies on `expiresAt` + PID liveness, not a
  monotonic epoch. A leader whose process is paused past its TTL (e.g. `SIGSTOP`,
  a laptop sleep) is treated as *alive* by `isPidAlive` (`liveness.ts:14-22`) as
  long as the pid exists, so takeover waits for the pid to actually be gone — a
  paused-but-present holder is deliberately not preempted.
- **Server bind is not first-writer-wins.** `MonitorBroadcastServer.start()`
  unlinks any stale socket before binding and *rejects* if the address is still
  taken (`broadcast.ts:63-79`). The lease is the real single-leader guarantee; the
  socket bind assumes the gate already ensured only the leader starts a host.
- **Request handler is leader-supplied.** The transport is leader-agnostic; a
  server with no `onRequest` answers every request with
  `"No request handler registered"` (`broadcast.ts:107-114`). Only `MonitorHost`
  wires the real handler (`host.ts:106-107`, `host.ts:201-236`).

## Critical files

| File | Role |
|---|---|
| `src/monitor/lease.ts` | Lease file mechanics: `MonitorLease` shape, atomic write, and the pure `canClaim` election decision (TTL + PID-liveness takeover). |
| `src/monitor/leader.ts` | `MonitorLeader` heartbeat loop, `tick()` convergence (last-rename-wins), graceful lease release, process-wide `electLeader` singleton. |
| `src/monitor/gate.ts` | `runOnLeaderOnly` — start on leadership gain, dispose on loss; the seam every leader-only starter wraps. |
| `src/monitor/broadcast.ts` | `MonitorBroadcastServer` (fan-out + dead-socket eviction) and auto-reconnecting `MonitorBroadcastClient` (backoff + correlated request/response). |
| `src/monitor/broadcastTypes.ts` | Wire types: `MonitorEvent`, the `event`/`request`/`response` `MonitorFrame` union, NDJSON `encodeFrame`, and the malformed-tolerant `FrameDecoder`. |
| `src/monitor/protocol.ts` | The typed contract: `MonitorRequest` union (`MONITOR_OP`), `MONITOR_FACT` fact types + payloads + type guards, `TerminalTuple`. |
| `src/monitor/host.ts` | `MonitorHost` — the leader==monitor runtime: serves followers, merges per-window tuple slices, starts the four detectors, funnels every fact into one `broadcast()`. |
| `src/monitor/follower.ts` | `MonitorFollower` — the always-on per-window client: reports tuples, arms detectors, resolves broadcast facts back to local terminals, degrades to `false` while disconnected. |
| `src/monitor/probes.ts` | Shared, vscode-free `ps`/`pgrep` probe primitives + concurrency gate, used by both the leader detector and the window-local fallback. |
| `src/monitor/readinessDetector.ts` | Leader-side pid-keyed readiness detector (#68). |
| `src/monitor/sessionWatcher.ts` | Leader-side machine-wide session-file watcher (#69). |
| `src/monitor/watchdogDetector.ts` | Leader-side sessionId-keyed stall detector (#70). |
| `src/monitor/snapshotDetector.ts` | Leader-side panel/floor snapshot detector (#71). |
| `src/core/liveness.ts` | `isPidAlive` — the canonical `process.kill(pid, 0)` liveness probe the takeover rule depends on. |

Wiring lives in `src/vscode/extension.ts`: `initMonitorLeader`
(`extension.ts:4267-4278`), `initMonitorHost` (`extension.ts:4285-4303`),
`initMonitorFollower` (`extension.ts:4311+`).
</content>
</invoke>
