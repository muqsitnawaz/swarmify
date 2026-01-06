"use client";

import { useState } from "react";

type AgentType = "claude" | "codex" | "gemini" | "cursor";
type FileTab = "auth.ts" | "README.md";

type AgentMeta = {
  id: AgentType;
  name: string;
  short: string;
  label: string;
};

const agents: AgentMeta[] = [
  { id: "claude", name: "Claude", short: "CL", label: "Orchestrator plan" },
  { id: "codex", name: "Codex", short: "CX", label: "Refactor pass" },
  { id: "gemini", name: "Gemini", short: "GM", label: "Middleware pass" },
  { id: "cursor", name: "Cursor", short: "CU", label: "Test sweep" },
];

const useCaseItems: {
  id: string;
  title: string;
  description: string;
  bullets: string[];
  scenario: string;
  footnote?: string;
}[] = [
  {
    id: "parallel",
    title: "Orchestrate parallel work from one prompt",
    description:
      "Swarmify turns a single orchestrator request into multiple focused CLI agent tasks. Each agent tackles a clear slice and reports back in tabs.",
    bullets: [
      "Orchestrator splits a plan into scoped sub tasks",
      "Agents work in parallel across files and services",
      "Diffs and markdown stay visible in the editor",
    ],
    scenario: "Implement Stripe checkout with tests and docs",
    footnote: "Best results come from a deliberate research plan implement flow",
  },
  {
    id: "debug",
    title: "Validate findings with multiple agents",
    description:
      "Different CLI agents are stronger at different tasks. Swarmify puts their findings side by side so the orchestrator can converge on the right fix.",
    bullets: [
      "One agent maps the failure path",
      "Another inspects edge cases and logs",
      "Orchestrator merges the final change set",
    ],
    scenario: "Trace why guest checkout fails in production",
  },
];

