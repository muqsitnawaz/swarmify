import React from 'react'

export type AgentId = 'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor' | 'shell'

const BG: Record<AgentId, string> = {
  claude: 'var(--claude)',
  codex: 'var(--codex)',
  gemini: 'var(--gemini)',
  opencode: 'var(--opencode)',
  cursor: 'var(--cursor)',
  shell: 'var(--shell)',
}

const LETTER: Record<AgentId, string> = {
  claude: 'C',
  codex: 'X',
  gemini: 'G',
  opencode: 'O',
  cursor: 'K',
  shell: '$',
}

export function AgentAvatar({ id, size = 18, title }: {
  id: AgentId | string
  size?: 14 | 16 | 18 | 20 | 24 | 28
  title?: string
}) {
  const normalized = (id.toLowerCase() as AgentId)
  const bg = BG[normalized] ?? 'var(--ds-text-dim)'
  const letter = LETTER[normalized] ?? id.slice(0, 1).toUpperCase()
  return (
    <span
      className={`sw-avatar sz-${size}`}
      style={{ background: bg }}
      title={title ?? id}
    >
      {letter}
    </span>
  )
}

export function agentIdFromPrefix(prefix: string | null | undefined): AgentId | null {
  switch (prefix) {
    case 'CC': return 'claude'
    case 'CX': return 'codex'
    case 'GX': return 'gemini'
    case 'OC': return 'opencode'
    case 'CR': return 'cursor'
    case 'SH': return 'shell'
    default: return null
  }
}

export function agentShortChunk(sessionId: string | null | undefined): string {
  if (!sessionId) return ''
  return sessionId.replace(/-/g, '').slice(0, 8)
}
