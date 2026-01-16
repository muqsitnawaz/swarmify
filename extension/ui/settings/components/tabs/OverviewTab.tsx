import React from 'react'
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

interface OverviewTabProps {
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
  icons: IconConfig
  isLightTheme: boolean
  onAgentClick: (agentKey: string) => void
  onCloseAgentTerminals: () => void
  onNavigateToSettings: () => void
  onRefreshTasks: () => void
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

export function OverviewTab({
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
  icons,
  isLightTheme,
  onAgentClick,
  onCloseAgentTerminals,
  onNavigateToSettings,
  onRefreshTasks,
}: OverviewTabProps) {
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
                  onClick={(e) => {
                    e.stopPropagation()
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
                  onClick={(e) => {
                    e.stopPropagation()
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
            <SectionHeader className="mb-0">{getAgentDisplayName(selectedAgentType)} Agents</SectionHeader>
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
            <div className="space-y-2">
              {agentTerminals.map(terminal => {
                const displayLabel = terminal.label || terminal.autoLabel || terminal.lastUserMessage
                const agentName = getAgentDisplayName(terminal.agentType)
                const sessionId = terminal.sessionId || ''
                const tasksForSession = sessionId ? sessionTasks[sessionId] : undefined
                const isSessionLoading = sessionId ? sessionTasksLoading[sessionId] : false

                return (
                  <div key={terminal.id} className="px-4 py-3 rounded-xl bg-[var(--muted)]">
                    <div className="flex items-center gap-3">
                      <img
                        src={getIcon(icons[terminal.agentType as keyof typeof icons] || icons.agents, isLightTheme)}
                        alt={terminal.agentType}
                        className="w-5 h-5"
                      />
                      <span className="text-sm font-medium truncate flex-1 min-w-0">
                        {agentName} # {terminal.index}
                        {displayLabel && (
                          <span className="text-[var(--muted-foreground)]"> - {displayLabel}</span>
                        )}
                        {terminal.messageCount !== undefined && terminal.messageCount > 0 && (
                          <span className="text-[var(--muted-foreground)]"> ({terminal.messageCount})</span>
                        )}
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)] shrink-0">
                        {formatTimeSince(terminal.createdAt)}
                      </span>
                    </div>

                    <div className="mt-2 ml-7 space-y-1 text-xs text-[var(--muted-foreground)]">
                      <div className="font-mono">
                        Session: {sessionId || 'unavailable'}
                      </div>
                      {isSessionLoading ? (
                        <div>Loading tasks...</div>
                      ) : tasksForSession && tasksForSession.length > 0 ? (
                        tasksForSession.map(task => {
                          const statusLabel = getTaskSummaryStatus(task)
                          return (
                            <div key={task.task_name} className="flex items-center gap-2">
                              <span className="text-[var(--muted-foreground)]">{'>'}</span>
                              <span className="font-mono text-[var(--foreground)]">{task.task_name}</span>
                              <span className="text-[var(--muted-foreground)]">
                                {formatAgentCount(task.agent_count)} {statusLabel}
                              </span>
                            </div>
                          )
                        })
                      ) : (
                        <div>(no swarm tasks)</div>
                      )}
                    </div>
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
          <div className="rounded-xl bg-[var(--muted)] overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--muted-foreground)] border-b border-[var(--border)]">
                <tr>
                  <th className="px-4 py-3 w-56">Task</th>
                  <th className="px-4 py-3 w-56">Agents</th>
                  <th className="px-4 py-3 w-48">Latest Activity</th>
                  <th className="px-4 py-3 w-32">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {[...tasks]
                  .sort((a, b) => new Date(b.latest_activity).getTime() - new Date(a.latest_activity).getTime())
                  .map(task => {
                    const statusLabel = getTaskSummaryStatus(task)
                    const latestAgent = task.agents[0]
                    const latestTime = latestAgent?.completed_at || latestAgent?.started_at || task.latest_activity

                    return (
                      <tr key={task.task_name} className="border-b border-[var(--border)] last:border-b-0 align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium break-words">{task.task_name}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
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
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                          <div>{formatSessionTimestamp(latestTime)}</div>
                          <div>{formatTimeAgoSafe(latestTime)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-medium capitalize">{statusLabel}</div>
                          <div className="text-xs text-[var(--muted-foreground)]">
                            {formatAgentCount(task.agent_count)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--muted-foreground)] space-y-1">
                          {task.agents.map(agent => (
                            <div key={`${task.task_name}-${agent.agent_id}-detail`} className="flex items-center gap-2">
                              <span className="w-16 shrink-0">{agent.agent_id}</span>
                              <span className="capitalize">{agent.status}</span>
                              {agent.duration && (
                                <span className="text-[var(--muted-foreground)]">· {agent.duration}</span>
                              )}
                              {agent.cwd && (
                                <span className="truncate">· {agent.cwd}</span>
                              )}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
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
