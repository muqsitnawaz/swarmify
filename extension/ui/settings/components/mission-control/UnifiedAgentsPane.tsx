import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { TaskSummary, TerminalDetail as TerminalInfo, AgentDetail, UnifiedTask } from '../../types'
import { AgentAvatar, agentShortChunk } from './AgentAvatar'
import { Icon } from './icons'
import { relTime, taskNameToTitle, swarmOverallStatus, shortDuration } from './types'
import { postMessage } from '../../hooks'
import {
  isTerminalActive,
  isTerminalJustSpawned,
  reconcilePending,
  pruneExpiredPending,
  filterDispatchedTaskIds,
  optimisticActivityLabel,
  PENDING_DISPATCH_TTL_MS,
  type PendingDispatch,
} from './dispatch'

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

  const now = Date.now()
  for (const t of terminals) {
    const chunk = agentShortChunk(t.sessionId) || (t.id ?? '').slice(-8)
    const justSpawned = isTerminalJustSpawned(t.createdAt, now)
    const isActive = isTerminalActive(t, now)
    const files: string[] = []
    if (t.recentFiles) files.push(...t.recentFiles.slice(0, 5))
    items.push({
      kind: 'terminal',
      id: `term-${t.id}`,
      agentType: t.agentType,
      displayName: `${t.agentType}-${chunk}`,
      activity: t.currentActivity || t.label || (justSpawned ? 'Starting...' : t.status === 'idle' ? 'idle' : t.role ?? 'terminal'),
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

type StatPopoverKey = 'shipped' | 'open' | 'running' | 'nextup' | 'files'

function statPopoverTitle(key: StatPopoverKey): string {
  switch (key) {
    case 'shipped': return 'Shipped today'
    case 'open': return 'Open PRs'
    case 'running': return 'Running agents'
    case 'nextup': return 'Next up'
    case 'files': return 'Files today'
  }
}

function statPopoverEmptyLabel(key: StatPopoverKey): string {
  switch (key) {
    case 'shipped': return 'No PRs shipped yet'
    case 'open': return 'No open PRs'
    case 'running': return 'No running agents'
    case 'nextup': return 'Queue is empty'
    case 'files': return 'No files touched today'
  }
}

interface BuildRowsCtx {
  activeItems: UnifiedAgent[]
  queueTasks: UnifiedTask[]
  filesToday: string[]
  shippedPRs: Array<{ key: string; title: string; url: string; agentType: string; timestamp: string }>
  openPRs: Array<{ key: string; title: string; url: string; agentType: string; timestamp: string }>
  onOpenExternal: (url: string) => void
  onFocusTerminal: (terminalId: string) => void
  onOpenFile: (path: string) => void
}

function buildStatPopoverRows(key: StatPopoverKey, ctx: BuildRowsCtx): StatPopoverRow[] {
  switch (key) {
    case 'shipped':
    case 'open': {
      const prs = key === 'shipped' ? ctx.shippedPRs : ctx.openPRs
      return prs.map((pr) => ({
        key: pr.key,
        icon: <AgentAvatar id={pr.agentType} size={16} />,
        title: pr.title,
        subtitle: shortPrLabel(pr.url),
        onClick: () => ctx.onOpenExternal(pr.url),
      }))
    }
    case 'running': {
      return ctx.activeItems.map((item) => {
        const terminalId = item.kind === 'terminal' ? item.terminal?.id : undefined
        const action = terminalId
          ? () => ctx.onFocusTerminal(terminalId)
          : item.prUrl
            ? () => ctx.onOpenExternal(item.prUrl as string)
            : undefined
        return {
          key: item.id,
          icon: <AgentAvatar id={item.agentType} size={16} />,
          title: item.displayName,
          subtitle: item.activity.slice(0, 48),
          onClick: action,
          disabled: !action,
        }
      })
    }
    case 'nextup': {
      return ctx.queueTasks.map((task) => ({
        key: task.id,
        title: task.title,
        subtitle: task.metadata.identifier || undefined,
        onClick: task.metadata.url ? () => ctx.onOpenExternal(task.metadata.url as string) : undefined,
        disabled: !task.metadata.url,
      }))
    }
    case 'files': {
      return ctx.filesToday.map((path) => {
        const base = path.split('/').pop() || path
        const dir = path.slice(0, path.length - base.length).replace(/\/$/, '')
        return {
          key: path,
          title: base,
          subtitle: dir || undefined,
          onClick: () => ctx.onOpenFile(path),
        }
      })
    }
  }
}

interface StatPopoverRow {
  key: string
  icon?: React.ReactNode
  title: string
  subtitle?: string
  disabled?: boolean
  onClick?: () => void
}

function StatPopover({
  title,
  rows,
  emptyLabel,
}: {
  title: string
  rows: StatPopoverRow[]
  emptyLabel: string
}) {
  return (
    <div className="sw-floor-pr-popover" role="menu">
      <div className="sw-floor-pr-popover-head">{title}</div>
      {rows.length === 0 ? (
        <div className="sw-floor-pr-popover-empty">{emptyLabel}</div>
      ) : (
        <div className="sw-floor-pr-popover-list">
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              className="sw-floor-pr-popover-row"
              onClick={row.onClick}
              disabled={row.disabled || !row.onClick}
            >
              {row.icon}
              <span className="sw-floor-pr-popover-title">{row.title}</span>
              {row.subtitle && <span className="sw-floor-pr-popover-num">{row.subtitle}</span>}
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
  openDispatchTrigger?: number
}

export function UnifiedAgentsPane({ terminals, tasks, tasksLoading, unifiedTasks, unifiedTasksLoading, onDispatch, onNavigate, openDispatchTrigger }: UnifiedAgentsPaneProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [statPopover, setStatPopover] = useState<'shipped' | 'open' | 'running' | 'nextup' | 'files' | null>(null)
  const [dispatchOpen, setDispatchOpen] = useState(false)
  useEffect(() => {
    if (openDispatchTrigger !== undefined && openDispatchTrigger > 0) setDispatchOpen(true)
  }, [openDispatchTrigger])
  const [activeFilter, setActiveFilter] = useState<'all' | 'local' | 'cloud'>('all')
  const [pendingDispatches, setPendingDispatches] = useState<PendingDispatch[]>([])
  const [tick, setTick] = useState(0)
  const [repoPicker, setRepoPicker] = useState<{
    taskId: string
    agentType: string
    repos: string[]
    preSelected: string[]
    title: string
    description: string
    identifier: string
  } | null>(null)
  const [ownerPicker, setOwnerPicker] = useState<{
    taskId: string
    agentType: string
    title: string
    description: string
    identifier: string
    labels: string[]
  } | null>(null)
  const [detailTask, setDetailTask] = useState<UnifiedTask | null>(null)
  const newMenuRef = useRef<HTMLDivElement>(null)
  const statPopoverRef = useRef<HTMLDivElement>(null)
  const nextUpSectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pendingDispatches.length === 0) return
    const interval = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(interval)
  }, [pendingDispatches.length])

  useEffect(() => {
    if (pendingDispatches.length === 0) return
    const now = Date.now()
    setPendingDispatches((prev) => {
      const pruned = pruneExpiredPending(prev, now)
      return pruned.length === prev.length ? prev : pruned
    })
  }, [tick, pendingDispatches])

  // Listen for backend dispatch follow-ups (repo picker / owner picker prompts)
  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      const msg = event.data
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'pickRepos') {
        const repos = Array.isArray(msg.repos) ? msg.repos.filter((r: unknown) => typeof r === 'string') : []
        // Fall back to pre-selecting all repos when `preSelected` is absent,
        // matching the prior multi-repo-narrowing behavior. Empty array
        // means "no pre-selection" — used when the Linear task has no
        // repo: label and the user must pick from the owner's full list.
        const preSelected = Array.isArray(msg.preSelected)
          ? msg.preSelected.filter((r: unknown) => typeof r === 'string')
          : repos
        setRepoPicker({
          taskId: String(msg.taskId || ''),
          agentType: String(msg.agentType || 'claude'),
          repos,
          preSelected,
          title: String(msg.title || ''),
          description: String(msg.description || ''),
          identifier: String(msg.identifier || ''),
        })
      } else if (msg.type === 'needGithubOwner') {
        setOwnerPicker({
          taskId: String(msg.taskId || ''),
          agentType: String(msg.agentType || 'claude'),
          title: String(msg.title || ''),
          description: String(msg.description || ''),
          identifier: String(msg.identifier || ''),
          labels: Array.isArray(msg.labels) ? msg.labels.filter((l: unknown) => typeof l === 'string') : [],
        })
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  useEffect(() => {
    if (!newMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) setNewMenuOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [newMenuOpen])

  useEffect(() => {
    if (!statPopover) return
    const handler = (e: MouseEvent) => {
      if (statPopoverRef.current && !statPopoverRef.current.contains(e.target as Node)) setStatPopover(null)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [statPopover])

  const baseItems = useMemo(() => buildUnifiedList(terminals, tasks), [terminals, tasks])

  // Reconcile: drop a pending dispatch once a matching real terminal/task appears.
  useEffect(() => {
    if (pendingDispatches.length === 0) return
    setPendingDispatches((prev) => {
      const next = reconcilePending(prev, terminals, tasks)
      return next.length === prev.length ? prev : next
    })
  }, [terminals, tasks, pendingDispatches])

  const optimisticItems = useMemo<UnifiedAgent[]>(() => {
    void tick
    return pendingDispatches.map((p) => ({
      kind: p.target === 'cloud' ? 'cloud' : 'terminal',
      id: p.id,
      agentType: p.agentType,
      displayName: p.taskIdentifier || p.title.slice(0, 40),
      activity: optimisticActivityLabel(p),
      active: true,
      duration: '',
      timestamp: new Date(p.createdAt).toISOString(),
      status: 'running',
      files: [],
      toolCalls: 0,
      mode: p.target === 'cloud' ? 'cloud' : 'edit',
      cloudProvider: p.target === 'cloud' ? 'anthropic' : null,
    }))
  }, [pendingDispatches, tick])

  const items = useMemo(() => [...optimisticItems, ...baseItems], [optimisticItems, baseItems])
  const activeItems = useMemo(() => items.filter((i) => i.active), [items])
  const recentItems = useMemo(() => items.filter((i) => !i.active), [items])

  const pendingTaskIds = useMemo(
    () => new Set(pendingDispatches.map((p) => p.taskId)),
    [pendingDispatches]
  )

  // Queue: urgent/high tasks that are todo (exclude tasks currently being dispatched)
  const queueTasks = useMemo(() => {
    const eligible = unifiedTasks.filter(
      (t) => t.status === 'todo' && (t.priority === 'urgent' || t.priority === 'high')
    )
    return filterDispatchedTaskIds(eligible, pendingTaskIds).slice(0, 4)
  }, [unifiedTasks, pendingTaskIds])

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

  // Open PRs: items with a prUrl whose PR is not merged/completed.
  // swarmOverallStatus treats status === 'completed' as 'merged', so we exclude those.
  const openPRs = useMemo(
    () =>
      items
        .filter((i) => i.prUrl && i.status !== 'completed')
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
  const filesToday = useMemo(() => {
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
    return Array.from(set).sort()
  }, [tasks])
  const filesTouchedToday = filesToday.length

  const backlogRemaining = useMemo(() => {
    const todoCount = unifiedTasks.filter((t) => t.status === 'todo').length
    return Math.max(0, todoCount - queueTasks.length)
  }, [unifiedTasks, queueTasks.length])

  // Real LLM output tok/s -- extension parses active Claude session JSONL files
  // and sums usage.output_tokens over the last 60s rolling window.
  const [liveThroughput, setLiveThroughput] = useState(0)
  useEffect(() => {
    if (activeItems.length === 0) {
      setLiveThroughput(0)
      return
    }
    const poll = () => postMessage({ type: 'getFloorThroughput' })
    poll()
    const id = setInterval(poll, 2500)
    return () => clearInterval(id)
  }, [activeItems.length])
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.type === 'floorThroughputData' && typeof msg.tokensPerSec === 'number') {
        setLiveThroughput(msg.tokensPerSec)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

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

  const handleDispatchTask = (
    task: UnifiedTask,
    agentType: string,
    target: 'local' | 'cloud' = 'local',
    targetRepos?: string[],
    cloudProvider: 'rush' | 'codex' | 'factory' = 'rush',
    notifyPrefs?: { onQuestion: boolean; onFinish: boolean; channel: string },
    branch?: string,
    codexEnv?: string,
  ) => {
    postMessage({
      type: 'dispatchTask',
      taskId: task.id,
      agentType,
      target,
      cloudProvider,
      title: task.title,
      description: task.description || '',
      identifier: task.metadata.identifier || '',
      labels: task.metadata.labels || [],
      targetRepos: targetRepos || [],
      branch: branch || '',
      codexEnv: codexEnv || '',
      notify: notifyPrefs || { onQuestion: false, onFinish: false, channel: '' },
    })
    const now = Date.now()
    const repoList = targetRepos && targetRepos.length > 0 ? targetRepos : [undefined]
    const pendings: PendingDispatch[] = repoList.map((repo, i) => ({
      id: `pending-${task.id}-${now}-${i}`,
      agentType,
      target,
      taskId: task.id,
      taskIdentifier: task.metadata.identifier || '',
      title: task.title,
      createdAt: now + i,
      targetRepo: repo,
    }))
    setPendingDispatches((prev) => [...prev, ...pendings])
    setTimeout(() => {
      postMessage({ type: 'fetchAllTerminals' })
      postMessage({ type: 'fetchTasks' })
    }, 800)
  }

  return (
    <div className="sw-floor-dashboard">
      {/* Header */}
      <div className="sw-floor-header">
        <div className="sw-floor-title">Factory Floor</div>
        <div className="sw-floor-header-right">
          <div className="sw-floor-stat-bar" ref={statPopoverRef}>
            <button
              type="button"
              className={`sw-floor-stat-btn${statPopover === 'running' ? ' active' : ''}`}
              title="Active agents"
              disabled={activeItems.length === 0}
              onClick={() => setStatPopover(statPopover === 'running' ? null : 'running')}
            >
              <b>{activeItems.length}</b> running
            </button>
            <span className="sw-stat-sep">·</span>
            <button
              type="button"
              className={`sw-floor-stat-btn${statPopover === 'nextup' ? ' active' : ''}`}
              title="Next up in the queue"
              disabled={queueTasks.length === 0}
              onClick={() => {
                if (statPopover === 'nextup') {
                  setStatPopover(null)
                } else {
                  setStatPopover('nextup')
                  nextUpSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              }}
            >
              <b>{queueTasks.length}</b> next up
            </button>
            <span className="sw-stat-sep">·</span>
            <button
              type="button"
              className={`sw-floor-stat-btn${statPopover === 'files' ? ' active' : ''}`}
              title="Unique files touched by agents today"
              disabled={filesTouchedToday === 0}
              onClick={() => setStatPopover(statPopover === 'files' ? null : 'files')}
            >
              <b>{filesTouchedToday}</b> files today
            </button>
            <span className="sw-stat-sep">·</span>
            <button
              type="button"
              className={`sw-floor-stat-btn${statPopover === 'shipped' ? ' active' : ''}`}
              title="PRs shipped today (completed with pr_url)"
              disabled={prsShippedToday === 0}
              onClick={() => setStatPopover(statPopover === 'shipped' ? null : 'shipped')}
            >
              <b>{prsShippedToday}</b> PRs shipped
            </button>
            <span className="sw-stat-sep">·</span>
            <button
              type="button"
              className={`sw-floor-stat-btn${statPopover === 'open' ? ' active' : ''}`}
              title="Open PRs across all active and recent agents"
              disabled={totalPRs === 0}
              onClick={() => setStatPopover(statPopover === 'open' ? null : 'open')}
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
            {statPopover && (
              <StatPopover
                title={statPopoverTitle(statPopover)}
                emptyLabel={statPopoverEmptyLabel(statPopover)}
                rows={buildStatPopoverRows(statPopover, {
                  activeItems,
                  queueTasks,
                  filesToday,
                  shippedPRs,
                  openPRs,
                  onOpenExternal: (url) => {
                    postMessage({ type: 'openExternal', url })
                    setStatPopover(null)
                  },
                  onFocusTerminal: (id) => {
                    postMessage({ type: 'focusTerminal', terminalId: id })
                    setStatPopover(null)
                  },
                  onOpenFile: (path) => {
                    postMessage({ type: 'openTerminalFile', path })
                    setStatPopover(null)
                  },
                })}
              />
            )}
          </div>
          {activeItems.length > 0 && <ThroughputCounter tokensPerSec={liveThroughput} />}
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
        <div className="sw-queue-section" ref={nextUpSectionRef}>
          <div className="sw-section-header-row">
            <span className="sw-section-label">Next Up</span>
            <span className="sw-section-count-pill">{queueTasks.length}</span>
            <span className="sw-section-hint">Click a card to configure and dispatch</span>
            <span className="sw-section-line" />
          </div>

          <div className="sw-queue-cards">
            {queueTasks.map((task) => (
              <DispatchCard key={task.id} task={task} onOpen={setDetailTask} />
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
            <div className="sw-active-filter" role="tablist" aria-label="Filter active agents">
              {(['all', 'local', 'cloud'] as const).map((key) => {
                const count = key === 'all'
                  ? activeItems.length
                  : key === 'cloud'
                    ? activeItems.filter((i) => i.kind === 'cloud').length
                    : activeItems.filter((i) => i.kind !== 'cloud').length
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={activeFilter === key}
                    className={`sw-active-filter-btn ${activeFilter === key ? 'active' : ''}`}
                    onClick={() => setActiveFilter(key)}
                  >
                    {key === 'all' ? 'All' : key === 'local' ? 'Local' : 'Cloud'}
                    <span className="sw-active-filter-count">{count}</span>
                  </button>
                )
              })}
            </div>
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
            {activeItems
              .filter((item) => activeFilter === 'all' || (activeFilter === 'cloud' ? item.kind === 'cloud' : item.kind !== 'cloud'))
              .map((item) => (
                <AgentStrip key={item.id} item={item} onFocus={handleFocusTerminal} onKill={handleKill} />
              ))}
            {activeItems.length > 0 && activeItems.filter((i) => activeFilter === 'all' || (activeFilter === 'cloud' ? i.kind === 'cloud' : i.kind !== 'cloud')).length === 0 && (
              <div className="sw-active-filter-empty">No {activeFilter} agents running.</div>
            )}
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
      {repoPicker && (
        <RepoPickerModal
          repos={repoPicker.repos}
          preSelected={repoPicker.preSelected}
          taskIdentifier={repoPicker.identifier}
          taskTitle={repoPicker.title}
          onClose={() => setRepoPicker(null)}
          onConfirm={(selected) => {
            const pseudoTask: UnifiedTask = {
              id: repoPicker.taskId,
              source: 'linear',
              title: repoPicker.title,
              description: repoPicker.description,
              status: 'todo',
              metadata: { identifier: repoPicker.identifier },
            } as UnifiedTask
            handleDispatchTask(pseudoTask, repoPicker.agentType, 'cloud', selected)
            setRepoPicker(null)
          }}
        />
      )}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          onClose={() => setDetailTask(null)}
          onDispatch={({ agent, target, cloudProvider, branch, codexEnv, notify }) => {
            handleDispatchTask(detailTask, agent, target, undefined, cloudProvider, notify, branch, codexEnv)
            setDetailTask(null)
          }}
        />
      )}
      {ownerPicker && (
        <GithubOwnerModal
          onClose={() => setOwnerPicker(null)}
          onSave={(owner) => {
            postMessage({ type: 'setGithubOwner', owner })
            const pseudoTask: UnifiedTask = {
              id: ownerPicker.taskId,
              source: 'linear',
              title: ownerPicker.title,
              description: ownerPicker.description,
              status: 'todo',
              metadata: { identifier: ownerPicker.identifier, labels: ownerPicker.labels },
            } as UnifiedTask
            setOwnerPicker(null)
            // Re-fire the dispatch; backend will now succeed with the saved owner.
            setTimeout(() => handleDispatchTask(pseudoTask, ownerPicker.agentType, 'cloud'), 200)
          }}
        />
      )}
    </div>
  )
}

function RepoPickerModal({ repos, preSelected, taskIdentifier, taskTitle, onClose, onConfirm }: {
  repos: string[]
  preSelected: string[]
  taskIdentifier: string
  taskTitle: string
  onClose: () => void
  onConfirm: (selected: string[]) => void
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(preSelected))
  // Empty pre-selection signals the "Linear task has no repo: label, pick
  // one from the owner's full list" flow. Switch the title + subcopy so the
  // user understands they must make a choice vs. narrow from multiple.
  const isEmptyPick = preSelected.length === 0
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const toggle = (r: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r); else next.add(r)
      return next
    })
  }
  const confirm = () => {
    const selected = repos.filter((r) => checked.has(r))
    if (selected.length === 0) return
    onConfirm(selected)
  }
  return (
    <div className="sw-dispatch-modal-overlay" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="sw-dispatch-modal" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="sw-dispatch-modal-head">
          <span className="sw-dispatch-modal-title">
            {isEmptyPick
              ? (taskIdentifier ? `${taskIdentifier} has no repo: label` : 'Pick a target repo')
              : (taskIdentifier ? `${taskIdentifier} targets multiple repos` : 'Pick target repos')}
          </span>
          <span className="sw-dispatch-modal-sub">{taskTitle.slice(0, 80)}</span>
          <button className="sw-dispatch-modal-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={12} />
          </button>
        </div>
        <div className="sw-dispatch-modal-body">
          <ul className="sw-dispatch-modal-list">
            {repos.map((r) => (
              <li key={r}>
                <div
                  className={`sw-dispatch-modal-row ${checked.has(r) ? 'checked' : ''}`}
                  onClick={() => toggle(r)}
                  role="button"
                >
                  <input
                    type="checkbox"
                    className="sw-dispatch-modal-check"
                    checked={checked.has(r)}
                    onChange={() => toggle(r)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="sw-dispatch-modal-title-text">{r}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="sw-dispatch-modal-foot">
          <div className="sw-dispatch-modal-foot-info">
            <div className="sw-dispatch-modal-foot-desc">
              {isEmptyPick
                ? `Selected ${checked.size} of ${repos.length}. Add a repo: label in Linear to skip this next time.`
                : `Selected ${checked.size} of ${repos.length}. One cloud dispatch per selected repo.`}
            </div>
          </div>
          <div className="sw-dispatch-modal-foot-actions">
            <button className="sw-btn secondary sm" onClick={onClose}>Cancel</button>
            <button className="sw-btn primary sm" disabled={checked.size === 0} onClick={confirm}>
              Dispatch {checked.size > 0 ? checked.size : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function GithubOwnerModal({ onClose, onSave }: {
  onClose: () => void
  onSave: (owner: string) => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const save = () => {
    const owner = value.trim()
    if (!owner) return
    onSave(owner)
  }
  return (
    <div className="sw-dispatch-modal-overlay" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="sw-dispatch-modal" onMouseDown={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="sw-dispatch-modal-head">
          <span className="sw-dispatch-modal-title">GitHub owner needed</span>
          <button className="sw-dispatch-modal-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={12} />
          </button>
        </div>
        <div className="sw-dispatch-modal-body" style={{ padding: 16 }}>
          <div style={{ marginBottom: 10, fontSize: 12, opacity: 0.75 }}>
            We couldn't infer your GitHub username from the workspace remote or `gh` CLI.
            Set it once and it will be saved.
          </div>
          <input
            ref={inputRef}
            type="text"
            placeholder="muqsitnawaz"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }}
            className="sw-dispatch-modal-search-input"
            style={{ width: '100%', padding: '6px 8px' }}
          />
        </div>
        <div className="sw-dispatch-modal-foot">
          <div className="sw-dispatch-modal-foot-actions" style={{ marginLeft: 'auto' }}>
            <button className="sw-btn secondary sm" onClick={onClose}>Cancel</button>
            <button className="sw-btn primary sm" disabled={!value.trim()} onClick={save}>
              Save & retry
            </button>
          </div>
        </div>
      </div>
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
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const [target, setTarget] = useState<'local' | 'cloud'>('local')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const todoTasks = useMemo(
    () => tasks.filter((t) => t.status === 'todo' || t.status === 'in_progress'),
    [tasks]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const priorityRank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
    return todoTasks
      .filter((t) => {
        if (priorityFilter === 'urgent' && t.priority !== 'urgent') return false
        if (priorityFilter === 'high' && t.priority !== 'high' && t.priority !== 'urgent') return false
        if (!q) return true
        return (
          t.title.toLowerCase().includes(q) ||
          (t.metadata.identifier || '').toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const ra = a.priority ? priorityRank[a.priority] ?? 99 : 99
        const rb = b.priority ? priorityRank[b.priority] ?? 99 : 99
        return ra - rb
      })
  }, [todoTasks, query, priorityFilter])

  const detailTask = detailTaskId ? todoTasks.find((t) => t.id === detailTaskId) ?? null : null
  const focusedTask = detailTask || filtered.find((t) => t.id === focusedTaskId) || filtered[0]
  const batchMode = checkedIds.size > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (detailTaskId) setDetailTaskId(null)
        else onClose()
        return
      }
      if (detailTaskId) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (filtered.length === 0) return
        e.preventDefault()
        const currentIdx = filtered.findIndex((t) => t.id === (focusedTask?.id || ''))
        const step = e.key === 'ArrowDown' ? 1 : -1
        const nextIdx = currentIdx < 0 ? 0 : (currentIdx + step + filtered.length) % filtered.length
        setFocusedTaskId(filtered[nextIdx].id)
        return
      }
      if (e.key === 'Enter' && focusedTask && !batchMode) {
        e.preventDefault()
        setDetailTaskId(focusedTask.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, detailTaskId, filtered, focusedTask, batchMode])

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
          ) : detailTask ? (
            <TaskDetailView task={detailTask} onBack={() => setDetailTaskId(null)} />
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
                      ref={isFocused ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                      className={`sw-dispatch-modal-row ${isFocused ? 'selected' : ''} ${isChecked ? 'checked' : ''}`}
                      onClick={() => {
                        setFocusedTaskId(task.id)
                        setDetailTaskId(task.id)
                      }}
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
                <div className="sw-dispatch-modal-foot-title">
                  {checkedIds.size} selected &middot; staggered 120ms
                </div>
              ) : focusedTask && focusedTask.metadata.identifier && (
                <div className="sw-dispatch-modal-foot-title sw-dispatch-modal-foot-id">
                  {focusedTask.metadata.identifier}
                </div>
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

function TaskDetailView({ task, onBack }: { task: UnifiedTask; onBack: () => void }) {
  const pcls = task.priority === 'urgent' ? 'urgent' : task.priority === 'high' ? 'high' : 'medium'
  const url = task.metadata.url as string | undefined
  return (
    <div className="sw-dispatch-modal-detail">
      <button className="sw-dispatch-modal-detail-back" onClick={onBack} title="Back to list">
        <span aria-hidden="true">&larr;</span>
        <span>Back</span>
      </button>
      <div className="sw-dispatch-modal-detail-head">
        <span className={`sw-dispatch-modal-led ${pcls}`} />
        {task.metadata.identifier && (
          <span className="sw-dispatch-modal-id">{task.metadata.identifier}</span>
        )}
        {task.priority && (
          <span className={`sw-dispatch-modal-priority ${pcls}`}>
            {task.priority.toUpperCase()}
          </span>
        )}
      </div>
      <div className="sw-dispatch-modal-detail-title">{task.title}</div>
      {task.description && (
        <div className="sw-dispatch-modal-detail-desc">{task.description}</div>
      )}
      {url && (
        <a
          className="sw-dispatch-modal-detail-link"
          href={url}
          onClick={(e) => {
            e.preventDefault()
            postMessage({ type: 'openExternal', url })
          }}
        >
          Open in {url.includes('linear.app') ? 'Linear' : url.includes('github.com') ? 'GitHub' : 'browser'}
        </a>
      )}
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
function DispatchCard({ task, onOpen }: { task: UnifiedTask; onOpen: (task: UnifiedTask) => void }) {
  const priorityCls = task.priority === 'urgent' ? 'urgent' : task.priority === 'high' ? 'high' : 'medium'
  const priorityLabel = task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : 'Medium'
  return (
    <button type="button" className="sw-queue-card sw-queue-card-clickable" onClick={() => onOpen(task)}>
      <div className="sw-queue-card-header">
        <div className={`sw-queue-priority-led ${priorityCls}`} />
        <span className="sw-queue-badge">{task.metadata.identifier || task.id.slice(0, 8)}</span>
        <span className={`sw-queue-priority-label ${priorityCls}`}>{priorityLabel}</span>
      </div>
      <div className="sw-queue-title">{task.title}</div>
      {task.description && (
        <div className="sw-queue-desc">{task.description.slice(0, 160)}</div>
      )}
    </button>
  )
}

type CloudProviderId = 'rush' | 'codex' | 'factory'

type DispatchPrefs = {
  lastAgent: string
  lastTarget: 'local' | 'cloud'
  lastCloudProvider: CloudProviderId
  notifyOnQuestion: boolean
  notifyOnFinish: boolean
  notifyChannel: string
  lastCodexEnv: string
  /** Most-recently-dispatched repos, newest first. Capped at MRU_MAX. */
  recentRepos: string[]
}

const DISPATCH_PREFS_KEY = 'swarmify.dispatchPrefs.v1'
const MRU_MAX = 10

function loadDispatchPrefs(): DispatchPrefs {
  try {
    const raw = localStorage.getItem(DISPATCH_PREFS_KEY)
    if (!raw) return defaultPrefs()
    const parsed = JSON.parse(raw)
    return { ...defaultPrefs(), ...parsed }
  } catch {
    return defaultPrefs()
  }
}

function defaultPrefs(): DispatchPrefs {
  return {
    lastAgent: 'claude',
    lastTarget: 'local',
    lastCloudProvider: 'rush',
    notifyOnQuestion: true,
    notifyOnFinish: true,
    notifyChannel: 'ios',
    lastCodexEnv: '',
    recentRepos: [],
  }
}

function saveDispatchPrefs(p: DispatchPrefs): void {
  try { localStorage.setItem(DISPATCH_PREFS_KEY, JSON.stringify(p)) } catch { /* ignore */ }
}

/** Push repos to the front of the MRU list, dedupe, cap at MRU_MAX. */
function bumpRecentRepos(existing: string[], used: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of used) {
    if (!r || seen.has(r)) continue
    seen.add(r)
    out.push(r)
  }
  for (const r of existing) {
    if (!r || seen.has(r)) continue
    seen.add(r)
    out.push(r)
  }
  return out.slice(0, MRU_MAX)
}

function TaskDetailModal({ task, onClose, onDispatch }: {
  task: UnifiedTask
  onClose: () => void
  onDispatch: (args: {
    agent: string
    target: 'local' | 'cloud'
    cloudProvider: CloudProviderId
    branch: string
    codexEnv: string
    targetRepos: string[]
    notify: { onQuestion: boolean; onFinish: boolean; channel: string }
  }) => void
}) {
  const prefs = useRef<DispatchPrefs>(loadDispatchPrefs())
  const [agent, setAgent] = useState(prefs.current.lastAgent)
  const [target, setTarget] = useState<'local' | 'cloud'>(prefs.current.lastTarget)
  const [cloudProvider, setCloudProvider] = useState<CloudProviderId>(prefs.current.lastCloudProvider)
  const [branch, setBranch] = useState('')
  const [codexEnv, setCodexEnv] = useState(prefs.current.lastCodexEnv)
  const [notifyOnQuestion, setNotifyOnQuestion] = useState(prefs.current.notifyOnQuestion)
  const [notifyOnFinish, setNotifyOnFinish] = useState(prefs.current.notifyOnFinish)
  const [notifyChannel, setNotifyChannel] = useState(prefs.current.notifyChannel)

  // Seed selected repos from Linear `repo:<name>` labels. Repo picker lets
  // user add/remove; suggestions come from `gh repo list <owner>`.
  const initialRepos = useMemo(() => {
    const labelRepos = (task.metadata.labels || []).filter((l) => l.startsWith('repo:')).map((l) => l.slice(5))
    return labelRepos
  }, [task.metadata.labels])
  const [selectedRepos, setSelectedRepos] = useState<string[]>(initialRepos)
  const [repoOwner, setRepoOwner] = useState<string>('')
  const [availableRepos, setAvailableRepos] = useState<string[]>([])
  const [repoInput, setRepoInput] = useState('')
  const [repoSuggestOpen, setRepoSuggestOpen] = useState(false)
  const [branchSuggestOpen, setBranchSuggestOpen] = useState(false)
  // Branches keyed by repo — cached per-modal-open so switching back to a
  // repo that was already fetched is instant. Includes the repo's default
  // branch so the UI can mark it.
  const [branchesByRepo, setBranchesByRepo] = useState<Record<string, { branches: string[]; defaultBranch: string }>>({})

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    postMessage({ type: 'fetchGithubRepos' })
    const onMsg = (event: MessageEvent) => {
      const msg = event.data
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'githubReposList') {
        setRepoOwner(typeof msg.owner === 'string' ? msg.owner : '')
        setAvailableRepos(Array.isArray(msg.repos) ? msg.repos : [])
      }
      if (msg.type === 'githubBranchesList') {
        const repo = typeof msg.repo === 'string' ? msg.repo : ''
        const branches: string[] = Array.isArray(msg.branches) ? msg.branches : []
        const defaultBranch: string = typeof msg.defaultBranch === 'string' ? msg.defaultBranch : ''
        if (repo) setBranchesByRepo((prev) => ({ ...prev, [repo]: { branches, defaultBranch } }))
      }
    }
    window.addEventListener('message', onMsg)
    return () => {
      window.removeEventListener('keydown', esc)
      window.removeEventListener('message', onMsg)
    }
  }, [onClose])

  // When exactly one repo is selected, fetch its branches (cached).
  // Multi-repo dispatch (Rush Cloud) passes a single --branch applied to all
  // clones — we still let the user type, but don't fetch suggestions because
  // branches differ per repo.
  useEffect(() => {
    if (selectedRepos.length !== 1) return
    const repo = selectedRepos[0]
    if (branchesByRepo[repo]) return
    postMessage({ type: 'fetchGithubBranches', repo })
  }, [selectedRepos, branchesByRepo])

  // Persist selections on EVERY change so that closing the modal without
  // clicking Dispatch still remembers what the user picked. Previously we
  // only saved inside handleDispatch, which meant a half-configured modal
  // dismissed via Cancel/Escape would lose the user's choices on reopen.
  useEffect(() => {
    const next: DispatchPrefs = {
      lastAgent: agent,
      lastTarget: target,
      lastCloudProvider: cloudProvider,
      notifyOnQuestion,
      notifyOnFinish,
      notifyChannel,
      lastCodexEnv: codexEnv,
      recentRepos: prefs.current.recentRepos,
    }
    saveDispatchPrefs(next)
    prefs.current = next
  }, [agent, target, cloudProvider, notifyOnQuestion, notifyOnFinish, notifyChannel, codexEnv])

  const singleRepo = selectedRepos.length === 1 ? selectedRepos[0] : ''
  const branchInfo = singleRepo ? branchesByRepo[singleRepo] : undefined
  const branchesForRepo = branchInfo?.branches || []
  const defaultBranch = branchInfo?.defaultBranch || ''
  const branchSuggestions = useMemo(() => {
    const q = branch.trim().toLowerCase()
    const matches = branchesForRepo.filter((b) => !q || b.toLowerCase().includes(q))
    // Pin the default branch to the top if it passes the filter.
    if (defaultBranch && matches.includes(defaultBranch)) {
      const rest = matches.filter((b) => b !== defaultBranch)
      return [defaultBranch, ...rest].slice(0, 8)
    }
    return matches.slice(0, 8)
  }, [branchesForRepo, branch, defaultBranch])

  const addRepo = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    // Accept bare name (suffix owner/) or owner/name
    const full = trimmed.includes('/') ? trimmed : (repoOwner ? `${repoOwner}/${trimmed}` : trimmed)
    if (selectedRepos.includes(full)) return
    setSelectedRepos((prev) => [...prev, full])
    setRepoInput('')
    setRepoSuggestOpen(false)
  }

  const removeRepo = (name: string) => {
    setSelectedRepos((prev) => prev.filter((r) => r !== name))
  }

  const repoSuggestions = useMemo(() => {
    const q = repoInput.trim().toLowerCase()
    const recent = prefs.current.recentRepos.filter((r) =>
      !selectedRepos.includes(r) && (!q || r.toLowerCase().includes(q))
    )
    const rest = availableRepos.filter((r) =>
      !selectedRepos.includes(r) && !recent.includes(r) && (!q || r.toLowerCase().includes(q))
    )
    // Recently-used repos first (up to 3), then the rest from gh repo list.
    // Mark recents so the UI can style/label them; cap total at 8.
    const out: { repo: string; recent: boolean }[] = []
    for (const r of recent.slice(0, 3)) out.push({ repo: r, recent: true })
    for (const r of rest) {
      if (out.length >= 8) break
      out.push({ repo: r, recent: false })
    }
    return out
  }, [availableRepos, selectedRepos, repoInput])

  const runTarget: 'local' | 'rush' | 'codex' = target === 'local' ? 'local' : cloudProvider === 'codex' ? 'codex' : 'rush'

  const modelsForTarget: Array<{ id: string; label: string }> = (() => {
    if (runTarget === 'local') return [
      { id: 'claude', label: 'Claude' },
      { id: 'codex', label: 'Codex' },
      { id: 'gemini', label: 'Gemini' },
    ]
    if (runTarget === 'rush') return [
      { id: 'claude', label: 'Claude' },
      { id: 'codex', label: 'Codex' },
    ]
    return [{ id: 'codex', label: 'Codex' }]
  })()

  useEffect(() => {
    if (!modelsForTarget.some((m) => m.id === agent)) {
      setAgent(modelsForTarget[0].id)
    }
  }, [runTarget, agent, modelsForTarget])

  const priorityCls = task.priority === 'urgent' ? 'urgent' : task.priority === 'high' ? 'high' : 'medium'
  const priorityLabel = task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : 'Medium'

  const createdAt = (task as UnifiedTask & { createdAt?: string }).createdAt
  const createdRel = createdAt ? relTime(new Date(createdAt).getTime()) : null

  const canDispatch = (runTarget !== 'codex' || codexEnv.trim().length > 0) && (
    runTarget === 'local' || selectedRepos.length > 0 || runTarget === 'rush' || runTarget === 'codex'
  )

  const handleDispatch = () => {
    // All other prefs are already persisted by the on-change effect above.
    // Dispatch only needs to bump the MRU repo list, which is the only
    // thing that should change on an actual dispatch (vs idle selection).
    const next: DispatchPrefs = {
      ...prefs.current,
      recentRepos: bumpRecentRepos(prefs.current.recentRepos, selectedRepos),
    }
    saveDispatchPrefs(next)
    prefs.current = next
    onDispatch({
      agent,
      target,
      cloudProvider,
      branch: branch.trim(),
      codexEnv: codexEnv.trim(),
      targetRepos: selectedRepos,
      notify: { onQuestion: notifyOnQuestion, onFinish: notifyOnFinish, channel: notifyChannel },
    })
  }

  return (
    <div className="sw-dispatch-modal-overlay" onMouseDown={onClose} role="dialog" aria-modal="true">
      <div className="sw-task-detail-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sw-task-detail-head">
          <div className="sw-task-detail-head-top">
            <span className={`sw-queue-priority-led ${priorityCls}`} />
            {task.metadata.identifier && (
              <span className="sw-queue-badge">{task.metadata.identifier}</span>
            )}
            <span className={`sw-queue-priority-label ${priorityCls}`}>{priorityLabel}</span>
            <span className="sw-task-detail-meta">
              {task.source}{createdRel ? ` - created ${createdRel}` : ''}
            </span>
            <button className="sw-dispatch-modal-close" onClick={onClose} aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="sw-task-detail-title">{task.title}</div>
        </div>

        <div className="sw-task-detail-body">
          {task.description ? (
            <pre className="sw-task-detail-desc">{task.description}</pre>
          ) : (
            <div className="sw-task-detail-desc sw-task-detail-desc-empty">No description.</div>
          )}
        </div>

        <div className="sw-task-detail-form">
          <div className="sw-task-detail-row">
            <label className="sw-task-detail-label">Run on</label>
            <div className="sw-task-detail-seg">
              <button
                type="button"
                className={`sw-task-detail-seg-btn ${target === 'local' ? 'active' : ''}`}
                onClick={() => setTarget('local')}
              >Local</button>
              <button
                type="button"
                className={`sw-task-detail-seg-btn ${target === 'cloud' && cloudProvider === 'rush' ? 'active' : ''}`}
                onClick={() => { setTarget('cloud'); setCloudProvider('rush') }}
              >Rush Cloud</button>
              <button
                type="button"
                className={`sw-task-detail-seg-btn ${target === 'cloud' && cloudProvider === 'codex' ? 'active' : ''}`}
                onClick={() => { setTarget('cloud'); setCloudProvider('codex') }}
              >Codex Cloud</button>
            </div>
          </div>

          <div className="sw-task-detail-row">
            <label className="sw-task-detail-label">Model</label>
            <div className="sw-task-detail-seg">
              {modelsForTarget.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`sw-task-detail-seg-btn ${agent === m.id ? 'active' : ''}`}
                  onClick={() => setAgent(m.id)}
                >{m.label}</button>
              ))}
            </div>
          </div>

          {runTarget !== 'local' && (
            <div className="sw-task-detail-row sw-task-detail-row-repos">
              <label className="sw-task-detail-label">
                {runTarget === 'rush' ? 'Repositories' : 'Repository'}
              </label>
              <div className="sw-task-detail-repos-picker">
                <div className="sw-task-detail-repo-chips">
                  {selectedRepos.map((r) => (
                    <span key={r} className="sw-task-detail-repo-chip">
                      {r}
                      <button
                        type="button"
                        className="sw-task-detail-repo-chip-x"
                        onClick={() => removeRepo(r)}
                        aria-label={`Remove ${r}`}
                      >
                        <Icon name="x" size={10} />
                      </button>
                    </span>
                  ))}
                  {selectedRepos.length === 0 && (
                    <span className="sw-task-detail-hint">
                      {runTarget === 'rush' ? 'Add one or more repos' : 'Add a repo'}
                    </span>
                  )}
                </div>
                <div className="sw-task-detail-repo-input-wrap">
                  <input
                    type="text"
                    className="sw-task-detail-input"
                    placeholder={repoOwner ? `${repoOwner}/repo or paste owner/repo` : 'owner/repo'}
                    value={repoInput}
                    onChange={(e) => { setRepoInput(e.target.value); setRepoSuggestOpen(true) }}
                    onFocus={() => setRepoSuggestOpen(true)}
                    onBlur={() => setTimeout(() => setRepoSuggestOpen(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && repoInput.trim()) {
                        e.preventDefault()
                        addRepo(repoInput)
                      }
                      if (runTarget === 'codex' && selectedRepos.length >= 1) {
                        // Codex Cloud rejects multi-repo — block typing more.
                        e.preventDefault()
                      }
                    }}
                    disabled={runTarget === 'codex' && selectedRepos.length >= 1}
                  />
                  {repoSuggestOpen && repoSuggestions.length > 0 && (
                    <div className="sw-task-detail-repo-suggest">
                      {repoSuggestions.map(({ repo, recent }) => (
                        <button
                          key={repo}
                          type="button"
                          className={`sw-task-detail-repo-suggest-item ${recent ? 'recent' : ''}`}
                          onMouseDown={(e) => { e.preventDefault(); addRepo(repo) }}
                        >
                          <span className="sw-task-detail-repo-suggest-name">{repo}</span>
                          {recent && <span className="sw-task-detail-repo-suggest-badge">Recent</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {runTarget === 'codex' && (
                  <div className="sw-task-detail-hint">Codex Cloud: one repo per task (env bundles multi-repo).</div>
                )}
              </div>
            </div>
          )}

          {runTarget === 'codex' && (
            <div className="sw-task-detail-row">
              <label className="sw-task-detail-label">Codex env</label>
              <input
                type="text"
                className="sw-task-detail-input"
                placeholder="env_abc123"
                value={codexEnv}
                onChange={(e) => setCodexEnv(e.target.value)}
              />
            </div>
          )}

          {runTarget !== 'local' && (
            <div className="sw-task-detail-row">
              <label className="sw-task-detail-label">Branch</label>
              <div className="sw-task-detail-repo-input-wrap">
                <input
                  type="text"
                  className="sw-task-detail-input"
                  placeholder={
                    selectedRepos.length > 1
                      ? 'main (applied to all repos)'
                      : defaultBranch
                        ? `${defaultBranch} (default)`
                        : 'main (default)'
                  }
                  value={branch}
                  onChange={(e) => { setBranch(e.target.value); setBranchSuggestOpen(true) }}
                  onFocus={() => setBranchSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setBranchSuggestOpen(false), 150)}
                />
                {branchSuggestOpen && branchSuggestions.length > 0 && (
                  <div className="sw-task-detail-repo-suggest">
                    {branchSuggestions.map((b) => {
                      const isDefault = b === defaultBranch
                      return (
                        <button
                          key={b}
                          type="button"
                          className={`sw-task-detail-repo-suggest-item ${isDefault ? 'recent' : ''}`}
                          onMouseDown={(e) => { e.preventDefault(); setBranch(b); setBranchSuggestOpen(false) }}
                        >
                          <span className="sw-task-detail-repo-suggest-name">{b}</span>
                          {isDefault && <span className="sw-task-detail-repo-suggest-badge">Default</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
                {selectedRepos.length > 1 && (
                  <div className="sw-task-detail-hint">One branch applies to every selected repo.</div>
                )}
              </div>
            </div>
          )}

          <div className="sw-task-detail-row sw-task-detail-row-notify">
            <label className="sw-task-detail-label">Notify me</label>
            <div className="sw-task-detail-notify">
              <label className="sw-task-detail-check">
                <input
                  type="checkbox"
                  checked={notifyOnQuestion}
                  onChange={(e) => setNotifyOnQuestion(e.target.checked)}
                />
                <span>When it asks a question</span>
              </label>
              <label className="sw-task-detail-check">
                <input
                  type="checkbox"
                  checked={notifyOnFinish}
                  onChange={(e) => setNotifyOnFinish(e.target.checked)}
                />
                <span>When it finishes</span>
              </label>
              <div className="sw-task-detail-channel">
                <span className="sw-task-detail-hint">Channel</span>
                <select
                  className="sw-task-detail-input sw-task-detail-select"
                  value={notifyChannel}
                  onChange={(e) => setNotifyChannel(e.target.value)}
                  disabled={!notifyOnQuestion && !notifyOnFinish}
                >
                  <option value="ios">iOS push</option>
                  <option value="email">Email</option>
                  <option value="linear">Linear comment</option>
                  <option value="none">None</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="sw-task-detail-foot">
          <button className="sw-btn secondary" onClick={onClose}>Cancel</button>
          <button className="sw-btn-dispatch" onClick={handleDispatch} disabled={!canDispatch}>
            Dispatch
          </button>
        </div>
      </div>
    </div>
  )
}
