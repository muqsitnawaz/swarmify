import React, { useEffect, useMemo, useState } from 'react'
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
import {
  RunningCounts,
  TerminalDetail,
  TaskSummary,
  BuiltInAgentConfig,
  IconConfig,
  ApprovalStatus,
  AgentDetail,
} from '../../types'
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
  ['Cmd+Shift+B', 'New secondary agent'],
  ['Cmd+Shift+L', 'Label agent'],
  ['Cmd+Shift+G', 'Commit & push'],
  ['Cmd+Shift+C', 'Clear & restart'],
  ['Cmd+R', 'Next agent'],
  ['Cmd+E', 'Previous agent'],
  ["Cmd+Shift+'", 'Prompts'],
]

const PROMPT_PREVIEW_CHARS = 50

const AGENT_ROLE_HINTS: Record<string, { role: string; hint: string; bestFor: string }> = {
  claude: { role: 'lead', hint: 'Strategy and oversight', bestFor: 'Planning & orchestration' },
  codex: { role: 'fix', hint: 'Fast edits and refactors', bestFor: 'Fast fixes' },
  gemini: { role: 'research', hint: 'Deep research and options', bestFor: 'Research & exploration' },
  cursor: { role: 'trace', hint: 'Debugging and tracing', bestFor: 'Debugging traces' },
  opencode: { role: 'assist', hint: 'Editor-style assistance', bestFor: 'Lightweight edits' },
  shell: { role: 'shell', hint: 'Runs commands', bestFor: 'Command execution' },
}

const ROLE_OPTIONS = Array.from(new Set(Object.values(AGENT_ROLE_HINTS).map(info => info.role)))

const APPROVAL_BADGE_STYLES: Record<ApprovalStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-600 border border-amber-500/40',
  approved: 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/40',
  running: 'bg-emerald-500/20 text-emerald-700 border border-emerald-500/40',
  complete: 'bg-[var(--muted-foreground)]/15 text-[var(--muted-foreground)] border border-[var(--border)]',
  rejected: 'bg-red-500/15 text-red-600 border border-red-500/40',
}

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

function getRoleInfo(agentKey: string) {
  const key = agentKey?.toLowerCase() || ''
  return AGENT_ROLE_HINTS[key] || { role: 'agent', hint: 'Generalist support', bestFor: 'Balanced work' }
}

function deriveApprovalStatusFromTask(task: TaskSummary): ApprovalStatus {
  if (task.approval_status) return task.approval_status
  const statusLabel = getTaskSummaryStatus(task)
  if (statusLabel === 'running') return 'running'
  if (statusLabel === 'done') return 'complete'
  return 'pending'
}

function formatMixFromTask(task: TaskSummary): string {
  if (task.mix) return task.mix
  const counts: Record<string, number> = {}
  for (const agent of task.agents || []) {
    const key = (agent.agent_type || 'agent').toLowerCase()
    counts[key] = (counts[key] || 0) + 1
  }
  const total = Math.max(task.agent_count || 0, Object.values(counts).reduce((sum, val) => sum + val, 0))
  if (!total) return 'Mix not set'
  const parts = Object.entries(counts).map(([key, count]) => `${Math.round((count / total) * 100)}% ${getAgentDisplayName(key)}`)
  return parts.length ? parts.join(', ') : 'Mix not set'
}

function formatPlanReason(agent: AgentDetail): string {
  if (agent.prompt) return truncateText(agent.prompt, 120)
  if (agent.last_messages && agent.last_messages.length > 0) {
    return truncateText(agent.last_messages[agent.last_messages.length - 1], 120)
  }
  const info = getRoleInfo(agent.agent_type || 'agent')
  return `${getAgentDisplayName(agent.agent_type || 'agent')} selected for ${info.bestFor.toLowerCase()}.`
}

type HierarchyNode = {
  id: string
  label: string
  role: string
  hint: string
  isParent: boolean
  reasoning: string
}

function buildHierarchy(task: TaskSummary): HierarchyNode[] {
  const agents = task.agents || []
  if (!agents.length) return []
  const parent = agents.find(agent => (agent.agent_type || '').toLowerCase() === 'claude') || agents[0]
  const rest = agents.filter(agent => agent !== parent)

  const toNode = (agent: AgentDetail, isParent: boolean): HierarchyNode => {
    const info = getRoleInfo(agent.agent_type || 'agent')
    const name = getAgentDisplayName((agent.agent_type || '').toLowerCase() || 'agents')
    const suffix = agent.agent_id ? ` (${agent.agent_id})` : ''
    return {
      id: agent.agent_id,
      label: `${name}${suffix}`,
      role: info.role,
      hint: info.bestFor,
      isParent,
      reasoning: formatPlanReason(agent),
    }
  }

  return [toNode(parent, true), ...rest.map(agent => toNode(agent, false))]
}

