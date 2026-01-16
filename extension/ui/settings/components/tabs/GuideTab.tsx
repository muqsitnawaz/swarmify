import React from 'react'
import { ExternalLink } from 'lucide-react'
import { SectionHeader } from '../common'

const QUICK_START_STEPS = [
  'Cmd+Shift+A to spawn an agent',
  'Type your request in the terminal',
  'Cmd+R / Cmd+E to switch agents',
  '/swarm in Claude for parallel agents',
  "Cmd+Shift+' for saved prompts",
]

export function GuideTab() {
  return (
    <div className="space-y-6">
      <section>
        <SectionHeader>Quick Start</SectionHeader>
        <div className="space-y-2">
          {QUICK_START_STEPS.map((step, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)]">
              <span className="text-sm font-semibold text-[var(--primary)] w-4">{index + 1}</span>
              <span className="text-sm">{step}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader>Learn More</SectionHeader>
        <div className="space-y-2">
          <a
            href="https://github.com/muqsitnawaz/swarmify"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--muted)] hover:bg-[var(--muted-foreground)]/10 transition-colors"
          >
            <ExternalLink className="w-4 h-4 text-[var(--muted-foreground)]" />
            <span className="text-sm">GitHub</span>
          </a>
        </div>
      </section>
    </div>
  )
}
