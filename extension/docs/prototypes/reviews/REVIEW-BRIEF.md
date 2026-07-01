# Design Review Brief — "Factory Floor", an agent-management dashboard

You are one of several AI agents (Claude, Codex, Kimi, Droid) independently reviewing
a UI design prototype. Be critical and concrete. We want diverse perspectives.

## The goal (read this first)

Make **managing many AI coding agents intuitive for a human**. A power user runs
**50–100 coding agents at once, spread across several computers** (a local Mac + remote
Linux/Mac boxes over SSH). Today that's chaos — terminal tabs everywhere, no way to tell
which agent is working, stuck, or waiting on you. This dashboard is the "mission control."

**Primary persona: developers** (the product is a dev tool). **Secondary: "vibe coders"**
— less technical people who direct agents in natural language and care about outcomes, not
internals. The design must serve both.

**Where it ships: a VS Code / VSCodium / Cursor extension — a WEBVIEW PANEL.** That means:
a constrained, often NARROW width; the host's light/dark theme; no native OS menus; keyboard
focus quirks; it competes for screen space with the editor. Design within those limits.

## What you're reviewing

A clickable HTML prototype (open / read the source):
`/Users/muqsit/src/github.com/muqsitnawaz/swarmify/extension/docs/prototypes/factory-floor.html`

Screenshots (view them if you can render images; otherwise the HTML + this description suffice):
- `v2-feed.png` — the **Feed** (home) view
- `v2-rail.png` — the **Columns** view (sidebar list + detail pane)
- `v2-table.png` — the **List** view
- `v2-board.png` — the **Board** (kanban-by-status) view
(all in this same `docs/prototypes/` directory)

## The design as built

- **One data set, multiple views**, switched by a **Finder-style icon toolbar** (no words):
  **Feed · Columns · List · Board**. A separate **"Group by" (Arrange) dropdown** (Host /
  Project / Status / Agent) is orthogonal and applies to whichever view.
- **Feed (home):** a reverse-chronological stream of every agent across every host. A pinned
  **"⚠ Needs You"** section at top (agents waiting on input, failed, or finished-but-unreviewed).
  Each item shows: agent avatar + name + project + host + ticket; the agent's **last response**
  (for a waiting agent, its question, in amber); the current activity line; a timestamp; a PR
  marker; and an **inline Reply / Approve / Send** box to unblock without switching context.
  (Modeled on Anthropic Claude Code's "Agent View".)
- **Columns:** Arc-browser-style — left rail of grouped, collapsible agent rows (Needs-You +
  Pinned on top, then grouped by host); a rich **detail pane** on the right (current activity,
  recent files with diff heat, recent tool calls, tok/s, actions).
- **List:** dense, sortable table — agent · project · host · activity · tok/s · status.
- **Board:** columns by status — Needs You · Running · Idle · Done.
- **Status/phase colors (locked):** running green `#22C55E`, idle gray, waiting/needs-you
  amber `#D4A72C`, failed red. Brand neon-green `#a3e635` is selection/accent ONLY, never a status.
- **Cross-host:** agents on remote machines are fetched over SSH and shown alongside local ones.

## Questions you MUST answer

Be specific. Reference what you'd change and why. Cover:

1. **Intuitiveness:** Does this make managing 50–100 agents genuinely easier? What's confusing,
   what's missing, what's the first thing a new user won't understand? Rank the views — which
   should be the default, which are redundant?
2. **Dev vs vibe-coder:** Where does this serve developers well? Where does it fail a vibe coder
   (too much jargon: tok/s, tool calls, branches, diff stats)? What would each persona want that's absent?
3. **VS Code webview reality:** At a NARROW panel width (say 400–500px), what breaks? The
   Columns/Board multi-pane layouts especially. How should it adapt (responsive, collapse)?
4. **Failure modes at scale & across computers** — be concrete. When agents run on many machines:
   what goes wrong (a host offline/slow over SSH, clock skew on "2m ago", duplicate agent identity
   across hosts, stale data, 100 rows of noise)? How should the UI degrade gracefully?

## Specific gaps the product owner already flagged — evaluate each and propose a design

5. **Replying with a screenshot/image.** Very common: the user is building something visually, or
   the agent asks "does this look right?" The user wants to **attach a screenshot/image in the reply**.
   The current inline reply is text-only. How should image-attach work in this panel, especially when
   the agent is on a REMOTE machine (the image has to get there)?
6. **Agent asks a question with SELECTABLE OPTIONS.** Agents often ask multiple-choice questions
   (e.g. "Which approach: A token bucket, B sliding window?"). The user wants to **click an option**,
   not type. The current design only shows free-text reply. Design the option-select interaction in
   the Feed/Columns.
7. **Project as a first-class lens.** Full group-by-Project may be too heavy, but the user still wants
   to **see agents under a project, collapsible**. Proposed: a **toggleable left SIDEBAR** (show/hide
   button) listing the projects agents are working in, to filter/scope the main view. Critique this —
   is a toggleable project sidebar right? How does it coexist with the Group-by dropdown and the
   Columns view's own sidebar?
8. **Where are the TICKETS / backlog?** New tickets to be worked on — pulled via `linear-cli` /
   `github-cli` (Linear issues, GitHub issues) — aren't shown. The earlier design had a "Next Up"
   queue; the prototype dropped it. Where should incoming tickets live so the user can see "what
   needs doing" and dispatch an agent onto a ticket? Is the dashboard about *running agents only*,
   or *running agents + the backlog feeding them*?

## How to respond

Write your review to **`docs/prototypes/reviews/<yourname>.md`** (you'll be told your name).
Do NOT edit any other file — only your own review file. Structure it:
- **Verdict** (2–3 sentences: is this the right direction?)
- **Top 5 changes** you'd make, most impactful first, each with the why.
- **Answers to the 8 questions** above (concise, concrete; propose designs for 5–8).
- **What's bound to become a problem** (the things that look fine now but break at scale / across hosts / for vibe coders).
- **One bold idea** the current design is missing.
Be honest and specific. We will synthesize all reviews; disagreement is useful.
