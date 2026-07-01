# Design Review — Factory Floor (kimi)

## Verdict

The prototype is directionally correct: the **Feed-first, needs-you-on-top** model is the right answer for 50–100 agents, and the status taxonomy is clear. But it is still too agent-centric and too dev-centric. To serve both developers and vibe coders, the design needs a plain-language layer, a higher-level "mission" grouping, and a much stronger narrow-width/cross-host story. Without those, the dashboard will become a dense wall of jargon that power users tolerate and non-technical users ignore.

## Top 5 changes

1. **Make the Feed the default and add a "Plain language" (vibe) toggle.**
   The Feed is the only view that both personas can parse immediately because it shows outcomes and questions first. A single toggle should swap the chrome from dev jargon (`tok/s`, `tool calls`, `branch`, diff stats) to human summaries (`working fast`, `12 steps taken`, `changed 3 files`, `ready for review`). This keeps one UI instead of two separate views.

2. **Collapse project scoping into one persistent, collapsible left sidebar.**
   Right now the user has three competing scoping controls: the view switcher, the "Group by" dropdown, and the Columns rail. Replace them with a single project sidebar that filters the whole dashboard. Group-by then becomes a secondary "arrange by" control inside the active project filter. This removes the ambiguity of "what is filtered vs what is grouped."

3. **Add a "Next Up / Backlog" lane as a first-class view or pinned top section in the Feed.**
   The Dispatch button implies there are things to dispatch, but the dashboard only shows running agents. A backlog view (pulled from Linear/GitHub) lets the user see "what needs doing" and dispatch an agent in one click. Without it, the product is monitoring, not mission control.

4. **Design the narrow-width breakpoint first, not as an afterthought.**
   At 400–500 px the Columns and Board views are unusable. The design needs a single-column stack for narrow panels: the Board becomes vertical swimlanes, the Columns view becomes a list with a slide-over detail drawer, and the top bar collapses filter chips into a single "Filter" dropdown. Feed already works here; optimize it.

5. **Build cross-host trust signals into every card.**
   Scale across remote machines means stale data, offline hosts, clock skew, and duplicate agent names. Every agent card should carry a freshness dot, host health indicator, and disambiguated identity (`auth-refactor on yosemite-s0`). Add a global "last synced" timestamp and queued actions for hosts that are temporarily unreachable.

## Answers to the 8 questions

### 1. Intuitiveness

The Feed is genuinely the right default: it surfaces the only thing that matters at 50–100 agents — "what needs my attention right now." The "Needs you" section, last-response text, and inline reply are the strongest parts of the prototype.

What a new user will not understand:
- The icon-only view switcher has no labels and four competing abstractions. Users will not remember which icon is Feed vs Columns vs List vs Board.
- "Group by" applies silently to some views but not others (the Board is already grouped by status regardless of the dropdown). This is a mode error waiting to happen.
- `tok/s`, `tool calls`, and diff stats appear everywhere with no explanation.

View ranking:
1. **Feed** — default. It is the only view built around attention, not data density.
2. **Columns** — for focused deep dives on one agent. Keep it, but it should be reachable by clicking any Feed card, not as a top-level default.
3. **Board** — useful as a fleet-status overview, but redundant with the Feed's "Needs you / Running / Idle / Done" sorting. Make it the third tab, not the second.
4. **List** — the most redundant. It is a spreadsheet view inside an IDE that already has many spreadsheets. Keep it as a hidden power-user option or drop it.

### 2. Dev vs vibe-coder

The prototype serves developers well where it exposes: file paths, branches, diff stats, tool calls, host names, transcripts, and token throughput. Those are exactly the signals a dev needs to debug or steer an agent.

