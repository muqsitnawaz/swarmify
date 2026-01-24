## Todo

## Clear explanation of why using CLI Coding Agents in the IDE is faster and better

### Clear explanation of why using CLI Coding Agents in the IDE is faster and better (even IDEs like VS Code support SSH so not an issue overall)

Initial research: The landing page copy lives in `agents-web/src/app/page.tsx`. The hero and comparison table already contrast CLI agents and IDE visibility. There is no section that explains speed or SSH tradeoffs yet.

---

## Split the homepage organization into two parts

### Split the homepage organization into two parts: Agents Swarm (tooling, mcp, installation in the extension etc) and Agent Interface (full sized editor tabs, labeling, task system etc)

Initial research: The homepage is a single page in `agents-web/src/app/page.tsx` with sections like Hero, Comparison, Use Cases, Prompt Library, Markdown, Features, Shortcuts, and CTA. There is no explicit split between Swarm and Interface sections today.

---

## Mention motivations one of them being different CLI Agents are stronger at different tasks

### Mention motivations one of them being different CLI Agents are stronger at different tasks, Codex is highly surgical, can make changes in very large codebases, but Claude Code especially with Opus 4.5 is very very good, so thats why people should be using multipel coding agents in parallel, pick the best one for each task --- we can quote some tweets here on the page about this part I found some tweets from the researchers or employees at those labs themselves

Initial research: The landing page lists supported agents and has use cases that mention different strengths, but it does not call out these specific model strengths or cite tweets. There is no tweet data source in the repo.

---

## We already talked about adding why CLI agents are not the future

### We already talked about adding why CLI agents are not the future, because cant see things, we need to drive this point home -- work will change drastically, many tweets here like this one ( Danielle Fong @DanielleFong - Jan 3 it was said that the jedi must build their own lightsaber as part of training -- and that seems to be the case with agent orchestration frameworks <-- she has 100k+ followers, but not every vibe coders should build this, we are providing the best mechanism here) and this tweet from Founder of Midjourney ( David @DavidSHolz ive done more personal coding projects over christmas break than i have in the last 10 years. its crazy. i can sense the limitations, but i *know* nothing is going to be the same anymore.) <--- coding agents are here to stay, and anyone who doesnt use them will get left behind

Initial research: The landing page already contrasts CLI agents with IDE visibility in the comparison table. There is no section that cites tweets or frames the long-term shift as strongly as requested.

---

## We are not clearly emphasizing some core capabilities of our framework

### We are not clearly emphasizing some core capabilities of our framework like the Agents which are orchestrated, they are basically Async SubAgents, the caller agent can keep on doing any other work and can check back later (it might better to animate an illustration of this that shows this happening with logos of AI Agents and task being supplied to it and so on )

Initial research: The landing page has a Swarm Mode feature and a parallel agents use case but does not describe async subagents or show an orchestration animation. Visual mockups are implemented in `agents-web/src/app/page.tsx`.

---

## People might have concerns about oh do they step on each others work or how do you resolve conflicts

### People might have concerns about oh do they step on each others work or how do you resolve conflicts, basically the /swarm command thats installed instructs the orchestrator agent to basically split the task carefully, tell them instructions like you give to a human co-worker

Initial research: The `/swarm` command content is generated in `agents-ext/src/swarm.vscode.ts` from `assets/swarm.md`. There is no landing page or dashboard explanation that addresses conflict resolution directly.

---

## We need an integration guide for each IDE perhaps on our landing page

### We need an integration guide for each IDE perhaps on our landing page, and also basically show the current IDE Backend being used for Agent Orchestration

Initial research: The landing page lists supported IDEs in the hero. Guides are linked in the extension UI via `agents-ext/src/settings.vscode.ts`. There is no per-IDE guide section on the website today.

---

## Also, thinking this abstraction of Windowing Backend is a good way

### Also, thinking this abstraction of Windowing Backend is a good way, perhaps, we can have a 3 layer diagram that shows the CLI Coding Agents L1, Windowing Backend L2, and then a Harness Engineering System at L3 <--- this can be easy for people to understand, no? It can help create a clearer mental model. And also easy to see that if you dont have L2 and L3 then youre missing out on so many more powerful things like parallel agent orchestration, managing multiple orchestrators in parallel and so on .

Initial research: The landing page currently has no architecture diagram. Any visual would be implemented in `agents-web/src/app/page.tsx` and styled via `agents-web/src/app/globals.css`.

---

## Claude Tasks Mode - Long-running task hierarchy

### Anthropic is building Claude Tasks Mode with a hierarchy: workspace -> projects -> tasks -> todos. We should consider aligning our task system with this pattern.

Initial research: Claude Tasks Mode (announced Jan 2026) features:
- Dual-panel UI: context files on right, progress tracker on left
- Clarifying questions before execution (auto-skips on timeout)
- Action plan generation for complex tasks
- Skills + MCP integration to achieve goals
- Artifacts appear in dedicated tabs

Our current setup uses RALPH.md for task files and TODO.md parsing. The gap is:
1. No real-time progress UI in dashboard
2. No planning/clarifying phase before Spawn
3. No visible context panel showing what files/MCPs agent is using
4. Tasks are per-session, not cross-project

Potential improvements:
- Tasks panel in Dashboard showing long-running tasks across agents
- Planning phase before Spawn - agent proposes plan, user approves
- Context visibility - what files/MCPs the agent is using
- Cross-project tasks that persist beyond single sessions
- Hierarchy: workspace (extension) -> projects (folders) -> tasks (RALPH.md) -> todos (checkboxes)

Sources:
- https://www.testingcatalog.com/exclusive-early-look-at-claude-tasks-mode-agent-from-anthropic/
- https://supergok.com/claude-tasks-mode-agent-workflow/
- https://x.com/koltregaskes/status/2002061616209092639
