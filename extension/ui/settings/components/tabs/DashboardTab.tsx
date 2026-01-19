import React, { useState } from 'react'
import { Button } from '../ui/button'
import { SectionHeader } from '../common'
import {
  getIcon,
  formatTimeSince,
  getTaskSummaryStatus,
  formatAgentCount,
  getAgentDisplayName,
  formatSessionTimestamp,
  formatTimeAgoSafe,
} from '../../utils'
import { RunningCounts, TerminalDetail, TaskSummary, BuiltInAgentConfig, IconConfig } from '../../types'
import { postMessage } from '../../hooks'

interface DashboardTabProps {
  showIntegrationCallout: boolean
  runningCounts: RunningCounts
  builtInAgents: BuiltInAgentConfig[]
  selectedAgentType: string | null
  agentTerminals: TerminalDetail[]
  agentTerminalsLoading: boolean
  sessionTasks: Record<string, TaskSummary[]>
  sessionTasksLoading: Record<string, boolean>
  tasks: TaskSummary[]
  tasksLoading: boolean
  tasksDisplayCount: number
  icons: IconConfig
  isLightTheme: boolean
  onAgentClick: (agentKey: string) => void
  onCloseAgentTerminals: () => void
  onNavigateToSettings: () => void
  onRefreshTasks: () => void
  onLoadMoreTasks: () => void
}

const SHORTCUTS = [
  ['Cmd+Shift+A', 'New agent'],
  ['Cmd+Shift+L', 'Label agent'],
  ['Cmd+Shift+G', 'Commit & push'],
  ['Cmd+Shift+C', 'Clear & restart'],
  ['Cmd+R', 'Next agent'],
  ['Cmd+E', 'Previous agent'],
  ["Cmd+Shift+'", 'Prompts'],
]

