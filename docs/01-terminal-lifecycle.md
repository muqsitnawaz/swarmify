# Terminal Lifecycle

How the Swarmify extension drives an agent terminal from "tab opened" to
"agent ready for input," and how every flow that sends text into a terminal
waits for the right moment. Consumed by every spawn, resume, reload, and
restore path in `extension/src/vscode/extension.ts` and `tmux.ts`.

Depends on a shim contract documented in
[`agents-cli/docs/01-version-management.md` — Shim Process Contract](../../agents-cli/docs/01-version-management.md#shim-process-contract).

## Problem

Before this design, the extension had two brittle patterns for "wait until the
terminal is ready":

1. `waitForShellReady(terminal, 5000)` — listened for
   `onDidChangeTerminalShellIntegration` with a 5-second timeout fallback.
   Worked well on fast machines; silently fell back to `sendText` on slow
   machines (heavy `.zshrc`, oh-my-zsh with p10k, conda init, nvm lazy-load),
   typing the launch command *before* the shell rendered its prompt.
2. Hardcoded `setTimeout(2000)` for tmux init and `setTimeout(6000)` for the
   Continue (resume-in-best) flow. Always too short on slow machines, always
   too long on fast ones.

The failure mode was visible on the "Continue" path:

```
Continue flow (old):
  sendText "claude@2.1.112"    → shell launches claude
  setTimeout 6000ms             → guess: "claude TUI is up by now"
  sendText "/continue <id>"     → typed into pty

Actual behavior on a busy machine:
  t=0ms      launch command typed
  t=200ms    shim runs agents sync subprocess
  t=1200ms   shim exec's claude
  t=4500ms   claude auto-update check (network timeout)
  t=6000ms   sendText /continue  ← TUI still booting, input dropped
  t=8100ms   TUI finally renders, showing an empty ">" prompt
```

The user sees the Continue prompt never land. No error, no log, just an empty
input box.

## Event Taxonomy

Four monotonic events per terminal. Each has a distinct meaning, a primary
detection signal, and a fallback for when the primary isn't available.

```
createTerminal ──► tabReady ──► shellReady ──► promptReady ──► agentReady
                    (pty)        (exec'd)       (rc done)       (TUI up)
```

| Event | What it means | Primary signal | Fallback |
|---|---|---|---|
| `tabReady` | VS Code `Terminal` exists, pty allocated | `await terminal.processId` resolves | — |
| `shellReady` | The shell binary has `exec`'d | `ps -p <pid> -o comm=` returns `zsh`/`bash`/`fish` | 2-second floor then assume ready |
| `promptReady` | `.zshrc`/rc done, `PS1` drawn, shell idle at prompt | `onDidChangeTerminalShellIntegration` fires | `pgrep -P <pid>` returns empty for 2 consecutive 150 ms polls |
| `agentReady` | Agent CLI (child of shell) has rendered its TUI and is blocked on pty input | fs.watch catches the agent's session file appearing | Child process in `S` state for 10 consecutive 150 ms polls **and** child alive ≥2500 ms |

All four are detectable via stable VS Code API (`processId`, shell
integration event) and POSIX tools (`ps`, `pgrep`, `fs.watch`) — no proposed
APIs, nothing fork-specific. The detection works identically in VS Code,
VSCodium, and Cursor.

## State Machine

```
                           ┌──────────────┐
                           │  (not yet    │
                           │  registered) │
                           └──────┬───────┘
                                  │ registerTerminal(t)
                                  ▼
                   ┌──────────────────────────────┐
                   │  all: null                   │
                   │  {tab, shell, prompt, agent} │
                   └──────────────┬───────────────┘
                                  │ processId resolves
                                  ▼
                   ┌──────────────────────────────┐
                   │  tabReadyAt: t₀              │
                   └──────────────┬───────────────┘
                                  │ ps -o comm= matches shell
                                  ▼
                   ┌──────────────────────────────┐
                   │  +shellReadyAt: t₁           │
                   └──────────────┬───────────────┘
                                  │ shell-integration event
                                  │ OR pgrep idle × 2
                                  ▼
          ┌──────────────────────────────────────────────┐
          │  +promptReadyAt: t₂                          │◀───┐
          └────────────────────┬─────────────────────────┘    │
                               │ armAgentReady(...) called    │  resetAfterAgentExit(t)
                               │ + session file appears       │  (after ^C^C)
                               │   OR child S-state × 10      │  clears prompt+agent
                               │     AND runtime ≥ 2500ms     │  keeps tab+shell
                               ▼                              │
          ┌──────────────────────────────────────────────┐    │
          │  +agentReadyAt: t₃ (TERMINAL STATE)          │────┘
          └────────────────────┬─────────────────────────┘
                               │ onDidCloseTerminal
                               ▼
                   ┌──────────────────────────────┐
                   │  disposed: true              │
                   │  (rejects pending waiters)   │
                   └──────────────────────────────┘

  Cascade rule: markEvent(E) sets all events ordered ≤ E that are still null.
  Reset rule:   resetFrom(promptReady) clears promptReady + agentReady,
                keeps tabReady + shellReady (pty and shell still alive).
```

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                 Extension Host (per-terminal registry)             │
│                                                                    │
│   registry: Map<vscode.Terminal, Registered>                       │
│                                                                    │
│   Registered {                                                     │
│     entry: ReadinessEntry                                          │
│     pid: number | null                                             │
│     timers: NodeJS.Timeout[]     ◀── cleared on close             │
│     watchers: fs.FSWatcher[]     ◀── disposed on close            │
│     disposables: vscode.Disposable[]                               │
│   }                                                                │
│                                                                    │
│   ReadinessEntry {                                                 │
│     state: { tabReadyAt, shellReadyAt, promptReadyAt,              │
│              agentReadyAt }                                        │
│     waiters: Map<Event, Waiter[]>  ◀── dedupes concurrent waits   │
│     disposed: boolean                                              │
│   }                                                                │
└────────────────────────────────────────────────────────────────────┘
                          │                             ▲
   createTerminal ───────▶│                             │
   resetAfterAgentExit ──▶│                             │
   armAgentReady ────────▶│                             │
                          │                             │
                          │ emits ────────────────────▶ │
                          │                             │
                          ▼                             │
    ┌──────────────────────────────────────────────────┐
    │  Signal sources (one global listener each)       │
    │                                                  │
    │  onDidChangeTerminalShellIntegration ──────────▶ promptReady
    │  onDidCloseTerminal ───────────────────────────▶ dispose
    │                                                  │
    │  Per-terminal probes                             │
    │  ps -p <pid> -o comm=      (every 50ms, 2s cap) ▶ shellReady
    │  pgrep -P <pid>            (every 150ms)        ▶ promptReady
    │  pgrep + ps stat=          (every 150ms)        ▶ agentReady
    │                                                  │
    │  Per-terminal fs.watchers                        │
    │  ~/.claude/projects/**           ── match ─────▶ agentReady (fast)
    │  ~/.agents/versions/claude/**/projects/**       ▶ agentReady (fast)
    │  ~/.codex/sessions/**                           ▶ agentReady (fast)
    │  ~/.gemini/tmp/**                               ▶ agentReady (fast)
    └──────────────────────────────────────────────────┘
```

The two layers are intentional:

- **Core** (`src/core/terminalReadiness.ts`) — pure state machine. No VS Code,
  no I/O. Handles cascade semantics (marking `promptReady` also fires
  `tabReady` and `shellReady`), dedups concurrent waiters, supports reset for
  re-arming after agent exit. 15 unit tests covering transitions, idempotency,
  timeouts, reset, and dispose.
- **Glue** (`swarmify/extension/src/vscode/terminalReadiness.ts`) — VS Code
  integration. Owns the per-terminal registry, probes, and `fs.watch`ers.

## User Flow: Continue

The concrete user-visible flow. User has a running Claude tab out of context
budget; wants to continue the same session in a newer Claude version.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ①  User sees:  "Claude 2.1.110 · session abc12345 · 98% context"        │
│      Muscle memory:  Cmd+Shift+J      →  "Continue in best version"      │
│                                                                          │
│  ②  Extension picks Claude 2.1.112 (best by version, signed in)          │
│      Spawns new terminal tab, icon flips to spinner                      │
│                                                                          │
│  ③  Tab shows:                                                           │
│      ┌─────────────────────────────────────────┐                         │
│      │  CC - abc12345                          │ ← new tab, focused      │
│      ├─────────────────────────────────────────┤                         │
│      │  ~/src/foo %                            │ ← shell prompt ready    │
│      │  $ claude@2.1.112                       │ ← launch typed          │
│      │  Claude Code v2.1.112                   │                         │
│      │  Welcome to Opus 4.7...                 │                         │
│      │  > _                                    │ ← TUI idle              │
│      └─────────────────────────────────────────┘                         │
│                                                                          │
│  ④  Extension types `/continue abc12345` into the TUI                    │
│      ┌─────────────────────────────────────────┐                         │
│      │  > /continue abc12345_                  │ ← lands in input box    │
│      └─────────────────────────────────────────┘                         │
│                                                                          │
│  ⑤  Claude resumes, picks up where session left off                      │
└──────────────────────────────────────────────────────────────────────────┘
```

What goes wrong without readiness events: step ④ fires before step ③'s TUI is
actually drawn. Bytes hit Claude's stdin while it's still in boot; Claude
discards them. User sees an empty `>` prompt and thinks Continue is broken.
See the [Problem](#problem) timeline.

## Sequence: Fresh Spawn

Concrete message timing for `openSingleAgent` launching Claude. Columns are
actors; arrows are calls/events; the time axis runs downward.

```
Extension      VSCode         OS           shell      fs.watch    StateMachine
  host         Terminal   (ps/pgrep)      (zsh)      (FSWatcher)  (ReadinessEntry)
    │             │             │           │            │              │
    │─createTerminal()──────────▶            │            │              │
    │◀────Terminal obj──────────             │            │              │
    │                                                                     │
    │─registerTerminal(t)────────────────────────────────────────────────▶│
    │                                                    createEntry() ──▶│
    │                                                                     │
    │─await t.processId─▶                                                  │
    │◀──pid=12345──────                                                    │
    │                                                                     │
    │────────────────────markEvent('tabReady', t₀)───────────────────────▶│
    │                                                                     │
    │─spawn ps probe─▶                                                     │
    │                 ps -p 12345 -o comm=                                 │
    │                            ─── "zsh\n" ────▶                         │
    │────────────────────markEvent('shellReady', t₁)─────────────────────▶│
    │                                                                     │
    │─spawn pgrep probe─▶                                                  │
    │                (every 150ms)                                         │
    │                 pgrep -P 12345                                       │
    │                            ─── "12346" ───▶  (.zshrc running)       │
    │                 pgrep -P 12345                                       │
    │                            ─── "" ─────────▶  (idle tick 1/2)       │
    │                 pgrep -P 12345                                       │
    │                            ─── "" ─────────▶  (idle tick 2/2) ✓    │
    │                                                                     │
    │  (parallel path) onDidChangeTerminalShellIntegration fires           │
    │◀───── event(terminal=t) ────                                         │
    │                                                                     │
    │────────────────────markEvent('promptReady', t₂)────────────────────▶│
    │                                                                     │
    │─waitFor('promptReady')──────────────────────────────────────────────▶│
    │◀─── resolve ────────────────────────────────────────────────────────│
    │                                                                     │
    │─t.sendText("claude --session-id abc12345")─▶                         │
    │                                        ◀── bytes to pty             │
    │                                           zsh forks shim             │
    │                                           shim execs claude          │
    │                                                                     │
    │─armAgentReady(t, {agentKey, sessionId, cwd})───────────────────────▶│
    │                                                    set agentArmed=T │
    │─spawn session-file watcher (fast path)─────────────────▶             │
    │                                           fs.watch(~/.claude/...)    │
    │                                                                     │
    │─spawn agent probe (fallback)─▶                                       │
    │                (every 150ms)                                         │
    │                 pgrep -P 12345                                       │
    │                            ─── "12346" ───▶ (child exists)           │
    │                 ps -p 12346 -o stat=                                 │
    │                            ─── "S+\n" ────▶ (network I/O sleep)      │
    │                             (idle tick 1/10, childFirstSeen=t₃)     │
    │                                                                     │
    │                             [~1200ms of stable S-state polls]       │
    │                                                                     │
    │                                        claude writes session file   │
    │                                        at ~/.claude/projects/.../   │
    │                                        abc12345.jsonl               │
    │                                                       ── event ──▶  │
    │                                           FAST PATH WINS            │
    │────────────────────markEvent('agentReady', t₄)─────────────────────▶│
    │                                                                     │
    │─waitFor('agentReady')───────────────────────────────────────────────▶│
    │◀─── resolve ────────────────────────────────────────────────────────│
    │                                                                     │
    │─t.sendText("/continue abc12345")─▶                                   │
    │                                        ◀── bytes to claude's stdin  │
    │                                           TUI processes input       │
    ▼             ▼             ▼           ▼            ▼              ▼
  time (ms):  0    50   200   400   1000  1500  2000  2500  3000  3500  4000
              └tab└shell└───.zshrc──┘     └────claude boots────┘   └ready┘
                                    └prompt
```

## Sequence: Resume (Ctrl+C twice)

The "restart with a fresh session" flow — the one that most needed fixing.
Agent CLI is running; user hits Cmd+Shift+C (clear) or Cmd+Shift+R (reload).

```
Extension      VSCode          OS       claude CLI      zsh        StateMachine
    │             │             │           │            │              │
    │  ── precondition ──                                                 │
    │  entry.state = { tabReady: t₀, shellReady: t₁,                      │
    │                  promptReady: t₂, agentReady: t₄ }                  │
    │  claude is running as pid 12346 (child of shell pid 12345)          │
    │                                                                     │
    │─sendSequence('\u0003')──▶                                            │
    │                                        SIGINT ───▶│                 │
    │                                        (claude shows "Interrupted") │
    │─sleep 100ms                                                          │
    │─sendSequence('\u0003')──▶                                            │
    │                                        SIGINT ───▶│                 │
    │                                        (claude exits)                │
    │                                                    │                 │
    │                                                    zsh back at prompt│
    │                                                                     │
    │─resetAfterAgentExit(t)──────────────────────────────────────────────▶│
    │                                              resetFrom('promptReady')│
    │                                              state = { tab: t₀,     │
    │                                                        shell: t₁,   │
    │                                                        prompt:null, │
    │                                                        agent: null }│
    │                                              restart pgrep probe    │
    │                                                                     │
    │                                 pgrep -P 12345                      │
    │                                      ─── "" ─────▶ (idle 1/2)       │
    │                                 pgrep -P 12345                      │
    │                                      ─── "" ─────▶ (idle 2/2) ✓    │
    │────────────────────markEvent('promptReady', t₅)────────────────────▶│
    │                                                                     │
    │─waitFor('promptReady')──────────────────────────────────────────────▶│
    │◀─── resolve ────────────────────────────────────────────────────────│
    │                                                                     │
    │─t.sendText("clear && claude -r abc12345")─▶                          │
    │                                                    │                 │
    │                                        new claude ◀ zsh forks        │
    │                                                                     │
    │─armAgentReady(t, {agentKey, sessionId, cwd})───────────────────────▶│
    │  [same as Fresh Spawn from here]                                    │
    ▼             ▼             ▼           ▼            ▼              ▼
```

Before: `setTimeout(200)` + `setTimeout(1500)` = **1700ms fixed wait**,
fragile on slow machines and wasteful on fast ones. After: typically
300–500ms on a warm machine, up to a 30s timeout on a pathologically slow one.

## Restored terminal (after IDE reload)

VS Code persists terminal tabs across reload. When a tab reappears via
`vscode.window.onDidOpenTerminal` *and* the extension identifies it as an
agent terminal, the agent is already running — we skip all probes:

```
Extension host                       ReadinessEntry
    │                                      │
    │  onDidOpenTerminal(t)                │
    │  ← recognized as agent ───           │
    │                                      │
    │─registerTerminal(t, {restored:true})─▶
    │                               skip probes
    │                               markEvent('agentReady')
    │                                  └─ cascades to tab/shell/prompt
    │                                      │
    ▼                                      ▼
```

No pgrep, no ps, no fs.watch. All four events fire immediately.

## Sequence: Shell Adoption

When the user spawns an `SH` terminal and later runs `claude` / `codex` /
`gemini` / `cursor-agent` / `opencode` inside it, the extension promotes the
internal `EditorTerminal` entry from "shell" to the detected agent so
dashboards, the session tracker, label generation, autogit, recap, and swarm
treat it as that agent.

```
Extension host                       ReadinessEntry / Registry
    │                                      │
    │  openSingleAgent (agentKey='shell')  │
    │─terminals.register(prefix='sh')─────▶
    │─readiness.registerTerminal──────────▶ tabReady → shellReady → promptReady
    │─armShellAdoptionForTerminal─────────▶ schedule armShellAdoption (every 2s)
    │                                      │
    │  ...user types `claude` at prompt... │
    │                                      │
    │                                      ▼ tick (2s loop, depth-5 BFS over pgrep -P)
    │                                      │   ps -p $childPid -o args=
    │                                      │   detectAgentKeyFromArgs(args)
    │                                      │   extractSessionIdFromArgs(args)
    │                                      │     OR fallback: stat session-file
    │                                      │     root for uuid filename with
    │                                      │     mtime ≥ child start time
    │                                      ▼
    │  ◀──────── onAdopted({agentKey, sessionId}) ──────────
    │                                      │
    │─terminals.adoptShellAsAgent──────────▶ entry.agentConfig = newConfig
    │  (mutates in place, idempotent)         entry.agentType = agentKey
    │                                         entry.sessionId = uuid
    │                                         schedulePersist + sessionTracker
    │                                      │
    │  registers session tracker watcher, starts auto-label poller
    │                                      │
    ▼                                      ▼
```

What does NOT change:
- The VS Code tab's `iconPath` (frozen at `createTerminal`).
- The VS Code tab's `name` (frozen if passed at `createTerminal`; otherwise
  whatever the agent CLI's OSC `\x1b]0;...\x07` sequence sets it to).
- `terminalId` / env vars — these stay `SH-…` for back-reference.

Hard limits:
- One-shot — after firing, the probe disposes itself.
- 10-minute lifetime — if no agent CLI appears, the probe drops to avoid
  leaking polling load per-terminal.
- Idempotent — re-arming a terminal that has already been adopted is a no-op
  (checked in both `armShellAdoption` and `adoptShellAsAgent`).

Diagnostic log: `~/.cache/swarmify/shell-adoption.log` — every poll tick,
every detection, every adoption. VS Code's `console.log` doesn't land in any
persisted log file, so this is the only post-hoc trace.

## Data Flow

Every signal source → a shape of data → a deterministic transformation → a
specific state mutation. Ambiguity in either direction is a bug.

```
┌─────────────────────────┬──────────────────────────────┬────────────────────────────────────────┬────────────────────────────┐
│ Signal Source           │ Data Shape                   │ Transformation                         │ State Mutation             │
├─────────────────────────┼──────────────────────────────┼────────────────────────────────────────┼────────────────────────────┤
│ terminal.processId      │ Promise<number | undefined>  │ await → number pid                     │ markEvent('tabReady')      │
│   (vscode API)          │                              │   null → give up silently              │                            │
├─────────────────────────┼──────────────────────────────┼────────────────────────────────────────┼────────────────────────────┤
│ ps -p <pid> -o comm=    │ stdout: "zsh\n"              │ trim + basename                        │ markEvent('shellReady')    │
│   (every 50ms, 2s cap)  │   or:   "-zsh\n"             │   → split('/').pop() → "zsh"           │                            │
│                         │   or:   "bash\n"             │   → KNOWN_SHELLS.has('zsh') ? ✓ : ✗    │                            │
├─────────────────────────┼──────────────────────────────┼────────────────────────────────────────┼────────────────────────────┤
│ onDidChangeTerminal     │ event { terminal: Terminal } │ if terminal === r.terminal → match     │ markEvent('promptReady')   │
│   ShellIntegration      │                              │                                        │                            │
│   (global listener)     │                              │                                        │                            │
├─────────────────────────┼──────────────────────────────┼────────────────────────────────────────┼────────────────────────────┤
│ pgrep -P <shell_pid>    │ stdout: "12346\n" (busy)     │ trim → "" | "pid" | "pid1\npid2"       │ markEvent('promptReady')   │
│   (every 150ms)         │   or:   "" (idle)            │ if "" → consecutiveIdle++              │   (when idle × 2)          │
│                         │   exit 1 = zero matches      │   else  → consecutiveIdle = 0          │                            │
│                         │                              │ if consecutiveIdle ≥ 2 → fire          │                            │
├─────────────────────────┼──────────────────────────────┼────────────────────────────────────────┼────────────────────────────┤
│ pgrep -P <shell_pid>    │ stdout: "12346\n"            │ first child pid = 12346                │ (feeds agent-state probe)  │
│   (every 150ms)         │   no child → reset counter   │ childFirstSeenAt = now()               │                            │
│                         │                              │                                        │                            │
│ ps -p <child> -o stat=  │ stdout: "S\n"   (idle sleep) │ startsWith('S') → idle                 │ markEvent('agentReady')    │
│   (every 150ms)         │   or:   "R+\n"  (running)    │ if idle AND (                          │   (when                    │
│                         │   or:   "D\n"   (I/O wait)   │   consecutiveIdle ≥ 10 AND             │    both conditions         │
│                         │                              │   now() - childFirstSeenAt ≥ 2500ms    │    simultaneously true)    │
│                         │                              │ ) → fire                               │                            │
├─────────────────────────┼──────────────────────────────┼────────────────────────────────────────┼────────────────────────────┤
│ fs.watch(root, recur..) │ event(type, filename)        │ filename.toLowerCase()                 │ markEvent('agentReady')    │
│   roots per agent:      │   filename may be null on    │   .includes(sessionId.toLowerCase())   │   (fast path; races        │
│   Claude:               │   some platforms — ignore    │ → match = true → fire                  │    with fallback probe)    │
│     ~/.claude/projects  │                              │                                        │                            │
│     ~/.agents/versions/ │                              │                                        │                            │
│       claude/*/home/... │                              │                                        │                            │
│   Codex:  ~/.codex/...  │                              │                                        │                            │
│   Gemini: ~/.gemini/... │                              │                                        │                            │
└─────────────────────────┴──────────────────────────────┴────────────────────────────────────────┴────────────────────────────┘
```

The cascade rule applies at the mutation step: `markEvent('promptReady')`
also sets `tabReadyAt` and `shellReadyAt` if they're still null. So a late
arrival of `shellReady` after `promptReady` is a no-op — the state is already
correct, just with a slightly different attribution of when the shell was
detected.

## Detection Mechanics

### `shellReady`

Poll `ps -p <pid> -o comm=` every 50 ms for up to 2 seconds. Match against a
small allowlist of shells (`zsh`, `-zsh`, `bash`, `-bash`, `fish`, `-fish`,
`sh`, `-sh`). First match fires `shellReady`. If nothing matches within 2 s,
we mark `shellReady` anyway — whatever is in the pty is what the user picked,
we shouldn't hang.

### `promptReady`

Two sources race; whichever fires first wins.

**Primary: shell integration event.** VS Code's
`onDidChangeTerminalShellIntegration` fires when the VS Code shell-integration
script finishes sourcing, typically at the end of `.zshrc`. A single global
listener dispatches to the right registry entry.

**Fallback: pgrep idle probe.** `pgrep -P <shell_pid>` returns the shell's
direct children. During `.zshrc` execution, plugins spawn git/curl/python
subprocesses; once the rc finishes and the shell prints `PS1`, the shell has
no children. Require **2 consecutive polls** of emptiness to debounce lazy-load
plugin bursts (nvm-lazy, conda init).

```
Slow machine timeline:
  t=0ms      createTerminal, processId resolves
  t=50ms     ps probe → "zsh" → shellReady
  t=100ms    .zshrc starts: oh-my-zsh loads
  t=800ms    oh-my-zsh spawns git rev-parse for prompt
  t=950ms    git exits
  t=1100ms   p10k instant prompt renders (integration broken)
  t=1250ms   nvm-lazy shim loads
  t=1400ms   nvm-lazy exits
  t=2100ms   pgrep empty
  t=2250ms   pgrep empty (debounce hit) → promptReady fires
```

On a machine where shell integration works, `promptReady` typically fires
within 100–300 ms. On a machine where it's broken or disabled, the pgrep
fallback adds ~150–300 ms of latency but still fires reliably.

### `agentReady`

This is the event that caused the visible Continue bug. Naive detection was
"child exists and is in `S` state for 2 polls" (300 ms). But agent CLIs are
Node processes, and Node's default state is `S` — the event loop sleeps on
epoll/kqueue between ticks. During `claude doctor` or auto-update, the process
sits in `S` for seconds waiting on network I/O, long before the TUI renders.

Two defenses run in parallel:

**Primary: session-file fast path** (`armSessionFileFastPath`). When the caller
supplies `{ agentKey, sessionId, cwd }`, we `fs.watch` the agent's session
roots (recursive) and fire `agentReady` as soon as a filename containing the
sessionId appears. Deterministic: the file is only created *after* the TUI
has initialised and the session is active.

Roots watched per agent:

| Agent | Roots |
|---|---|
| Claude | `~/.claude/projects` and `~/.agents/versions/claude/*/home/.claude/projects` (shim's `CLAUDE_CONFIG_DIR` redirect) |
| Codex | `~/.codex/sessions` |
| Gemini | `~/.gemini/tmp` |
| OpenCode | `~/.local/share/opencode/storage/message` |
| Cursor | `~/.cursor/chats` |

Unknown agent keys (e.g. `shell`, custom agents) skip the fast path and rely
on the fallback.

**Fallback: hardened process-state probe** (`startAgentReadyProbe`). Waits
for both:

- **Continuous idle for ≥1500 ms.** 10 consecutive 150 ms polls where
  `ps -p <child> -o stat=` starts with `S`. Any `R` or `D` state resets the
  counter. Catches Node event-loop bursts during boot.
- **Minimum child runtime ≥2500 ms.** Tracks when the child process first
  appeared; won't fire until at least 2.5 s have elapsed. Defends against the
  pathological case where Claude sits in `S` the entire time waiting on a
  network timeout.

The fast path typically wins by several seconds on a cold Claude launch. The
fallback is the safety net for agents without session files or for agent
launches that fail before writing their session file.

## Dependency: Shim Process Contract

The `promptReady` and `agentReady` detection signals rely on a specific
process-tree shape — specifically, that the agent CLI either is a direct child
of the shell or is reached via `exec`-replacement that keeps the same pid.

Full contract with rationale: [`agents-cli/docs/01-version-management.md` —
Shim Process Contract](../../agents-cli/docs/01-version-management.md#shim-process-contract).

If a future launch mode (e.g., interactive `agents pty`) keeps a wrapper
process alive as a parent, the `pgrep`-based signals would need a tree-walk
to find the actual agent. See [Future Work](#future-work).

## API

```typescript
// src/vscode/terminalReadiness.ts

initReadiness(context: vscode.ExtensionContext): void;
registerTerminal(terminal: vscode.Terminal, opts?: { restored?: boolean }): void;
resetAfterAgentExit(terminal: vscode.Terminal): void;
armAgentReady(terminal: vscode.Terminal, opts?: {
  agentKey?: 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode' | string;
  sessionId?: string;
  cwd?: string;
}): void;
waitFor(
  terminal: vscode.Terminal,
  event: 'tabReady' | 'shellReady' | 'promptReady' | 'agentReady',
  opts?: { timeoutMs?: number },
): Promise<void>;
disposeTerminal(terminal: vscode.Terminal): void;
```

Default timeouts:

| Event | Default timeout |
|---|---|
| `tabReady` | 10 s |
| `shellReady` | 10 s |
| `promptReady` | 30 s |
| `agentReady` | 60 s |

Timeouts reject the waiter with a descriptive error; callers log and fall
through rather than failing the user-visible action. That's deliberate:
waiting is a best-effort optimization, not a correctness requirement.

## Consumers

Every path that sends text to a newly-spawned or resumed agent terminal now
goes through this API. Greppable list:

| Function | File | Flow |
|---|---|---|
| `openSingleAgent` (tmux branch) | `extension.ts` | editor-terminal spawn with tmux splits |
| `openSingleAgent` (non-tmux) | `extension.ts` | editor-terminal spawn, direct VS Code terminal |
| `resumeSession` | `extension.ts` | `claude -r <id>` on the active terminal |
| `resumeCurrentInBestProfile` | `extension.ts` | `Cmd+Shift+J` — the Continue flow, launches in best version, sends `/continue <id>` after `agentReady` |
| `openAgentTerminals` | `extension.ts` | startup auto-open of configured agent counts |
| `clearActiveTerminal` | `extension.ts` | `Cmd+Shift+C` — clear with fresh session |
| `reloadActiveTerminal` | `extension.ts` | `Cmd+Shift+R` — reload against same session |
| `restoreAgentTerminals` | `extension.ts` | post-reload session restore |
| `reopenLastClosedSession` | `extension.ts` | reopen the most recently closed agent tab |
| `createTmuxTerminal` | `tmux.ts` | tmux session init — replaces hardcoded `setTimeout(2000)` |

## Cleanup

In-memory only. Nothing on disk, no cleanup needed.

```
vscode.window.onDidCloseTerminal(terminal)
  └─► disposeTerminal(terminal)
        ├─► dispose all vscode.Disposable listeners on this terminal
        ├─► clearTimeout() on all pending probe timers
        ├─► fs.FSWatcher.close() on session-file watchers
        ├─► reject pending waiters with "terminal closed"
        └─► delete from registry Map
```

On extension deactivate, VS Code disposes the global shell-integration
listener automatically via `context.subscriptions`. The registry itself
gets GC'd with the module.

## Failure Modes and Defenses

| Failure | Cause | Defense |
|---|---|---|
| `promptReady` never fires | Shell integration disabled AND `.zshrc` spawns a persistent background job | 30 s hard timeout; caller falls through to `sendText` |
| `promptReady` fires too early | Lazy-load plugin finishes, spawns another subprocess mid-prompt | 2-consecutive-polls debounce absorbs brief bursts |
| `agentReady` fires too early | Node process sleeping on auto-update network I/O | 1500 ms continuous idle debounce + 2500 ms minimum child runtime floor |
| `agentReady` never fires (agent crashes during boot) | Agent process dies without writing session file | 60 s timeout; caller falls through |
| Stale readiness state after IDE reload | VS Code restored terminals VS Code has forgotten the readiness registry | Restored terminals registered with `{ restored: true }` which marks all events fired |
| Shim uses fork+exec instead of `exec` | Hypothetical future shim change | `pgrep -P shell_pid` keeps returning the shim pid; `promptReady` never fires; caller times out at 30 s. Contract must be preserved by the shim. |

## Testing

Pure state machine: 15 unit tests in
`swarmify/extension/src/core/terminalReadiness.test.ts` — cascade semantics,
idempotency, timeouts, reset/re-arm, dispose, concurrent waiter dedup.

End-to-end: install the extension (`bash scripts/install.sh`), spawn a
Claude/Codex/Gemini tab, trigger Reload (`Cmd+Shift+R`), clear (`Cmd+Shift+C`),
and Continue (`Cmd+Shift+J`). Watch the `[READINESS]` and `[RESUME-IN-BEST]`
log lines in the extension host output channel for timing breakdowns.

## Future Work

- **Process-tree walk for wrapped launches.** If `agents pty` or similar
  becomes the launch mode, replace `pgrep -P shell_pid` with a recursive walk
  that finds the deepest descendant matching a known agent binary name.
- **CPU-time delta for `agentReady` fallback.** A truly idle Node process has
  stable cumulative CPU time across polls. More expensive to measure but less
  fooled by long network sleeps than `stat=S` debouncing.
- **Shell-integration-based output inspection.** With
  `TerminalShellExecution.read()` (stable in VS Code 1.93+), the extension
  could observe command output directly instead of polling. Currently overkill
  for the spawn flows but useful if we need per-command completion detection.
