const diagram = String.raw`
/swarm "70% Claude, 30% Cursor"
└─ Lead (Claude) drafts plan
   ├─ Claude 70% — strategy, approvals
   └─ Cursor 30% — trace + fixes
      └─ Shell actions pinned to session
[Approval Gate] ➜ Execute in your IDE
`;

const problemPoints = [
  "One model cannot juggle research, implementation, testing, and debugging in one pass.",
  "Context windows force awkward batching and missed details.",
  "Manual coordination between tools and terminals kills velocity.",
  "Context-switching across terminals breaks flow and focus.",
];

const solutionPoints = [
  "Swarmify orchestrates Claude, Codex, Gemini, and Cursor with shared context.",
  "Hierarchical agent spawning keeps plans delegated and auditable.",
  "Terminal pinning per session — agents survive IDE restarts.",
  "Approval gates keep you in control before code executes.",
];

const steps = [
  {
    title: "Run `/swarm`",
    body: "Describe the task and how you want the mix to behave. No dashboards, just your IDE.",
  },
  {
    title: "Swarm plans",
    body: "Lead agent proposes a distribution plan, assigns Mix of Agents, and shows the tree.",
  },
  {
    title: "You approve",
    body: "Review the plan, gate risky actions, then agents execute in parallel with live updates.",
  },
];

const mixExamples = [
  {
    title: "Bug triage sprint",
    mix: "40% Gemini research + 60% Cursor debugging",
    detail: "Gemini sweeps logs while Cursor traces and patches the failing paths.",
  },
  {
    title: "Feature implementation",
    mix: "50% Claude planning + 30% Codex coding + 20% Gemini research",
    detail: "Claude sequences the work, Codex ships the code, Gemini keeps context filled.",
  },
  {
    title: "Emergency refactor",
    mix: "70% Codex + 30% Cursor tracing",
    detail: "Codex handles bulk edits while Cursor watches regressions in real time.",
  },
  {
    title: "Architecture review",
    mix: "60% Claude + 40% Gemini",
    detail: "Claude synthesizes patterns, Gemini hunts edge cases and alternatives.",
  },
];

const agentStrengths = [
  { name: "Claude", strengths: "Planning, synthesis, multi-step reasoning." },
  { name: "Gemini", strengths: "Research depth, multi-modal analysis, broad coverage." },
  { name: "Codex", strengths: "Fast implementation, syntax-heavy tasks, refactors." },
  { name: "Cursor", strengths: "Debugging, tracing, surgical edits inside your repo." },
];

const useCases = [
  { title: "Bug triage sprint (overnight)", body: "Parallel log sweeps, reproduction, and targeted fixes while you sleep." },
  { title: "Refactor across services", body: "Divide services by agent, keep a lead agent coordinating patterns." },
  { title: "Incident deep-dive", body: "Research + tracing + remediation in parallel with approvals at every step." },
  { title: "Feature spike", body: "Mix research with implementation without leaving the IDE." },
];

const pricingPlans = [
  {
    name: "Solo",
    price: "$X/mo",
    target: "Individual developers",
    points: ["Run `/swarm` unlimited", "Local approvals", "Session restore"],
    cta: "Start with Solo",
  },
  {
    name: "Team",
    price: "$X/mo",
    target: "Shared orchestration",
    points: ["Shared sessions + logs", "Session restoration", "Approval controls"],
    cta: "Book team demo",
  },
  {
    name: "Org",
    price: "Custom",
    target: "Security & scale",
    points: ["SSO", "Cost controls", "Dedicated support"],
    cta: "Talk with us",
  },
];

const resourceLinks = [
  { label: "Docs", href: "https://github.com/muqsitnawaz/swarmify#readme" },
  { label: "Changelog", href: "https://github.com/muqsitnawaz/swarmify/commits/main" },
  { label: "GitHub", href: "https://github.com/muqsitnawaz/swarmify" },
  { label: "Security", href: "https://github.com/muqsitnawaz/swarmify#security" },
];

