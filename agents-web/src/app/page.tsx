"use client";

import { useState } from "react";

type AgentType = "claude" | "codex" | "gemini" | "cursor";

const agents: { id: AgentType; name: string; logo: string }[] = [
  { id: "claude", name: "Claude", logo: "/claude.png" },
  { id: "codex", name: "Codex", logo: "/codex.png" },
  { id: "gemini", name: "Gemini", logo: "/gemini.png" },
  { id: "cursor", name: "Cursor", logo: "/cursor.png" },
];

export default function Home() {
  const [activeAgent, setActiveAgent] = useState<AgentType>("claude");

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
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
            Run multiple agents.
            <br />
            <span className="text-[#888]">Review their work in your IDE.</span>
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
                onClick={() => setActiveAgent(agent.id)}
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
        <div className="animate-fade-in-delay-2 glow rounded-xl overflow-hidden border border-[#222]">
          <EditorMockup activeAgent={activeAgent} setActiveAgent={setActiveAgent} />
        </div>
      </section>

      {/* Taskable Markdown (live in agents-ext) */}
      <section className="px-6 py-20 border-t border-[#1a1a1a] bg-[#070707]">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-[#111] border border-[#222] text-[#67e8f9]">
              New in agents-ext
            </span>
            <span className="text-sm text-[#888]">Rendered markdown, checkable todos, one-click tasks, tab labels.</span>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#67e8f9]/20 to-[#3b82f6]/20 flex items-center justify-center">
                  <span className="text-[#67e8f9] font-semibold text-lg">MD</span>
                </div>
                <div>
                  <h3 className="font-semibold text-white">Clean markdown view</h3>
                  <p className="text-xs text-[#888]">Notion-like rendering for agent output.</p>
                </div>
              </div>
              <ul className="text-sm text-[#ccc] space-y-2">
                <li>• Bold, lists, tables render like a doc—not raw syntax.</li>
                <li>• Todos render with native checkboxes; state reflects the file.</li>
                <li>• If a box is empty in the file, it stays empty until you change it.</li>
              </ul>
            </div>
            <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#22c55e]/20 to-[#0ea5e9]/20 flex items-center justify-center">
                  <span className="text-[#22c55e] font-semibold text-lg">⚡</span>
                </div>
                <div>
                  <h3 className="font-semibold text-white">Turn todos into tasks</h3>
                  <p className="text-xs text-[#888]">Hover a checkbox → “Start task” launches an agent with the todo text.</p>
                </div>
              </div>
              <ul className="text-sm text-[#ccc] space-y-2">
                <li>• Pulls todo text + nearby context so agents know the job.</li>
                <li>• Add a label once—tab titles update: <code>logo Codex — &lt;your label&gt;</code>.</li>
                <li>• No hidden metadata; file stays plain markdown.</li>
              </ul>
            </div>
          </div>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1a1a]">
                  <th className="text-left py-4 px-4 text-[#888] font-medium"></th>
                  <th className="text-left py-4 px-4 text-[#888] font-medium">CLI Agents</th>
                  <th className="text-left py-4 px-4 text-[#888] font-medium">IDE-native Agents</th>
                  <th className="text-left py-4 px-4 font-medium text-white">Swarmify</th>
                </tr>
              </thead>
              <tbody className="text-[#ccc]">
                <tr className="border-b border-[#1a1a1a]">
                  <td className="py-4 px-4 text-[#888]">Strength</td>
                  <td className="py-4 px-4">Powerful, flexible, scriptable</td>
                  <td className="py-4 px-4">Visual, integrated</td>
                  <td className="py-4 px-4 text-white">Both</td>
                </tr>
                <tr className="border-b border-[#1a1a1a]">
                  <td className="py-4 px-4 text-[#888]">At scale</td>
                  <td className="py-4 px-4">tmux panes, mental overhead</td>
                  <td className="py-4 px-4">Often single-agent per window</td>
                  <td className="py-4 px-4 text-white">Multiple agents as editor tabs</td>
                </tr>
                <tr className="border-b border-[#1a1a1a]">
                  <td className="py-4 px-4 text-[#888]">Labeling</td>
                  <td className="py-4 px-4">Escape sequences, fragile</td>
                  <td className="py-4 px-4">Varies by tool</td>
                  <td className="py-4 px-4 text-white">Name agents by task</td>
                </tr>
                <tr className="border-b border-[#1a1a1a]">
                  <td className="py-4 px-4 text-[#888]">Markdown output</td>
                  <td className="py-4 px-4">Raw tags in terminal</td>
                  <td className="py-4 px-4">Varies by tool</td>
                  <td className="py-4 px-4 text-white">Rendered like Notion</td>
                </tr>
                <tr>
                  <td className="py-4 px-4 text-[#888]">Diff review</td>
                  <td className="py-4 px-4">Scrolling stdout</td>
                  <td className="py-4 px-4">Native diff panels</td>
                  <td className="py-4 px-4 text-white">Native diffs as agents work</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
              <h3 className="text-lg font-semibold mb-2">Run multiple agents—not one at a time</h3>
              <p className="text-[#888] text-sm leading-relaxed">
                Your editor already handles 30 tabs. Now agents live there. Spawn agents for auth, tests, docs—all running, all visible.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
              <h3 className="text-lg font-semibold mb-2">Review diffs as agents work</h3>
              <p className="text-[#888] text-sm leading-relaxed">
                Native syntax highlighting. Inline diff view. Catch mistakes before they land—no scrolling through terminal output.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
              <h3 className="text-lg font-semibold mb-2">Label each agent by task</h3>
              <p className="text-[#888] text-sm leading-relaxed">
                &apos;auth-refactor&apos;, &apos;payment-tests&apos;, &apos;docs-update&apos;—know what&apos;s running at a glance. tmux makes this painful. Tabs make it obvious.
              </p>
            </div>
            <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
              <h3 className="text-lg font-semibold mb-2">Agent-generated docs, readable in your editor</h3>
              <p className="text-[#888] text-sm leading-relaxed">
                CLI agents output .md files with raw tags and broken tables. Swarmify renders them Notion-style—no squinting at ## or |---|---|.
              </p>
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
              <span className="text-[#ccc]">Spawn agents in tabs</span>
            </div>
            <div className="hidden md:block text-[#333]">→</div>
            <div className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-[#222] flex items-center justify-center text-xs">3</span>
              <span className="text-[#888]">(Optional) Enable Swarm mode for agent-to-agent delegation</span>
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
            <div className="p-6 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
              <div className="flex items-center gap-3 mb-6">
                <TerminalIcon />
                <h3 className="text-lg font-semibold">Terminal CLI</h3>
              </div>
              <ul className="space-y-4 text-[#888] text-sm">
                <CompareItem negative>Small panel at the bottom of your screen</CompareItem>
                <CompareItem negative>Can&apos;t see git changes as agent edits files</CompareItem>
                <CompareItem negative>One agent at a time, sequential work</CompareItem>
                <CompareItem negative>Tmux splits still can&apos;t show images or previews</CompareItem>
                <CompareItem negative>Context switch to browser for frontend</CompareItem>
                <CompareItem negative>Scroll through raw markdown output</CompareItem>
              </ul>
            </div>
            {/* IDE Column */}
            <div className="p-6 rounded-xl border border-[#3b82f6]/50 bg-[#0a0a0a]">
              <div className="flex items-center gap-3 mb-6">
                <IDEIcon />
                <h3 className="text-lg font-semibold">VS Code / Cursor</h3>
              </div>
              <ul className="space-y-4 text-[#ccc] text-sm">
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
            What you can do
          </h2>
          <p className="text-[#888] text-center mb-12 max-w-2xl mx-auto">
            Agents work in parallel. You review the results.
          </p>
          <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <UseCase
              title="Parallel PR review"
              description="One agent reviews logic, another checks tests, a third scans for security issues."
            />
            <UseCase
              title="Write tests while you implement"
              description="Code in one tab, spawn an agent to write tests in another. Both run simultaneously."
            />
            <UseCase
              title="Refactor + docs in parallel"
              description="One agent refactors the module, another updates the documentation to match."
            />
            <UseCase
              title="Multi-file feature work"
              description="Distribute frontend, backend, and tests across agents. Merge when ready."
            />
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

function UseCase({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-5 rounded-xl bg-[#0a0a0a] border border-[#1a1a1a]">
      <h3 className="font-medium mb-1">{title}</h3>
      <p className="text-[#888] text-sm">{description}</p>
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
  setActiveAgent
}: {
  activeAgent: AgentType;
  setActiveAgent: (agent: AgentType) => void;
}) {
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
          my-project - Cursor
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 px-2 pt-2 bg-[#111] overflow-x-auto">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setActiveAgent(agent.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs transition-colors ${
              activeAgent === agent.id
                ? "bg-[#0d0d0d] text-white"
                : "bg-[#161616] text-[#888] hover:text-white"
            }`}
          >
            <img src={agent.logo} alt={agent.name} width={16} height={16} className="rounded-sm" />
            <span className="font-medium">{agent.name}</span>
          </button>
        ))}
        <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs bg-[#161616] text-[#888]">
          <FileIcon />
          <span className="font-mono">auth.ts</span>
        </div>
      </div>

      {/* Split Content: Terminal + Git Panel */}
      <div className="flex min-h-[340px]">
        {/* Terminal */}
        <div className="flex-1 p-5 font-mono text-xs leading-relaxed border-r border-[#1a1a1a] overflow-hidden">
          <AgentContent agent={activeAgent} />
        </div>

        {/* Git Changes Panel */}
        <div className="w-56 bg-[#0a0a0a] p-3 text-xs shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#888] uppercase tracking-wide text-[10px]">Changes</span>
            <span className="bg-[#3b82f6] text-white px-1.5 py-0.5 rounded text-[10px]">3</span>
          </div>
          <div className="space-y-1">
            <GitFile name="auth.ts" status="M" />
            <GitFile name="middleware.ts" status="M" />
            <GitFile name="types.ts" status="A" />
          </div>
          <div className="mt-4 pt-3 border-t border-[#1a1a1a]">
            <div className="text-[#888] uppercase tracking-wide text-[10px] mb-2">Diff Preview</div>
            <div className="font-mono text-[10px] space-y-0.5">
              <div className="text-[#f87171]">- if (token) {"{"}</div>
              <div className="text-[#4ade80]">+ if (token && !isExpired(token)) {"{"}</div>
              <div className="text-[#888]">    return decode(token);</div>
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
        <div className="text-[#3b82f6]">&gt; <span className="text-white">Fix the authentication bug in src/auth.ts</span></div>
        <div className="text-[#ccc] mt-3">I&apos;ll analyze the authentication module and fix the issue.</div>
        <div className="text-[#ccc] mt-2">Found the problem - the JWT token validation is missing</div>
        <div className="text-[#ccc]">the expiry check. Let me fix that...</div>
        <div className="text-[#666] mt-3">Reading: src/auth.ts</div>
        <div className="text-[#666]">Editing: src/auth.ts</div>
        <div className="text-[#4ade80] mt-3">Done. The token now properly validates expiry.</div>
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
        <div className="text-[#3b82f6] mt-2">&gt; <span className="text-white">Add input validation to the login form</span></div>
        <div className="text-[#ccc] mt-2">Adding email format validation and password strength check...</div>
        <div className="text-[#666]">Modified: src/components/LoginForm.tsx</div>
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
        <div className="text-[#3b82f6] mt-2">&gt; <span className="text-white">Refactor the API routes to use middleware</span></div>
        <div className="text-[#ccc] mt-2">I&apos;ll create a middleware pattern for authentication...</div>
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


function GitFile({ name, status }: { name: string; status: 'M' | 'A' | 'D' }) {
  const statusColor = status === 'M' ? 'text-[#f59e0b]' : status === 'A' ? 'text-[#22c55e]' : 'text-[#ef4444]';
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-[#1a1a1a]">
      <div className="flex items-center gap-2">
        <FileIcon />
        <span className="text-[#ccc]">{name}</span>
      </div>
      <span className={`font-mono ${statusColor}`}>{status}</span>
    </div>
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
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0 text-[#666]">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M6 6L10 10M10 6L6 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0 text-[#3b82f6]">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5.5 8L7 9.5L10.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
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
