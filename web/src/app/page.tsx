"use client";

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="relative px-6 pt-20 pb-32 max-w-5xl mx-auto">
        <div className="animate-fade-in">
          <p className="text-[#888] text-sm tracking-wide uppercase mb-4">
            VS Code Extension
          </p>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6">
            AI Agents
            <br />
            <span className="text-[#888]">in your editor</span>
          </h1>
          <p className="text-xl text-[#888] max-w-xl mb-10">
            Run Claude, Codex, Gemini, and Cursor as editor tabs.
            <br />
            Stop context-switching. Ship faster.
          </p>
        </div>

        {/* Install command */}
        <div className="animate-fade-in-delay-1 flex flex-wrap gap-4 mb-16">
          <a
            href="https://marketplace.visualstudio.com/items?itemName=muqsitnawaz.swarm-ext"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
          >
            Install Extension
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
          <div className="flex items-center gap-3 px-5 py-3 bg-[#111] border border-[#222] rounded-lg font-mono text-sm">
            <span className="text-[#888]">$</span>
            <code>bunx agent-swarm</code>
            <button
              onClick={() => navigator.clipboard.writeText("bunx agent-swarm")}
              className="text-[#888] hover:text-white transition-colors"
              title="Copy"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M3 11V3H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Editor mockup */}
        <div className="animate-fade-in-delay-2 glow rounded-xl overflow-hidden border border-[#222]">
          <EditorMockup />
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-16 text-center animate-fade-in">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <Feature
              title="Agents as Tabs"
              description="Each AI agent runs in its own editor tab. See your code and agents side by side."
            />
            <Feature
              title="Swarm Mode"
              description="Let agents spawn sub-agents. Get second opinions or run parallel tasks from one session."
            />
            <Feature
              title="Any Agent"
              description="Built-in support for Claude, Codex, Gemini, Cursor. Add custom agents with a 2-letter code."
            />
          </div>
        </div>
      </section>

      {/* Shortcuts */}
      <section className="px-6 py-24 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold mb-4 text-center">
            Keyboard-first
          </h2>
          <p className="text-[#888] text-center mb-12">
            Everything is one shortcut away
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
            Ready to ship faster?
          </h2>
          <p className="text-xl text-[#888] mb-10">
            Install from VS Code Marketplace or run the MCP server directly.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="https://marketplace.visualstudio.com/items?itemName=muqsitnawaz.swarm-ext"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              Install Extension
            </a>
            <a
              href="https://github.com/muqsitnawaz/swarm"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 border border-[#333] rounded-lg hover:border-[#555] transition-colors"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-[#1a1a1a]">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-[#888]">
          <div>
            Swarmify
          </div>
          <div className="flex gap-6">
            <a href="https://github.com/muqsitnawaz/swarm" className="hover:text-white transition-colors">
              GitHub
            </a>
            <a href="https://marketplace.visualstudio.com/items?itemName=muqsitnawaz.swarm-ext" className="hover:text-white transition-colors">
              VS Code
            </a>
            <a href="https://www.npmjs.com/package/agent-swarm" className="hover:text-white transition-colors">
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

function Shortcut({ keys, action }: { keys: string; action: string }) {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-[#111] border border-[#1a1a1a]">
      <span className="text-[#888]">{action}</span>
      <kbd className="px-2 py-1 bg-[#1a1a1a] rounded text-xs font-mono">{keys}</kbd>
    </div>
  );
}

function EditorMockup() {
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
          my-project
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 px-2 pt-2 bg-[#111] overflow-x-auto">
        <Tab name="CC" label="Claude" color="#f97316" active />
        <Tab name="CX" label="Codex" color="#10b981" />
        <Tab name="GX" label="Gemini" color="#3b82f6" />
        <Tab name="CR" label="Cursor" color="#8b5cf6" />
        <Tab name="index.ts" isFile />
      </div>

      {/* Content */}
      <div className="p-6 font-mono text-sm leading-relaxed min-h-[300px]">
        <div className="text-[#888] mb-4">Claude Code</div>
        <div className="space-y-2">
          <Line prompt=">" text="Fix the authentication bug in src/auth.ts" />
          <Line text="" />
          <Line text="I'll analyze the authentication module and fix the issue." />
          <Line text="" />
          <Line text="Found the problem - the JWT token validation is missing" />
          <Line text="the expiry check. Let me fix that..." />
          <Line text="" />
          <Line text="Reading: src/auth.ts" muted />
          <Line text="Editing: src/auth.ts" muted />
          <Line text="" />
          <Line text="Done. The token now properly validates expiry." highlight />
        </div>
      </div>
    </div>
  );
}

function Tab({ name, label, color, active, isFile }: {
  name: string;
  label?: string;
  color?: string;
  active?: boolean;
  isFile?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg text-xs ${
      active ? 'bg-[#0d0d0d] text-white' : 'bg-[#161616] text-[#888] hover:text-white'
    } transition-colors cursor-pointer`}>
      {color && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />}
      <span className="font-mono">{name}</span>
      {label && <span className="text-[#666]">{label}</span>}
    </div>
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