It fails vibe coders in almost every detail:
- `tok/s` is meaningless noise. Replace with a qualitative badge: `working fast`, `thinking`, `waiting`.
- `18 tool calls` should become `18 steps taken` or `looked at 4 files, ran 2 tests`.
- Diff stats (`+142 / -18`) should become `changed 3 files` or `small change` / `large change`.
- Branch names (`feat-cli-help`) and host names (`yosemite-s0`) are infrastructure. Vibe users care about project and ticket, not branch and machine.
- Activity lines like `Reading session.activity.ts` are file-path heavy. A vibe-friendly version would say `Checking how sessions are tracked`.

What each persona wants that is absent:
- **Developers:** saved filters, keyboard shortcuts, transcript search, batch actions (retry 5 failed agents), and raw log access.
- **Vibe coders:** a one-sentence outcome per agent, big action buttons (`Approve`, `Try another way`, `Show me`), and the ability to reply in plain language without seeing a terminal.

### 3. VS Code webview reality at narrow width

At 400–500 px, several things break:
- The top bar is too crowded: logo + view switcher + "Group by" + stats + theme button. On a narrow panel the title can drop to just the bolt icon, "Group by" can collapse to an icon, and stats can hide behind a single summary chip.
- The Columns view uses `grid-template-columns: 320px 1fr`. At 400 px the rail eats 80% of the width and the detail pane becomes unreadable. It should switch to a stacked layout: full-width agent list, and tapping an agent opens a slide-over detail drawer.
- The Board uses `grid-template-columns: repeat(4, 1fr)`. At 400 px each column is ~100 px wide and card text is truncated to nothing. It should collapse to a single vertical swimlane selector ( Needs you / Running / Idle / Done ) with one column visible at a time.
- The List view needs horizontal scroll, which is awkward. Hide less critical columns (host, tok/s) and let users configure what survives at narrow width.
- Filter chips (`Needs you`, `Running`, `Idle`, `Failed`, `CC`, `CX`, `GX`) overflow the bar. Collapse them into a single "Filter" dropdown at narrow widths.

The Feed is the only view that survives narrow width well because it is already single-column. That is another reason it should be the default.

### 4. Failure modes at scale and across computers

Specific things that will go wrong:

- **Host offline or slow over SSH:** Agents will appear frozen. The UI should gray out agents on that host, show a "host unreachable" badge, and queue any reply/action until the host reconnects. The global header should show host health dots next to the running/total count.
- **Clock skew on "2m ago":** Relative timestamps become lies when remote machines disagree. Show timestamps as "reported by host" and add a global "synced at" line. If skew is detected, warn: "Host clock is 3 minutes ahead; times may be inaccurate."
- **Duplicate agent identity across hosts:** Two agents named `auth-refactor` on `this-mac` and `yosemite-s0` look identical. Always disambiguate with host name in the subtitle: `auth-refactor · yosemite-s0`.
- **Stale data:** The dashboard polls, but users will not know how fresh the view is. Add a small freshness indicator (e.g., "updated 8s ago") and a manual refresh button.
- **100 rows of noise:** The Feed needs stronger grouping and batching. After the first 10 "Needs you" items, offer "Show 34 more like this." Let users pin, snooze, or bulk-approve similar questions.
- **Network partition:** If the local machine loses connection to a remote host, replies and image attachments should queue locally and retry, not fail silently.

### 5. Replying with a screenshot/image

This is one of the highest-value interactions missing from the prototype. Agents frequently ask "does this look right?" and the answer is visual.

Design:
- Add a paperclip/attach icon inside every inline reply bar in the Feed and Columns detail pane.
- Support three input paths: paste from clipboard, drag-and-drop, and click-to-browse.
- Show a thumbnail preview in the reply area before sending, with a remove button.
- For remote hosts, the image has to travel. The cleanest implementation is to stream the file through the existing SSH/agent channel to a temp path on the remote machine, or upload to a shared object store and pass the URL. The UI should show upload progress and warn if the host is remote: "Sending 1.2 MB to yosemite-s0..."
- Add a size/compression hint for large screenshots, and a fallback if transfer fails: "Could not send image to remote host. Agent will receive a text description instead."

### 6. Agent asks a question with selectable options

