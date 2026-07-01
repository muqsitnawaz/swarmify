# Factory Floor — design source of truth

The canonical reference for the redesigned agent-management dashboard. The
interactive prototype `factory-floor.html` is the living spec; this doc captures
the decisions behind it. Saved 2026-06-30.

## Open it
Double-click `factory-floor.html` (self-contained — no build, no deps, works
offline). URL params for quick views: `?l=feed|rail|table|board`,
`?theme=light|dark`, `?plain=1`, `?center=backlog`, `?nosb=1`.

## The problem
Manage 50–100 AI coding agents running across many machines (a local Mac + remote
Linux/Mac boxes over SSH). Today: terminal-tab chaos, no way to tell which agent
is working, stuck, or waiting on you. Ships as a **VS Code / VSCodium / Cursor
extension webview panel** (constrained width, host theme). Primary persona:
**developers**; secondary: **vibe coders** (natural-language, outcome-focused).

## Locked decisions

**Layout — one environment, 3-pane shell** (both wings collapsible):
- **Left = scope sidebar** — Smart (All / Needs you), Queue (Backlog), Projects
  (with wait-counts), Hosts (with health: `zion offline`). Toggle to reclaim width.
- **Center = the list** — two modes:
  - *Agents* (home): backlog teaser strip → ⚠ **Needs You** → Live Activity.
  - *Backlog*: full tickets list with **group / sort / filter** (Linear-style).
- **Right = detail** — the selected agent's conversation + reply, OR the selected
  ticket's detail + a **Dispatch** panel. Toggle to go full-width.

**View switcher — Finder-style** (icons, no words): Feed · Columns · List · Board.
A separate **Group-by/Arrange** dropdown is orthogonal (applies to any view).

**The interaction model (the actual product, per the review):**
- **Needs-You triage on top** — agents waiting / failed / finished-unreviewed,
  surfaced first. Maps human attention (the thing that can't scale) onto what the
  system can compute (who's blocked).
- **Structured replies, not free-text** — option buttons for multiple-choice,
  `Confirm`/`Cancel` (destructive styled deliberately), `Retry` for failed; a
  free-text escape hatch always. Plus **screenshot attach** (remote = scp over the
  existing SSH channel).
- **Batch triage by question-shape** — agents asking the *same* question cluster
  into one card: "Token bucket vs sliding window? · Apply to all N". Answer a
  *class* of decision once.
- **Backlog → Dispatch → running agent → Needs-You → Done** is one closed loop in
  one environment. Tickets come from `linear-cli` / `github-cli`.
- **Plain-language toggle** — swaps dev jargon (tok/s, tool calls, diff stats,
  branches) for human summaries; serves the vibe-coder persona without a second UI.

**Palette — LOCKED** (`design-system.css`): brand neon-green `#a3e635` is
selection/accent ONLY. Status colors: running `#22C55E`, idle `#6B7280`, waiting
`#D4A72C`, failed `#EF4444`. Geist / Geist Mono.

## Open polish items (fold in during the port, not re-mock)
- Unify the top toolbar so Sort/Group/filter adapt per center-mode.
- Two-greens fix (running `#22C55E` too close to brand `#a3e635`).
- Cross-host trust on cards: per-host "synced Xs ago", offline grey-out, duplicate
  name disambiguation (`auth-refactor · yosemite-s0`).
- Narrow-width (≤600px): single-pane fallback, collapse filter chips to one menu.

## Multi-model review
Reviewed by Claude + Kimi (Codex/Droid failed to launch). Full critiques in
`reviews/`. Both converged: Feed-first + Needs-You is right; fix the interaction
model not the chrome; cut to ~2 primary views; add the backlog; structured replies
and screenshot-attach are the unbuilt essentials.

## Port plan (into the extension)
1. Fix the regression first — restructure `.sw-floor-dashboard` to the 3-pane grid
   so the detail pane is always on screen (`UnifiedAgentsPane.tsx`,
   `design-system.css:1424`).
2. Backlog + Dispatch surface wired into the center (reuse Next-Up/tasks plumbing).
3. Needs-You + structured replies + batch-triage clustering.
4. Cross-host trust signals, plain-language toggle, polish.
Each step ships as its own PR, verified live in VSCodium.

## Screenshots
`screenshots/` — v3 feed (dev + plain + narrow), v4 3-pane, v5 backlog/dispatch.