export default function Home() {
  return (
    <div className="relative isolate">
      <div className="pointer-events-none absolute inset-0 opacity-80" />
      <main className="relative mx-auto max-w-6xl px-6 pb-20 pt-12 sm:pt-16">
        <header className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs uppercase tracking-wide text-slate-200">
                Mix of Agents
              </span>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs uppercase tracking-wide text-slate-200">
                For developers
              </span>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs uppercase tracking-wide text-slate-200">
                For teams
              </span>
            </div>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold leading-tight text-white sm:text-5xl">
                Ship with a team of agents, from one command.
              </h1>
              <p className="text-lg text-slate-200">
                Specify your Mix of Agents. Get results faster. No new infra. Swarmify runs in your IDE with approvals before anything executes.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300"
                href="#pricing"
              >
                Run `/swarm` now
              </a>
              <a
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:border-emerald-300/70 hover:bg-white/10"
                href="#demo"
              >
                Book team demo
              </a>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-semibold text-white">For developers</p>
                <p className="text-sm text-slate-200">
                  Keep everything in the IDE. Agents pin to your terminals and survive restarts.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-semibold text-white">For teams</p>
                <p className="text-sm text-slate-200">
                  Approval gates, session logs, and reproducible Mix of Agents for every task.
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-300">No dashboards. No new infra. Just `/swarm` in your IDE.</p>
          </div>

          <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Agent tree (text-first)</p>
              <span className="rounded-full border border-emerald-200/50 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                Approval Gate
              </span>
            </div>
            <pre className="overflow-x-auto rounded-2xl bg-slate-900/70 p-4 text-sm leading-relaxed text-emerald-100">
{diagram}
            </pre>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                Session pinned to IDE
              </span>
              <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
                Live parallel updates
              </span>
            </div>
          </div>
        </header>

        <section className="mt-14 space-y-6">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
            Trusted by distributed teams shipping with agent swarms.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {["Product squads", "Platform teams", "Security responders"].map((label) => (
              <div
                key={label}
                className="flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-100"
              >
                {label}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 grid gap-8 lg:grid-cols-2">
          <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-2xl font-semibold text-white">Single agents aren&apos;t enough.</h2>
            <ul className="space-y-3 text-sm text-slate-200">
              {problemPoints.map((point) => (
                <li key={point} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-emerald-400" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4 rounded-3xl border border-emerald-300/40 bg-emerald-300/5 p-6">
            <h2 className="text-2xl font-semibold text-white">Multi-agent orchestration in your IDE.</h2>
            <ul className="space-y-3 text-sm text-slate-200">
              {solutionPoints.map((point) => (
                <li key={point} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-emerald-300" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-16 space-y-8">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-semibold text-white">How it works</h3>
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
              Plan → Approve → Execute
            </span>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {steps.map((step, idx) => (
              <div key={step.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
                    {idx + 1}
                  </div>
                  <p className="text-base font-semibold text-white">{step.title}</p>
                </div>
                <p className="text-sm text-slate-200">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Mix of Agents</p>
              <h3 className="text-2xl font-semibold text-white">Compose the right team for every task.</h3>
              <p className="text-sm text-slate-200">
                Describe what you need in the task. The orchestrator assembles the optimal mix and shows the tree before execution.
              </p>
            </div>
            <span className="rounded-full border border-emerald-300/50 bg-emerald-300/10 px-4 py-2 text-xs font-semibold text-emerald-200">
              Text-first, IDE-native
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {mixExamples.map((mix) => (
              <div key={mix.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-semibold text-white">{mix.title}</p>
                <p className="text-sm font-semibold text-emerald-200">{mix.mix}</p>
                <p className="mt-2 text-sm text-slate-200">{mix.detail}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            {agentStrengths.map((agent) => (
              <div key={agent.name} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-semibold text-white">{agent.name}</p>
                <p className="text-xs text-slate-200">{agent.strengths}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 space-y-6">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-semibold text-white">Use cases</h3>
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
              Built for speed + control
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {useCases.map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-2 text-sm text-slate-200">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="mt-16 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Pricing</p>
              <h3 className="text-2xl font-semibold text-white">Pick your starting point.</h3>
              <p className="text-sm text-slate-200">Swap tiers when you are ready. Approvals stay the same.</p>
            </div>
            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">
              No new infra
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {pricingPlans.map((plan) => (
              <div key={plan.name} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-white">{plan.name}</p>
                  <p className="text-base font-semibold text-emerald-200">{plan.price}</p>
                </div>
                <p className="text-xs text-slate-300">{plan.target}</p>
                <ul className="space-y-2 text-sm text-slate-200">
                  {plan.points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <a
                  className="mt-auto inline-flex items-center justify-center rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:border-emerald-300/70 hover:bg-white/10"
                  href={plan.name === "Solo" ? "#pricing" : "#demo"}
                >
                  {plan.cta}
                </a>
              </div>
            ))}
          </div>
        </section>

        <section id="demo" className="mt-16 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3 rounded-3xl border border-white/10 bg-white/5 p-6">
            <h3 className="text-xl font-semibold text-white">
              Run `/swarm` in your IDE. No dashboards. No new infra.
            </h3>
            <p className="text-sm text-slate-200">
              Describe your task, set the Mix of Agents, approve the plan, and let the swarm ship. Keep the approvals and logs in your session.
            </p>
            <div className="flex flex-wrap gap-3">
              {resourceLinks.map((resource) => (
                <a
                  key={resource.label}
                  className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition hover:border-emerald-300/70 hover:bg-white/10"
                  href={resource.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {resource.label}
                </a>
              ))}
            </div>
          </div>
          <div className="space-y-4 rounded-3xl border border-emerald-300/30 bg-emerald-300/5 p-6">
            <p className="text-sm font-semibold text-white">Approval workflow</p>
            <p className="text-sm text-slate-200">
              Plans, shell actions, and file edits are staged for review. You approve once, and the swarm executes with session-pinned terminals.
            </p>
            <div className="grid gap-2 text-xs text-slate-200">
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <span>Plan preview</span>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 font-semibold text-emerald-200">Approve</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <span>Shell commands</span>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 font-semibold text-emerald-200">Gate</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <span>File edits</span>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 font-semibold text-emerald-200">Review</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-black/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-white">Swarmify</p>
            <p className="text-xs text-slate-400">Multi-agent orchestration in your IDE.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a className="hover:text-white" href="#pricing">
              Pricing
            </a>
            <a className="hover:text-white" href="#demo">
              Demo
            </a>
            <a className="hover:text-white" href="https://github.com/muqsitnawaz/swarmify">
              GitHub
            </a>
          </div>
          <p className="text-xs text-slate-500">© {new Date().getFullYear()} Swarmify. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
