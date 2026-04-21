import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { TaskSummary, TerminalDetail as TerminalInfo, AgentDetail, UnifiedTask } from '../../types'
import { AgentAvatar, agentShortChunk } from './AgentAvatar'
import { Icon } from './icons'
import { relTime, taskNameToTitle, swarmOverallStatus, shortDuration } from './types'
import { postMessage } from '../../hooks'

const NEW_AGENT_MENU: Array<{ agent: string; name: string; abbr: string; keys: string[] }> = [
  { agent: 'claude', name: 'Claude', abbr: 'CC', keys: ['Cmd', 'Shift', 'A'] },
  { agent: 'codex', name: 'Codex', abbr: 'CX', keys: ['Cmd', 'Shift', 'B'] },
  { agent: 'gemini', name: 'Gemini', abbr: 'GX', keys: ['Cmd', 'Shift', 'X'] },
  { agent: 'opencode', name: 'OpenCode', abbr: 'OC', keys: ['Cmd', 'Shift', 'M'] },
  { agent: 'cursor', name: 'Cursor', abbr: 'CR', keys: ['Cmd', 'Shift', 'U'] },
]

type FilterTab = 'all' | 'terminal' | 'cloud' | 'team'

type FactoryTaskType = 'plan' | 'implement' | 'test' | 'review' | 'bugfix' | 'docs'

interface UnifiedAgent {
  kind: 'terminal' | 'headless' | 'cloud' | 'team'
  id: string
  agentType: string
  displayName: string
  activity: string
  active: boolean
  duration: string
  timestamp: string
  prUrl?: string | null
  cloudProvider?: string | null
  terminal?: TerminalInfo
  swarm?: TaskSummary
  agent?: AgentDetail
  teamAgents?: AgentDetail[]
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'idle'
  files: string[]
  toolCalls: number
  linearIssue?: string | null
  mode?: string
  // Factory metadata surfaced as badges in the UI
  taskType?: FactoryTaskType | null
  teammateName?: string | null
  /** For team rows, a roll-up count of task-types across members. */
  taskTypeCounts?: Partial<Record<FactoryTaskType, number>>
}

function taskTypeColor(type: FactoryTaskType): string {
  switch (type) {
    case 'plan': return '#8b5cf6'     // violet
    case 'implement': return '#3b82f6' // blue
    case 'test': return '#10b981'     // green
    case 'review': return '#f59e0b'   // amber
    case 'bugfix': return '#ef4444'   // red
    case 'docs': return '#6b7280'     // gray
  }
}

