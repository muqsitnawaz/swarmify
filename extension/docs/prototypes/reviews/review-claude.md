# Factory Floor — Design Review (Claude)

**Lens:** Information architecture + the four product-owner-flagged gaps (screenshot-in-reply, option-select questions, project sidebar, tickets/backlog).

## Verdict

The core instinct is right: **a "Needs You" triage queue on top of a reverse-chron stream is the correct home view** for managing 50–100 agents — it maps the one thing a human can't scale (their attention) onto the one thing the system can compute (which agents are blocked). But the prototype is currently a *monitoring* dashboard wearing a *management* dashboard's clothes. It shows you what agents are doing beautifully and lets you do almost nothing about it except type a sentence. Four views is at least one too many, the backlog half of the loop is entirely missing, and the two highest-frequency interactions a human actually has with a blocked agent — "pick option B" and "here's a screenshot" — are unbuilt. Fix the interaction model, not the chrome.

## Top 5 changes (most impactful first)

1. **Make the reply box structured, not a text input.** The single biggest gap. Right now every blocked agent gets the same `<input placeholder="Reply to unblock…">` regardless of what it actually asked. The two dominant question shapes — **multiple-choice** ("token bucket or sliding window?") and **confirm-destructive** ("this drops a column, OK?") — are answerable in one click but force free-typing. The reply affordance must be driven by the *question type*, not hardcoded as text. This is detailed in Q6/Q5 below. Everything else is polish; this is the product.

2. **Add the backlog. The dashboard is half a loop without it.** The brief's own framing is "running agents + the backlog feeding them," but the prototype shows only the former. There is a vestigial `Next Up · 6` tab inside the *detail pane* (`factory-floor.html:347`) — incoming work is buried three clicks deep inside a single agent. Tickets from `linear-cli`/`github-cli` need a top-level home so the user can see "what needs doing" and dispatch. The `⚡ Dispatch` button (line 227) currently dispatches into a void — there's no visible queue it draws from or adds to. See Q8.

3. **Cut to two primary views: Feed (home) and List (scale). Demote Columns and Board.** Four co-equal view icons (line 191–204) is a Finder metaphor that doesn't earn its keep here. Feed is the triage home; List is the "I have 100 agents, let me sort/scan/bulk-act" power view. **Board adds nothing Feed's grouping doesn't** — kanban-by-status is just the Feed's "Needs You / Running / Idle / Done" sections turned sideways, and at narrow webview width four columns is unusable (Q3). **Columns is really "Feed item, expanded"** — it should be the *detail drill-down* you get when you click a Feed row, not a peer view. Right now clicking a Feed item already routes to `setL("rail")` (line 475), which proves Columns is a detail layer, not a sibling.

4. **Decide what the green dot means and stop overloading status.** The legend (line 232–239) declares brand green is "selection/accent only, never a status," yet `--run` (`#22C55E`) and `--brand-600` (`#84cc16`) are both green and both appear constantly — tok/s sparklines, file heat bars, the Send button, *and* the running dot. At a glance a user cannot tell "this is selected" from "this is running" from "this is just an accent." Two greens that close together (`#22C55E` vs `#a3e635`) violate the design's own rule in practice. Reserve one hue family for live-status, period.

5. **Show host health as first-class state, not a text label.** Agents are fetched over SSH from remote boxes (line 51, `HOSTS` line 243), but a host is just a string in a meta line (`· ${a.host}`). When `yosemite-s1` goes offline or lags, every agent on it shows stale data with no signal. Host reachability is a top-level failure mode at this scale (Q4) and needs a persistent indicator — ideally the project/host sidebar (Q7) doubles as a host-health panel.

## Answers to the 8 questions

### 1. Intuitiveness & ranking the views

