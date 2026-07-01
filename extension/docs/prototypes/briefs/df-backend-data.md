# Brief: BACKEND-DATA (src/) — installed agents, ranking, live host load

Read `df-CONTEXT.md` first. You are one of two `src/` agents. You provide the DATA the
Dispatch panel needs: which agents are installed, ranked projects/hosts, and live
per-host load. You send it to the webview via postMessage.

## Owns (edit only these)
- `src/vscode/settings.vscode.ts` — ADD one new message case `case 'fetchDispatchData'`
  (beside the existing agent cases ~1352-1392) that replies `{type:'dispatchData',
  agents, hosts, targets}` (shapes in dispatch.types.ts). Do NOT touch `case
  'dispatchTask'` (backend-pipeline owns it) or `case 'fetchHostSessions'`.
- `src/core/dispatchRanking.ts` — NEW. Pure: rank projects + hosts by session-index
  usage. `+ .test.ts`.
- `src/core/remoteSessions.ts` — widen `HostInfo` (currently `{name,online}`, lines
  73-76) with `agents:number; load:'idle'|'free'|'busy'|'hot'|'off'; uses:number`.
- `src/vscode/remoteSessions.vscode.ts` — gather per-host live load in/around
  `fetchActiveForHost` (191-230; mirror the `if(!isLocal) --host` branch at 198-199):
  local via `os.loadavg()`; remote via `uptime`/`nproc` over the SAME ssh path. Thread
  it into `resolvedHosts`/`groupByHost` (273-277) so it rides the EXISTING `hostSessions`
  message. Per-host agent count = `HostGroup.sessions.length`.

## Must NOT touch
Any `.tsx`, `.css`, `settings.vscode.ts` `case 'dispatchTask'`, the spawn, floorModel.

## Reuse — installed agents ALREADY EXIST
`src/core/agentInventory.ts` `fetchAgentInventories([...])` (150-170) runs `agents view
--json` and returns installed versions + `signedIn/email/plan` (types 12-22). `case
'refreshAgentInventories'` (settings.vscode.ts:1371-1379) already posts them. In
`fetchDispatchData`, call `fetchAgentInventories`/`getCachedAgentInventories` and map to
`InstalledAgent[]` (id/name/color/signedIn/version/isDefault) — do NOT re-exec `agents view`.

## Ranking source
Projects/hosts by usage: the cross-host `fetchHostSessions` output already carries
per-session `host`+`cwd`+`project` (`remoteSessions.ts` normalizeActiveSession 164-202).
`dispatchRanking.ts` takes those sessions (+ recent local sessions if cheap) and returns
ranked `DispatchTarget[]` (projects, with path) and host usage counts. Test with fixtures.

## Done
`bun run compile` + `bun test` green. Verify `fetchDispatchData` returns real installed
agents + ranked projects + hosts-with-load by running the relevant functions and quoting
output. Report the exact shape you post.