const PROMPT_PREVIEW_CHARS = 50

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars).trim()}...`
}

function truncateMiddle(value: string, headChars: number, tailChars: number): string {
  if (value.length <= headChars + tailChars + 3) return value
  return `${value.slice(0, headChars)}...${value.slice(-tailChars)}`
}

function getTerminalPrompt(terminal: TerminalDetail): string {
  const raw = terminal.lastUserMessage || terminal.label || terminal.autoLabel || ''
  return raw.trim() || 'No prompt available.'
}

function getFilesChangedCount(tasksForSession?: TaskSummary[]): number | null {
  if (!tasksForSession || tasksForSession.length === 0) return null
  const uniqueFiles = new Set<string>()
  for (const task of tasksForSession) {
    for (const agent of task.agents) {
      for (const file of agent.files_created || []) uniqueFiles.add(file)
      for (const file of agent.files_modified || []) uniqueFiles.add(file)
      for (const file of agent.files_deleted || []) uniqueFiles.add(file)
    }
  }
  return uniqueFiles.size
}

export function DashboardTab({
  showIntegrationCallout,
  runningCounts,
  builtInAgents,
  selectedAgentType,
  agentTerminals,
  agentTerminalsLoading,
  sessionTasks,
  sessionTasksLoading,
  tasks,
  tasksLoading,
  tasksDisplayCount,
  icons,
  isLightTheme,
  onAgentClick,
  onCloseAgentTerminals,
  onNavigateToSettings,
  onRefreshTasks,
  onLoadMoreTasks,
}: DashboardTabProps) {
  const [expandedTerminalIds, setExpandedTerminalIds] = useState<Set<string>>(new Set())

  const toggleExpanded = (terminalId: string) => {
    setExpandedTerminalIds(prev => {
      const next = new Set(prev)
      if (next.has(terminalId)) next.delete(terminalId)
      else next.add(terminalId)
      return next
    })
  }

  return (
    <div className="space-y-8">
      {showIntegrationCallout && (
        <section className="px-4 py-3 rounded-xl bg-[var(--muted)] border border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--background)]">
              <img src={icons.agents} alt="Agents" className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Swarm Integration</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Install a CLI agent and enable Swarm to see tasks here.
              </p>
            </div>
            <Button size="sm" onClick={onNavigateToSettings}>
              Configure
            </Button>
          </div>
        </section>
      )}

      {/* Running Now */}
      <section>
        <SectionHeader>Running Now</SectionHeader>
        <div className="flex flex-wrap gap-3">
          {builtInAgents.map(agent => {
            const count = runningCounts[agent.key as keyof typeof runningCounts] as number
            const isSelected = selectedAgentType === agent.key
            return (
              <div
                key={agent.key}
                onClick={() => count > 0 && onAgentClick(agent.key)}
                className={`group flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-colors ${
                  isSelected
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'bg-[var(--muted)]'
                } ${count > 0 ? 'cursor-pointer hover:bg-[var(--muted-foreground)]/10' : ''}`}
              >
                <img src={getIcon(agent.icon, isLightTheme)} alt={agent.name} className="w-5 h-5" />
                <span className="text-sm font-medium">{agent.name}</span>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    postMessage({ type: 'spawnAgent', agentKey: agent.key })
                  }}
                  className={`w-6 text-center text-base font-semibold tabular-nums transition-colors ${isSelected ? '' : 'text-[var(--foreground)]'} hover:text-[var(--primary)]`}
                >
                  <span className="group-hover:hidden">{count}</span>
                  <span className="hidden group-hover:inline">+</span>
                </button>
              </div>
            )
          })}
          {Object.entries(runningCounts.custom).map(([name, count]) => {
            const isSelected = selectedAgentType === name
            return (
              <div
                key={name}
                onClick={() => count > 0 && onAgentClick(name)}
                className={`group flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-colors ${
                  isSelected
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'bg-[var(--muted)]'
                } ${count > 0 ? 'cursor-pointer hover:bg-[var(--muted-foreground)]/10' : ''}`}
              >
                <img src={icons.agents} alt={name} className="w-5 h-5" />
                <span className="text-sm font-medium">{name}</span>
                <button
                  onClick={(event) => {
                    event.stopPropagation()
                    postMessage({ type: 'spawnAgent', agentKey: name, isCustom: true })
                  }}
                  className={`w-6 text-center text-base font-semibold tabular-nums transition-colors ${isSelected ? '' : 'text-[var(--foreground)]'} hover:text-[var(--primary)]`}
                >
                  <span className="group-hover:hidden">{count}</span>
                  <span className="hidden group-hover:inline">+</span>
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {/* Agent Terminals */}
      {selectedAgentType && (
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
              const currentActivity = terminal.currentActivity || 'Thinking...'
              const activityLine = currentActivity.startsWith('>') ? currentActivity : `> ${currentActivity}`
              const isExpanded = expandedTerminalIds.has(terminal.id)
              const sessionId = terminal.sessionId || ''
              const filesChanged = getFilesChangedCount(sessionTasks[sessionId])

              return (
                <div
                  key={terminal.id}
                  onClick={() => toggleExpanded(terminal.id)}
                  className="px-4 py-3 rounded-xl bg-[var(--muted)] transition-colors cursor-pointer hover:bg-[var(--muted-foreground)]/10"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={getIcon(icons[terminal.agentType as keyof typeof icons] || icons.agents, isLightTheme)}
                      alt={terminal.agentType}
                      className="w-5 h-5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {agentName} # {terminal.index}
                        {displayLabel && (
                          <span className="text-[var(--muted-foreground)]"> - {displayLabel}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-[var(--muted-foreground)] shrink-0">
                      {formatTimeSince(terminal.createdAt)}
                    </span>
                  </div>

                  <div className="mt-2 ml-8 text-xs text-[var(--muted-foreground)]">
                    {truncateText(prompt, PROMPT_PREVIEW_CHARS)}
                  </div>

                  <div className="mt-1 ml-8 text-xs font-mono text-[var(--foreground)]">
                    {activityLine}
                  </div>

                  {isExpanded && (
                    <div className="mt-3 ml-8 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-3 space-y-2">
                      <div className="text-xs text-[var(--muted-foreground)]">Full prompt</div>
                      <div className="text-sm text-[var(--foreground)] whitespace-pre-wrap">{prompt}</div>
                      <div className="grid gap-1 text-xs text-[var(--muted-foreground)]">
                        <div>
                          Session ID: {sessionId ? truncateMiddle(sessionId, 6, 6) : 'unavailable'}
                        </div>
                        <div>Messages: {terminal.messageCount ?? 0}</div>
                        <div>Files changed: {filesChanged === null ? 'unknown' : filesChanged}</div>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled
                          onClick={(event) => {
                            event.stopPropagation()
                          }}
                        >
                          Focus Terminal
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled
                          onClick={(event) => {
                            event.stopPropagation()
                          }}
                        >
                          Open Session Log
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          )}
        </section>
      )}

      {/* Recent Swarms */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <SectionHeader className="mb-0">Recent Swarms</SectionHeader>
          <Button variant="ghost" size="sm" onClick={onRefreshTasks} disabled={tasksLoading}>
            Refresh
          </Button>
        </div>
        {tasksLoading && tasks.length === 0 ? (
          <div className="text-center py-8 text-[var(--muted-foreground)]">Loading swarms...</div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-8 text-[var(--muted-foreground)]">No recent swarms found.</div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {[...tasks]
                .sort((a, b) => new Date(b.latest_activity).getTime() - new Date(a.latest_activity).getTime())
                .slice(0, tasksDisplayCount)
                .map(task => {
                  const statusLabel = getTaskSummaryStatus(task)
                  const latestAgent = task.agents[0]
                  // Use started_at as primary timestamp (completed_at data is unreliable)
                  const latestTime = latestAgent?.started_at || task.latest_activity

                  return (
                    <div key={task.task_name} className="rounded-xl bg-[var(--muted)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium break-words">{task.task_name}</div>
                          <div className="text-xs text-[var(--muted-foreground)]">
                            {formatAgentCount(task.agent_count)} · {statusLabel}
                          </div>
                        </div>
                        <div className="text-xs text-[var(--muted-foreground)] text-right shrink-0">
                          <div>{formatSessionTimestamp(latestTime)}</div>
                          <div>{formatTimeAgoSafe(latestTime)}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {task.agents.map(agent => {
                          const agentKey = (agent.agent_type || '').toLowerCase()
                          const iconKey = (agentKey in icons ? agentKey : 'agents') as keyof typeof icons
                          const displayName = getAgentDisplayName(agentKey || 'agents')
                          return (
                            <span
                              key={`${task.task_name}-${agent.agent_id}`}
                              className="inline-flex items-center gap-2 rounded-full bg-[var(--background)] px-2.5 py-1"
                            >
                              <img
                                src={getIcon(icons[iconKey], isLightTheme)}
                                alt={agent.agent_type}
                                className="w-4 h-4"
                              />
                              <span className="text-xs font-medium">{displayName}</span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
            </div>
            {tasks.length > tasksDisplayCount && (
              <Button
                variant="outline"
                className="w-full mt-3"
                onClick={onLoadMoreTasks}
              >
                Load More ({tasks.length - tasksDisplayCount} remaining)
              </Button>
            )}
          </>
        )}
      </section>

      {/* Shortcuts */}
      <section>
        <SectionHeader>Shortcuts</SectionHeader>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex items-center gap-4">
              <kbd className="px-2 py-1 rounded bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] font-mono text-xs min-w-[120px] text-center">
                {keys}
              </kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
