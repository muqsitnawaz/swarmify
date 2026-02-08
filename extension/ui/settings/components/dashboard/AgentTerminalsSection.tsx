import React from 'react'
import { IconConfig, TaskSummary, TerminalDetail } from '../../types'
import { getAgentDisplayName, getIcon, formatActualTime } from '../../utils'
import { SectionHeader } from '../common'
import { getFilesChangedCount, getTerminalPrompt, truncateMiddle, truncateText } from './helpers'

interface AgentTerminalsSectionProps {
  selectedAgentType: string | null
  agentTerminals: TerminalDetail[]
  agentTerminalsLoading: boolean
  sessionTasks: Record<string, TaskSummary[]>
  expandedTerminalIds: Set<string>
  icons: IconConfig
  isLightTheme: boolean
  onCloseAgentTerminals: () => void
  onToggleExpanded: (terminalId: string) => void
}

export function AgentTerminalsSection({
  selectedAgentType,
  agentTerminals,
  agentTerminalsLoading,
  sessionTasks,
  expandedTerminalIds,
  icons,
  isLightTheme,
  onCloseAgentTerminals,
  onToggleExpanded,
}: AgentTerminalsSectionProps) {
  if (!selectedAgentType) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <SectionHeader className="mb-0">
          {getAgentDisplayName(selectedAgentType)} Terminals ({agentTerminals.length})
        </SectionHeader>
        <button
          onClick={onCloseAgentTerminals}
          className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          Close
        </button>
      </div>
      {agentTerminalsLoading ? (
        <div className="text-sm text-[var(--muted-foreground)] py-4">Loading...</div>
      ) : agentTerminals.length === 0 ? (
        <div className="text-sm text-[var(--muted-foreground)] py-4">
          No terminals found for {getAgentDisplayName(selectedAgentType)}.
        </div>
      ) : (
        <div className="space-y-3">
          {agentTerminals.map(terminal => {
            const displayLabel = terminal.label || terminal.autoLabel
            const agentName = getAgentDisplayName(terminal.agentType)
            const prompt = getTerminalPrompt(terminal)
            const hasMessages = terminal.messageCount && terminal.messageCount > 0
            const currentActivity = terminal.currentActivity || (hasMessages ? 'Working...' : 'Waiting for input')
            const activityLine = currentActivity.startsWith('>') ? currentActivity : `> ${currentActivity}`
            const isExpanded = expandedTerminalIds.has(terminal.id)
            const sessionId = terminal.sessionId || ''
            const filesChanged = getFilesChangedCount(sessionTasks[sessionId])
            const status = terminal.status || (hasMessages ? 'running' : 'idle')

            return (
              <div
                key={terminal.id}
                onClick={() => onToggleExpanded(terminal.id)}
                className="px-4 py-3 rounded-xl bg-[var(--muted)] transition-colors cursor-pointer hover:bg-[var(--muted-foreground)]/10"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={getIcon(icons[terminal.agentType as keyof typeof icons] || icons.agents, isLightTheme)}
                    alt={terminal.agentType}
                    className="w-5 h-5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {displayLabel || `${agentName} ${terminal.index}`}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        status === 'running' ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/40' :
                        status === 'completed' ? 'bg-[var(--muted-foreground)]/15 text-[var(--muted-foreground)] border border-[var(--border)]' :
                        'bg-amber-500/15 text-amber-600 border border-amber-500/40'
                      }`}>
                        {status === 'running' ? 'Running' : status === 'completed' ? 'Done' : 'Idle'}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--muted-foreground)] truncate">
                      {truncateText(prompt, 80)}
                    </div>
                  </div>
                  <span className="text-xs text-[var(--muted-foreground)] shrink-0">
                    {formatActualTime(terminal.firstMessageTimestamp)}
                  </span>
                </div>

                <div className="mt-2 ml-8 text-xs font-mono text-[var(--foreground)]">
                  {activityLine}
                </div>

                {isExpanded && (
                  <div className="mt-3 ml-8 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-3 space-y-2">
                    <div className="text-xs text-[var(--muted-foreground)]">Full prompt</div>
                    <div className="text-sm text-[var(--foreground)] whitespace-pre-wrap">{prompt}</div>
                    <div className="grid gap-1 text-xs text-[var(--muted-foreground)]">
                      <div>Session: {sessionId ? truncateMiddle(sessionId, 6, 6) : 'not started'}</div>
                      <div>Messages: {terminal.messageCount ?? 0}</div>
                      {filesChanged !== null && filesChanged > 0 && (
                        <div>Files changed: {filesChanged}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