**Genuinely easier? Partially.** The "Needs You" pin is the right primitive and the live-response preview (mirroring Claude Code's Agent View) is the strongest idea here — you read the agent's actual last sentence, not a status enum. That's what makes 50 agents legible.

**What's confusing / missing:**
- **The four-icon toolbar has no labels** (line 191–204). A new user sees four abstract glyphs and a "Group by" dropdown and has no idea Feed≠List≠Board differ in *kind* while Group-by is *orthogonal*. The orthogonality (view × arrangement) is a genuinely hard mental model and it's presented with zero scaffolding. First thing a new user won't understand: **why "Group: Host" and the "Columns" view both exist** — both seem to group by host.
- **Duplicate-looking work is invisible.** In `v2-feed.png` the *same* question — "token bucket per-user, or a sliding window?" — appears on **three different agents** (RUSH-812, cli-help, onboarding). It's a data artifact of `pick(RESP)`, but it exposes a real IA hole: at scale, many agents ask near-identical questions and there's no clustering, no "answer all 3 the same way," no dedup.
- **No count of what's off-screen.** "NEEDS YOU · 14" is shown, but Live Activity is an infinite scroll with no "showing 12 of 38 running" — at 100 agents you lose your place.

**Ranking:** Feed (default — keep) > List (keep, the scale view) > Columns (demote to detail drill-down) > Board (cut, or make it an opt-in "Arrange: Status" of the List). Board and "Group: Status" are redundant.

### 2. Dev vs vibe-coder

**Serves devs well:** the detail pane (`detailHtml`, line 341) is excellent for a developer — diff heat per file, recent tool calls, `bun test … ✓ 18 passed`, tok/s, branch, Focus terminal / Kill. That's a real cockpit.

**Fails the vibe coder:** nearly all of that is jargon they can't action. `tok/s`, `18 tool calls`, `branch feat-cli-help`, `+142 −18` diff stats, `cargo build` borrow-check errors — a vibe coder reads "Build failed: borrow-check in src/pool.rs:42" (line 280) and is helpless. They care about **outcome and a decision**, not mechanics.

**What's absent per persona:**
- *Vibe coder wants:* a plain-language "what is this agent trying to do for me" (the **ticket/goal**, not the branch name), a screenshot/preview of the visual result, and option-buttons instead of a terminal. Give them a "simple mode" that hides tok/s, tool calls, file diffs, and shows: goal → current step in English → the question → buttons.
- *Developer wants:* keyboard-driven bulk ops (select 5 idle agents, kill), a real transcript (the tab exists at line 347 but is inert), and inline diff view without leaving the panel.

The design currently has **one density for both**. A persona toggle (or auto-detect from whether the user ever opens a terminal) is the cleanest fix.

### 3. VS Code webview reality (narrow, 400–500px)

This is where the multi-pane views fall apart:
- **Columns** is `grid-template-columns:320px 1fr` (line 82). At 450px panel width the 320px rail leaves ~130px for the detail pane — unusable. Both panes need to collapse to a single stack: list *or* detail, with a back button, like a mobile master-detail.
- **Board** is `repeat(4,1fr)` (line 133) with `overflow:hidden` on the container — four columns at 450px = ~100px each, and horizontal overflow is *hidden*, so two columns just vanish. This view is broken below ~900px. Either horizontal-scroll-snap one column at a time, or drop Board on narrow (reinforcing the cut in change #3).
- **List** table has 8 columns of `white-space:nowrap` (line 151) — it'll overflow-scroll horizontally, which is acceptable for a dense table but means Project/Host/tok/s are off-screen by default. Prioritize: status · name · activity, collapse the rest behind the row.
- **Feed** is the only view that's already responsive-ish (`max-width:760px`, single column, line 160) — another reason it's the right default. The filter bar (line 220, `flex-wrap:wrap`) will wrap to 3–4 rows at narrow width and eat vertical space; collapse chips into an overflow menu.

**Adaptation rule:** below ~600px, force single-pane everywhere; Columns/Board degrade to Feed-with-a-different-sort. The `100vh - 92px` height math (used in every layout) also assumes the header never wraps — at narrow width the top bar + filter bar will easily exceed 92px and clip the content.

### 4. Failure modes at scale & across computers

- **Clock skew on "2m ago."** Timestamps (`${a.since} ago`, line 462) are relative and presumably computed from each host's own clock. SSH-fetched agents on a box with 40s skew will show "just now" for stale data or future-dated activity. Fix: normalize all timestamps to the dashboard host's clock at fetch time, or show "synced 30s ago" per host so staleness is visible.
- **Host offline/slow.** No degraded state exists. If `zion` stops responding, its agents should gray out with a "last seen 4m ago — host unreachable" banner, not silently freeze on their last-known line. Today they'd look identical to a working idle agent.
- **Duplicate agent identity across hosts.** `name` is picked from a 20-item list (`NAMES`, line 246), so `incr-count` and `auth-refactor` appear on multiple hosts in every screenshot. The user genuinely can't tell two `incr-count`s apart without reading the host meta. Identity must be `host:project:name` and the UI should disambiguate visually (host-color chip) when names collide.
- **100 rows of noise.** Feed's "Live Activity" is unbounded. At 100 agents the Needs-You section is the only signal; everything below is scroll-blindness. Default-collapse "Live Activity" to a count ("47 running — expand"), or cap it to the N most-recently-changed.
- **tok/s aggregate is meaningless across hosts.** The header "2,484 tok/s" (line 216) sums throughput across machines with different hardware — a number that goes up when a fast box wakes up, not when more useful work happens. Drop it or make it "N actively generating."

### 5. Replying with a screenshot/image

The current reply is `<input>` only (line 466). Image-attach is high-frequency for visual work and the remote case is the hard part.

**Proposed design:**
- The reply box gets a **paste/drop target + an image button**. Cmd-V of a screenshot (the dominant gesture on Mac) attaches inline as a thumbnail chip above the text field. This covers 90% of cases with zero new UI chrome.
- **Local agent:** write the image to a temp path the agent can read, inject the path into the agent's stdin/prompt (`[image: /tmp/…png]`), done.
- **Remote agent (the hard part):** the dashboard host holds the bytes; the agent is on `yosemite-s1`. Two clean options: (a) **scp-on-attach** — when the reply is sent, the extension scp's the image to a known scratch dir on the remote host over the *same SSH connection already used to fetch the agent*, then passes the remote path; (b) if the agent supports it, a content-addressed blob the agent fetches back over the existing channel. (a) is simpler and reuses infrastructure that must already exist (line 51: "fetched over SSH"). Show a tiny "uploading to yosemite-s1…" inline state on the chip — **not a toast** (CLAUDE.md hard rule #6), an inline state on the attachment itself.
- **Reverse direction matters too:** when the *agent* asks "does this look right?" it often has a screenshot to *show* the user. The Feed item should render an inline image thumbnail in the response area, not just text. The `.resp` block (line 464) needs to support an image payload.

### 6. Agent asks a question with SELECTABLE OPTIONS

The most under-served interaction. Real questions in the prototype's own data are *literally* multiple-choice: "token bucket per-user, or a sliding window. Which do you prefer?" / "OK to proceed?" / "Confirm before I run it on prod?" (lines 279–280). All get a free-text box.

**Proposed design — parse the question into a structured choice and render buttons:**
- The agent's question carries options (either the CLI emits them structurally, or the dashboard parses "A … or B …?" / "Confirm?" patterns). Render them as **chips/buttons in the reply row**, replacing or augmenting the text input:
  - *Multiple choice:* `[ Token bucket ]  [ Sliding window ]  [ Something else… ]` — last option falls back to the text field for the long tail.
  - *Confirm/destructive:* `[ Confirm ]` (amber, requires the dot to mean "waiting") `[ Cancel ]` `[ Explain risk ]`. The destructive case ("drops the legacy_tokens column") should style Confirm as a deliberate, not-one-tap-by-accident action.
- This is the single highest-leverage change for **both** personas: the vibe coder can finally act without understanding the internals, and the dev saves keystrokes. The existing `Approve` button (line 466) is a degenerate special case of this — generalize it.
- **Columns view** gets the same treatment in its detail pane's actions row (line 362 currently has Focus/Open PR/Retry/Kill) — when the selected agent is waiting on a choice, surface the option buttons *above* those.
- Keep a free-text escape hatch always; agents ask open questions too.

### 7. Project as a first-class lens (toggleable sidebar)

**The toggleable project sidebar is the right call — but it should be a host+project sidebar, and it must not collide with the two grouping mechanisms already present.** Today there are *three* overlapping ways to slice by project/host:
1. The **Group-by dropdown** (line 207) — Host/Project/Status/Agent.
2. The **Columns view's own grouped rail** (groups by the same `groupKey`, line 301).
3. The **triple-pane `renderTri` nav** (line 366) — which *already is* a left sidebar listing SMART / HOSTS / PROJECTS with counts. **This is the proposed sidebar, already built, but orphaned** — `renderTri` exists in the code (line 368) but isn't wired to any view icon (the switcher only has feed/rail/table/board, line 480). The product owner is asking for something that's 80% implemented and disconnected.

**Critique & proposal:**
- **Make the `renderTri` nav the toggleable sidebar**, available across Feed/List (not a separate "tri" view). It's a *filter/scope*, orthogonal to *view* and to *arrange* — which is exactly the right factoring. Show/hide it with a button so narrow webviews can reclaim the width.
- **Resolve the redundancy:** if the sidebar scopes by project/host, then **"Group: Host" and "Group: Project" in the dropdown become redundant** — drop them, leaving the dropdown to do only Status/Agent (or remove it entirely and let the sidebar own host/project while the view owns status). Two controls that both group-by-host is the confusion called out in Q1.
- **Coexistence with Columns:** Columns' own grouped rail *is* the same data as the sidebar + list. Collapsing Columns into "Feed-detail" (change #3) removes the third redundant grouper. End state: **Sidebar = scope (which hosts/projects), View = shape (feed vs list), Status = the always-on triage sort.** Three clean axes instead of three overlapping ones.
- Make sidebar rows show live counts *with status breakdown* (the nav already renders `byHost`/`byProj` counts, line 372–379) — add the `●run ◷wait ✕fail` mini-counts that the rail group headers already compute (line 327), so the sidebar is also the host-health panel from change #5.

### 8. Where are the tickets / backlog?

**Currently: almost nowhere.** The only trace is the `Next Up · 6` tab inside one agent's detail pane (line 347) — backlog buried inside a running agent, which is backwards. The brief confirms the earlier "Next Up" queue was dropped.

**The dashboard must be running agents + the backlog feeding them** — otherwise the `Dispatch` button (line 227) has no source and the user can't answer "what should I start next?"

**Proposed home for tickets:**
- A **"Backlog" / "Next Up" section** — two viable placements:
  - (a) **Top of the Feed, above "Needs You,"** as a collapsible "📋 Ready to dispatch · 12" strip. This keeps the single-stream mental model: blocked agents → live agents → and the unstarted work in the same column. Risk: pushes live activity down.
  - (b) **A sidebar entry** under a new "QUEUE" section in the `renderTri` nav (alongside SMART/HOSTS/PROJECTS), so tickets are a *scope* you click into. Cleaner separation; my recommendation.
- Each ticket row (from `linear-cli`/`github-cli`) shows: source badge (Linear/GH), id, title, and a **`Dispatch ▸` button that opens the agent/host/mode picker** — turning a ticket into a running agent in one gesture. This is the missing other half of `⚡ Dispatch`.
- **Close the loop visually:** a dispatched ticket should animate from Backlog → Live Activity (the agent now working it carries its `ticket` field, which already exists in the data model, line 267). When that agent finishes and opens a PR, it should be traceable back to the ticket. The data model is *already* ticket-aware (`a.ticket`, shown in Feed line 461) — the backlog is the one missing surface, not a missing concept.
- **Don't over-build it.** It's a triage-and-dispatch list, not a Linear clone — no editing, no sub-issues, no drag-reorder. Show the top N "Todo" items assigned to me or my team, and a "open in Linear" escape hatch.

## What's bound to become a problem

- **Two greens (`#22C55E` run / `#a3e635` brand) will be indistinguishable in practice** and the design's own "never a status" rule is already violated by usage. This bites the moment a user is scanning 100 rows for "what's actually live."
- **Relative timestamps + multi-host = silent staleness.** Everything will *look* fresh because "2m ago" never says which clock or whether the host even answered. The most dangerous failure is the one that looks healthy.
- **The Feed's unbounded "Live Activity" doesn't survive 100 agents.** It's fine at 20 (the screenshots). At 100 it's a wall of noise and the Needs-You section is the only thing anyone reads — which argues for collapsing Live Activity by default.
- **Free-text reply is a bottleneck for the vibe-coder persona** the product explicitly wants to serve. Every blocked agent demanding a typed sentence is exactly the friction that persona can't clear. Option-buttons (Q6) aren't a nice-to-have; they're the difference between the secondary persona being served or not.
- **Identity collisions** (`auth-refactor` on three hosts) will cause the user to act on the wrong agent — approve the wrong one, kill the wrong one. Disambiguation is a correctness issue, not cosmetics.
- **The orphaned `renderTri` view** signals the IA wasn't fully decided — there's a fourth layout in the code that the switcher can't reach. Ship with a committed axis model, not a spare.

## One bold idea the design is missing

**Batch triage by question-shape, not by agent.** At 50–100 agents, many will block on the *same kind* of decision — "can I push?", "tests pass, merge?", "approach A or B?". Instead of (or above) the per-agent Feed, cluster the Needs-You queue **by question pattern**: "8 agents waiting to merge a green PR · [Approve all] [Review each]"; "3 agents asking token-bucket-vs-sliding-window · [pick once, apply to all]". The human answers a *class* of decision once rather than scrolling 14 near-identical amber cards (which the prototype's own duplicate-question artifact in `v2-feed.png` accidentally demonstrates is real). This turns "managing 100 agents" from a linear scroll into a handful of batched decisions — the actual leverage a mission-control view should provide, and something no per-agent terminal can ever do.
