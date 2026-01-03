"use client";

import { useState } from "react";

type AgentType = "claude" | "codex" | "gemini" | "cursor";
type FileTab = "auth.ts" | "README.md";

const agents: { id: AgentType; name: string; logo: string; label: string }[] = [
  { id: "claude", name: "Claude", logo: "/claude.png", label: "Stripe integration" },
  { id: "codex", name: "Codex", logo: "/codex.png", label: "Landing page updates" },
  { id: "gemini", name: "Gemini", logo: "/gemini.png", label: "API middleware" },
  { id: "cursor", name: "Cursor", logo: "/cursor.png", label: "Auth tests" },
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
    title: "Build faster with parallel agents",
    description: "Many CLIs like Codex and Gemini don't have subagent support. Swarmify lets any agent spawn subagents for parallel work.",
    bullets: [
      "One orchestrator delegates to multiple workers",
      "Feature + tests + docs happen simultaneously",
      "Watch all diffs side-by-side in editor tabs"
    ],
    scenario: "Implementing Stripe checkout with tests",
    footnote: "We recommend using Claude as the orchestrator"
  },
  {
    id: "debug",
    title: "Debug with confidence, move faster",
    description: "Spin up multiple coding agents to verify the root cause of bugs. Different models catch different issues - save hours every day.",
    bullets: [
      "Each agent investigates from a different angle",
      "Compare findings to confirm root cause",
      "Fix once you have consensus"
    ],
    scenario: "Finding why checkout fails for guest users"
  }
];