The prototype only shows a free-text input, but many agent questions are multiple choice ("token bucket or sliding window?"). Free-text is slower and error-prone.

Design:
- Detect options in the agent's last response. If the text contains patterns like `A) ... B) ...`, numbered lists, or "approach X vs approach Y," render them as a row of selectable buttons directly below the question.
- In the Feed, show the options as compact chips (`Token bucket`, `Sliding window`, `Other`). Clicking one sends immediately or pre-fills the reply box.
- In the Columns detail pane, show the options as a vertical stack of radio-style cards with a short preview of each choice, plus a free-text "Say something else" option at the bottom.
- Add universal quick-action buttons that work even when options are not detected: `Yes`, `No`, `Proceed`, `Try another way`, `Ask me later`.
- The "Approve" button should be context-aware: if options are present, it approves the default/recommended option; if not, it approves the last action.

### 7. Project as a first-class lens

A toggleable project sidebar is the right idea, but only if it becomes the primary scoping mechanism.

Critique:
- The current prototype has too many scoping controls. The user can group by project via the dropdown, or filter by project in the Columns view's middle rail, or soon use a project sidebar. That is three ways to think about the same thing.

Proposal:
- Replace the left side of every view with a single collapsible project sidebar. It lists projects, shows a count of active agents per project, and supports multi-select.
- Selecting a project filters the entire dashboard. The "Group by" dropdown then only changes how the filtered results are arranged (e.g., group by host within the selected project).
- In the Columns view, merge the project list into the same left rail. Do not add a second rail. The rail becomes: project sections, each expandable to show its agents.
- Add a "Projects" button in the top bar to show/hide the sidebar, with a keyboard shortcut.

### 8. Where are the tickets/backlog?

The dashboard currently shows only running agents, but the Dispatch button implies the user needs something to dispatch onto. The earlier "Next Up" queue should not have been dropped.

Proposal:
- Add a "Next Up" view as a fifth tab in the view switcher. It shows unassigned tickets pulled from Linear/GitHub, with title, project, priority, and a "Dispatch agent" button.
- Alternatively (and arguably better), add a collapsible "Next Up" section at the top of the Feed, above "Needs you." This keeps the user in one view and surfaces work that needs an agent.
- The dashboard should be about **running agents + the backlog feeding them**. Monitoring without dispatch is incomplete.
- For vibe coders, the backlog is the most important surface: they want to see "what needs doing" and click "let an agent handle this."

## What's bound to become a problem

- **Notification overload:** With 100 agents, the "Needs you" section could hold 30+ items. The UI needs batch approval, snooze, and smart grouping by question type.
- **No saved views or filters:** Power users will want "my failed agents on remote hosts" or "all agents waiting on me in project X." Rebuilding that filter every time is friction.
- **Transcript discoverability:** There is a Transcript tab in the detail pane, but no way to search across all agents. When something breaks, users will need global search.
- **No concept of agent ownership or collision:** Two agents on different hosts working the same ticket can conflict. The dashboard needs to warn when agents share a ticket or branch.
- **Accessibility:** The icon-only switcher, color-only status dots, and tiny `tok/s` numbers will fail accessibility audits. Add labels, tooltips, and ARIA roles.
- **Theme integration:** The custom light/dark toggle is fine, but the webview should also respect VS Code's active theme automatically.

## One bold idea the design is missing

**Mission lens:** group agents into missions, not just projects.

At 50–100 agents, even the best feed is a firehose. The missing abstraction is the *mission* — a ticket, a feature, or an objective that multiple agents are pursuing together. The dashboard should let the user switch from "agent view" to "mission view," where each card represents a mission with a progress ring, a few key agents, and an overall status. Clicking a mission expands into the agents working on it.

This turns 100 agents into 10–15 missions, which a human can hold in working memory. It also makes the product usable for vibe coders: they do not manage agents, they manage outcomes. "Fix auth," "Write docs," "Ship RUSH-812" become the first-class objects; agents become the workers inside them.
