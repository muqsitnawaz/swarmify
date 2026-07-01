# Brief: FLOOR-UI (ui/) — heartbeat, stall, plan-review, failure card

Read `df-CONTEXT.md` first. You add the AFTER-dispatch trust signals to the Floor:
a live heartbeat on running cards, a "stalled" state, the plan-review surface, and the
failure card. Spec: DESIGN.md "at-dispatch vs after-dispatch" + reviews.

## Owns (edit/create only these, in `ui/settings/components/mission-control/`)
- `floorModel.ts` — add `lastActivityMs: number` to `FloorAgent` (currently only
  `since:string`, ~lines 53-73) so the card can tick a live staleness age. Add a
  `'stalled'` value to `FloorPhase` (line 26) and fold it into `deriveNeeds` (140-142)
  so a stalled agent surfaces in Needs-You. Add a pure `deriveStalled(lastActivityMs,
  phase, now)` helper + threshold. Update `floorModel.test.ts`.
- `floorAdapter.ts` — populate `lastActivityMs` in `toFloorAgentFromUnified` /
  `toFloorAgentFromRemote` from existing timestamp data (the sessions already carry
  activity timestamps). Update `floorAdapter.test.ts`.
- `FeedItem.tsx` — replace the static `{a.since} ago` (line 51) + `nowline` (55-59) with
  a **live heartbeat**: a ticking last-activity age that goes amber past the stall
  threshold and red past 2x, plus the current action. Add a `stalled` visual variant to
  the `attn` logic (line 28).
- `PlanReview.tsx` — fill the stub: render `PendingPlan.steps` with Approve /
  Approve+edit / Send-back, calling the props callbacks. Match a Floor decision-block look.
- `FailureCard.tsx` — fill the stub: failed agent with reason + Retry + Reassign
  (dropdown of `InstalledAgent[]`), calling props callbacks.

## Must NOT touch
`UnifiedAgentsPane.tsx` (integrator), `DispatchPanel.tsx` + its sub-components,
`dispatch.types.ts` (import only), any `.css` (STYLES owns floor.css additions), `src/`.

## Contract
- A ticking "now" for the heartbeat: use a shared `useNow(1000)`-style hook (create
  `useNow.ts` if none exists) so cards re-tick without busting the stable list every
  second — bucket the age (e.g. 5s) before it enters any memo signature.
- Class names: match the Floor prototype for the heartbeat/decision blocks; new classes
  go to STYLES (floor.css) — coordinate names in your report.
- No literal emoji.

## Done
`bun run compile` + `bun test` green (floorModel/floorAdapter tests cover the new
staleness + stalled logic). Commit. Report the new FloorAgent fields + the stall
threshold + which class names STYLES must add.
