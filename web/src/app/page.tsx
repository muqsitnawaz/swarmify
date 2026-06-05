const evolutionCards = [
  {
    era: "1970s-1990s",
    title: "Text Editors",
    desc: "Vim, Emacs, Notepad. You wrote every line. You compiled manually. You debugged with print statements.",
    current: false,
  },
  {
    era: "2000s-2020s",
    title: "IDEs",
    desc: "VS Code, IntelliJ, Xcode. Autocomplete, debugging, version control, extensions. You still wrote every line — just faster.",
    current: false,
  },
  {
    era: "Now",
    title: "IAEs",
    desc: "Swarmify. AI agents write the code. You orchestrate the swarm — plan, delegate, review, ship. 10 orchestrators, each spawning 10 more.",
    current: true,
  },
];

const features = [
  {
    title: "Agents as Editor Tabs",
    desc: "Every agent runs in a full-screen editor tab — not a buried terminal panel. See diffs, output, and context in real time.",
    icon: "monitor",
  },
  {
    title: "Swarm Orchestration",
    desc: "One command, multiple agents. /swarm decomposes your task, assigns the right model to each slice, and executes in parallel.",
    icon: "zap",
  },
  {
    title: "Sub-agent Spawning",
    desc: "Any agent can spawn sub-agents via MCP. Research, debug, test — without blowing up the parent's context window.",
    icon: "users",
  },
  {
    title: "Keyboard-first",
    desc: "12+ shortcuts for spawning, switching, labeling, and reviewing agents. Cycle through your swarm without touching the mouse.",
    icon: "terminal",
  },
  {
    title: "Task Management",
    desc: "Pull tasks from TODO.md, Linear, or GitHub Issues. Assign them to agents directly. Track what's running, what's done.",
    icon: "file",
  },
  {
    title: "Approval Gates",
    desc: "Agents propose a plan. You approve before they execute. Stay in control of every change hitting your codebase.",
    icon: "shield",
  },
  {
    title: "Context Sync",
    desc: "AGENTS.md, CLAUDE.md, GEMINI.md — synced automatically. Every agent sees the same ground truth.",
    icon: "globe",
  },
  {
    title: "Session Persistence",
    desc: "Close VS Code, crash, restart. Every agent session is auto-saved and restored. Zero data loss.",
    icon: "save",
  },
  {
    title: "Config Sync",
    desc: "agents push / agents pull. Your entire multi-agent setup — MCPs, commands, hooks — synced via GitHub. New machine in seconds.",
    icon: "upload",
  },
];

const workflowSteps = [
  {
    num: "01",
    title: "Describe the mission",
    desc: "Use /swarm to describe what you need. Specify the agent mix — 70% Claude for planning, 30% Codex for implementation.",
  },
  {
    num: "02",
    title: "Approve the plan",
    desc: "The lead agent decomposes the task and proposes a distribution. You review, adjust, approve.",
  },
  {
    num: "03",
    title: "Monitor and ship",
    desc: "Agents work in parallel. Switch between tabs to review diffs, unblock agents, and merge when ready.",
  },
];

const agentRows = [
  { name: "Claude", cli: "claude", best: "Planning, synthesis, multi-step reasoning", color: "#c67a4e" },
  { name: "Codex", cli: "codex", best: "Fast implementation, surgical edits", color: "#3ba55d" },
  { name: "Gemini", cli: "gemini", best: "Research, multi-system changes", color: "#4285f4" },
  { name: "Cursor", cli: "cursor-agent", best: "Debugging, tracing through codebases", color: "#b47ee5" },
];

const pricingPlans = [
  {
    name: "Solo",
    price: "Free",
    target: "Individual developers",
    points: ["Run /swarm unlimited", "Local approvals", "Session restore", "All agents supported"],
    cta: "Install now",
    href: "https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext",
  },
  {
    name: "Team",
    price: "Coming soon",
    target: "Shared orchestration",
    points: ["Shared sessions + logs", "Session restoration", "Approval controls"],
    cta: "Join waitlist",
    href: "#demo",
  },
  {
    name: "Org",
    price: "Custom",
    target: "Security & scale",
    points: ["SSO", "Cost controls", "Dedicated support"],
    cta: "Talk with us",
    href: "#demo",
  },
];

const resourceLinks = [
  { label: "Docs", href: "https://github.com/muqsitnawaz/swarmify#readme" },
  { label: "Changelog", href: "https://github.com/muqsitnawaz/swarmify/commits/main" },
  { label: "GitHub", href: "https://github.com/muqsitnawaz/swarmify" },
];

