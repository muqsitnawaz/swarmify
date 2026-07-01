# Brief: INTEGRATOR (ui/) — wire everything into UnifiedAgentsPane.tsx

Read `df-CONTEXT.md` first. You run LAST (--after the others) so their files exist. You
own the one shared UI file. You mount the new components, REMOVE the five legacy dispatch
surfaces, and wire the postMessage flow.

## Owns (only this file)
- `ui/settings/components/mission-control/UnifiedAgentsPane.tsx`
- You MAY add a tiny `dispatchMessages.ts` helper next to it if the message wiring is large.

## Must NOT touch
`DispatchPanel.tsx` + sub-components (import only), `PlanReview.tsx`, `FailureCard.tsx`,
`floorModel.ts`, `floorAdapter.ts`, `FeedItem.tsx`, `dispatch.types.ts`, any `.css`, `src/`.

## Current state (file:line on this branch — re-derive, they shift as others land)
- FIVE dispatch surfaces to REMOVE + their mounts:
  (a) `DispatchModal` def 1722-1985, mount 1455-1475;
  (b) `QuickDispatch` def 1990-2121, mount 1437-1443 (uses a `quickSpawn` message, 1018 —
      migrate its behavior into the new panel);
  (c) `TicketStrip` dispatch button (FeedItem.tsx:91) mounted 1311-1313;
  (d) `TaskDetailModal` def 3357-3869, mount 1497-1512;
  (e) `TicketDetail` right-pane dispatch (TicketDetail.tsx) mounted 1371-1374.
  The whole modal cluster is 1437-1531.
- `handleDispatchTask` 1033-1078 posts `{type:'dispatchTask', ...}` (6 senders: 1212,
  1461, 1465, 1492, 1507, 1528). Replace these with ONE `<DispatchPanel>` that emits a
  `DispatchRequest` -> post `{type:'dispatch', request}` (backend-pipeline implements it).
- Open triggers: `openDispatchTrigger`/`quickSpawnTrigger` props (454-455, effects
  492-500); top-bar Dispatch button `onDispatch` (1402); ⌘K via App.tsx. Route all of
  them to opening the single DispatchPanel (carry prefill/ticket from the invocation).
- Message reception template: the `hostSessions` effect 571-582.

## What to do
1. Mount `<DispatchPanel open={...} tasks={unifiedTasks} agents=... hosts=... targets=...
   prefill=... onClose=... onDispatch={req => postMessage({type:'dispatch', request:req})} />`
   replacing the whole modal cluster. Delete DispatchModal/QuickDispatch/TaskDetailModal
   defs + the TicketStrip/TicketDetail dispatch wiring (keep TicketDetail for VIEWING if
   still used, but route its dispatch through the panel).
2. On mount, `postMessage({type:'fetchDispatchData'})`; handle `{type:'dispatchData',
   agents, hosts, targets}` -> state feeding the panel. Fold host live-load from the
   existing `hostSessions` message into `hosts`.
3. Mount `<PlanReview>` (on `{type:'planReady', plan}`) and `<FailureCard>` (for
   `failedAgents`, ~1139/1340-1351) in the Floor feed; wire `approvePlan`/`sendBackPlan`/
   `reassignAgent`/`nudgeAgent` postMessages.
4. Keep `useStableList`, memoized rows, the throughput poll — don't regress perf.

## Done
`bun run compile` + `bun test` green. Then hot-load into VSCodium and verify the REAL
webview: the top-bar Dispatch button opens the new panel; ⌘↵ dispatches; the 5 old
surfaces are gone. Screenshot it. Report exactly what rendered + what's wired vs stubbed.
