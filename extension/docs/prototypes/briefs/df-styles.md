# Brief: STYLES (ui/) — dispatch.css + floor.css additions

Read `df-CONTEXT.md` first. You own all new styling for the Dispatch panel and the
Floor after-dispatch pieces. Port the prototype CSS; do NOT touch design-system tokens.

## Owns
- `ui/settings/components/mission-control/dispatch.css` — NEW. All Dispatch-panel styles.
- `ui/settings/index.css` — add exactly ONE `@import "./components/mission-control/dispatch.css";`
  line (next to the existing imports).
- `ui/settings/components/mission-control/floor.css` — ADD the after-dispatch styles
  (heartbeat/staleness states, stalled variant, plan-review block, failure card). Do NOT
  rewrite existing floor rules.

## Must NOT touch
`design-system.css` (LOCKED tokens — read, don't edit), any `.tsx`, any `.ts`, `src/`.

## What to do
1. Read the prototype `<style>` block: `extension/docs/prototypes/dispatch.html` (the
   whole `:root`..`</style>`). Port every rule into `dispatch.css`, keeping the EXACT
   class names DISPATCH-UI renders (`.whatbox`, `.tchip`, `.achip`, `.ctxa`, `.gbtn`,
   `.suggest`, `.apill`, `.dd*`, `.loadbar`, `.loadtxt`, `.badge`, `.seg`, `.summary`,
   `.nudge`, `.bellpop`, `.chk`, `.chan`, `.batch`, `.disp`, `.kbd`, `.warn`, ...).
2. Rewrite the prototype's local palette vars to the LOCKED tokens: `--brand`->`var(--brand)`,
   `--run`->`var(--status-running)`, `--wait`->`var(--status-pending)`, `--fail`->
   `var(--status-failed)`, `--idle`->`var(--status-idle)`; bg/text/border ->
   `var(--ds-bg)`/`var(--ds-bg-panel)`/`var(--ds-bg-sunken)`/`var(--ds-border)` + the
   design-system text tokens. No hardcoded hex where a token exists. Both light + dark.
3. Everything scoped so it only applies under `.swarmify-root` (design-system convention).
4. Floor additions: heartbeat age color states (normal/amber/red), `.stalled` card
   variant, plan-review + failure-card blocks — match FLOOR-UI's class names (see their
   report).

## Done
`bun run compile` passes (CSS bundles). Spot-check dispatch.css against the prototype.
Commit dispatch.css + the one index.css line + the floor.css additions. Report the token
mappings + any class you couldn't place.