function buildUnifiedList(terminals: TerminalInfo[], tasks: TaskSummary[]): UnifiedAgent[] {
  const items: UnifiedAgent[] = []

  for (const t of terminals) {
    const chunk = agentShortChunk(t.sessionId) || (t.id ?? '').slice(-8)
    const isActive = t.status === 'running' || !!t.currentActivity
    const files: string[] = []
    if (t.recentFiles) files.push(...t.recentFiles.slice(0, 5))
    items.push({
      kind: 'terminal',
      id: `term-${t.id}`,
      agentType: t.agentType,
      displayName: `${t.agentType}-${chunk}`,
      activity: t.currentActivity || t.label || (t.status === 'idle' ? 'idle' : t.role ?? 'terminal'),
      active: isActive,
      duration: t.firstMessageTimestamp ? relTime(t.firstMessageTimestamp) : '',
      timestamp: t.lastActivityTimestamp || new Date(t.createdAt).toISOString(),
      terminal: t,
      status: isActive ? 'running' : 'idle',
      files,
      toolCalls: t.quickSummary?.toolCalls ?? 0,
      mode: t.role || 'edit',
    })
  }

  for (const task of tasks) {
    const isTeam = task.agents.length > 1
    const isActive = task.status_counts.running > 0

    if (isTeam) {
      const status = swarmOverallStatus(task)
      const pr = task.agents.map((a) => a.pr_url).find(Boolean)
      const dur = task.agents.map((a) => a.duration).find(Boolean)
      const allFiles = task.agents.flatMap((a) => [...(a.files_created || []), ...(a.files_modified || [])]).slice(0, 6)
      const totalTools = task.agents.reduce((s, a) => s + (a.bash_commands?.length || 0), 0)
      const linear = task.agents.map((a) => a.linear_issue).find(Boolean)
      const taskTypeCounts: Partial<Record<FactoryTaskType, number>> = {}
      for (const a of task.agents) {
        const tt = a.task_type as FactoryTaskType | null | undefined
        if (tt) taskTypeCounts[tt] = (taskTypeCounts[tt] ?? 0) + 1
      }
      items.push({
        kind: 'team',
        id: `team-${task.task_name}`,
        agentType: task.agents[0]?.agent_type ?? 'claude',
        displayName: taskNameToTitle(task.task_name),
        activity: `${task.agent_count} agents`,
        active: isActive,
        duration: dur || '',
        timestamp: task.latest_activity,
        prUrl: pr,
        swarm: task,
        teamAgents: task.agents,
        status: status === 'merged' ? 'completed' : status === 'running' ? 'running' : status === 'failed' ? 'failed' : 'idle',
        files: allFiles,
        toolCalls: totalTools,
        linearIssue: linear,
        taskTypeCounts,
      })
    } else if (task.agents.length === 1) {
      const a = task.agents[0]
      const isCloud = a.mode === 'cloud' || !!a.cloud_provider
      const lastCmd = a.bash_commands?.[a.bash_commands.length - 1]
      const lastFile = a.files_modified?.[a.files_modified.length - 1]
      const lastMsg = a.last_messages?.[a.last_messages.length - 1]
      const promptFirstLine = a.prompt?.split('\n')[0]?.slice(0, 120) || ''
      const activity = isCloud
        ? (promptFirstLine || 'cloud run')
        : (lastCmd ? `$ ${lastCmd}` : lastFile ? `Editing ${lastFile}` : lastMsg ? lastMsg.slice(0, 120) : promptFirstLine || 'working...')
      const allFiles = [...(a.files_created || []), ...(a.files_modified || [])].slice(0, 6)
      items.push({
        kind: isCloud ? 'cloud' : 'headless',
        id: `agent-${a.agent_id}`,
        agentType: a.agent_type,
        displayName: isCloud
          ? `${a.agent_type}-${a.agent_id.slice(0, 8)}`
          : taskNameToTitle(task.task_name),
        activity,
        active: a.status === 'running',
        duration: a.duration || '',
        timestamp: a.started_at,
        prUrl: a.pr_url,
        cloudProvider: a.cloud_provider,
        agent: a,
        swarm: task,
        status: a.status as UnifiedAgent['status'],
        files: allFiles,
        toolCalls: a.bash_commands?.length || 0,
        linearIssue: a.linear_issue,
        mode: a.mode,
        taskType: (a.task_type as FactoryTaskType | null | undefined) ?? null,
        teammateName: a.name ?? null,
      })
    }
  }

  items.sort((a, b) => {
    if (a.active && !b.active) return -1
    if (!a.active && b.active) return 1
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  })

  return items
}

function agentAbbr(type: string): string {
  const map: Record<string, string> = { claude: 'CC', codex: 'CX', gemini: 'GX', opencode: 'OC', cursor: 'CR' }
  return map[type.toLowerCase()] || type.slice(0, 2).toUpperCase()
}

function modeLabel(item: UnifiedAgent): string {
  if (item.mode === 'cloud') return 'cloud'
  if (item.kind === 'team') return 'team'
  if (item.kind === 'cloud') return 'cloud'
  return item.mode || 'edit'
}

// Throughput counter -- live pulsing sparkline for LLM output tok/s
function ThroughputCounter({ tokensPerSec }: { tokensPerSec: number }) {
  const BAR_COUNT = 24
  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(0))
  const [displayValue, setDisplayValue] = useState(tokensPerSec)

  useEffect(() => {
    if (tokensPerSec <= 0) {
      setBars(Array(BAR_COUNT).fill(0))
      setDisplayValue(0)
      return
    }

    const nextBar = () => {
      const variance = 0.5 + Math.random() * 1.0
      return Math.max(2, Math.min(22, (tokensPerSec * variance) / 70))
    }

    const tick = () => {
      setBars(prev => {
        const next = prev.slice(1)
        next.push(nextBar())
        return next
      })
      setDisplayValue(prev => {
        const target = tokensPerSec * (0.88 + Math.random() * 0.24)
        return Math.round(prev * 0.55 + target * 0.45)
      })
    }

    tick()
    const id = setInterval(tick, 140)
    return () => clearInterval(id)
  }, [tokensPerSec])

  return (
    <div className="sw-throughput" title="LLM output tokens per second (estimated)">
      <div className="sw-throughput-sparkline">
        {bars.map((h, i) => (
          <div key={i} className="sw-spark-bar" style={{ height: h }} />
        ))}
      </div>
      <div className="sw-throughput-value">{displayValue}</div>
      <div className="sw-throughput-unit">
        <span className="sw-throughput-label">tok/s</span>
        <span className="sw-throughput-sub">throughput</span>
      </div>
    </div>
  )
}

