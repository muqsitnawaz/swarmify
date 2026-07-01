# Dispatch + Floor build — shared context (READ FIRST)

Six agents build two things in parallel in this ONE shared worktree (branch
`dispatch-floor-build`). **Stay strictly inside the files your brief lists under
"Owns"; never edit another agent's files.**

1. A **consolidated Dispatch panel** replacing the FIVE legacy dispatch surfaces.
2. **Floor after-dispatch** signals: liveness heartbeat, plan-review, failure card.

## Goal / mindset
Make dispatching a task **effortless**, and make the user **trust** it's actually
working afterward. Judge every choice against that.

## The spec — build to this, do NOT freelance
- `extension/docs/prototypes/dispatch.html` — the interactive Dispatch prototype.
  **Match it 1:1** (layout, controls, class names, interactions). Read/open it.
- `extension/docs/prototypes/DESIGN.md` — the "Dispatch panel" section: locked
  decisions, at-dispatch vs after-dispatch boundary, port notes.
- `extension/docs/prototypes/factory-floor.html` — the Floor prototype (for part 2).
- `extension/docs/prototypes/reviews/` — the multi-model critique (the "why").
- `extension/docs/prototypes/screenshots/dispatch-v2-*.png` — express/expanded/bell.

## Architecture (respect it)
- **Two isolated TS build roots.** `src/` = extension host (Node/VS Code). `ui/` =
  webview (React/Vite). No `ui/` file imports `src/*`; data crosses via `postMessage`,
  types mirrored per side.
- **Shared webview contract = `ui/settings/components/mission-control/dispatch.types.ts`**
  (committed): `DispatchRequest`, `InstalledAgent`, `DispatchHost` (live load),
  `NotifyPrefs`, `PendingPlan`, and a comment block with the EXACT postMessage shapes
  both the webview and the extension host must implement. Types are FINAL — import,
  don't change. Missing field? Note it in your report; don't silently diverge.
- **Committed stubs** `DispatchPanel.tsx`, `PlanReview.tsx`, `FailureCard.tsx` (typed
  props, return null). UI agents fill bodies; the integrator imports them. Keep the
  exported prop interfaces stable.
- Floor types in `floorModel.ts`; local->FloorAgent adapter in `floorAdapter.ts`.

## Palette — LOCKED
`design-system.css` tokens (`--brand:#a3e635` = accent only; `--status-*`). Do NOT edit
design-system.css. New dispatch styles -> new `dispatch.css`; Floor additions -> the
existing `floor.css`. Match the prototype's class names so styles attach.

## Hard rules
NO emojis/glyphs in code/comments/UI text (render the prototype's ⚡▾🔔 marks via
`lucide-react` or CSS, never literal emoji in TSX). NO toasts. NO mocks in tests.
TypeScript only. bun.

## Build + verify (in `extension/`)
- `bun run compile` (tsc + vite, both webviews) — zero errors.
- `bun test` — no mocks; keep green.
- Small logical commits to this branch (Co-Authored-By trailer; NO "Generated with
  Claude" line). Do NOT open a PR — the orchestrator integrates, verifies, ships.

Return file:line evidence for claims. If you can't verify a surface, say so.
