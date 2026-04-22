# Software Factory — Architecture & End-to-End Flow

This document maps every piece of the Software Factory to the exact file it
lives in, so you can trace a brief from `agents factory start` all the way
to a merged PR without guessing.

## Repos involved

| Repo | Role | Path |
|------|------|------|
| `agents-cli` | Orchestration: planner/worker DAG, supervisor loop, ledger sync, config, CLI | `/Users/muqsit/src/github.com/muqsitnawaz/agents-cli` |
| `agents-mcp` | 4 Ledger MCP tools for teammates to query each other | `/Users/muqsit/src/github.com/muqsitnawaz/swarmify/agents-mcp` |
| `swarmify/extension` | VS Code panel — Factory section, intake Q&A, badges | `/Users/muqsit/src/github.com/muqsitnawaz/swarmify/extension` |
| `agents/infra/sandbox` | Kubernetes pod substrate — **where a cloud-dispatched teammate runs**, NOT where orchestration runs | `/Users/muqsit/src/github.com/muqsitnawaz/agents/infra/sandbox` |
| `agents/rush/cli` | Rush Cloud platform CLI (Go). Provides the dispatch API the factory calls into. | `/Users/muqsit/src/github.com/muqsitnawaz/agents/rush/cli` |
| `prompts/{claude,codex}/commands` | `factory-plan` and `factory-worker` skill prompts | `/Users/muqsit/src/github.com/muqsitnawaz/swarmify/prompts` |

**Common confusion resolved:** The orchestration is NOT in `infra/sandbox`.
Infra/sandbox defines the pod that runs ONE teammate. The factory brain —
the DAG walker that decides which teammate runs next — runs on the user's
machine in `agents-cli`.

## High-level flow

```
          user's laptop                                     cloud
┌───────────────────────────────────────┐          ┌───────────────────┐
│ agents factory start "<brief>"        │          │                   │
│                                       │          │                   │
│  1. resolveDispatch  ────> rush       │  dispatch│  Rush Cloud pod   │
│     (config priority)                 │ ────────>│  (one per         │
│                                       │          │   teammate)       │
│  2. spawn Planner teammate            │          │                   │
│     (mode=edit, task_type=plan)       │          │                   │
│                                       │          │                   │
│  3. startDetachedSupervisor ──┐       │          │                   │
│     (child process)           │       │          │                   │
│                               │       │          │                   │
│                               v       │          │                   │
│                     ┌─────────────────┴─┐        │                   │
│                     │  runSupervisor    │        │                   │
│                     │  wave loop (8s)   │        │                   │
│                     │                   │        │                   │
│                     │  - rescanFromDisk │        │                   │
│                     │  - startReady     │        │                   │
│                     │  - oracle hook    │        │                   │
│                     │  - ledger sync    │        │                   │
│                     │  drains when      │        │                   │
│                     │  pending+running=0│        │                   │
│                     └───────────────────┘        │                   │
│                                                  │                   │
└───────────────────────────────────────┘          └───────────────────┘
           │                                                 │
           │                                                 │
           └──────────────┬──────────────────────────────────┘
                          v
                ┌──────────────────┐
                │  Team Ledger     │
                │  (local or R2)   │
                │                  │
                │  team.md         │ <- narrative
                │  registry.json   │ <- DAG state
                │  sessions/       │ <- transcripts
                │  artifacts/      │ <- diffs, test output, notes
                │  bugs/           │ <- reviewer-filed
                └──────────────────┘
```

## Orchestration logic — exact file map

Every responsibility, mapped to its file. Read these in order to trace the
full flow.

### 1. Entry point — `agents factory start "<brief>"`

**File:** `agents-cli/src/commands/factory.ts`

- Parses CLI flags (`--cloud`, `--local`, `--repo`, `--agent`, `--detach`/`--foreground`)
- Calls `resolveDispatch()` to pick provider + auto-detect repo
- Invokes `provider.dispatch()` for cloud runs (via Rush/Codex/Factory.ai adapter)
- Calls `handleSpawn()` to register the Planner teammate in the DAG
- Launches the supervisor via `startDetachedSupervisor()` (spawns `agents factory run <team>` as a child process)

Subcommands:
- `factory start` — seed a team with a Planner + auto-launch supervisor
- `factory run <team>` — foreground supervisor loop
- `factory watch <team>` — tail the detached supervisor's log
- `factory stop <team>` — SIGTERM the detached supervisor
- `factory status <team>` — roll-up counts per task_type
- `factory answer <team> <text>` — reply to the oldest input_required teammate
- `factory evict <agent_id>` — pre-SIGTERM sync, called from pod preStop hooks
- `factory config` — read/write `~/.agents/factory/config.json`

### 2. Dispatch resolution

**File:** `agents-cli/src/lib/factory/config.ts`