function FeatureIcon({ type }: { type: string }) {
  const cls = "w-5 h-5";
  switch (type) {
    case "monitor":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      );
    case "zap":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      );
    case "users":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case "terminal":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case "file":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "shield":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case "globe":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9" />
        </svg>
      );
    case "save":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
          <polyline points="17 21 17 13 7 13 7 21" />
          <polyline points="7 3 7 8 15 8" />
        </svg>
      );
    case "upload":
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="16 12 12 8 8 12" />
          <line x1="12" y1="16" x2="12" y2="8" />
        </svg>
      );
    default:
      return null;
  }
}

export default function Home() {
  return (
    <div className="relative">
      <main className="relative mx-auto max-w-[1200px] px-6 pb-20">

        {/* ── Hero ── */}
        <header className="pt-16 sm:pt-24 pb-8">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 font-mono text-xs text-[var(--muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" style={{ boxShadow: "0 0 6px var(--accent)" }} />
              Open source · Free forever
            </div>

            <h1 className="text-5xl font-bold tracking-tight leading-[1.05] sm:text-7xl" style={{ letterSpacing: "-0.03em" }}>
              The first <em className="not-italic text-[var(--accent)]">IAE.</em>
            </h1>

            <p className="text-lg leading-relaxed text-[var(--muted)]" style={{ maxWidth: "48ch" }}>
              Integrated Agents Environment. Your IDE becomes a command center for orchestrating
              Claude, Codex, Gemini, and Cursor in parallel — with full visibility into every
              agent&apos;s work.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#0a0a0b] transition hover:bg-[var(--accent-hover)] hover:shadow-[0_0_20px_rgba(0,232,123,0.2)]"
                href="https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext"
                target="_blank"
                rel="noreferrer"
              >
                Install for VS Code
              </a>
              <a
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm font-semibold text-white transition hover:border-[var(--muted)] hover:bg-[var(--surface-2)]"
                href="https://github.com/muqsitnawaz/swarmify"
                target="_blank"
                rel="noreferrer"
              >
                View on GitHub
              </a>
              <a
                className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-[var(--muted)] transition hover:text-white"
                href="https://www.youtube.com/watch?v=rbeoKhDxK8E"
                target="_blank"
                rel="noreferrer"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                Watch it in action
              </a>
            </div>

            <div className="flex items-center gap-3 text-xs text-[var(--faint)]">
              Works in
              <span className="flex items-center gap-2 text-[var(--muted)]">
                <span>VS Code</span>
                <span className="text-[var(--faint)]">·</span>
                <span>Cursor</span>
                <span className="text-[var(--faint)]">·</span>
                <span>SSH Remotes</span>
              </span>
            </div>
          </div>

          {/* Terminal Demo */}
          <div className="mt-12 max-w-3xl overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] font-mono text-xs" style={{ boxShadow: "0 12px 32px rgba(0,0,0,0.5), 0 0 60px rgba(0,232,123,0.03)" }}>
            <div className="flex" style={{ gap: "1px", background: "var(--border)" }}>
              {[
                { name: "Claude · auth-system", active: true, running: true },
                { name: "Codex · api-tests", active: false, running: true },
                { name: "Gemini · db-migration", active: false, running: true },
                { name: "Shell", active: false, running: false },
              ].map((tab) => (
                <div
                  key={tab.name}
                  className={`flex flex-1 items-center justify-center gap-2 px-4 py-2 ${
                    tab.active
                      ? "border-t-2 border-[var(--accent)] bg-[var(--surface)] text-white"
                      : "bg-[var(--surface-2)] text-[var(--faint)]"
                  }`}
                  style={{ minWidth: 0 }}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: tab.running ? "var(--accent)" : "var(--faint)" }}
                  />
                  <span className="truncate">{tab.name}</span>
                </div>
              ))}
            </div>
            <div className="space-y-0 p-5 leading-7 text-[var(--muted)]">
              <div><span className="text-[var(--accent)]">$ </span><span className="text-white">/swarm Ship user auth — 50% Claude, 30% Codex, 20% Gemini</span></div>
              <div>&nbsp;</div>
              <div><span className="text-[var(--accent)]">Swarm:Plan</span> Decomposing into 4 parallel tasks...</div>
              <div>&nbsp;</div>
              <div><span className="text-[var(--accent)]">Swarm:Spawn</span> task=&quot;oauth-google&quot;{" "}<span className="text-[var(--faint)]">agent=claude{" "} mode=edit</span></div>
              <div><span className="text-[var(--accent)]">Swarm:Spawn</span> task=&quot;oauth-github&quot;{" "}<span className="text-[var(--faint)]">agent=codex{" "}  mode=edit</span></div>
              <div><span className="text-[var(--accent)]">Swarm:Spawn</span> task=&quot;session-mgmt&quot;{" "}<span className="text-[var(--faint)]">agent=gemini{" "} mode=edit</span></div>
              <div><span className="text-[var(--accent)]">Swarm:Spawn</span> task=&quot;auth-tests&quot;{"  "}<span className="text-[var(--faint)]">agent=codex{" "}  mode=plan</span></div>
              <div>&nbsp;</div>
              <div className="text-[var(--faint)]">4 agents running in parallel. Switch tabs to monitor.</div>
            </div>
          </div>
        </header>

        {/* ── Concept ── */}
        <section className="border-y border-[var(--border)] bg-[var(--surface)] -mx-6 px-6 py-20 text-center" style={{ marginTop: "4rem" }}>
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[var(--accent)]">The Paradigm Shift</p>
          <h2 className="mx-auto mb-6 text-3xl font-bold sm:text-4xl" style={{ letterSpacing: "-0.02em", maxWidth: "24ch" }}>
            Text Editors became IDEs. Now IDEs become IAEs.
          </h2>
          <p className="mx-auto text-base leading-relaxed text-[var(--muted)]" style={{ maxWidth: "56ch" }}>
            When coding got complex, text editors evolved into Integrated Development Environments.
            Now that AI agents do the coding, your environment needs to evolve again —
            into an Integrated Agents Environment where you orchestrate, not type.
          </p>
        </section>

        {/* ── Evolution ── */}
        <section className="py-20">
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[var(--accent)]">Evolution</p>
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
            From typing code to orchestrating agents
          </h2>
          <p className="text-base text-[var(--muted)]">Every era had its environment. This is the next one.</p>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {evolutionCards.map((card) => (
              <div
                key={card.title}
                className={`rounded-lg border p-8 ${
                  card.current
                    ? "border-[var(--accent)] bg-[var(--surface)]"
                    : "border-[var(--border)] bg-[var(--surface)] opacity-50"
                }`}
                style={card.current ? { boxShadow: "0 0 30px rgba(0,232,123,0.06)" } : undefined}
              >
                <p className={`mb-3 font-mono text-xs uppercase tracking-wide ${card.current ? "text-[var(--accent)]" : "text-[var(--faint)]"}`}>
                  {card.era}
                </p>
                <h3 className="mb-3 text-xl font-bold" style={{ letterSpacing: "-0.02em" }}>{card.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--muted)]">{card.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Features ── */}
        <section className="py-20">
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[var(--accent)]">Capabilities</p>
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
            Everything you need to manage an agent swarm
          </h2>
          <p className="text-base text-[var(--muted)]">Not just tabs in a terminal. A full orchestration layer inside your editor.</p>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 transition hover:border-[var(--muted)]"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg text-[var(--accent)]" style={{ background: "rgba(0,232,123,0.08)" }}>
                  <FeatureIcon type={f.icon} />
                </div>
                <h3 className="mb-2 text-base font-semibold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--muted)]">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Workflow ── */}
        <section className="py-20">
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[var(--accent)]">Workflow</p>
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
            You&apos;re the engineering manager
          </h2>
          <p className="text-base text-[var(--muted)]">Each agent is a tech lead. You set the vision, they execute.</p>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {workflowSteps.map((step) => (
              <div key={step.num}>
                <p className="mb-3 font-mono text-xs text-[var(--accent)]">{step.num}</p>
                <h3 className="mb-2 text-lg font-semibold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-[var(--muted)]">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Agents ── */}
        <section className="py-20">
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[var(--accent)]">Agent Fleet</p>
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
            The right model for the right job
          </h2>
          <p className="text-base text-[var(--muted)]">Different models have different strengths. Swarmify lets you use them all.</p>

          <div className="mt-12 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-4 py-3 text-left font-mono text-xs font-medium uppercase tracking-wide text-[var(--faint)]">Agent</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-medium uppercase tracking-wide text-[var(--faint)]">CLI</th>
                  <th className="px-4 py-3 text-left font-mono text-xs font-medium uppercase tracking-wide text-[var(--faint)]">Best For</th>
                </tr>
              </thead>
              <tbody>
                {agentRows.map((agent) => (
                  <tr key={agent.name} className="border-b border-[var(--border)]">
                    <td className="px-4 py-4 font-medium text-white">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: agent.color }} />
                      {agent.name}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-[var(--muted)]">{agent.cli}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{agent.best}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Video ── */}
        <section className="py-20">
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[var(--accent)]">See it in action</p>
          <h2 className="mb-8 text-3xl font-bold sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
            Watch the workflow
          </h2>
          <a
            href="https://www.youtube.com/watch?v=rbeoKhDxK8E"
            target="_blank"
            rel="noreferrer"
            className="group relative block max-w-3xl overflow-hidden rounded-lg border border-[var(--border)] transition hover:border-[var(--muted)]"
          >
            <img
              src="https://img.youtube.com/vi/rbeoKhDxK8E/maxresdefault.jpg"
              alt="Swarmify demo"
              className="w-full transition group-hover:opacity-90"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)] text-[#0a0a0b] shadow-lg transition group-hover:scale-110">
                <svg className="ml-1 h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </a>
        </section>

        {/* ── Install ── */}
        <section id="install" className="border-y border-[var(--border)] bg-[var(--surface)] -mx-6 px-6 py-20 text-center">
          <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[var(--accent)]">Get Started</p>
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
            One step. Two minutes.
          </h2>
          <p className="mx-auto mb-10 text-base text-[var(--muted)]" style={{ maxWidth: "56ch" }}>
            Install the extension. Run your first swarm.
          </p>

          <div className="mx-auto max-w-md text-left">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-5">
              <p className="mb-3 font-mono text-xs uppercase tracking-wide text-[var(--faint)]">Extension</p>
              <p className="font-mono text-xs leading-relaxed">
                Install <span className="text-[var(--accent)]">Agents</span> from the<br />
                VS Code / Cursor Marketplace
              </p>
            </div>
          </div>

          <div className="mt-10">
            <p className="mb-4 font-mono text-xs text-[var(--faint)]">Then run your first swarm</p>
            <div className="inline-block rounded-lg border border-[var(--border)] bg-[var(--background)] px-6 py-3 font-mono text-xs">
              <span className="text-[var(--accent)]">/swarm</span>{" "}
              <span className="text-white">Ship billing — 70% Claude, 30% Codex</span>
            </div>
          </div>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" className="py-20">
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-widest text-[var(--accent)]">Pricing</p>
              <h2 className="mb-4 text-3xl font-bold sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
                Pick your starting point.
              </h2>
              <p className="text-base text-[var(--muted)]">Your agents, your API keys. No hidden fees.</p>
            </div>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {pricingPlans.map((plan) => (
              <div key={plan.name} className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-white">{plan.name}</p>
                  <p className="text-base font-semibold text-[var(--accent)]">{plan.price}</p>
                </div>
                <p className="text-xs text-[var(--faint)]">{plan.target}</p>
                <ul className="space-y-2 text-sm text-[var(--muted)]">
                  {plan.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <a
                  className="mt-auto inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm font-semibold text-white transition hover:border-[var(--muted)] hover:bg-[var(--border)]"
                  href={plan.href}
                >
                  {plan.cta}
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <section id="demo" className="py-20 text-center">
          <div className="relative">
            <div className="pointer-events-none absolute -top-px left-1/2 h-px w-2/5 -translate-x-1/2 bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent opacity-30" />
          </div>
          <h2 className="mb-4 text-3xl font-bold sm:text-4xl" style={{ letterSpacing: "-0.02em" }}>
            Your IDE just evolved.
          </h2>
          <p className="mx-auto mb-8 text-base leading-relaxed text-[var(--muted)]" style={{ maxWidth: "48ch" }}>
            Swarmify turns your editor into an Integrated Agents Environment.
            Free, open source, and ready for your first swarm.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[#0a0a0b] transition hover:bg-[var(--accent-hover)] hover:shadow-[0_0_20px_rgba(0,232,123,0.2)]"
              href="https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext"
              target="_blank"
              rel="noreferrer"
            >
              Get Swarmify
            </a>
            <a
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm font-semibold text-white transition hover:border-[var(--muted)] hover:bg-[var(--surface-2)]"
              href="https://github.com/muqsitnawaz/swarmify"
              target="_blank"
              rel="noreferrer"
            >
              Star on GitHub
            </a>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-6 py-8 text-xs text-[var(--faint)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-white">Swarmify</span>
            <span>The Integrated Agents Environment</span>
          </div>
          <div className="flex flex-wrap gap-4">
            {resourceLinks.map((link) => (
              <a key={link.label} className="transition hover:text-[var(--muted)]" href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </div>
          <p className="text-[var(--faint)]">&copy; {new Date().getFullYear()} Swarmify</p>
        </div>
      </footer>
    </div>
  );
}