function approvalLabel(status: ApprovalStatus): string {
  switch (status) {
    case 'approved':
      return 'Approved'
    case 'running':
      return 'Running'
    case 'complete':
      return 'Complete'
    case 'rejected':
      return 'Changes requested'
    default:
      return 'Pending Approval'
  }
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
  const [expandedSwarms, setExpandedSwarms] = useState<Set<string>>(new Set())
  const [approvalStates, setApprovalStates] = useState<Record<string, ApprovalStatus>>({})
  const [mixEdits, setMixEdits] = useState<Record<string, string>>({})
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [roleEdits, setRoleEdits] = useState<Record<string, Record<string, string>>>({})

  const toggleExpanded = (terminalId: string) => {
    setExpandedTerminalIds(prev => {
      const next = new Set(prev)
      if (next.has(terminalId)) next.delete(terminalId)
      else next.add(terminalId)
      return next
    })
  }

  const toggleSwarmHierarchy = (taskName: string) => {
    setExpandedSwarms(prev => {
      const next = new Set(prev)
      if (next.has(taskName)) next.delete(taskName)
      else next.add(taskName)
      return next
    })
  }

  useEffect(() => {
    setApprovalStates(prev => {
      const next = { ...prev }
      tasks.forEach(task => {
        if (!next[task.task_name]) {
          next[task.task_name] = deriveApprovalStatusFromTask(task)
        }
      })
      return next
    })

    setMixEdits(prev => {
      const next = { ...prev }
      tasks.forEach(task => {
        if (!next[task.task_name]) {
          next[task.task_name] = formatMixFromTask(task)
        }
      })
      return next
    })

    setRoleEdits(prev => {
      const next = { ...prev }
      tasks.forEach(task => {
        if (!next[task.task_name]) {
          const defaults: Record<string, string> = {}
          task.agents.forEach(agent => {
            const generatedKey = `${task.task_name}-${Object.keys(defaults).length}`
            const key = agent.agent_id || agent.agent_type || agent.prompt || agent.last_messages?.[0] || generatedKey
            defaults[key] = getRoleInfo(agent.agent_type || 'agent').role
          })
          next[task.task_name] = defaults
        }
      })
      return next
    })
  }, [tasks])

  const pendingApprovals = useMemo(
    () => tasks.filter(task => (approvalStates[task.task_name] || deriveApprovalStatusFromTask(task)) === 'pending'),
    [tasks, approvalStates]
  )

  const currentRunningTask = useMemo(
    () => tasks.find(task => getTaskSummaryStatus(task) === 'running'),
    [tasks]
  )

  const currentMix = currentRunningTask ? mixEdits[currentRunningTask.task_name] || formatMixFromTask(currentRunningTask) : null

  const handleApprove = (taskName: string) => {
    setApprovalStates(prev => ({ ...prev, [taskName]: 'approved' }))
    setEditingTask(null)
    postMessage({ type: 'approveSwarmPlan', taskName })
  }

  const handleReject = (taskName: string) => {
    setApprovalStates(prev => ({ ...prev, [taskName]: 'rejected' }))
    setEditingTask(taskName)
  }

  const handleApplyEdits = (taskName: string) => {
    const mix = mixEdits[taskName]
    const roles = roleEdits[taskName] || {}
    postMessage({ type: 'updateSwarmPlan', taskName, mix, roles })
    setApprovalStates(prev => ({ ...prev, [taskName]: 'pending' }))
    setEditingTask(null)
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
              <p className="text-sm font-semibold">Every swarm starts with `/swarm` in your IDE</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Describe your Mix of Agents with `/swarm`, install a CLI agent, and enable Swarm to see tasks here.
              </p>
            </div>
            <Button size="sm" onClick={onNavigateToSettings}>
              Configure
            </Button>
          </div>
        </section>
      )}

      <section className="px-4 py-4 rounded-xl bg-[var(--muted)] border border-[var(--border)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Describe your task, orchestrator assembles your Mix of Agents</p>
            <p className="text-xs text-[var(--muted-foreground)]">Plan → Approval → Execution. You stay in control at every step.</p>
          </div>
          {currentMix && (
            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[var(--background)] border border-[var(--border)]">
              Current mix: {currentMix}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
        <div className="flex items-center justify-between mb-2">
          <SectionHeader className="mb-0">Approval Queue</SectionHeader>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            Review and approve the distribution plan below
          </span>
        </div>
        {pendingApprovals.length === 0 ? (
          <div className="text-sm text-[var(--muted-foreground)]">All swarms are approved or running.</div>
        ) : (
          <div className="space-y-3">
            {pendingApprovals.map(task => {
              const mixValue = mixEdits[task.task_name] || formatMixFromTask(task)
              const hierarchy = buildHierarchy(task)
              const isEditing = editingTask === task.task_name
              const status = approvalStates[task.task_name] || 'pending'

              return (
                <div key={task.task_name} className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold break-words">{task.task_name}</div>
                      <div className="text-xs text-[var(--muted-foreground)]">Review and approve the distribution plan below</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-1 rounded-full ${APPROVAL_BADGE_STYLES[status]}`}>
                        {approvalLabel(status)}
                      </span>
                      <Button size="sm" onClick={() => handleApprove(task.task_name)} variant="secondary">
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleReject(task.task_name)}>
                        Request edits
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--background)] border border-[var(--border)]">
                      Mix of Agents: {mixValue}
                    </span>
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/30">
                      Pending Approval
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {hierarchy.map(node => (
                      <div
                        key={`${task.task_name}-${node.label}`}
                        className="flex items-start gap-3 px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)]"
                        style={{ marginLeft: node.isParent ? 0 : 16 }}
                        title={`${node.role} · ${node.hint}`}
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold">{node.label}</span>
                          <span className="text-[11px] text-[var(--muted-foreground)]">
                            {node.isParent ? 'Parent' : 'Child'} · {node.role} · {node.hint}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--foreground)] flex-1">{node.reasoning}</div>
                      </div>
                    ))}
                  </div>

                  {isEditing && (
                    <div className="mt-3 space-y-2">
                      <label className="text-xs font-medium text-[var(--foreground)]">Adjust mix before approval</label>
                      <input
                        value={mixValue}
                        onChange={(event) => setMixEdits(prev => ({ ...prev, [task.task_name]: event.target.value }))}
                        className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                        placeholder="70% Claude, 20% Codex, 10% Cursor"
                      />
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-[var(--foreground)]">Reassign roles</div>
                        {hierarchy.map(node => {
                          const roleKey = node.id || node.label
                          const value = roleEdits[task.task_name]?.[roleKey] || node.role
                          return (
                            <div key={`${task.task_name}-role-${roleKey}`} className="flex items-center gap-2">
                              <span className="text-xs w-36 truncate">{node.label}</span>
                              <select
                                value={value}
                                onChange={(event) => {
                                  setRoleEdits(prev => ({
                                    ...prev,
                                    [task.task_name]: { ...(prev[task.task_name] || {}), [roleKey]: event.target.value }
                                  }))
                                }}
                                className="text-xs rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                              >
                                {ROLE_OPTIONS.map(option => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => handleApplyEdits(task.task_name)}>Save mix</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingTask(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Running Now */}
      <section>
        <SectionHeader>Running Now</SectionHeader>
        <div className="flex flex-wrap gap-3">
          {builtInAgents.map(agent => {
            const count = runningCounts[agent.key as keyof typeof runningCounts] as number
            const isSelected = selectedAgentType === agent.key
            const roleInfo = getRoleInfo(agent.key)
            const inMix = currentMix ? currentMix.toLowerCase().includes(agent.name.toLowerCase()) : false
            return (
              <div
                key={agent.key}
                onClick={() => count > 0 && onAgentClick(agent.key)}
                className={`group flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-colors ${
                  isSelected
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'bg-[var(--muted)]'
                } ${inMix ? 'border border-[var(--primary)]/50' : ''} ${count > 0 ? 'cursor-pointer hover:bg-[var(--muted-foreground)]/10' : ''}`}
                title={`${agent.name} – ${roleInfo.bestFor}`}
              >
                <img src={getIcon(agent.icon, isLightTheme)} alt={agent.name} className="w-5 h-5" />
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-medium">{agent.name}</span>
                  <span className="text-[11px] text-[var(--muted-foreground)]">{roleInfo.bestFor}</span>
                </div>
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
            const roleInfo = getRoleInfo(name)
            return (
              <div
                key={name}
                onClick={() => count > 0 && onAgentClick(name)}
                className={`group flex items-center gap-2.5 px-4 py-2.5 rounded-xl transition-colors ${
                  isSelected
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'bg-[var(--muted)]'
                } ${count > 0 ? 'cursor-pointer hover:bg-[var(--muted-foreground)]/10' : ''}`}
                title={`${name} – ${roleInfo.bestFor}`}
              >
                <img src={icons.agents} alt={name} className="w-5 h-5" />
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-medium">{name}</span>
                  <span className="text-[11px] text-[var(--muted-foreground)]">{roleInfo.bestFor}</span>
                </div>
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
              const approvalStatus = (terminal.approvalStatus || 'pending') as ApprovalStatus
              const badgeStyle = APPROVAL_BADGE_STYLES[approvalStatus] || APPROVAL_BADGE_STYLES.pending
              const roleInfo = getRoleInfo(terminal.agentType)
              const isChild = Boolean(terminal.parentId && !terminal.isParent)

              return (
                <div
                  key={terminal.id}
                  onClick={() => toggleExpanded(terminal.id)}
                  className={`px-4 py-3 rounded-xl bg-[var(--muted)] transition-colors cursor-pointer hover:bg-[var(--muted-foreground)]/10 ${isChild ? 'ml-6' : ''}`}
                  title={terminal.isParent ? 'Parent terminal: Pending approval badge shown until execution starts' : `Child of ${terminal.parentLabel || 'parent'} · ${roleInfo.bestFor}`}
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={getIcon(icons[terminal.agentType as keyof typeof icons] || icons.agents, isLightTheme)}
                      alt={terminal.agentType}
                      className="w-5 h-5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        {agentName} # {terminal.index}
                        {displayLabel && (
                          <span className="text-[var(--muted-foreground)]"> - {displayLabel}</span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${badgeStyle}`}>
                          {approvalLabel(approvalStatus)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--muted-foreground)]">
                        {terminal.isParent ? 'Parent terminal · ' : 'Child terminal · '}
                        {roleInfo.role} · {roleInfo.bestFor}
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
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`px-2 py-0.5 rounded-full ${badgeStyle}`}>{approvalLabel(approvalStatus)}</span>
                        {terminal.isParent && terminal.children && terminal.children.length > 0 && (
                          <span className="text-[var(--muted-foreground)]">
                            Children: {terminal.children.length}
                          </span>
                        )}
                        {!terminal.isParent && terminal.parentLabel && (
                          <span className="text-[var(--muted-foreground)]">
                            Parent: {terminal.parentLabel}
                          </span>
                        )}
                      </div>
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
                  const approvalStatus = approvalStates[task.task_name] || deriveApprovalStatusFromTask(task)
                  const mixValue = mixEdits[task.task_name] || formatMixFromTask(task)
                  const hierarchy = buildHierarchy(task)
                  const isHierarchyOpen = expandedSwarms.has(task.task_name)

                  return (
                    <div key={task.task_name} className="rounded-xl bg-[var(--muted)] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium break-words">{task.task_name}</div>
                          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] flex-wrap">
                            <span>{formatAgentCount(task.agent_count)} · {statusLabel}</span>
                            <span className={`px-2 py-0.5 rounded-full ${APPROVAL_BADGE_STYLES[approvalStatus]}`}>
                              {approvalLabel(approvalStatus)}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-[var(--background)] border border-[var(--border)]">
                              Mix of Agents: {mixValue}
                            </span>
                          </div>
                        </div>
                        <div className="text-xs text-[var(--muted-foreground)] text-right shrink-0">
                          <div>{formatSessionTimestamp(latestTime)}</div>
                          <div>{formatTimeAgoSafe(latestTime)}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => toggleSwarmHierarchy(task.task_name)}>
                          {isHierarchyOpen ? 'Hide hierarchy' : 'Show hierarchy'}
                        </Button>
                        {approvalStatus === 'pending' && (
                          <Button size="sm" variant="secondary" onClick={() => handleApprove(task.task_name)}>
                            Approve plan
                          </Button>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {task.agents.map(agent => {
                          const agentKey = (agent.agent_type || '').toLowerCase()
                          const iconKey = (agentKey in icons ? agentKey : 'agents') as keyof typeof icons
                          const displayName = getAgentDisplayName(agentKey || 'agents')
                          const roleInfo = getRoleInfo(agentKey)
                          return (
                            <span
                              key={`${task.task_name}-${agent.agent_id}`}
                              className="inline-flex items-center gap-2 rounded-full bg-[var(--background)] px-2.5 py-1"
                              title={`${roleInfo.role} · ${roleInfo.bestFor}`}
                            >
                              <img
                                src={getIcon(icons[iconKey], isLightTheme)}
                                alt={agent.agent_type}
                                className="w-4 h-4"
                              />
                              <span className="flex flex-col leading-tight">
                                <span className="text-xs font-medium">{displayName}</span>
                                <span className="text-[10px] text-[var(--muted-foreground)]">{roleInfo.bestFor}</span>
                              </span>
                            </span>
                          )
                        })}
                      </div>
                      {isHierarchyOpen && hierarchy.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {hierarchy.map(node => (
                            <div
                              key={`${task.task_name}-${node.label}`}
                              className="flex items-start gap-3 px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)]"
                              style={{ marginLeft: node.isParent ? 0 : 16 }}
                              title={node.reasoning}
                            >
                              <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--muted-foreground)]/10">
                                {node.role}
                              </span>
                              <div className="min-w-0">
                                <div className="text-sm font-medium">{node.label}</div>
                                <div className="text-[11px] text-[var(--muted-foreground)]">{node.hint}</div>
                              </div>
                              <div className="text-xs text-[var(--foreground)] flex-1">{node.reasoning}</div>
                            </div>
                          ))}
                        </div>
                      )}
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