- `readFactoryConfig()` / `writeFactoryConfig()` — `~/.agents/factory/config.json`
- `detectGitHubRepo(cwd)` — parses `git remote get-url origin` (https + ssh)
- `resolveDispatch(cwd, cliCloud, cliLocal, cliRepo)` — returns `{ provider, repo, considered }`
  - Priority: `--local` override > `--cloud` override > config `cloud_priority[0]`
  - Skips `rush` in the priority if no repo can be found (falls through)

### 3. DAG + teammate lifecycle

**File:** `agents-cli/src/lib/teams/agents.ts`

- `AgentProcess` — one teammate. Owns: id, name, task_type, after deps, cloud fields, cwd, status
- `AgentManager`:
  - `spawn()` — create a teammate, validate name uniqueness + `--after` deps, check for cycles, launch if no deps OR stage as PENDING
  - `launchProcess()` — spawn the local agent CLI child process
  - `startReady(taskName)` — walk pending teammates, launch any whose `after` deps have all completed; dispatches cloud-backed teammates via `CloudDispatchFn`
  - `rescanFromDisk()` — pull in meta.json files from sibling processes (the planner's `agents teams add` calls run in a DIFFERENT node process)
  - `setCompletionHook()` — fires once per teammate on terminal status; used by the CLI to sync to ledger + run the test oracle

Task types (`TaskType` enum): `plan | implement | test | review | bugfix | docs`

### 4. Supervisor wave loop

**File:** `agents-cli/src/lib/teams/supervisor.ts`

`runSupervisor(mgr, { team, intervalMs, maxWaves, onWave })` — the loop that
walks the DAG forever until it drains.

Each wave:
1. `mgr.rescanFromDisk()` — pick up teammates added by sibling processes
2. `mgr.startReady(team)` — fire any now-ready teammates
3. `mgr.listByTask(team)` — compute counts (pending/running/completed/failed)
4. Call `onWave(summary)` — writes a status line
5. `mgr.rescanFromDisk()` again (onWave callback might have added tasks)
6. Check drain: `pending === 0 && running === 0` → exit

Stops on: drain, `--max-waves`, SIGINT/SIGTERM, or callback returning `false`.

### 5. Test oracle loop

**File:** `agents-cli/src/lib/teams/oracle.ts`

`maybeFileBugfix(agent, manager)` — fires from the completion hook:
- If `task_type === 'test'` AND `status === 'failed'`
- AND no existing `bugfix` teammate with `--after <this-test>`
- Then spawn a new teammate with `task_type='bugfix'`, `name='bugfix-<test-name>'`, prompt points at the failing test's Ledger artifacts

### 6. Team Ledger — shared substrate

**Files:** `agents-cli/src/lib/ledger/*.ts`

- `types.ts` — `LedgerStore` interface
- `local.ts` — `LocalDiskLedger` (writes to `~/.agents/ledger/teams/<team_id>/`)
- `r2.ts` — `R2Ledger` (S3-compatible via `@aws-sdk/client-s3`, uses `AGENTS_R2_*` env vars)
- `sync.ts` — `syncTeammate(snapshot, ledger)` on completion, `syncOnEviction(...)` on pod preStop
- `index.ts` — `resolveLedger()` (R2 if `AGENTS_R2_BUCKET` set, else local)

Ledger layout (both local + R2):
```
teams/<team_id>/
  registry.json                      teammate list + DAG state
  team.md                            planner's running narrative
  sessions/<task_id>-<teammate>.jsonl   full event stream
  artifacts/<task_id>/
    diff.patch
    test-output.txt
    notes.md                         teammate's own notes
  bugs/<task_id>.md                  reviewer-filed bugs
```

### 7. Ledger MCP tools (for teammates)

**File:** `agents-mcp/src/server.ts` + `agents-mcp/src/ledger/*`

Four tools any teammate's MCP client can call:
- `LedgerRead(team_id, task_id, kind?)` — another teammate's outputs
- `LedgerRecent(team_id, n=5)` — last completed tasks
- `LedgerSearch(team_id, query)` — substring search across sessions/notes/bugs/narrative
- `LedgerNote(team_id, task_id, teammate, text)` — append to own notes.md

This is how the bugfix teammate reads the failing test's diff + test-output
without needing direct IPC.

### 8. Planner + Worker prompts

**Files:**
- `prompts/{claude,codex}/commands/factory-plan.md` — seed the initial DAG, spawn sub-planners for depth
- `prompts/{claude,codex}/commands/factory-worker.md` — read deps via LedgerRead, file more tasks via `agents teams add`, record notes via LedgerNote

Every teammate with a `task_type` gets a preamble injected by
`factoryWorkerPreamble()` in `agents-cli/src/commands/teams.ts` that points
at the worker skill and names the team_id / teammate name / task_type.

### 9. Extension UI

**Files in `swarmify/extension`:**
- `ui/settings/components/FactorySection.tsx` — priority list, planner agent, auto-detect toggle, supervisor interval
- `ui/settings/components/panel/PanelTab.tsx` — hosts FactorySection
- `ui/settings/components/mission-control/UnifiedAgentsPane.tsx` — team grouping, task-type badges, IntakeBanner
- `src/vscode/settings.vscode.ts` — `factoryConfigRead`/`factoryConfigWrite`/`factoryAnswer` postMessage handlers

### 10. Cloud provider adapters

**Files:** `agents-cli/src/lib/cloud/{rush,codex,factory}.ts`

Each implements the `CloudProvider` interface (`agents-cli/src/lib/cloud/types.ts`):
- `dispatch(options)` → returns `CloudTask` with remote session id
- `status(taskId)` → polls the provider
- `stream(taskId)` → async iterable of events
- `cancel(taskId)`, `message(taskId, content)`, `list(filter)`

Rush is the only one that talks to Rush Cloud pods in `agents/infra/sandbox`.

### 11. Execution substrate — where cloud teammates actually run

**Files in `agents/infra/sandbox`:**
- `pool.yaml` — pre-warmed Claude Code pod pool, allocates on demand
- `Dockerfile.rush`, `Dockerfile.codex`, `Dockerfile.opencode` — teammate runtime images
- `helm-values.yaml`, `ingress.yaml`, `namespace.yaml` — deployment
- `storage.yaml`, `workspaces-gc.yaml` — ephemeral workspace volumes + GC

A Rush-dispatched teammate runs the agent CLI (claude/codex/etc) inside ONE
of these pods. The pod mounts the user's repo as workspace, runs the prompt,
opens a PR on completion.

**What the pod does NOT do:** walk the DAG. The DAG supervisor runs on the
user's laptop, not in any pod. Pods execute one teammate each.

## End-to-end scenario — trivial brief

User runs:
```
agents factory start "add a reverseString function" --cwd ./my-repo
```

1. `commands/factory.ts::start` action fires
2. `resolveDispatch()` reads `~/.agents/factory/config.json`, sees priority `['rush','codex','local']`, detects git remote → picks `rush` with `repo='owner/my-repo'`
3. Rush provider adapter (`lib/cloud/rush.ts`) calls Rush Cloud API → allocates a pod from `infra/sandbox` pool
4. Pod starts, runs `claude -p "<planner-prompt>"` with `factory-plan` skill
5. Planner's Bash tool runs `agents teams add owner/my-repo-team codex "implement reverseString" --name impl-rev --task-type implement --cwd ./my-repo` three times (impl/test/review triad)
6. `startDetachedSupervisor()` (already running on user's laptop) wakes at wave N, `rescanFromDisk()` picks up the three new meta.json files from `~/.agents/teams/agents/`
7. `startReady()` launches `impl-rev` (deps satisfied). Stages `test-rev` + `review-rev` as PENDING
8. `impl-rev` finishes → completion hook → `syncTeammate()` writes its diff + session to the ledger
9. Next wave: `test-rev` fires. Writes `TESTS: 3 passed, 0 failed` as its last line
10. `review-rev` fires, reads impl's diff via MCP `LedgerRead`, logs notes via `LedgerNote`
11. DAG drains. Supervisor exits with `Factory drained in 47s (6 waves)`
12. If rush flow, pod opens a PR with the diff

## The open gap: cross-pod teammate visibility

**Fact:** When the Planner runs in a Rush Cloud pod, its `agents teams add`
calls write meta.json to the POD's `~/.agents/teams/agents/`, not yours. The
local supervisor's `rescanFromDisk()` only reads YOUR `~/.agents/`. So
today, cloud-dispatched planners successfully emit the DAG inside their pod
but the supervisor on your laptop never sees the new teammates.

**Fix (Task #18, deferred):** move `registry.json` + per-teammate meta to R2.
Both sides read/write via `LedgerStore`. Pod writes teammate meta to R2 →
local supervisor reads R2 every wave → sees the new teammates → dispatches
their workers (also to R2).

**Local-machine factory still works today** — all processes on the same
laptop see the same `~/.agents/teams/agents/`. It's only the cloud path
that hits this boundary.

## Config files summary

| File | Purpose | Who writes |
|------|---------|------------|
| `~/.agents/factory/config.json` | Factory defaults (priority, planner agent, interval) | `agents factory config` CLI and extension panel |
| `~/.agents/teams/config.json` | Teams-level agent + provider config | `agents teams` |
| `~/.agents/teams/agents/<agent_id>/meta.json` | One teammate's snapshot | `AgentManager.saveMeta()` |
| `~/.agents/ledger/teams/<team_id>/*` | Shared substrate (local backend) | `LocalDiskLedger` |
| `~/.agents/factory/<team>.supervisor.log` | Detached supervisor stdout | `factory start --detach` |
| `~/.agents/factory/<team>.supervisor.pid` | Detached supervisor pid | `factory start --detach`; read by `factory stop` |
