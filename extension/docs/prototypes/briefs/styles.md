# Brief: STYLES — port the prototype CSS into floor.css

**Read `_CONTEXT.md` first.** You own all new Floor styling. The prototype already has a
complete, reviewed stylesheet — your job is to port it into the extension's token system.

## Owns
- `extension/ui/settings/components/mission-control/floor.css` — NEW. All Floor styles.
- `extension/ui/settings/index.css` — add exactly ONE line: `@import
  "./components/mission-control/floor.css";` next to the existing design-system import.
  (This is the only shared file you touch; a single append — keep it to one line.)

## Must NOT touch
- `design-system.css` (LOCKED tokens — read it, don't edit it), any `.tsx`, any `.ts`,
  anything in `src/`.

## What to do
1. Read the prototype `<style>` block: `extension/docs/prototypes/factory-floor.html`
   lines 7-257. It contains the full, final styling for the 3-pane shell, sidebar, feed
   items, clusters, structured-reply buttons, backlog rows, ticket detail, dispatch panel,
   top bar, and filter bar.
2. Port every rule into `floor.css`, keeping the **exact class names** the prototype uses
   (COMPONENTS renders those same names). Do not rename classes.
3. **Rewrite the prototype's local palette vars to the extension's LOCKED tokens** — the
   prototype defines its own `:root` (factory-floor.html:3-6); map them:
   - `--brand` → `var(--brand)` (both #a3e635), `--brand-600` → `var(--brand-600)`
   - `--run` → `var(--status-running)` (#22C55E), `--idle` → `var(--status-idle)`
     (#6B7280), `--fail` → `var(--status-failed)` (#EF4444), `--wait` →
     `var(--status-pending)` (#D4A72C)
   - background/text/border: map the prototype's `--bg`/`--panel`/`--line`/`--tx`/
     `--tx-mut`/`--tx-dim` to `var(--ds-bg)`, `var(--ds-bg-panel)`, `var(--ds-bg-sunken)`,
     `var(--ds-border)` and the design-system text tokens (read design-system.css :43-102
     for the exact light/dark token names). **Do not hardcode hex** for anything that has
     a token — brand green must be `var(--brand)`, statuses must be the status tokens.
   - Both light and dark must work (design-system.css uses `.theme-light`/`.theme-dark`).
4. Two-greens fix from the review: running (#22C55E) sits close to brand (#a3e635). Keep
   running as `var(--status-running)`; ensure selection/accent (brand) is visually distinct
   (e.g. selection uses a brand ring/border, status uses the dot fill).
5. The 3-pane grid: `.page` is a flex row; `.sidebar` ~210px, `.feed-col` flex:1,
   `.detail-col` ~430px (prototype). Ensure it degrades gracefully at the webview's narrow
   widths (the panel can be ~400-600px) — at narrow width the detail-col may need to drop.

## Done =
`bun run compile` passes (CSS bundles). Ideally spot-check by opening
`factory-floor.html` to compare, but the port target is the extension. Commit floor.css +
the one index.css line. Report the token mappings you applied and any class the prototype
styled that you could not find a home for.