export default function Home() {
  const [activeAgent, setActiveAgent] = useState<AgentType>("claude");
  const [activePanel, setActivePanel] = useState<"agent" | "file">("agent");

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="relative px-6 pt-20 pb-32 max-w-5xl mx-auto">
        <div className="animate-fade-in">
          {/* Works in */}
          <div className="flex items-center gap-4 mb-6">
            <span className="text-[#666] text-sm">Works in</span>
            <div className="flex items-center gap-3">
              <img src="/cursor.png" alt="Cursor" width={24} height={24} className="rounded" title="Cursor" />
              <img src="/vscode.png" alt="VS Code" width={24} height={24} className="rounded" title="VS Code" />
              <div className="flex items-center gap-1.5">
                <img src="/antigravity.png" alt="Antigravity" width={24} height={24} className="rounded" title="Antigravity (Beta)" />
                <span className="text-[10px] text-[#666]">(Beta)</span>
              </div>
            </div>
          </div>
          <h1 className="hero-heading text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
            Run multiple agents.
            <br />
            <span className="hero-muted text-[#888]">Review their work in your IDE.</span>
          </h1>
          <p className="text-xl text-[#888] max-w-xl mb-10">
            CLI agents are powerful but chaotic at scale. Swarmify puts them in editor tabs—with labels, rendered markdown, and diff visibility.
          </p>
        </div>

        {/* Agents supported - clickable */}
        <div className="animate-fade-in-delay-1 flex items-center gap-4 mb-8">
          <span className="text-[#666] text-sm">Agents</span>
          <div className="flex items-center gap-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => {
                  setActiveAgent(agent.id);
                  setActivePanel("agent");
                }}
                className={`rounded transition-all ${
                  activeAgent === agent.id
                    ? "ring-2 ring-white ring-offset-2 ring-offset-black"
                    : "opacity-60 hover:opacity-100"
                }`}
                title={agent.name}
              >
                <img src={agent.logo} alt={agent.name} width={28} height={28} className="rounded" />
              </button>
            ))}
          </div>
        </div>

        {/* Install command */}
        <div className="animate-fade-in-delay-1 flex flex-wrap gap-4 mb-16">
          <a
            href="https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Get Swarmify
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
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

      {/* Comparison Table - Best of Both Worlds */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">
            CLI agents meet IDE visibility
          </h2>
          <p className="text-[#888] text-center mb-12 max-w-2xl mx-auto">
            The flexibility of CLI agents. The visibility of your editor. No tradeoffs.
          </p>
          <div className="rounded-2xl border border-[#1a1a1a] bg-gradient-to-br from-[#0b1116] via-[#0b0f14] to-[#0a0a0a] p-1 overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0 rounded-xl overflow-hidden">
              <thead>
                <tr className="bg-[#0f141a]">
                  <th className="text-left py-4 px-4 text-[11px] uppercase tracking-wider text-[#9bb0bf] font-semibold"></th>
                  <th className="text-left py-4 px-4 text-[11px] uppercase tracking-wider text-[#9bb0bf] font-semibold">CLI Agents</th>
                  <th className="text-left py-4 px-4 text-[11px] uppercase tracking-wider text-[#9bb0bf] font-semibold">IDE-native Agents</th>
                  <th className="text-left py-4 px-4 text-[11px] uppercase tracking-wider text-[#cfe6f1] font-semibold bg-gradient-to-r from-[#13202b] to-[#0f1a22]">Swarmify</th>
                </tr>
              </thead>
              <tbody className="text-[#ccc]">
                <tr className="border-b border-[#1a1a1a] hover:bg-[#0f141a]/60 transition-colors">
                  <td className="py-4 px-4 text-[#cbd5e1]">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#60a5fa]" />
                      Strength
                    </span>
                  </td>
                  <td className="py-4 px-4">Powerful, flexible, scriptable</td>
                  <td className="py-4 px-4">Visual, integrated</td>
                  <td className="py-4 px-4 text-white bg-[#0f1a22]">Both</td>
                </tr>
                <tr className="border-b border-[#1a1a1a] hover:bg-[#0f141a]/60 transition-colors">
                  <td className="py-4 px-4 text-[#cbd5e1]">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#fbbf24]" />
                      At scale
                    </span>
                  </td>
                  <td className="py-4 px-4">tmux panes, mental overhead</td>
                  <td className="py-4 px-4">Often single-agent per window</td>
                  <td className="py-4 px-4 text-white bg-[#0f1a22]">Multiple agents as editor tabs</td>
                </tr>
                <tr className="border-b border-[#1a1a1a] hover:bg-[#0f141a]/60 transition-colors">
                  <td className="py-4 px-4 text-[#cbd5e1]">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
                      Labeling
                    </span>
                  </td>
                  <td className="py-4 px-4">Escape sequences, fragile</td>
                  <td className="py-4 px-4">Varies by tool</td>
                  <td className="py-4 px-4 text-white bg-[#0f1a22]">Name agents by task</td>
                </tr>
                <tr className="border-b border-[#1a1a1a] hover:bg-[#0f141a]/60 transition-colors">
                  <td className="py-4 px-4 text-[#cbd5e1]">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#a78bfa]" />
                      Markdown output
                    </span>
                  </td>
                  <td className="py-4 px-4">Raw tags in terminal</td>
                  <td className="py-4 px-4">Varies by tool</td>
                  <td className="py-4 px-4 text-white bg-[#0f1a22]">Rendered like Notion</td>
                </tr>
                <tr className="hover:bg-[#0f141a]/60 transition-colors">
                  <td className="py-4 px-4 text-[#cbd5e1]">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#f97316]" />
                      Diff review
                    </span>
                  </td>
                  <td className="py-4 px-4">Scrolling stdout</td>
                  <td className="py-4 px-4">Native diff panels</td>
                  <td className="py-4 px-4 text-white bg-[#0f1a22]">Native diffs as agents work</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 3x Faster */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <div className="rounded-2xl border border-[#1a1a1a] bg-gradient-to-br from-[#0b141a] via-[#0a0f13] to-[#0a0a0a] p-8 md:p-10">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold mb-3">
                  Ship 3x faster with Swarm
                </h2>
                <p className="text-[#888] text-lg max-w-2xl">
                  Plan once, then run multiple agents in parallel. Nine hours of work,
                  done in three.
                </p>
              </div>
              <div className="flex items-center gap-4 text-sm text-[#ccc]">
                <div className="rounded-full border border-[#1f2d36] bg-[#0f1a22] px-4 py-2">
                  Plan
                </div>
                <span className="text-[#334155]">→</span>
                <div className="rounded-full border border-[#1f2d36] bg-[#0f1a22] px-4 py-2">
                  Spawn agents
                </div>
                <span className="text-[#334155]">→</span>
                <div className="rounded-full border border-[#1f2d36] bg-[#0f1a22] px-4 py-2">
                  Review diffs
                </div>
              </div>
            </div>
            <div className="mt-8 grid md:grid-cols-3 gap-4 text-sm text-[#cbd5e1]">
              <div className="rounded-xl border border-[#1a1a1a] bg-[#0b1116] p-4">
                <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Parallelism</div>
                Delegate tests, docs, refactors in one prompt.
              </div>
              <div className="rounded-xl border border-[#1a1a1a] bg-[#0b1116] p-4">
                <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Visibility</div>
                Watch diffs and markdown updates as they land.
              </div>
              <div className="rounded-xl border border-[#1a1a1a] bg-[#0b1116] p-4">
                <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Control</div>
                Labels and shortcuts keep 5+ agents organized.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">
            How it works
          </h2>
          <p className="text-[#888] text-center mb-12 max-w-2xl mx-auto">
            Install the extension. Run agents in tabs. Optionally, let agents spawn sub-agents.
          </p>
          <div className="grid md:grid-cols-2 gap-6 mb-16">
            {/* Extension Card */}
            <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-[#3b82f6]/10 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#3b82f6]">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M3 9H21" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M9 9V21" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold">Swarmify Extension</h3>
                  <span className="text-xs text-[#888]">Required</span>
                </div>
              </div>
              <p className="text-[#888] text-sm mb-4">
                Your editor handles 30 tabs. Now agents live there too. Split-view agents side by side, same shortcuts you use for files.
              </p>
              <a
                href="https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#3b82f6] text-sm hover:underline"
              >
                Install from Marketplace
              </a>
            </div>
            {/* Swarm Mode Card */}
            <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-[#22c55e]/10 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#22c55e]">
                    <circle cx="12" cy="6" r="3" stroke="currentColor" strokeWidth="1.5"/>
                    <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.5"/>
                    <circle cx="18" cy="18" r="3" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M12 9V12M12 12L6 15M12 12L18 15" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold">Swarm Mode</h3>
                  <span className="text-xs text-[#888]">Optional</span>
                </div>
              </div>
              <p className="text-[#888] text-sm mb-4">
                Let one agent spawn others for parallel sub-tasks. Delegate tests, docs, refactors—all from one prompt.
              </p>
              <a
                href="https://www.npmjs.com/package/@swarmify/agents-mcp"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#22c55e] text-sm hover:underline"
              >
                Powered by Swarmify MCP
              </a>
            </div>
          </div>
          {/* Steps */}
          <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8 text-sm">
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-[#222] flex items-center justify-center text-xs">1</span>
              <span className="text-[#ccc]">Install extension</span>
            </div>
            <div className="hidden md:block text-[#333]">→</div>
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-[#222] flex items-center justify-center text-xs">2</span>
              <span className="text-[#ccc]">Spin up CLI agents</span>
            </div>
            <div className="hidden md:block text-[#333]">→</div>
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-[#222] flex items-center justify-center text-xs">3</span>
              <span className="text-[#ccc]">Let agents spawn a swarm</span>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">
            Terminal tabs don&apos;t scale. Editor tabs do.
          </h2>
          <p className="text-[#888] text-center mb-16 max-w-2xl mx-auto">
            No more tmux panes. No more iTerm tab chaos. Just editor tabs.
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Terminal Column */}
            <div className="rounded-2xl border border-[#1a1a1a] bg-gradient-to-b from-[#0b0f13] to-[#0a0a0a] p-6">
              <div className="flex items-center justify-between pb-4 border-b border-[#1a1a1a]">
                <div className="flex items-center gap-3">
                  <TerminalIcon />
                  <h3 className="text-lg font-semibold">Terminal CLI</h3>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-[#666]">Limits</span>
              </div>
              <ul className="space-y-4 text-[#9aa1a8] text-sm mt-6">
                <CompareItem negative>Small panel at the bottom of your screen</CompareItem>
                <CompareItem negative>Can&apos;t see git changes as agent edits files</CompareItem>
                <CompareItem negative>One agent at a time, sequential work</CompareItem>
                <CompareItem negative>Tmux splits still can&apos;t show images or previews</CompareItem>
                <CompareItem negative>Context switch to browser for frontend</CompareItem>
                <CompareItem negative>Scroll through raw markdown output</CompareItem>
              </ul>
            </div>
            {/* IDE Column */}
            <div className="rounded-2xl border border-[#3b82f6]/50 bg-gradient-to-b from-[#0c1320] to-[#0a0a0a] p-6 shadow-[0_0_30px_rgba(59,130,246,0.12)]">
              <div className="flex items-center justify-between pb-4 border-b border-[#1a1a1a]">
                <div className="flex items-center gap-3">
                  <IDEIcon />
                  <h3 className="text-lg font-semibold">VS Code / Cursor</h3>
                </div>
                <span className="text-[10px] uppercase tracking-wider text-[#5ea1ff]">Swarmify</span>
              </div>
              <ul className="space-y-4 text-[#d4d7db] text-sm mt-6">
                <CompareItem>Full-screen terminal tabs in the editor area</CompareItem>
                <CompareItem>Git diff visible in real-time as changes happen</CompareItem>
                <CompareItem>Split horizontal/vertical - agents + code side by side</CompareItem>
                <CompareItem>Images, diagrams, previews render inline</CompareItem>
                <CompareItem>Browser preview in the same window</CompareItem>
                <CompareItem>Beautiful markdown rendering built-in</CompareItem>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">
            Common workflows
          </h2>
          <p className="text-[#888] text-center mb-16 max-w-2xl mx-auto">
            Multiple agents, one window. Here's how teams use Swarmify.
          </p>
          <div className="space-y-16">
            {useCaseItems.map((item) => (
              <UseCaseSection key={item.id} item={item} />
            ))}
          </div>
        </div>
      </section>

      {/* Prompt Library */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-[1.1fr_1.2fr] gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-4">
                Reuse prompts, move faster
              </h2>
              <p className="text-[#888] text-lg mb-6">
                Save your most-used agent prompts and launch them in seconds.
                No more rewriting the same instructions for every task.
              </p>
              <div className="space-y-3 text-sm text-[#ccc]">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[#3b82f6]" />
                  <span>Search and pin the prompts you use every day.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[#3b82f6]" />
                  <span>Kick off complex tasks with one shortcut.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[#3b82f6]" />
                  <span>Keep workflows consistent across multiple agents.</span>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[#1a1a1a] bg-[#0b141a] p-4 shadow-[0_0_40px_rgba(0,0,0,0.35)]">
              <PromptLibraryMock />
            </div>
          </div>
        </div>
      </section>

      {/* Markdown + Tasks Preview */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-[1.1fr_1.2fr] gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-4">
                Markdown that&apos;s readable and actionable
              </h2>
              <p className="text-[#888] text-lg mb-6">
                Render agent-generated .md like Notion, check todos, and spin up tasks
                without leaving your editor.
              </p>
              <div className="space-y-3 text-sm text-[#ccc]">
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[#22c55e]" />
                  <span>Clean markdown view with tables, callouts, and inline code.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[#22c55e]" />
                  <span>Clickable todos that can launch a task immediately.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[#22c55e]" />
                  <span>Labels flow into tab titles so you always know what&apos;s running.</span>
                </div>
              </div>
            </div>
            <div className="grid gap-6">
              <div className="rounded-2xl border border-[#1a1a1a] bg-[#0b141a] p-4 shadow-[0_0_40px_rgba(0,0,0,0.35)]">
                <MarkdownPreviewMock />
              </div>
              <div className="rounded-2xl border border-[#1a1a1a] bg-[#0b141a] p-4 shadow-[0_0_40px_rgba(0,0,0,0.35)]">
                <TaskableTodosMock />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-16 text-center animate-fade-in">
            Built for agent workflows
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <Feature
              title="Split View"
              description="Split-view agents side by side. Same shortcuts you use for files work for agents."
            />
            <Feature
              title="Swarm Mode"
              description="One prompt, multiple agents. Delegate tests, docs, refactors automatically."
            />
            <Feature
              title="Rich Previews"
              description="Rendered markdown, native diffs. No more scrolling through raw terminal output."
            />
          </div>
        </div>
      </section>

      {/* Shortcuts */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">
            Save an hour every day
          </h2>
          <p className="text-[#888] text-center mb-12">
            Keyboard shortcuts for everything you do repeatedly
          </p>
          <div className="grid md:grid-cols-2 gap-4 max-w-2xl mx-auto">
            <Shortcut keys="Cmd+Shift+A" action="New agent" />
            <Shortcut keys="Cmd+Shift+N" action="New task with context" />
            <Shortcut keys="Cmd+Shift+C" action="Clear & restart" />
            <Shortcut keys="Cmd+Shift+L" action="Label agent" />
            <Shortcut keys="Cmd+Shift+G" action="Generate commit" />
            <Shortcut keys="Cmd+Shift+I" action="Go to terminal" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl font-bold mb-6">
            Try Swarmify
          </h2>
          <p className="text-xl text-[#888] mb-10">
            Run multiple agents. Review their work. Ship faster.
          </p>
          <a
            href="https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext"
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
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-[#888]">
          <div>
            Swarmify
          </div>
          <div className="flex gap-6">
            <a href="https://marketplace.visualstudio.com/items?itemName=swarmify.swarm-ext" className="hover:text-white transition-colors">
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

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-6 rounded-xl border border-[#1a1a1a] hover:border-[#333] transition-colors">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-[#888] text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function UseCaseSection({ item }: { item: typeof useCaseItems[number] }) {
  return (
    <div className="grid md:grid-cols-[1fr_1.3fr] gap-8 items-start py-6">
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-white">{item.title}</h3>
        <p className="text-[#9ab0bf] text-sm leading-relaxed">{item.description}</p>
        <ul className="space-y-2 text-[#cbd5e1] text-sm">
          {item.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-2">
              <span className="mt-[6px] inline-block h-1 w-1 rounded-full bg-[#3b82f6]" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        {item.footnote && (
          <div className="pt-2 text-xs text-[#888] italic">
            {item.footnote}
          </div>
        )}
        <div className="pt-2">
          <div className="text-[10px] uppercase tracking-wide text-[#666] mb-1">Example</div>
          <div className="text-[#888] text-xs">{item.scenario}</div>
        </div>
      </div>

      <UseCaseVisual scenario={item.scenario} />
    </div>
  );
}

function UseCaseVisual({ scenario }: { scenario: string }) {
  return (
    <div className="rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] overflow-hidden">
      {/* Simplified tab bar showing multiple agents */}
      <div className="flex gap-0.5 px-2 pt-2 bg-[#111] overflow-x-auto">
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs bg-[#0d0d0d] text-white">
          <img src="/claude.png" alt="Claude" width={14} height={14} className="rounded-sm" />
          <span className="font-medium">Claude</span>
          <span className="text-[10px] text-[#666]">— Feature impl</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs bg-[#161616] text-[#888]">
          <img src="/codex.png" alt="Codex" width={14} height={14} className="rounded-sm" />
          <span className="font-medium">Codex</span>
          <span className="text-[10px] text-[#666]">— Tests</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs bg-[#161616] text-[#888]">
          <FileIcon />
          <span className="font-mono text-[11px]">checkout.ts</span>
        </div>
      </div>

      {/* Terminal output */}
      <div className="p-5 text-xs leading-relaxed font-mono min-h-[180px]">
        <div className="space-y-1">
          <div className="text-[#f97316] font-bold mb-2">Claude Code</div>
          <div className="text-[#3b82f6]">&gt; <span className="text-white">{scenario}</span></div>
          <div className="text-[#ccc] mt-2">Implementing payment flow with Stripe SDK...</div>
          <div className="text-[#666] mt-2">Reading: src/billing/stripe.ts</div>
          <div className="text-[#666]">Editing: src/api/checkout.ts</div>
          <div className="text-[#4ade80] mt-2">Creating checkout session endpoint...</div>
        </div>
      </div>
    </div>
  );
}

function PromptLibraryMock() {
  return (
    <div className="rounded-xl border border-[#1b2a33] bg-[#0f1b22] p-4 font-sans">
      <div className="text-center text-[11px] tracking-wide text-[#8fb3c4] mb-3">
        Swarmify - Agents
      </div>
      <div className="rounded-lg bg-[#0c171d] border border-[#13232c] px-3 py-2 text-[11px] text-[#6f8a99] mb-4">
        Search prompts...
      </div>
      <div className="space-y-3 text-[11px]">
        <div className="rounded-lg border border-[#19323f] bg-[#15313d] p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <StarIcon />
              <span className="text-[#cfe6f1] font-semibold">rethink</span>
            </div>
            <div className="flex items-center gap-2 text-[#7aa2b6]">
              <StarIcon filled />
              <TrashIcon />
            </div>
          </div>
          <div className="text-[#b7c7d2] leading-relaxed">
            Before we make this change, what do you think? Is this the right
            tradeoff for the team and the codebase?
          </div>
        </div>
        <div className="rounded-lg border border-[#12252f] bg-[#0f2029] p-3">
          <div className="flex items-center gap-2 mb-2">
            <StarIcon />
            <span className="text-[#cfe6f1] font-semibold">debugit</span>
          </div>
          <div className="text-[#94a8b6] leading-relaxed">
            Confirm the root cause by spinning up multiple agents and comparing
            their findings.
          </div>
        </div>
        <button className="w-full flex items-center gap-2 text-left text-[#8aa8ba] text-[11px] py-2 px-2 rounded-md hover:bg-[#0f2029] transition-colors">
          <PlusIcon />
          Add new prompt
        </button>
      </div>
    </div>
  );
}

function MarkdownPreviewMock() {
  return (
    <div className="rounded-xl border border-[#1b2a33] bg-[#0f1b22] p-4 font-sans text-[11px] text-[#b7c7d2]">
      <div className="text-center text-[11px] tracking-wide text-[#8fb3c4] mb-4">
        README.md
      </div>
      <div className="text-[#d8e6ef] text-base font-semibold mb-2">Landing Page Tasks</div>
      <p className="text-[#9ab0bf] mb-3 leading-relaxed">
        This doc tracks the next batch of updates. Review diffs as agents work and
        ship changes in parallel.
      </p>
      <div className="rounded-lg border border-[#1b2a33] bg-[#0c171d] px-3 py-2 mb-3">
        <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Highlights</div>
        <ul className="space-y-1 text-[#b7c7d2]">
          <li>• Hero copy aligned to orchestration</li>
          <li>• Prompt library visible by default</li>
          <li>• Task list hooks for instant delegation</li>
        </ul>
      </div>
      <div className="rounded-lg border border-[#1b2a33] bg-[#0c171d] px-3 py-2">
        <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Notes</div>
        <div className="grid grid-cols-3 gap-2 text-[10px] text-[#8aa8ba]">
          <div className="rounded border border-[#1b2a33] px-2 py-1">Owner</div>
          <div className="rounded border border-[#1b2a33] px-2 py-1">Status</div>
          <div className="rounded border border-[#1b2a33] px-2 py-1">ETA</div>
          <div className="rounded border border-[#1b2a33] px-2 py-1 text-[#cfe6f1]">Swarmify</div>
          <div className="rounded border border-[#1b2a33] px-2 py-1 text-[#cfe6f1]">In review</div>
          <div className="rounded border border-[#1b2a33] px-2 py-1 text-[#cfe6f1]">Today</div>
        </div>
      </div>
    </div>
  );
}

function TaskableTodosMock() {
  const [todos, setTodos] = useState([false, false, false]);
  const toggleTodo = (index: number) => {
    setTodos((current) => current.map((item, i) => (i === index ? !item : item)));
  };

  return (
    <div className="rounded-xl border border-[#1b2a33] bg-[#0f1b22] p-4 font-sans text-[11px] text-[#b7c7d2]">
      <div className="flex items-center gap-2 mb-4 text-[10px] text-[#8fb3c4]">
        <span className="rounded bg-[#13232c] px-2 py-1">Codex — Landing page updates</span>
        <span className="rounded bg-[#13232c] px-2 py-1">Claude — Stripe integration</span>
      </div>
      <div className="space-y-3">
        {[
          "Polish hero copy for orchestration",
          "Add prompt library preview section",
          "Wire markdown todos to agent task",
        ].map((text, index) => (
          <div key={text} className="flex items-center gap-3 rounded-lg border border-[#162a34] bg-[#0c171d] px-3 py-2">
            <button
              type="button"
              onClick={() => toggleTodo(index)}
              className={`h-4 w-4 rounded border ${
                todos[index]
                  ? "bg-[#22c55e] border-[#22c55e]"
                  : "border-[#335261] bg-transparent"
              }`}
              aria-label={`Toggle todo ${text}`}
            />
            <span className="flex-1 text-[#b7c7d2]">{text}</span>
            <button
              type="button"
              className="relative overflow-hidden rounded-full border border-[#2c4756] bg-[#13232c] px-3 py-1 text-[10px] text-[#bfe3f4] shadow-[0_0_12px_rgba(59,130,246,0.25)] transition-all hover:border-[#3b82f6] hover:shadow-[0_0_16px_rgba(59,130,246,0.45)]"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[#3b82f6]/30 to-transparent animate-pulse" />
              <span className="relative">Start task</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Shortcut({ keys, action }: { keys: string; action: string }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-[#111] border border-[#1a1a1a]">
      <span className="text-[#888]">{action}</span>
      <kbd className="px-2 py-1 bg-[#1a1a1a] rounded text-xs font-mono">{keys}</kbd>
    </div>
  );
}

function EditorMockup({
  activeAgent,
  setActiveAgent,
  activePanel,
  setActivePanel
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
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#111] border-b border-[#1a1a1a]">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 text-center text-xs text-[#666]">
          my-project - <span className="editor-title-highlight">Cursor</span>
        </div>
      </div>

      {/* Tabs */}
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
                : "bg-[#161616] text-[#888] hover:text-white"
            }`}
          >
            <img src={agent.logo} alt={agent.name} width={16} height={16} className="rounded-sm" />
            <span className="font-medium">{agent.name}</span>
            <span className="text-[10px] text-[#666] truncate max-w-[140px]">— {agent.label}</span>
          </button>
        ))}
        {files.map((file) => (
          <button
            key={file}
            onClick={() => setFileActive(file)}
            className={`flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs transition-colors ${
              activePanel === "file" && activeFile === file
                ? "bg-[#0d0d0d] text-white"
                : "bg-[#161616] text-[#888] hover:text-white"
            }`}
          >
            <FileIcon />
            <span className="font-mono">{file}</span>
          </button>
        ))}
      </div>

      {/* Split Content: Terminal + Git Panel */}
      <div className="flex flex-col md:flex-row min-h-[340px]">
        {/* Terminal / File Preview */}
        <div className="flex-1 p-5 text-xs leading-relaxed border-b md:border-b-0 md:border-r border-[#1a1a1a] overflow-hidden">
          {activePanel === "agent" ? (
            <div className="font-mono">
              <AgentContent agent={activeAgent} />
            </div>
          ) : (
            <FilePreview file={activeFile} />
          )}
        </div>

        {/* Git Changes Panel */}
        <div className="w-full md:w-56 bg-[#0a0a0a] p-3 text-xs shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#888] uppercase tracking-wide text-[10px]">Changes</span>
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
            <div className="text-[#888] uppercase tracking-wide text-[10px] mb-2">Diff Preview</div>
            <div className="font-mono text-[10px] space-y-0.5">
              {activeDiff === "auth.ts" && (
                <>
                  <div className="text-[#f87171]">- if (token) {"{"}</div>
                  <div className="text-[#4ade80]">+ if (token && !isExpired(token)) {"{"}</div>
                  <div className="text-[#888]">    return decode(token);</div>
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
        <div className="text-[#ccc] mt-3">I&apos;ll add the Stripe client, webhook handler, and plans mapping.</div>
        <div className="text-[#ccc] mt-2">Creating checkout session flow and subscription sync...</div>
        <div className="text-[#666] mt-3">Reading: src/billing/stripe.ts</div>
        <div className="text-[#666]">Editing: src/api/webhooks.ts</div>
        <div className="text-[#4ade80] mt-3">Done. Billing flows are wired and tested.</div>
      </div>
    );
  }

  if (agent === "codex") {
    return (
      <div className="space-y-1">
        <pre className="text-[#10b981] text-[10px] leading-tight mb-3">{`
   ██████╗ ██████╗ ██████╗ ███████╗██╗  ██╗
  ██╔════╝██╔═══██╗██╔══██╗██╔════╝╚██╗██╔╝
  ██║     ██║   ██║██║  ██║█████╗   ╚███╔╝
  ██║     ██║   ██║██║  ██║██╔══╝   ██╔██╗
  ╚██████╗╚██████╔╝██████╔╝███████╗██╔╝ ██╗
   ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝`}</pre>
        <div className="text-[#888]">OpenAI Codex CLI</div>
        <div className="text-[#3b82f6] mt-2">&gt; <span className="text-white">Update landing page copy + sections</span></div>
        <div className="text-[#ccc] mt-2">Reframing hero, updating comparison, adding previews...</div>
        <div className="text-[#666]">Modified: agents-web/src/app/page.tsx</div>
      </div>
    );
  }

  if (agent === "gemini") {
    return (
      <div className="space-y-1">
        <pre className="text-[8px] leading-[1.1] mb-2">{`
`}<span className="text-[#60a5fa]">{`  ╲╱  `}</span><span className="text-[#f472b6]">{`██████╗ ███████╗███╗   ███╗██╗███╗   ██╗██╗`}</span>{`
`}<span className="text-[#60a5fa]">{` ╲  ╱ `}</span><span className="text-[#a78bfa]">{`██╔════╝ ██╔════╝████╗ ████║██║████╗  ██║██║`}</span>{`
`}<span className="text-[#fbbf24]">{`╲    ╱`}</span><span className="text-[#f472b6]">{`██║  ███╗█████╗  ██╔████╔██║██║██╔██╗ ██║██║`}</span>{`
`}<span className="text-[#fbbf24]">{` ╲  ╱ `}</span><span className="text-[#a78bfa]">{`██║   ██║██╔══╝  ██║╚██╔╝██║██║██║╚██╗██║██║`}</span>{`
`}<span className="text-[#60a5fa]">{`  ╲╱  `}</span><span className="text-[#60a5fa]">{`╚██████╔╝███████╗██║ ╚═╝ ██║██║██║ ╚████║██║`}</span>{`
`}<span className="text-[#60a5fa]">{`      `}</span><span className="text-[#f472b6]">{` ╚═════╝ ╚══════╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝`}</span></pre>
        <div className="text-[#888] text-[10px]">Gemini CLI 0.22.5</div>
        <div className="text-[#3b82f6] mt-2">&gt; <span className="text-white">Introduce API middleware pattern</span></div>
        <div className="text-[#ccc] mt-2">I&apos;ll move auth + logging into middleware layers...</div>
        <div className="text-[#666]">Created: src/middleware/auth.ts</div>
      </div>
    );
  }

  // cursor
  return (
    <div className="space-y-1">
      <pre className="text-[#8b5cf6] text-[10px] leading-tight mb-3">{`
   ██████╗██╗   ██╗██████╗ ███████╗ ██████╗ ██████╗
  ██╔════╝██║   ██║██╔══██╗██╔════╝██╔═══██╗██╔══██╗
  ██║     ██║   ██║██████╔╝███████╗██║   ██║██████╔╝
  ██║     ██║   ██║██╔══██╗╚════██║██║   ██║██╔══██╗
  ╚██████╗╚██████╔╝██║  ██║███████║╚██████╔╝██║  ██║
   ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝`}</pre>
      <div className="text-[#888]">Cursor Agent</div>
      <div className="text-[#3b82f6] mt-2">&gt; <span className="text-white">Write tests for the auth module</span></div>
      <div className="text-[#ccc] mt-2">Creating comprehensive test suite with edge cases...</div>
      <div className="text-[#666]">Created: src/__tests__/auth.test.ts</div>
    </div>
  );
}

function FilePreview({ file }: { file: FileTab }) {
  if (file === "README.md") {
    return (
      <div className="font-sans text-[11px] text-[#b7c7d2] space-y-3">
        <div className="text-[#d8e6ef] text-base font-semibold">Landing Page Updates</div>
        <p className="text-[#9ab0bf] leading-relaxed">
          Track the Swarmify rollout tasks and review progress in one place.
        </p>
        <div className="space-y-2">
          {[
            "Rewrite hero to focus on orchestration",
            "Add prompt library + markdown previews",
            "Align comparison table visuals",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded border border-[#335261] bg-transparent" />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-[#1b2a33] bg-[#0c171d] px-3 py-2">
          <div className="text-[#7aa2b6] uppercase text-[10px] tracking-wide mb-2">Notes</div>
          <ul className="space-y-1 text-[#b7c7d2]">
            <li>• Keep labels visible in tab titles</li>
            <li>• Start task from todos</li>
            <li>• Ship 3x faster message near top</li>
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
  onClick
}: {
  name: string;
  status: "M" | "A" | "D";
  active?: boolean;
  onClick?: () => void;
}) {
  const statusColor = status === 'M' ? 'text-[#f59e0b]' : status === 'A' ? 'text-[#22c55e]' : 'text-[#ef4444]';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between py-1 px-2 rounded text-left hover:bg-[#1a1a1a] ${
        active ? "bg-[#121a22]" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <FileIcon />
        <span className="text-[#ccc]">{name}</span>
      </div>
      <span className={`font-mono ${statusColor}`}>{status}</span>
    </button>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-[#888]">
      <path d="M3 2C3 1.44772 3.44772 1 4 1H9L13 5V14C13 14.5523 12.5523 15 12 15H4C3.44772 15 3 14.5523 3 14V2Z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M9 1V5H13" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}


function Line({ prompt, text, muted, highlight }: {
  prompt?: string;
  text: string;
  muted?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={`${muted ? 'text-[#555]' : highlight ? 'text-[#10b981]' : 'text-[#ccc]'}`}>
      {prompt && <span className="text-[#3b82f6] mr-2">{prompt}</span>}
      {text}
    </div>
  );
}

function TerminalIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[#888]">
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 9L10 12L6 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 15H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function IDEIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[#3b82f6]">
      <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M2 7H22" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M7 7V21" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="4.5" cy="5" r="0.75" fill="currentColor"/>
      <circle cx="6.5" cy="5" r="0.75" fill="currentColor"/>
      <circle cx="8.5" cy="5" r="0.75" fill="currentColor"/>
      <path d="M10 11L13 14L10 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M15 17H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function CompareItem({ children, negative }: { children: React.ReactNode; negative?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      {negative ? (
        <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#141a1f] text-[#7b8794]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M5 5L11 11M11 5L5 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </span>
      ) : (
        <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#102235] text-[#6fb4ff]">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M4.5 8.5L7 11L11.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      )}
      <span>{children}</span>
    </li>
  );
}

function StarIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={filled ? "text-[#fbbf24]" : "text-[#7aa2b6]"}>
      <path
        d="M12 3.5L14.7 9L20.8 9.8L16.4 14.1L17.6 20.2L12 17.2L6.4 20.2L7.6 14.1L3.2 9.8L9.3 9L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill={filled ? "currentColor" : "none"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[#7aa2b6]">
      <path d="M4 7H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M9 7V5H15V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M7 7L8 19H16L17 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[#7aa2b6]">
      <path d="M12 5V19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M5 12H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
