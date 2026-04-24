# Voice-Driven Factory — Foreman operates the UI visibly

## Goal

"Hey Foreman, dispatch RUSH-557 to Claude Cloud" → it happens in the UI, in
front of you. Every click in the Factory Floor has a voice equivalent, and you
see the model make the click before it commits.

No voice-only confirmation flows. The visible animation is the confirmation.
Voice-abort is the escape hatch.

## Non-goals

- Off-the-shelf computer-use / screenshot-driven control. We own every pixel of
  the Factory; driving it through a vision model is slow and wasteful.
- A2UI or similar protocols designed for agents *generating* UI. We already
  have the UI.
- Cloud-vs-local guardrails based on cost. Factory runs on our infra; dispatch
  is dispatch.

## Landscape (2026)

- **Anthropic Computer Use / OpenAI Computer Use** — vision + mouse/keyboard.
  For unknown UIs. Wrong tool when you own the app.
- **A2UI Protocol** — JSON protocol where the agent emits UI structure, the
  client renders it, interactions signal back. Built for agent-generated UIs,
  not for driving existing ones.
- **Cursor / browser-agent SDKs (Playwright, Stagehand)** — DOM automation for
  arbitrary web pages. Again, external — not aware of our React state.

None of them are a fit. The right pattern for "own-UI + agent-drives-it-
visibly" is a **UI command bus** — small, native, ~200 lines.

## Architecture

### Three new pieces

1. **`ForemanCursor` component** — fixed-position SVG overlay that animates
   between target-element rects. Lives in
   `extension/ui/settings/components/foreman/`. Framer Motion or plain CSS
   transforms; no heavy dep needed.

2. **UI command bus** — new extension ↔ webview message type
   `foreman.uiCommand`, carrying a discriminated union:

   ```ts
   type UiCommand =
     | { kind: 'move_cursor'; target: ElementSelector }
     | { kind: 'click'; target: ElementSelector }
     | { kind: 'open_modal'; which: 'dispatch' | 'task_detail'; taskId?: string }
     | { kind: 'fill_field'; selector: string; value: string }
     | { kind: 'switch_tab'; tab: 'floor' | 'bench' | 'panel' }
     | { kind: 'focus_terminal'; id: string }
     | { kind: 'highlight'; target: ElementSelector; ms?: number }
   ```

   `ElementSelector` is a stable `data-foreman-id` attribute
   (e.g. `data-foreman-id="task-card-RUSH-557"`), not a DOM query. Resilient
   to layout changes.

3. **Command sequencer** (extension host) — when Foreman calls
   `dispatch_task({identifier, agent, target})`, the extension emits a
   sequence of `foreman.uiCommand` messages with 200–400 ms delays between
   them. Webview plays them like an animation reel.

### Example trace — "Dispatch 557 to Claude Cloud"

```
t=0      You: "Dispatch 557 to Claude Cloud"
t=400    Ghost cursor materializes near the orb
t=600    Cursor glides to RUSH-557 card
t=1000   Card highlights, TaskDetail modal opens
t=1300   Cursor → "Claude" agent chip → highlights
t=1500   Cursor → "Cloud" target → highlights
t=1800   Cursor → DISPATCH button → pulses
t=2000   Click fires. Real dispatch runs (same handler a human click would run).
t=2200   Cursor fades. Modal closes.
t=2400   Foreman: "Dispatched. Pending-abc123."
```

You watched every choice. If a choice was wrong you had two seconds to say
"stop" — mic is always hot; webview receives `foreman.abort`; animation halts;
the final click never fires.

### Abort channel

Mic stays open during animations. Any of `stop | cancel | wait | no` →
`foreman.abort` → sequencer cancels remaining commands. No backend side-effect
happens until the last `click` command executes, so abort is always safe.

## Tool kit

### Design rules (same five from the prior review)

1. One tool, one question.
2. Names are documentation — `verb_noun`.
3. Outputs sized for narration — every read tool returns `summary: string`.
4. Ambiguity surfaces as data —
   `{ status: 'needs_clarification', candidates: [...] }`.
5. No preview/execute split — the visible UI animation replaces voice-confirm.

### Read tools (8)

| Tool | Inputs | Output shape |
|---|---|---|
| `floor_summary` | — | `{summary, live_agents, cloud_jobs, queue_size, teams_active}` |
| `list_agents` | `{status?: 'live'\|'recent', kind?, project?}` | `{summary, items[{id, kind, label, task, status, elapsed}], total}` |
| `list_tasks` | `{status?, source?: 'linear'\|'github', repo?, priority?}` | `{summary, items[{identifier, title, priority, repo, assignee}], total}` |
| `list_cloud_jobs` | `{status?}` | `{summary, items[{id, agent, status, prompt, repo}], total}` |
| `list_teams` | `{active_only?}` | `{summary, items[{name, running, pending, completed, failed}], total}` |
| `get_agent` | `{who: string}` | `{status, agent?, candidates?[]}` |
| `get_task` | `{identifier}` | full task with description, linked PRs, recent dispatches |
| `recent_activity` | `{since?: '5m'\|'1h'\|'today'}` | `{summary, events[{when, who, what}]}` |

Key change from today: `list_tasks` hooks into the existing
`unifiedTasks` pipeline (`src/core/tasks.ts` → Linear + GitHub). Foreman
finally sees the queue.

### Action tools (7)

Each tool animates through the UI, then the underlying handler fires.