// Short PR label from a GitHub URL: https://github.com/org/repo/pull/123 → org/repo#123
function shortPrLabel(url: string): string {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i)
  if (m) return `${m[1]}/${m[2]}#${m[3]}`
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname}`
  } catch {
    return url
  }
}

interface PrPopoverItem {
  key: string
  title: string
  url: string
  agentType: string
  timestamp: string
}

function PrPopover({
  title,
  prs,
  onOpen,
}: {
  title: string
  prs: PrPopoverItem[]
  onOpen: (url: string) => void
}) {
  return (
    <div className="sw-floor-pr-popover" role="menu">
      <div className="sw-floor-pr-popover-head">{title}</div>
      {prs.length === 0 ? (
        <div className="sw-floor-pr-popover-empty">No PRs</div>
      ) : (
        <div className="sw-floor-pr-popover-list">
          {prs.map((pr) => (
            <button
              key={pr.key}
              type="button"
              className="sw-floor-pr-popover-row"
              onClick={() => onOpen(pr.url)}
            >
              <AgentAvatar id={pr.agentType} size={16} />
              <span className="sw-floor-pr-popover-title">{pr.title}</span>
              <span className="sw-floor-pr-popover-num">{shortPrLabel(pr.url)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// VU meter segments
function VuMeter({ value, max }: { value: number; max: number }) {
  const segments = 8
  const filled = Math.round((value / Math.max(max, 1)) * segments)
  return (
    <div className="sw-strip-vu">
      {Array.from({ length: segments }, (_, i) => {
        const h = 4 + ((i + 1) / segments) * 16
        let cls = ''
        if (i < filled) {
          if (i >= segments - 2) cls = 'on-red'
          else if (i >= segments - 4) cls = 'on-amber'
          else cls = 'on-green'
        }
        return <div key={i} className={`sw-vu-seg ${cls}`} style={{ height: h }} />
      })}
    </div>
  )
}

interface UnifiedAgentsPaneProps {
  terminals: TerminalInfo[]
  tasks: TaskSummary[]
  tasksLoading: boolean
  unifiedTasks: UnifiedTask[]
  unifiedTasksLoading: boolean
  onDispatch: () => void
  onNavigate?: (tab: 'floor' | 'bench' | 'panel') => void
}

export function UnifiedAgentsPane({ terminals, tasks, tasksLoading, unifiedTasks, unifiedTasksLoading, onDispatch, onNavigate }: UnifiedAgentsPaneProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [prPopover, setPrPopover] = useState<'shipped' | 'open' | null>(null)
  const [dispatchOpen, setDispatchOpen] = useState(false)
  const newMenuRef = useRef<HTMLDivElement>(null)
  const prPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!newMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) setNewMenuOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [newMenuOpen])

  useEffect(() => {
    if (!prPopover) return
    const handler = (e: MouseEvent) => {
      if (prPopoverRef.current && !prPopoverRef.current.contains(e.target as Node)) setPrPopover(null)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [prPopover])

  const items = useMemo(() => buildUnifiedList(terminals, tasks), [terminals, tasks])
  const activeItems = useMemo(() => items.filter((i) => i.active), [items])
  const recentItems = useMemo(() => items.filter((i) => !i.active), [items])

  // Queue: urgent/high tasks that are todo
  const queueTasks = useMemo(() =>
    unifiedTasks
      .filter((t) => t.status === 'todo' && (t.priority === 'urgent' || t.priority === 'high'))
      .slice(0, 4),
    [unifiedTasks]
  )

  // Intake queue: cloud teammates that a cloud provider flagged as
  // 'input_required'. Surface one banner per team; submit pipes through to
  // `agents factory answer <team> <text>` in the VS Code backend.
  const intakeTeams = useMemo(() => {
    const byTeam = new Map<string, { teammate: string; agentId: string }[]>()
    for (const t of tasks) {
      for (const a of t.agents) {
        if (a.status !== 'input_required') continue
        const existing = byTeam.get(t.task_name) ?? []
        existing.push({ teammate: a.name ?? a.agent_id.slice(0, 8), agentId: a.agent_id })
        byTeam.set(t.task_name, existing)
      }
    }
    return Array.from(byTeam.entries()).map(([team, agents]) => ({ team, agents }))
  }, [tasks])

  // Gauge metrics
  const totalFiles = useMemo(() => {
    const fileSet = new Set<string>()
    for (const item of items) {
      for (const f of item.files) fileSet.add(f.split('/').pop() || f)
    }
    return fileSet.size
  }, [items])

  const openPRs = useMemo(
    () =>
      items
        .filter((i) => i.prUrl)
        .map((i) => ({
          key: i.id,
          title: i.displayName,
          url: i.prUrl as string,
          agentType: i.agentType,
          timestamp: i.timestamp,
        })),
    [items]
  )
  const totalPRs = openPRs.length

  // PRs shipped today: agents with pr_url that completed today.
  const shippedPRs = useMemo(() => {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const startMs = startOfDay.getTime()
    const out: Array<{ key: string; title: string; url: string; agentType: string; timestamp: string }> = []
    for (const task of tasks) {
      for (const a of task.agents) {
        if (!a.pr_url) continue
        if (a.status !== 'completed') continue
        if (!a.completed_at) continue
        if (new Date(a.completed_at).getTime() < startMs) continue
        out.push({
          key: `shipped-${a.agent_id}`,
          title: taskNameToTitle(task.task_name),
          url: a.pr_url,
          agentType: a.agent_type,
          timestamp: a.completed_at,
        })
      }
    }
    return out
  }, [tasks])
  const prsShippedToday = shippedPRs.length

  // Files touched today: unique files across agents that had activity today.
  const filesTouchedToday = useMemo(() => {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const startMs = startOfDay.getTime()
    const set = new Set<string>()
    for (const task of tasks) {
      for (const a of task.agents) {
        const ts = a.completed_at || a.started_at
        if (!ts) continue
        if (new Date(ts).getTime() < startMs) continue
        for (const f of a.files_created || []) set.add(f)
        for (const f of a.files_modified || []) set.add(f)
      }
    }
    return set.size
  }, [tasks])

  const backlogRemaining = useMemo(() => {
    const todoCount = unifiedTasks.filter((t) => t.status === 'todo').length
    return Math.max(0, todoCount - queueTasks.length)
  }, [unifiedTasks, queueTasks.length])

  // Estimated LLM output tok/s based on active agent count.
  // TODO: replace with real session parsing (output tokens delta / sec rolling window).
  const estimatedThroughput = useMemo(() => {
    const activeCount = activeItems.length
    if (activeCount === 0) return 0
    return Math.round(activeCount * 280)
  }, [activeItems.length])

  const handleNewAgent = (agent: string) => {
    const commands: Record<string, string> = {
      claude: 'agents.newClaude',
      codex: 'agents.newCodex',
      gemini: 'agents.newGemini',
      opencode: 'agents.newOpencode',
      cursor: 'agents.newCursor',
    }
    postMessage({ type: 'executeCommand', command: commands[agent] })
  }

  const handleFocusTerminal = (t: TerminalInfo) => {
    postMessage({ type: 'focusTerminal', terminalId: t.id })
  }

  const handleRetry = (taskName: string) => {
    postMessage({ type: 'retrySwarm', taskName })
  }

  const handleKill = (taskName: string) => {
    postMessage({ type: 'killSwarm', taskName })
  }

  const handleDispatchTask = (task: UnifiedTask, agentType: string, target: 'local' | 'cloud' = 'local') => {
    postMessage({
      type: 'dispatchTask',
      taskId: task.id,
      agentType,
      target,
      title: task.title,
      description: task.description || '',
      identifier: task.metadata.identifier || '',
    })
  }

  return (
    <div className="sw-floor-dashboard">
      {/* Header */}
      <div className="sw-floor-header">
        <div className="sw-floor-title">Factory Floor</div>
        <div className="sw-floor-header-right">
          <div className="sw-floor-stat-bar" ref={prPopoverRef}>
            <span><b>{activeItems.length}</b> running</span>
            <span className="sw-stat-sep">·</span>
            <span><b>{queueTasks.length}</b> next up</span>
            <span className="sw-stat-sep">·</span>
            <span title="Unique files touched by agents today"><b>{filesTouchedToday}</b> files today</span>
            <span className="sw-stat-sep">·</span>
            <button
              type="button"
              className={`sw-floor-stat-btn${prPopover === 'shipped' ? ' active' : ''}`}
              title="PRs shipped today (completed with pr_url)"
              disabled={prsShippedToday === 0}
              onClick={() => setPrPopover(prPopover === 'shipped' ? null : 'shipped')}
            >
              <b>{prsShippedToday}</b> PRs shipped
            </button>
            <span className="sw-stat-sep">·</span>
            <button
              type="button"
              className={`sw-floor-stat-btn${prPopover === 'open' ? ' active' : ''}`}
              title="Open PRs across all active and recent agents"
              disabled={totalPRs === 0}
              onClick={() => setPrPopover(prPopover === 'open' ? null : 'open')}
            >
              <b>{totalPRs}</b> PRs open
            </button>
            {backlogRemaining > 0 && (
              <>
                <span className="sw-stat-sep">·</span>
                <button
                  type="button"
                  className="sw-floor-stat-btn"
                  title="Open the Bench tab to see all tasks"
                  onClick={() => onNavigate?.('bench')}
                >
                  {backlogRemaining} more on Bench
                </button>
              </>
            )}
            {prPopover && (
              <PrPopover
                title={prPopover === 'shipped' ? 'Shipped today' : 'Open PRs'}
                prs={prPopover === 'shipped' ? shippedPRs : openPRs}
                onOpen={(url) => {
                  postMessage({ type: 'openExternal', url })
                  setPrPopover(null)
                }}
              />
            )}
          </div>
          {activeItems.length > 0 && <ThroughputCounter tokensPerSec={estimatedThroughput} />}
        </div>
      </div>

      {/* Intake Q&A -- teammates waiting on a human answer */}
      {intakeTeams.length > 0 && (
        <div className="sw-intake-section">
          {intakeTeams.map((team) => (
            <IntakeBanner key={team.team} team={team.team} teammates={team.agents} />
          ))}
        </div>
      )}

      {/* Next Up -- scheduled / urgent tasks about to run */}
      {queueTasks.length > 0 && (
        <div className="sw-queue-section">
          <div className="sw-section-header-row">
            <span className="sw-section-label">Next Up</span>
            <span className="sw-section-count-pill">{queueTasks.length}</span>
            <span className="sw-section-line" />
          </div>

          <div className="sw-queue-cards">
            {queueTasks.map((task) => (
              <DispatchCard key={task.id} task={task} onDispatch={handleDispatchTask} />
            ))}
          </div>
        </div>
      )}

      {/* Active Agents */}
      {(activeItems.length > 0 || tasksLoading) && (
        <>
          <div className="sw-section-header-row">
            <span className="sw-section-label">Active</span>
            <span className="sw-section-count-pill">{activeItems.length}</span>
            <span className="sw-section-line" />
            <div style={{ position: 'relative' }} ref={newMenuRef}>
              <button className="sw-btn secondary sm" onClick={() => setNewMenuOpen((o) => !o)}>
                <Icon name="plus" size={11} />
                New
              </button>
              {newMenuOpen && (
                <div className="sw-menu">
                  {NEW_AGENT_MENU.map((m) => (
                    <button
                      key={m.agent}
                      className="sw-menu-item"
                      onClick={() => { setNewMenuOpen(false); handleNewAgent(m.agent) }}
                    >
                      <AgentAvatar id={m.agent} size={16} />
                      <span>{m.name}</span>
                      <span className="spacer" />
                      <span className="kbd-group">
                        {m.keys.map((k) => (
                          <span key={k} className="kbd kbd-inline">{k}</span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="sw-btn primary sm" onClick={() => setDispatchOpen(true)}>
              <Icon name="dispatch" size={11} />
              Dispatch
            </button>
          </div>

          <div className="sw-agent-strips">
            {activeItems.map((item) => (
              <AgentStrip key={item.id} item={item} onFocus={handleFocusTerminal} onKill={handleKill} />
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {items.length === 0 && !tasksLoading && queueTasks.length === 0 && (
        <div className="sw-empty" style={{ marginTop: 40 }}>
          <Icon name="zap" size={20} />
          <div className="sw-empty-title">No agents running</div>
          <div className="sw-empty-sub">
            Press{' '}
            <span className="kbd-group" style={{ display: 'inline-flex' }}>
              <span className="kbd kbd-inline">Cmd</span>
              <span className="kbd kbd-inline">Shift</span>
              <span className="kbd kbd-inline">A</span>
            </span>{' '}
            to open Claude, or dispatch a team.
          </div>
        </div>
      )}

      {/* Recent Agents -- collapsed by default */}
      {recentItems.length > 0 && (
        <>
          <button
            className="sw-section-header-row sw-section-toggle"
            onClick={() => setRecentOpen((o) => !o)}
            aria-expanded={recentOpen}
          >
            <Icon name="chevD" size={11} style={{ transform: recentOpen ? undefined : 'rotate(-90deg)', transition: 'transform 120ms ease' }} />
            <span className="sw-section-label">Recent</span>
            <span className="sw-section-count-pill">{recentItems.length}</span>
            <span className="sw-section-line" />
          </button>

          {recentOpen && (
            <div className="sw-agent-strips">
              {recentItems.slice(0, 5).map((item) => (
                <AgentStrip key={item.id} item={item} dimmed onFocus={handleFocusTerminal} onRetry={handleRetry} />
              ))}
            </div>
          )}
        </>
      )}

      {dispatchOpen && (
        <DispatchModal
          tasks={unifiedTasks}
          loading={unifiedTasksLoading}
          onClose={() => setDispatchOpen(false)}
          onDispatch={(task, agentType, target) => {
            handleDispatchTask(task, agentType, target)
          }}
          onDispatchBatch={(tasksToDispatch, agentType, target) => {
            tasksToDispatch.forEach((task, idx) => {
              setTimeout(() => handleDispatchTask(task, agentType, target), idx * 120)
            })
          }}
          onComplete={() => setDispatchOpen(false)}
        />
      )}
    </div>
  )
}

// In-webview dispatch modal -- replaces VS Code's native quick pick.
// Supports single-row dispatch and multi-select batch dispatch.
function DispatchModal({ tasks, loading, onClose, onDispatch, onDispatchBatch, onComplete }: {
  tasks: UnifiedTask[]
  loading: boolean
  onClose: () => void
  onDispatch: (task: UnifiedTask, agentType: string, target: 'local' | 'cloud') => void
  onDispatchBatch: (tasks: UnifiedTask[], agentType: string, target: 'local' | 'cloud') => void
  onComplete: () => void
}) {
  const [query, setQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent' | 'high'>('all')
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const [target, setTarget] = useState<'local' | 'cloud'>('local')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const todoTasks = useMemo(
    () => tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress'),
    [tasks]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return todoTasks.filter((t) => {
      if (priorityFilter === 'urgent' && t.priority !== 'urgent') return false
      if (priorityFilter === 'high' && t.priority !== 'high' && t.priority !== 'urgent') return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        (t.metadata.identifier || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      )
    })
  }, [todoTasks, query, priorityFilter])

  const focusedTask = filtered.find((t) => t.id === focusedTaskId) || filtered[0]
  const batchMode = checkedIds.size > 0

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      for (const t of filtered) next.add(t.id)
      return next
    })
  }

  const clearSelection = () => setCheckedIds(new Set())

  const handleSingleDispatch = (agentType: string) => {
    if (!focusedTask) return
    onDispatch(focusedTask, agentType, target)
    onComplete()
  }

  const handleBatchDispatch = (agentType: string) => {
    const picked = filtered.filter((t) => checkedIds.has(t.id))
    if (picked.length === 0) return
    onDispatchBatch(picked, agentType, target)
    onComplete()
  }

  const agentButtons = [
    { id: 'claude', abbr: 'CC' },
    { id: 'codex', abbr: 'CX' },
    { id: 'gemini', abbr: 'GX' },
  ]

  return (
    <div className="sw-dispatch-modal-overlay" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="sw-dispatch-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sw-dispatch-modal-head">
          <span className="sw-dispatch-modal-title">
            {batchMode ? `Dispatch ${checkedIds.size} tasks` : 'Dispatch a task'}
          </span>
          <span className="sw-dispatch-modal-sub">{filtered.length} of {todoTasks.length} tasks</span>
          <button className="sw-dispatch-modal-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="sw-dispatch-modal-search">
          <Icon name="search" size={13} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search tasks..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="sw-dispatch-modal-filters">
            {(['all', 'urgent', 'high'] as const).map((p) => (
              <button
                key={p}
                className={`sw-dispatch-modal-filter ${priorityFilter === p ? 'active' : ''}`}
                onClick={() => setPriorityFilter(p)}
              >
                {p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {filtered.length > 0 && (
          <div className="sw-dispatch-modal-bulkbar">
            <button className="sw-dispatch-modal-bulk-link" onClick={selectAllVisible}>
              Select all visible
            </button>
            {checkedIds.size > 0 && (
              <>
                <span className="sw-stat-sep">·</span>
                <button className="sw-dispatch-modal-bulk-link" onClick={clearSelection}>
                  Clear ({checkedIds.size})
                </button>
              </>
            )}
          </div>
        )}
        <div className="sw-dispatch-modal-body">
          {loading ? (
            <div className="sw-dispatch-modal-empty">Loading tasks...</div>
          ) : filtered.length === 0 ? (
            <div className="sw-dispatch-modal-empty">
              {todoTasks.length === 0 ? 'No open tasks. Add one in Linear or the Bench tab.' : 'No tasks match your search.'}
            </div>
          ) : (
            <ul className="sw-dispatch-modal-list">
              {filtered.map((task) => {
                const pcls = task.priority === 'urgent' ? 'urgent' : task.priority === 'high' ? 'high' : 'medium'
                const isFocused = task.id === (focusedTask?.id || '')
                const isChecked = checkedIds.has(task.id)
                return (
                  <li key={task.id}>
                    <div
                      className={`sw-dispatch-modal-row ${isFocused ? 'selected' : ''} ${isChecked ? 'checked' : ''}`}
                      onClick={() => setFocusedTaskId(task.id)}
                    >
                      <label
                        className="sw-dispatch-modal-check"
                        onClick={(e) => e.stopPropagation()}
                        title="Select for batch dispatch"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleChecked(task.id)}
                        />
                      </label>
                      <span className={`sw-dispatch-modal-led ${pcls}`} />
                      {task.metadata.identifier && (
                        <span className="sw-dispatch-modal-id">{task.metadata.identifier}</span>
                      )}
                      <span className="sw-dispatch-modal-title-text">{task.title}</span>
                      {task.priority && (
                        <span className={`sw-dispatch-modal-priority ${pcls}`}>
                          {task.priority.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {(batchMode || focusedTask) && (
          <div className="sw-dispatch-modal-foot">
            <div className="sw-dispatch-modal-foot-info">
              {batchMode ? (
                <>
                  <div className="sw-dispatch-modal-foot-title">{checkedIds.size} tasks selected</div>
                  <div className="sw-dispatch-modal-foot-desc">
                    Each task will be dispatched to its own agent, staggered by 120ms.
                  </div>
                </>
              ) : focusedTask && (
                <>
                  <div className="sw-dispatch-modal-foot-title">{focusedTask.title}</div>
                  {focusedTask.description && (
                    <div className="sw-dispatch-modal-foot-desc">{focusedTask.description.slice(0, 180)}</div>
                  )}
                </>
              )}
            </div>
            <div className="sw-dispatch-modal-foot-actions">
              <div className="sw-dispatch-target" title="Where to run the task">
                <button
                  type="button"
                  className={`sw-dispatch-target-btn ${target === 'local' ? 'active' : ''}`}
                  onClick={() => setTarget('local')}
                >
                  Local
                </button>
                <button
                  type="button"
                  className={`sw-dispatch-target-btn ${target === 'cloud' ? 'active' : ''}`}
                  onClick={() => setTarget('cloud')}
                  title="Rush Cloud -- run on GitHub repo"
                >
                  Cloud
                </button>
              </div>
              <span className="sw-dispatch-modal-foot-label">
                {batchMode ? `Dispatch ${checkedIds.size} to` : 'Dispatch to'}
              </span>
              {agentButtons.map((a) => (
                <button
                  key={a.id}
                  className={`sw-dispatch-modal-agent ${a.id}`}
                  onClick={() => batchMode ? handleBatchDispatch(a.id) : handleSingleDispatch(a.id)}
                  title={`Dispatch to ${a.id} (${target})`}
                >
                  {a.abbr}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Agent horizontal strip
/**
 * Inline banner for teammates waiting on human input.
 *
 * One banner per team; shows which teammates are blocked and provides a
 * single textarea whose submit forwards to `agents factory answer <team>`
 * via the extension backend. Oldest input_required teammate is the one
 * that gets the message (matches CLI behavior).
 */
function IntakeBanner({ team, teammates }: { team: string; teammates: { teammate: string; agentId: string }[] }) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const names = teammates.map((t) => t.teammate).join(', ')

  const submit = () => {
    const body = text.trim()
    if (!body || submitting) return
    setSubmitting(true)
    postMessage({ type: 'factoryAnswer', teamId: team, text: body })
    setText('')
    // Leave submitting=true briefly so the button disables until the next
    // status refresh removes this teammate from input_required.
    setTimeout(() => setSubmitting(false), 1500)
  }

  return (
    <div className="sw-intake-banner" role="status">
      <div className="sw-intake-banner-head">
        <Icon name="zap" size={13} />
        <span className="sw-intake-banner-title">
          {teammates.length === 1 ? 'Waiting on you' : `${teammates.length} teammates waiting on you`}
        </span>
        <span className="sw-intake-banner-sub">
          {team} · {names}
        </span>
      </div>
      <div className="sw-intake-banner-form">
        <textarea
          className="sw-intake-banner-input"
          placeholder="Your answer..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
          rows={2}
        />
        <button
          type="button"
          className="sw-btn primary sm"
          onClick={submit}
          disabled={!text.trim() || submitting}
        >
          Send
        </button>
      </div>
    </div>
  )
}

/**
 * Factory-specific badges: task-type for single teammates, task-type roll-up
 * for team rows, plus the cloud-provider pill. Renders nothing when no
 * Factory metadata is present, so plain teammates look identical to before.
 */
function FactoryBadges({ item }: { item: UnifiedAgent }) {
  const badges: React.ReactElement[] = []

  if (item.taskType) {
    badges.push(
      <span
        key="task-type"
        className="sw-factory-badge"
        title={`Factory task type: ${item.taskType}`}
        style={{
          background: taskTypeColor(item.taskType) + '22',
          color: taskTypeColor(item.taskType),
          border: `1px solid ${taskTypeColor(item.taskType)}66`,
        }}
      >
        {item.taskType}
      </span>
    )
  }

  if (item.cloudProvider) {
    badges.push(
      <span
        key="cloud"
        className="sw-factory-badge"
        title={`Dispatched on cloud: ${item.cloudProvider}`}
        style={{ background: '#0ea5e922', color: '#0ea5e9', border: '1px solid #0ea5e966' }}
      >
        {item.cloudProvider}
      </span>
    )
  }

  if (item.kind === 'team' && item.taskTypeCounts) {
    const order: FactoryTaskType[] = ['plan', 'implement', 'test', 'review', 'bugfix', 'docs']
    for (const k of order) {
      const n = item.taskTypeCounts[k] ?? 0
      if (n <= 0) continue
      badges.push(
        <span
          key={`team-${k}`}
          className="sw-factory-badge"
          title={`${n} ${k} task${n === 1 ? '' : 's'}`}
          style={{
            background: taskTypeColor(k) + '22',
            color: taskTypeColor(k),
            border: `1px solid ${taskTypeColor(k)}66`,
          }}
        >
          {k} × {n}
        </span>
      )
    }
  }

  if (badges.length === 0) return null
  return <div className="sw-strip-factory-badges">{badges}</div>
}

function AgentStrip({ item, dimmed, onFocus, onKill, onRetry }: {
  item: UnifiedAgent
  dimmed?: boolean
  onFocus: (t: TerminalInfo) => void
  onKill?: (taskName: string) => void
  onRetry?: (taskName: string) => void
}) {
  const fileNames = item.files.map((f) => f.split('/').pop() || f)
  const abbr = agentAbbr(item.agentType)
  const mode = modeLabel(item)

  return (
    <div className={`sw-agent-strip ${dimmed ? 'dimmed' : ''}`}>
      <div className={`sw-strip-color-bar ${item.agentType.toLowerCase()}`} />
      <div className={`sw-strip-led ${item.status === 'running' ? 'green' : item.status === 'failed' ? 'red' : 'gray'}`} />
      <div className="sw-strip-identity">
        <AgentAvatar id={item.agentType} size={28} />
        <div>
          <div className="sw-strip-name">
            {item.teammateName
              ? item.teammateName
              : item.agentType.charAt(0).toUpperCase() + item.agentType.slice(1)}
          </div>
          <div className="sw-strip-kind">{mode}</div>
        </div>
      </div>
      <div className="sw-strip-activity">
        {item.activity}
      </div>
      <FactoryBadges item={item} />
      <div className="sw-strip-files">
        {fileNames.slice(0, 3).map((f) => (
          <span key={f} className="sw-file-pill">{f}</span>
        ))}
        {fileNames.length > 3 && <span className="sw-file-pill">+{fileNames.length - 3}</span>}
      </div>
      <VuMeter value={item.toolCalls} max={Math.max(item.toolCalls * 1.5, 10)} />
      <div className="sw-strip-tags">
        {item.linearIssue && <span className="sw-tag-linear">{item.linearIssue}</span>}
        {item.prUrl && <span className="sw-tag-pr">#{item.prUrl.match(/\/pull\/(\d+)/)?.[1] || 'PR'}</span>}
      </div>
      <div className="sw-strip-actions">
        {item.terminal && (
          <button className="sw-btn-strip sw-btn-focus" onClick={() => onFocus(item.terminal!)}>Focus</button>
        )}
        {item.active && item.swarm && onKill && (
          <button className="sw-btn-strip sw-btn-kill" onClick={() => onKill(item.swarm!.task_name)}>Kill</button>
        )}
        {!item.active && item.swarm && onRetry && (
          <button className="sw-btn-strip sw-btn-focus" onClick={() => onRetry(item.swarm!.task_name)}>Retry</button>
        )}
      </div>
    </div>
  )
}

// Dispatch card with agent picker
function DispatchCard({ task, onDispatch }: { task: UnifiedTask; onDispatch: (task: UnifiedTask, agent: string) => void }) {
  const [selectedAgent, setSelectedAgent] = useState('claude')
  const priorityCls = task.priority === 'urgent' ? 'urgent' : task.priority === 'high' ? 'high' : 'medium'
  const priorityLabel = task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : 'Medium'
  const agents = [
    { id: 'claude', abbr: 'CC' },
    { id: 'codex', abbr: 'CX' },
    { id: 'gemini', abbr: 'GX' },
  ]

  return (
    <div className="sw-queue-card">
      <div className="sw-queue-card-header">
        <div className={`sw-queue-priority-led ${priorityCls}`} />
        <span className="sw-queue-badge">{task.metadata.identifier || task.id.slice(0, 8)}</span>
        <span className={`sw-queue-priority-label ${priorityCls}`}>{priorityLabel}</span>
      </div>
      <div className="sw-queue-title">{task.title}</div>
      {task.description && (
        <div className="sw-queue-desc">{task.description.slice(0, 100)}</div>
      )}
      <div className="sw-queue-footer">
        <div className="sw-queue-assign">
          <span className="sw-queue-assign-label">Assign</span>
          {agents.map((a) => (
            <button
              key={a.id}
              className={`sw-queue-agent-pick ${a.id} ${selectedAgent === a.id ? 'selected' : ''}`}
              onClick={() => setSelectedAgent(a.id)}
            >
              {a.abbr}
            </button>
          ))}
        </div>
        <button className="sw-btn-dispatch" onClick={() => onDispatch(task, selectedAgent)}>Dispatch</button>
      </div>
    </div>
  )
}
