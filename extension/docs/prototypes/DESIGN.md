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

---

# Dispatch panel — the consolidated "Dispatch" surface

The interactive spec is `dispatch.html` (self-contained; toolbar toggles demo the
states). Screenshots: `screenshots/dispatch-v2-*.png`. Saved 2026-07-01.

## The problem
The extension had **five** divergent dispatch surfaces (the big list modal, the ⌘K
composer, the Next-Up strip, the rich TaskDetail modal, and the right-pane
TicketDetail) — inconsistent controls, four meanings of "Dispatch", and a leaky
pipeline that dropped mode/branch/notify. One goal reframes it: **make dispatching a
task effortless.** This is ONE compact, single-column webview panel that replaces all
five.

## Locked decisions (v2)
**A launcher, not a form.**
- **Express by default** — just the task box + a one-line summary
  (`Claude · swarmify on this-mac · Auto`) + Dispatch. "Configure ▾" reveals the full
  controls; "⌃ Hide config" collapses. First-timer dispatches in seconds.
- **`⌘↵` dispatches** (chord printed on the button); the context box **autofocuses**.
- **Mode defaults to Auto** (safe: runs itself, asks before risky) — never Edit.

**Capturing intent — one input, ticket + context always coexist.**
- A unified box: attached **ticket chips** + an always-present **context textarea**.
  No ticket-vs-prompt toggle.
- **`⚡ Auto-pick urgent`** grabs the top ticket (rank: urgent-bugs first); ranked
  suggestions filter live as you type.
- The box is a **paste + drag-drop target** with an **attachment tray** — paste a
  screenshot → thumbnail chip; drop files/folders → chips; `@`-mention code. (The old
  duplicate "Comments" box is cut — exactly one place to tell the agent what to do.)

**Agent — real, from `agents view --json`.**
- Only **installed** agents, with sign-in state (Claude/Codex/Kimi signed in;
  OpenCode/Antigravity/Grok/Droid dimmed with "sign in"). Never a hardcoded stale set
  — Gemini/Cursor aren't installed, so they don't show.

**Run on — machine-aware, unified local · remote · cloud.**
- One ranked selector spanning `this-mac` → remote SSH hosts → Rush/Codex Cloud.
- **Live load column** (not lifetime usage): agents-running-per-host + `idle/free/busy`
  + load bar. `MOST USED` is demoted; a **`SUGGESTED` = least-busy** badge drives
  selection. Busy machine → inline nudge to the free host in one click. Cloud rows show
  **cost** (`~$0.40/run`); offline hosts are disabled (no silent dispatch into a dead
  host).
- **Project is required** (ranked by usage) — no directory means the agent runs in
  `$HOME` (insecure). Cloud swaps Project → **Repo** (+ Branch) and warns it's a fresh
  clone (local uncommitted changes excluded).

**Mode — Plan · Auto · Edit**, honest hints (Plan = read-only until approved; Auto =
safe steps, asks before risky; Edit = full access). Ports to real per-agent CLI
permission flags.

**Trust the agent is alive (the silent-stall problem).**
- **Watchdog** row at dispatch: `Off · Keep moving (default) · Hands-off`. "Keep moving"
  auto-nudges on stall and pings you if stuck after 2 tries (wires the existing watchdog).
- **Notify bell** in the header (out of "More options"): events (**Stalled, Plan-ready,
  Failed** emphasized, + Needs-input, Finished), channels (iMessage / Slack / Desktop),
  DND + quiet hours.

**Batch.** Attach 2+ tickets → toggle `1 agent, all N` vs `1 agent per ticket` (fan-out).

## At-dispatch vs after-dispatch (scope boundary)
This panel *sets policy* at dispatch. The **live signals live in the Floor**, not here:
the running-card **heartbeat** (ticking last-activity age → amber/red + current action),
the **Plan-review** approve surface (Plan mode promises approval — the Floor delivers it),
and the **Failure** card (distinct from stall; offers retry / reassign-to-another-agent).
Those are the next Floor iteration.

## Multi-model review (4 agents, 2026-07-01)
Reviewed by four Claude reviewers with distinct lenses (intent capture · machine health ·
control/notifications/stalls · overall friction). Convergent verdicts, all folded into v2:
launcher not form (⌘↵, express-collapse, Auto default); paste/drop/screenshot attach;
live machine-load in Run-on (MOST-USED steers toward overloading the Mac — surface load
+ SUGGESTED least-busy); silent-stall heartbeat + watchdog policy + header notify-bell
(stall/plan-ready/failed events); cut the duplicate context box. Full seed gaps from the
product owner: clipboard/drag-drop, machine utilization, plan-review, notifications,
silent stalls.

## Port notes
- Agents: `agents view --json` (installed + sign-in). Host/project ranking + per-host
  live agent-count: the session index (already machine-wide). Host CPU/load: local
  `os.loadavg()`/`vm_stat`, remote over the same SSH transport, cloud via provider API —
  agent-count is the cheapest honest signal, ship it first.
- Mode → per-agent permission flags (`claude --permission-mode plan|acceptEdits`, etc.).
- Watchdog policy → the existing watchdog nudge/escalate bridge.
- Notify events/channels → the OpenClaw/iMessage/Slack notification path.