| Tool | Inputs | What the user sees |
|---|---|---|
| `dispatch_task` | `{identifier, agent?, target?, repo?}` | Card → modal → agent chip → target → DISPATCH |
| `spawn_agent` | `{kind, label?, repo?}` | NEW button → menu → kind selection → terminal opens |
| `stop_agent` | `{who}` | Card → focus terminal → stop control |
| `focus_ui` | `{tab?, agent_id?, task_id?}` | Tab switch / card highlight |
| `open_terminal` | `{who}` | Terminal tab focus |
| `answer_intake` | `{team, text}` | Intake banner → input fill → submit |
| `retry_team` | `{name}` | Team row → retry |

Output shape, uniform across action tools:

```ts
{
  status: 'executed' | 'aborted' | 'needs_clarification' | 'failed';
  plan: string;                // one-sentence narration: "Dispatched RUSH-557 to Claude Cloud"
  candidates?: Array<{id: string; label: string}>;
  result_id?: string;          // dispatch_id / terminal_id / ...
  error?: string;
}
```

### Reversible vs irreversible

- Reversible UI moves (`focus_ui`, `open_terminal`, `switch_tab`) — animate
  fast, no abort window. Voice just makes it happen.
- Irreversible actions (dispatch, spawn, stop, answer_intake, retry_team) —
  sequenced animation with an abort window. Always ≥ 1.5 s of visible movement
  before the committing click.

## Data-foreman-id inventory

Elements that must expose a stable `data-foreman-id`. Complete before Phase 1
ends so every subsequent tool has targets to animate to.

- `topbar-tabs-floor`, `topbar-tabs-bench`, `topbar-tabs-panel`
- `floor-dispatch-btn`, `floor-new-btn`
- `floor-active-filter-all`, `floor-active-filter-local`, `floor-active-filter-cloud`
- `task-card-{IDENTIFIER}` (per Next Up card)
- `agent-card-{ID}` (per active agent row)
- `task-detail-agent-{kind}` (per agent chip inside TaskDetail)
- `task-detail-target-local`, `task-detail-target-cloud`
- `task-detail-cloud-provider-{rush|codex|factory}`
- `task-detail-dispatch-btn`
- `dispatch-modal-search`, `dispatch-modal-task-{IDENTIFIER}`
- `terminal-focus-btn`, `terminal-close-btn`
- `intake-banner-{team}`, `intake-banner-input-{team}`, `intake-banner-submit-{team}`

Convention: kebab-case, scoped by feature, suffixed with the dynamic id when
applicable.

## System prompt rewrite

Replace `FOREMAN_SYSTEM_PROMPT` in `extension/src/vscode/foreman.vscode.ts`.
Key additions:

- Tool-selection examples for the 5 most common phrases:
  - "how's it going" → `floor_summary`
  - "what's in the queue" → `list_tasks({status: 'todo'})`
  - "dispatch X" → `dispatch_task({identifier: X, ...})`
  - "start a Claude" → `spawn_agent({kind: 'claude'})`
  - "show me X" → `focus_ui({task_id: X})`
- "When the user gives a verb, always prefer the action tool. Read tools are
  for questions only."
- "Dispatch and spawn animate through the UI. The animation IS the confirm.
  Don't ask the user to confirm again."
- "If `get_agent` / `dispatch_task` returns `candidates`, read them aloud and
  ask the user which one."

## Phased build

| Phase | Scope | Time |
|---|---|---|
| 1. Cursor + bus | `ForemanCursor` component, `foreman.uiCommand` plumbing, `data-foreman-id` on the ~20 key elements | 1 day |
| 2. Read tools | Replace `briefing`/`focus` with the 8 narrow read tools, wire `list_tasks` into Linear/GH pipeline, auto-call `floor_summary` on connect | 1 day |
| 3. Reversible actions | `focus_ui`, `open_terminal`, `switch_tab` — animate + execute | Half day |
| 4. Spawn + dispatch | `spawn_agent`, `dispatch_task` — multi-step UI sequences | 1 day |
| 5. Destructive + abort | `stop_agent`, `retry_team`, `answer_intake`, abort channel (`foreman.abort` on stop/cancel/wait/no) | Half day |
| 6. Prompt + voice test | New `FOREMAN_SYSTEM_PROMPT`, 10-minute "run the factory by voice" walkthrough, log every tool call, fix mismatches | Half day |

**~4.5 days end to end.**

## Risk ledger

- **Layout shifts breaking `data-foreman-id` targets.** Mitigation: scroll
  target into view before cursor animation; if element isn't in DOM, tool
  returns `status: 'failed'` with a specific error the model can narrate.
- **Model calls action tool with wrong inputs.** Mitigation: `candidates[]`
  on ambiguous lookups; action tools validate inputs and return
  `needs_clarification` rather than guessing.
- **Abort race** — user says "stop" after the commit click has fired.
  Mitigation: document it. Dispatches are reversible via `stop_agent` /
  closing the terminal; spawns same. If a dispatch went to cloud and is
  unkillable, the dispatch_id is in the follow-up narration so the user can
  cancel on the cloud side.
- **Mic mute during animation** — current echo-prevention gate mutes the mic
  while Foreman is speaking. Extend the gate so it does **not** mute during
  UI animation playback, so "stop" is always heard.

## Open questions

- Cursor visual: retro pointer, orb-colored dot, or a labeled chip
  ("Foreman")? Needs a design pass once Phase 1 is standing up.
- Rate limit: how many tool calls per minute before we start queuing? For now
  assume single-threaded — one action tool at a time.
