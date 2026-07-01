# Factory Floor port — shared context (READ FIRST)

You are one of five agents porting a redesigned agent-management dashboard ("Factory
Floor") into this VS Code extension. Work happens in this worktree on the branch
`factory-floor-port`. Everyone shares this one working tree — **stay strictly inside
the files your brief lists as "Owns". Never edit another agent's files.**

## The design — this is not a guess, it is a built prototype

The **source of truth** is the interactive prototype, vendored here:

- `extension/docs/prototypes/factory-floor.html` — the living spec. Open it, read its
  markup + CSS + JS. Every class name, every layout, every interaction you build must
  match it 1:1. Field names in the data model are deliberately mirrored so the port is
  a translation, not a redesign.
- `extension/docs/prototypes/DESIGN.md` — locked decisions and the port plan.
- `extension/docs/prototypes/reviews/claude.md` + `reviews/kimi.md` — the multi-model
  critique that justifies the design (why Feed-first + Needs-You + structured replies +
  backlog are the essentials). Read for the "why".

### What the redesign is
Manage 50–100 agents across many machines. Replace today's card grid with a **3-pane
shell** (prototype `renderFeed()`, factory-floor.html:681-697, `.page`):

```
[ left: scope sidebar ] [ center: the list ] [ right: detail ]
   .sidebar (210px)        .feed-col (1fr)      .detail-col (430px)
```

- **Left** = scope sidebar: Smart (All / ⚠ Needs you), Queue (Backlog), Projects (with
  wait-counts), Hosts (with health). Collapsible. Prototype `buildSidebar()`:563-579.
- **Center** = two modes (`CENTER` state = 'agents' | 'backlog'):
  - *agents* (home): a Next-Up backlog teaser strip → ⚠ **Needs You** (batch-triage
    clusters + structured replies) → **Live Activity**. Prototype `agentsCenter()`:624-640.
  - *backlog*: full ticket list with group/sort/filter (Linear-style). Prototype
    `backlogCenter()`:651-665.
- **Right** = detail: selected agent's decision block + rich progress, OR selected
  ticket's detail + a **Dispatch** panel. Prototype `detailRight()`:699-714,
  `ticketDetail()`:666-680. Collapsible.
- **Top bar**: Finder-style icon view-switcher (Feed·Columns·List·Board) + a separate
  Group-by dropdown + stats + Plain-language toggle + sidebar/right toggles. Prototype
  markup factory-floor.html:260-296. (The port targets the **Feed** view first; the
  other three switcher icons can route to today's existing views as a follow-up.)

### The interaction model (the actual product)
- **Needs-You triage on top** — agents waiting / failed / done-unreviewed surface first.
- **Structured replies, not free-text** — option buttons for choices, Confirm/Cancel
  (destructive styled red), Retry for failed, plus a free-text escape hatch and a
  Screenshot attach. Prototype `structuredReply()`:591-597, `detailRight()`:702-712.
- **Batch triage by question-shape** — agents asking the *same* question cluster into one
  card ("… · Apply to all N"). Prototype `clusterCard()`:598-607, `byQ`:629.
- **Backlog → Dispatch → running → Needs-You → Done** is one closed loop. Tickets come
  from the existing Linear/GitHub fetch. Prototype `ticketDetail()` dispatch panel:671-677.
- **Plain-language toggle** — swaps dev jargon (tok/s, tool calls) for human summaries.
  Prototype `plainTok()`:400, `PLAIN` branches in feedItem/feedItem meta.

## Architecture facts you must respect

- **Two isolated TS build roots.** `src/` = extension host (Node/VS Code). `ui/` =
  webview (React, Vite). **No `ui/` file may import from `src/`** and vice-versa. Data
  crosses via `postMessage`; types are mirrored on each side. If your brief is a `ui/`
  brief, everything you write is webview code.
- **The shared webview contract is `ui/settings/components/mission-control/floorModel.ts`**
  (already committed). It defines `FloorAgent`, `FloorTicket`, `StructuredQuestion`, the
  group/sort/cluster function signatures, and `PHASE_RANK`/`PRI_RANK`. Types are FINAL —
  import them; do not change their shape. Only the LOGIC agent fills the function bodies.
- **Palette is LOCKED** (`ui/settings/components/mission-control/design-system.css` :7-102).
  Brand neon-green `--brand:#a3e635` is selection/accent ONLY, never a status. Status
  tokens: running `--status-running:#22C55E`, idle `--status-idle:#6B7280`, waiting
  `--status-pending:#D4A72C`, failed `--status-failed:#EF4444`. Theme bg: `--ds-bg`,
  `--ds-bg-panel`, `--ds-bg-sunken`, borders `--ds-border`. Fonts: Geist / Geist Mono.
  **Do not touch design-system.css tokens.** New Floor styles go in a new `floor.css`.

## Hard rules (this repo — non-negotiable)
- **NO emojis / icons / decorative symbols** in code, comments, or UI text. The prototype
  uses a few unicode glyphs (⚡ ⚠ ▸ ◷ ●) as inline SVG or status marks — replicate the
  *visual* using the existing `lucide-react` icon set or CSS, NOT literal emoji in TSX.
- **NO toasts.** Silent success or inline error (red text near the action).
- **NO mocks in tests.** Real logic, real fixtures.
- TypeScript only. Package manager: **bun**.

## Build + verify (run in `extension/`)
- `bun run compile` — tsc + vite build for BOTH webviews. Must pass with zero errors.
- `bun test` — full suite, no mocks. Add/keep tests green.
- Commit your own work to `factory-floor-port` as you finish coherent pieces (small,
  logical commits; end messages with the Co-Authored-By trailer, no "Generated with
  Claude" line). Do not open a PR — the orchestrator does that after integration.

**Done means it compiles and the real webview renders.** Not "code written." If you can't
verify a surface end-to-end, say precisely what is unverified.