export default function Home() {
  const [activeAgent, setActiveAgent] = useState<AgentType>("claude");
  const [activePanel, setActivePanel] = useState<"agent" | "file">("agent");

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="relative px-6 pt-20 pb-24 max-w-5xl mx-auto">
        <div className="animate-fade-in">
          {/* Works in */}
          <div className="flex items-center gap-4 mb-6">
            <span className="text-[#666] text-sm">Works in</span>
            <div className="flex items-center gap-2 flex-wrap">
              {["VS Code", "Cursor", "Antigravity Beta"].map((name) => (
                <span
                  key={name}
                  className="rounded-full border border-[#1a1a1a] bg-[#0f141a] px-3 py-1 text-[11px] text-[#cbd5e1]"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
          <h1 className="hero-heading text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
            Harness engineering for CLI orchestrators.
            <br />
            <span className="hero-muted text-[#94a3b8]">Run multiple agents and review their work in your IDE.</span>
          </h1>
          <p className="text-xl text-[#94a3b8] max-w-2xl mb-10">
            Swarmify is a harness engineering system that customizes agent integration points like hooks, commands, and
            context files. It orchestrates multiple CLI agents inside your editor, following the research plan implement
            workflow popularized by Dex.
          </p>
        </div>

        {/* Agents supported - clickable */}
        <div className="animate-fade-in-delay-1 flex items-center gap-4 mb-8">
          <span className="text-[#666] text-sm">CLI agents</span>
          <div className="flex items-center gap-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => {
                  setActiveAgent(agent.id);
                  setActivePanel("agent");
                }}
                className={`rounded transition-all border border-[#1a1a1a] px-3 py-2 text-xs ${
                  activeAgent === agent.id
                    ? "bg-[#0f141a] text-white"
                    : "opacity-70 hover:opacity-100 text-[#cbd5e1]"
                }`}
                title={agent.name}
              >
                <span className="font-mono mr-2 text-[10px] text-[#94a3b8]">{agent.short}</span>
                <span className="font-medium">{agent.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Install command */}
        <div className="animate-fade-in-delay-1 flex flex-wrap gap-4 mb-12">
          <a
            href="https://marketplace.visualstudio.com/items?itemName=swarmify.agents-ext"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Get Swarmify
          </a>
          <div className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-[#1a1a1a] text-sm text-[#94a3b8]">
            Orchestrator runs in your IDE windowing backend
          </div>
        </div>

        {/* Editor mockup */}
        <div className="animate-fade-in-delay-2 glow editor-mockup rounded-xl overflow-hidden border border-[#222]">
          <EditorMockup
            activeAgent={activeAgent}
            setActiveAgent={setActiveAgent}
            activePanel={activePanel}
            setActivePanel={setActivePanel}
          />
        </div>
      </section>

      {/* Harness Engineering + Architecture */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-[1.1fr_1fr] gap-10 items-start">
            <div>
              <h2 className="text-3xl font-bold mb-4">Harness engineering for multi agent orchestration</h2>
              <p className="text-[#94a3b8] text-lg mb-6">
                Swarmify is not another model. It is a harness engineering system that shapes how CLI agents integrate
                with your repo. You control hooks, commands, and context files, then let a single orchestrator drive
                multiple agents through the research plan implement workflow popularized by Dex.
              </p>
              <div className="space-y-4 text-sm text-[#cbd5e1]">
                <div className="rounded-xl border border-[#1a1a1a] bg-[#0b1116] p-4">
                  <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Harness inputs</div>
                  Context files, repo hooks, CLI commands, and per task instructions
                </div>
                <div className="rounded-xl border border-[#1a1a1a] bg-[#0b1116] p-4">
                  <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Orchestrator outputs</div>
                  Structured plans, scoped tasks, and traceable diffs across multiple agents
                </div>
                <div className="rounded-xl border border-[#1a1a1a] bg-[#0b1116] p-4">
                  <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Context alignment</div>
                  Extension manages AGENTS.md, CLAUDE.md, and GEMINI.md with symlinks so every agent sees the same ground
                  truth
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[#1a1a1a] bg-gradient-to-br from-[#0b141a] via-[#0b0f14] to-[#0a0a0a] p-6">
              <h3 className="text-lg font-semibold mb-4">3 layer architecture</h3>
              <div className="space-y-3">
                <LayerBlock title="L1" subtitle="CLI coding agents" items={["Claude", "Codex", "Gemini", "Cursor"]} />
                <LayerBlock title="L2" subtitle="Windowing backend" items={["VS Code", "Cursor IDE"]} />
                <LayerBlock title="L3" subtitle="Harness engineering system" items={["Swarmify"]} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Agent Swarm */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Agent Swarm</h2>
            <p className="text-[#94a3b8] max-w-2xl mx-auto">
              Tooling, MCP, installation, and orchestration for running multiple CLI agents under one orchestrator.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <InfoCard
              title="Orchestrator control"
              description="One orchestrator coordinates multiple CLI agents with scoped tasks and shared context."
            />
            <InfoCard
              title="Swarmify MCP"
              description="Use the MCP server for structured task spawning and consistent output formatting."
            />
            <InfoCard
              title="Installation"
              description="Install the extension once. All orchestrator sessions appear as editor tabs."
            />
            <InfoCard
              title="Context file management"
              description="AGENTS.md, CLAUDE.md, and GEMINI.md are kept in sync with symlinks to prevent divergence."
            />
            <InfoCard
              title="Native subagent gap"
              description="Many CLI agents still lack native subagent spawning. Swarmify bridges this gap for harness level context benefits."
            />
            <InfoCard
              title="Async subagents"
              description="Spawned agents run asynchronously so the orchestrator can keep working. Check back later to review results."
            />
          </div>

          <div className="mt-10 rounded-2xl border border-[#1a1a1a] bg-[#0b1116] p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <h3 className="text-xl font-semibold mb-2">Parallel execution that stays visible</h3>
                <p className="text-[#94a3b8] text-sm max-w-xl">
                  Subagents run in parallel while the orchestrator continues working. When they finish, their tabs show
                  diffs and markdown output for review.
                </p>
              </div>
              <div className="w-full md:w-64">
                <ParallelLanes />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CLI Agent Strengths */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Why multiple CLI agents</h2>
            <p className="text-[#94a3b8] max-w-2xl mx-auto">
              Different CLI agents are stronger at different tasks. Swarmify lets the orchestrator run them in parallel
              so you get the best model for each slice of work.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <InfoCard
              title="Codex"
              description="Highly surgical for large codebases and precise edits across many files."
            />
            <InfoCard
              title="Claude Opus 4.5"
              description="Very capable for complex reasoning, planning, and long chain decisions."
            />
            <InfoCard
              title="Gemini and Cursor"
              description="Strong for targeted refactors, fast iteration, and complementary perspectives."
            />
          </div>
        </div>
      </section>

      {/* Why CLI agents in IDE */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">Why CLI agents in an IDE</h2>
          <p className="text-[#94a3b8] text-center mb-12 max-w-2xl mx-auto">
            SSH support lets IDEs like VS Code run anywhere. Swarmify gives you visibility into orchestrator work inside
            the IDE instead of running agents blindly in a terminal.
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="rounded-2xl border border-[#1a1a1a] bg-gradient-to-b from-[#0b0f13] to-[#0a0a0a] p-6">
              <div className="flex items-center justify-between pb-4 border-b border-[#1a1a1a]">
                <h3 className="text-lg font-semibold">Terminal only</h3>
                <span className="text-[10px] uppercase tracking-wider text-[#666]">Limits</span>
              </div>
              <ul className="space-y-3 text-[#9aa1a8] text-sm mt-6">
                <li>Minimal visibility into agent edits</li>
                <li>Hard to compare multiple outputs</li>
                <li>Context switching between panes</li>
                <li>Markdown, diffs, and previews are hidden</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-[#3b82f6]/50 bg-gradient-to-b from-[#0c1320] to-[#0a0a0a] p-6 shadow-[0_0_30px_rgba(59,130,246,0.12)]">
              <div className="flex items-center justify-between pb-4 border-b border-[#1a1a1a]">
                <h3 className="text-lg font-semibold">IDE windowing backend</h3>
                <span className="text-[10px] uppercase tracking-wider text-[#5ea1ff]">Swarmify</span>
              </div>
              <ul className="space-y-3 text-[#d4d7db] text-sm mt-6">
                <li>Live diffs and markdown in editor tabs</li>
                <li>Parallel agent tabs with clear labels</li>
                <li>Split view of code and agent output</li>
                <li>SSH support means the IDE can run anywhere</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Agent Interface */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto space-y-16">
          <div className="text-center">
            <h2 className="text-3xl font-bold mb-4">Agent Interface</h2>
            <p className="text-[#94a3b8] max-w-2xl mx-auto">
              Editor tabs, labeling, and task systems that keep orchestrator sessions visible and organized.
            </p>
          </div>

          <div className="grid md:grid-cols-[1fr_1.3fr] gap-8 items-start">
            <div>
              <h3 className="text-2xl font-bold mb-4">Prompt library and task launching</h3>
              <p className="text-[#94a3b8] text-lg mb-6">
                Save orchestrator prompts and launch tasks with consistent harness context. Promote any output into a new
                task without leaving the editor.
              </p>
              <div className="space-y-3 text-sm text-[#ccc]">
                <div>Search and reuse orchestrator prompts across projects.</div>
                <div>Kick off complex tasks with one shortcut.</div>
                <div>Labels flow into tab titles for quick scanning.</div>
              </div>
            </div>
            <div className="rounded-2xl border border-[#1a1a1a] bg-[#0d0d0d] p-4">
              <PromptLibraryMock />
            </div>
          </div>

          <div className="grid md:grid-cols-[1fr_1.3fr] gap-8 items-start">
            <div>
              <h3 className="text-2xl font-bold mb-4">Markdown and todo workflows</h3>
              <p className="text-[#94a3b8] text-lg mb-6">
                Render agent markdown output like a real document, check todos, and convert them into orchestrator tasks.
              </p>
              <div className="space-y-3 text-sm text-[#ccc]">
                <div>Readable markdown with tables and inline code.</div>
                <div>Todos launch tasks directly into a new tab.</div>
                <div>Diff previews stay attached to the agent session.</div>
              </div>
            </div>
            <div className="rounded-2xl border border-[#1a1a1a] bg-[#0d0d0d] p-4">
              <CombinedMarkdownMock />
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">Common orchestrator workflows</h2>
          <p className="text-[#94a3b8] text-center mb-16 max-w-2xl mx-auto">
            Multi agent execution with clear orchestration and IDE visibility.
          </p>
          <div className="space-y-16">
            {useCaseItems.map((item) => (
              <UseCaseSection key={item.id} item={item} />
            ))}
          </div>
        </div>
      </section>

      {/* Integration Guide */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Integration guide</h2>
            <p className="text-[#94a3b8] max-w-2xl mx-auto">
              Pick your IDE and confirm the windowing backend powering orchestrator tabs.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <InfoCard
              title="VS Code"
              description="Install the Swarmify extension, then run the orchestrator in VS Code terminal tabs. Backend: VS Code windowing."
            />
            <InfoCard
              title="Cursor"
              description="Install the extension, then launch orchestrator sessions as editor tabs. Backend: Cursor IDE windowing."
            />
            <InfoCard
              title="VS Code over SSH"
              description="Use Remote SSH to run on any machine while keeping orchestration visible in the local IDE. Backend: VS Code windowing."
            />
          </div>
        </div>
      </section>

      {/* Trust Badges */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold mb-3">Trusted by engineers at</h2>
          </div>
          <div className="flex justify-center items-center gap-12 flex-wrap">
            <div className="rounded-xl border border-[#1a1a1a] bg-[#0b1116] px-8 py-6 flex items-center justify-center">
              <img src="/users/google.png" alt="Google" className="h-8 object-contain opacity-80 hover:opacity-100 transition-opacity" />
            </div>
            <div className="rounded-xl border border-[#1a1a1a] bg-[#0b1116] px-8 py-6 flex items-center justify-center">
              <img src="/users/tiktok.png" alt="TikTok" className="h-8 object-contain opacity-80 hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-10 text-center">Conflict resolution FAQ</h2>
          <div className="space-y-6">
            <FaqItem
              question="Do agents step on each other&apos;s work?"
              answer="The /swarm command tells the orchestrator to split work carefully and assign clear scopes. It is like giving instructions to human coworkers, each with a defined task and boundary."
            />
            <FaqItem
              question="How do I review results from subagents?"
              answer="Each subagent reports back in its own tab with markdown and diffs. The orchestrator can merge the final change set after review."
            />
            <FaqItem
              question="What about context drift?"
              answer="Swarmify manages AGENTS.md, CLAUDE.md, and GEMINI.md with symlinks so all agents share the same context source."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-6">Try Swarmify</h2>
          <p className="text-xl text-[#94a3b8] mb-10">
            Orchestrate multiple CLI agents, review every diff, and ship faster.
          </p>
          <a
            href="https://marketplace.visualstudio.com/items?itemName=swarmify.agents-ext"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Get Swarmify for VS Code
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-[#94a3b8]">
          <div>Swarmify</div>
          <div className="flex gap-6">
            <a href="https://marketplace.visualstudio.com/items?itemName=swarmify.agents-ext" className="hover:text-white transition-colors">
              VS Code Marketplace
            </a>
            <a href="https://www.npmjs.com/package/@swarmify/agents-mcp" className="hover:text-white transition-colors">
              npm
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function InfoCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-[#94a3b8] text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function LayerBlock({ title, subtitle, items }: { title: string; subtitle: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#0b1116] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-[#7aa2b6] uppercase tracking-wide">{title}</div>
        <div className="text-xs text-[#94a3b8]">{subtitle}</div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-[#cbd5e1]">
        {items.map((item) => (
          <span key={item} className="rounded-full border border-[#1a1a1a] bg-[#0f141a] px-3 py-1">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function UseCaseSection({ item }: { item: typeof useCaseItems[number] }) {
  return (
    <div className="grid md:grid-cols-[1fr_1.3fr] gap-8 items-start py-6">
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-white">{item.title}</h3>
        <p className="text-[#9ab0bf] text-sm leading-relaxed">{item.description}</p>
        <ol className="space-y-2 text-[#ccc] text-sm list-decimal list-inside">
          {item.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ol>
        {item.footnote && <div className="pt-2 text-xs text-[#94a3b8] italic">{item.footnote}</div>}
        <div className="pt-2">
          <div className="text-[10px] uppercase tracking-wide text-[#666] mb-1">Example</div>
          <div className="text-[#94a3b8] text-xs">{item.scenario}</div>
        </div>
      </div>

      <UseCaseVisual scenario={item.scenario} />
    </div>
  );
}

function UseCaseVisual({ scenario }: { scenario: string }) {
  return (
    <div className="rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] overflow-hidden">
      <div className="flex gap-0.5 px-2 pt-2 bg-[#111] overflow-x-auto">
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs bg-[#0d0d0d] text-white">
          <span className="font-mono text-[10px] text-[#94a3b8]">CL</span>
          <span className="font-medium">Claude</span>
          <span className="text-[10px] text-[#666]">- Orchestrator plan</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs bg-[#161616] text-[#94a3b8]">
          <span className="font-mono text-[10px] text-[#94a3b8]">CX</span>
          <span className="font-medium">Codex</span>
          <span className="text-[10px] text-[#666]">- Tests</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs bg-[#161616] text-[#94a3b8]">
          <span className="font-mono text-[10px] text-[#94a3b8]">FILE</span>
          <span className="font-mono text-[11px]">checkout.ts</span>
        </div>
      </div>

      <div className="p-5 text-xs leading-relaxed font-mono min-h-[180px]">
        <div className="space-y-1">
          <div className="text-[#f97316] font-bold mb-2">Claude Code</div>
          <div className="text-[#3b82f6]">&gt; <span className="text-white">{scenario}</span></div>
          <div className="text-[#ccc] mt-2">Planning scoped tasks for parallel execution...</div>
          <div className="text-[#666] mt-2">Reading: src/billing/stripe.ts</div>
          <div className="text-[#666]">Editing: src/api/checkout.ts</div>
          <div className="text-[#4ade80] mt-2">Task list created for subagents.</div>
        </div>
      </div>
    </div>
  );
}

function PromptLibraryMock() {
  return (
    <div className="font-sans">
      <div className="text-center text-[11px] tracking-wide text-[#94a3b8] mb-3">Swarmify - Agents</div>
      <div className="rounded-lg bg-[#0a0a0a] border border-[#1a1a1a] px-3 py-2 text-[11px] text-[#666] mb-4">
        Search prompts...
      </div>
      <div className="space-y-3 text-[11px]">
        <div className="rounded-lg border border-[#1a1a1a] bg-[#111] p-3">
          <div className="text-white font-semibold mb-2">research plan implement</div>
          <div className="text-[#ccc] leading-relaxed">
            Build a plan, split tasks, then execute with scoped CLI agents and review diffs.
          </div>
        </div>
        <div className="rounded-lg border border-[#1a1a1a] bg-[#0f0f0f] p-3">
          <div className="text-white font-semibold mb-2">debug consensus</div>
          <div className="text-[#aaa] leading-relaxed">
            Launch multiple agents to confirm root cause and compare findings.
          </div>
        </div>
      </div>
    </div>
  );
}

function CombinedMarkdownMock() {
  return (
    <div className="font-sans text-[11px] text-[#b7c7d2]">
      <div className="text-center text-[11px] tracking-wide text-[#94a3b8] mb-4">README.md</div>

      <div className="text-[#d8e6ef] text-base font-semibold mb-2">Landing Page Tasks</div>
      <p className="text-[#9ab0bf] mb-4 leading-relaxed">
        This doc tracks the next batch of updates. Review diffs as agents work and ship changes in parallel.
      </p>

      <div className="rounded-lg border border-[#1b2a33] bg-[#0c171d] px-3 py-2">
        <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Highlights</div>
        <ul className="space-y-1 text-[#b7c7d2] list-decimal list-inside">
          <li>Hero copy aligned to orchestration</li>
          <li>Prompt library visible by default</li>
          <li>Task list hooks for instant delegation</li>
        </ul>
      </div>
    </div>
  );
}

function ParallelLanes() {
  return (
    <div className="space-y-2">
      {["Orchestrator", "Subagent A", "Subagent B"].map((label, index) => (
        <div key={label} className="parallel-lane">
          <div className="flex items-center justify-between text-[10px] text-[#94a3b8] mb-1">
            <span>{label}</span>
            <span>Running</span>
          </div>
          <div className={`h-2 rounded-full bg-[#0f141a] border border-[#1a1a1a] parallel-flow-${index + 1}`} />
        </div>
      ))}
    </div>
  );
}

function EditorMockup({
  activeAgent,
  setActiveAgent,
  activePanel,
  setActivePanel,
}: {
  activeAgent: AgentType;
  setActiveAgent: (agent: AgentType) => void;
  activePanel: "agent" | "file";
  setActivePanel: (panel: "agent" | "file") => void;
}) {
  const [activeFile, setActiveFile] = useState<FileTab>("auth.ts");
  const [activeDiff, setActiveDiff] = useState<FileTab | "middleware.ts" | "types.ts">("auth.ts");
  const files: FileTab[] = ["auth.ts", "README.md"];
  const gitFiles: { name: FileTab | "middleware.ts" | "types.ts"; status: "M" | "A" | "D" }[] = [
    { name: "auth.ts", status: "M" },
    { name: "middleware.ts", status: "M" },
    { name: "README.md", status: "A" },
    { name: "types.ts", status: "A" },
  ];

  const setFileActive = (name: FileTab) => {
    setActiveFile(name);
    setActiveDiff(name);
    setActivePanel("file");
  };

  return (
    <div className="bg-[#0d0d0d]">
      <div className="flex items-center gap-2 px-4 py-3 bg-[#111] border-b border-[#1a1a1a]">
        <div className="flex-1 text-center text-xs text-[#666]">my-project - <span className="editor-title-highlight">Cursor</span></div>
      </div>

      <div className="flex gap-0.5 px-2 pt-2 bg-[#111] overflow-x-auto">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => {
              setActiveAgent(agent.id);
              setActivePanel("agent");
            }}
            className={`flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs transition-colors ${
              activePanel === "agent" && activeAgent === agent.id
                ? "bg-[#0d0d0d] text-white"
                : "bg-[#161616] text-[#94a3b8] hover:text-white"
            }`}
          >
            <span className="font-mono text-[10px] text-[#94a3b8]">{agent.short}</span>
            <span className="font-medium">{agent.name}</span>
            <span className="text-[10px] text-[#666] truncate max-w-[140px]">- {agent.label}</span>
          </button>
        ))}
        {files.map((file) => (
          <button
            key={file}
            onClick={() => setFileActive(file)}
            className={`flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs transition-colors ${
              activePanel === "file" && activeFile === file
                ? "bg-[#0d0d0d] text-white"
                : "bg-[#161616] text-[#94a3b8] hover:text-white"
            }`}
          >
            <span className="font-mono text-[10px] text-[#94a3b8]">FILE</span>
            <span className="font-mono">{file}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row min-h-[340px]">
        <div className="flex-1 p-5 text-xs leading-relaxed border-b md:border-b-0 md:border-r border-[#1a1a1a] overflow-hidden">
          {activePanel === "agent" ? (
            <div className="font-mono">
              <AgentContent agent={activeAgent} />
            </div>
          ) : (
            <FilePreview file={activeFile} />
          )}
        </div>

        <div className="w-full md:w-56 bg-[#0a0a0a] p-3 text-xs shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#94a3b8] uppercase tracking-wide text-[10px]">Changes</span>
            <span className="bg-[#3b82f6] text-white px-1.5 py-0.5 rounded text-[10px]">4</span>
          </div>
          <div className="space-y-1">
            {gitFiles.map((file) => (
              <GitFile
                key={file.name}
                name={file.name}
                status={file.status}
                active={activeDiff === file.name}
                onClick={() => {
                  setActiveDiff(file.name);
                  if (file.name === "README.md" || file.name === "auth.ts") {
                    setFileActive(file.name);
                  }
                }}
              />
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-[#1a1a1a]">
            <div className="text-[#94a3b8] uppercase tracking-wide text-[10px] mb-2">Diff Preview</div>
            <div className="font-mono text-[10px] space-y-0.5">
              {activeDiff === "auth.ts" && (
                <>
                  <div className="text-[#f87171]">- if (token) {"{"}</div>
                  <div className="text-[#4ade80]">+ if (token && !isExpired(token)) {"{"}</div>
                  <div className="text-[#94a3b8]">    return decode(token);</div>
                </>
              )}
              {activeDiff === "README.md" && (
                <>
                  <div className="text-[#4ade80]">+ ## Landing page updates</div>
                  <div className="text-[#4ade80]">+ - [ ] Review diff section layout</div>
                  <div className="text-[#4ade80]">+ - [ ] Add prompt library preview</div>
                </>
              )}
              {activeDiff === "middleware.ts" && (
                <>
                  <div className="text-[#f87171]">- export const auth = () =&gt; token;</div>
                  <div className="text-[#4ade80]">+ export const auth = () =&gt; verify(token);</div>
                </>
              )}
              {activeDiff === "types.ts" && (
                <>
                  <div className="text-[#4ade80]">+ export interface AgentLabel {"{"}</div>
                  <div className="text-[#4ade80]">+   label: string;</div>
                  <div className="text-[#4ade80]">+ {"}"}</div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentContent({ agent }: { agent: AgentType }) {
  if (agent === "claude") {
    return (
      <div className="space-y-1">
        <div className="text-[#f97316] font-bold mb-3">Claude Code</div>
        <div className="text-[#3b82f6]">&gt; <span className="text-white">Integrate Stripe billing and webhooks</span></div>
        <div className="text-[#ccc] mt-3">I will map the research plan implement flow.</div>
        <div className="text-[#ccc] mt-2">Spawning subagents for tests and docs.</div>
        <div className="text-[#666] mt-3">Reading: src/billing/stripe.ts</div>
        <div className="text-[#666]">Editing: src/api/webhooks.ts</div>
        <div className="text-[#4ade80] mt-3">Done. Billing flows are wired and tested.</div>
      </div>
    );
  }

  if (agent === "codex") {
    return (
      <div className="space-y-1">
        <div className="text-[#10b981] font-bold mb-3">OpenAI Codex CLI</div>
        <div className="text-[#3b82f6] mt-2">&gt; <span className="text-white">Update landing page copy and sections</span></div>
        <div className="text-[#ccc] mt-2">Refining orchestrator language and harness engineering sections.</div>
        <div className="text-[#666]">Modified: agents-web/src/app/page.tsx</div>
      </div>
    );
  }

  if (agent === "gemini") {
    return (
      <div className="space-y-1">
        <div className="text-[#94a3b8] text-[10px]">Gemini CLI 0.22.5</div>
        <div className="text-[#3b82f6] mt-2">&gt; <span className="text-white">Introduce API middleware pattern</span></div>
        <div className="text-[#ccc] mt-2">Moving auth and logging into middleware layers.</div>
        <div className="text-[#666]">Created: src/middleware/auth.ts</div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[#94a3b8]">Cursor Agent</div>
      <div className="text-[#3b82f6] mt-2">&gt; <span className="text-white">Write tests for the auth module</span></div>
      <div className="text-[#ccc] mt-2">Creating comprehensive test suite with edge cases.</div>
      <div className="text-[#666]">Created: src/__tests__/auth.test.ts</div>
    </div>
  );
}

function FilePreview({ file }: { file: FileTab }) {
  if (file === "README.md") {
    return (
      <div className="font-sans text-[11px] text-[#b7c7d2] space-y-3">
        <div className="text-[#d8e6ef] text-base font-semibold">Landing Page Updates</div>
        <p className="text-[#9ab0bf] leading-relaxed">Track Swarmify rollout tasks and review progress in one place.</p>
        <div className="space-y-2">
          {[
            "Rewrite hero to focus on orchestration",
            "Add harness engineering architecture",
            "Align integration guide section",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <span className="text-[#94a3b8] text-[10px]">TODO</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-[#1b2a33] bg-[#0c171d] px-3 py-2">
          <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Notes</div>
          <ul className="space-y-1 text-[#b7c7d2] list-decimal list-inside">
            <li>Keep labels visible in tab titles</li>
            <li>Start task from todos</li>
            <li>Ship faster message near top</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="font-mono text-[11px] text-[#cbd5e1] space-y-1">
      <div className="text-[#7aa2b6]">export function verifyToken(token: string) {"{"}</div>
      <div className="text-[#94a3b8] pl-4">if (!token) return false;</div>
      <div className="text-[#94a3b8] pl-4">const payload = decode(token);</div>
      <div className="text-[#94a3b8] pl-4">return !isExpired(payload);</div>
      <div className="text-[#7aa2b6]">{"}"}</div>
      <div className="text-[#4ade80] mt-3">+ Added expiry validation</div>
      <div className="text-[#f87171]">- Removed legacy token check</div>
    </div>
  );
}

function GitFile({
  name,
  status,
  active,
  onClick,
}: {
  name: string;
  status: "M" | "A" | "D";
  active?: boolean;
  onClick?: () => void;
}) {
  const statusColor =
    status === "M" ? "text-[#f59e0b]" : status === "A" ? "text-[#22c55e]" : "text-[#ef4444]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between py-1 px-2 rounded text-left hover:bg-[#1a1a1a] ${
        active ? "bg-[#121a22]" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#94a3b8]">FILE</span>
        <span className="text-[#ccc]">{name}</span>
      </div>
      <span className={`font-mono ${statusColor}`}>{status}</span>
    </button>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] p-6">
      <h3 className="text-lg font-semibold mb-2">{question}</h3>
      <p className="text-[#94a3b8] text-sm leading-relaxed">{answer}</p>
    </div>
  );
}
