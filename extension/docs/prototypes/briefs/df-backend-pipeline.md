# Brief: BACKEND-PIPELINE (src/) — dispatch spawn, mode, watchdog, notify, plan/failure

Read `df-CONTEXT.md` first. You own the extension-host side of ACTING on a dispatch:
the spawn (with real Plan/Auto/Edit mode), the handler that consumes the full request,
watchdog + notify wiring, and the plan-review / reassign actions.

## Owns (edit only these)
- `src/vscode/extension.ts` — `openSingleAgentWithQueue` (2933-2938): add
  `mode?:'plan'|'auto'|'edit'` to `opts`; thread into `buildClaudeLaunchCommand` call
  (2969). `buildAgentLaunchCommand` (176-201): add a `mode` param that emits a per-agent
  permission flag next to `--model`/`--strategy` (191-199) — use the existing
  `additionalFlags` escape hatch (197-199) pattern. Claude: `--permission-mode
  plan|acceptEdits|default` (auto=default). Map per agent; unknown-agent -> no flag.
- `src/core/agents.ts` — add a per-agent mode->flag map (BUILT_IN_AGENTS 25-34 has no
  flag fields today). Pure + testable.
- `src/vscode/settings.vscode.ts` — `case 'dispatchTask'` (1573-1747): it currently
  IGNORES `branch`, `codexEnv`, `notify`, `mode`. Rework it to accept the new unified
  `case 'dispatch'` carrying a `DispatchRequest` (dispatch.types.ts) and consume ALL
  fields: mode->spawn flag (local 1745; cloud command 1721/1725), branch + codexEnv into
  the cloud command, notify -> notification prefs, batch 'per' -> fan out N coordinated
  dispatches. Keep the old `case 'dispatchTask'` working during migration OR have the
  integrator switch senders — coordinate via your report. ADD cases `case 'approvePlan'`,
  `case 'sendBackPlan'`, `case 'reassignAgent'`, `case 'nudgeAgent'`.
- `src/mcp/watchdog-bridge.ts` — expose an escalate path if needed (handleSendNudge
  186-257 is the nudge entry). Watchdog policy from dispatch drives nudge/escalate.

## Must NOT touch
Any `.tsx`, `.css`, `remoteSessions*` (backend-data), `dispatchRanking.ts`, floorModel.

## Notify + watchdog
Notification path today: `src/vscode/notifications.vscode.ts` (Notifications MCP +
alerter, enableNotifications 48-113). Wire `NotifyPrefs.events/channel` to it (stall,
plan-ready, failed, question, finish). Watchdog policy: 'keep' = auto-nudge on stall +
escalate after 2 fails; wire to watchdog-bridge.

## Plan-review + reassign
Plan detection: a Plan-mode agent emits a plan (ExitPlanMode signal in the session).
Post `{type:'planReady', plan:PendingPlan}` when detected. `approvePlan` resumes the
agent (send approval to its terminal). `reassignAgent` spawns `toAgent` with the same
task context. `nudgeAgent` -> watchdog nudge.

## Done
`bun run compile` + `bun test` green. Verify mode actually reaches the CLI: dispatch a
Plan-mode agent and quote the launched command showing the permission flag. Report the
exact `dispatch` handling + which fields now flow through.
