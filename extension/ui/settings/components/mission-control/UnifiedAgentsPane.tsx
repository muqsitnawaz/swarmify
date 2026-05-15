import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { TaskSummary, TerminalDetail as TerminalInfo, AgentDetail, UnifiedTask, RecentToolCall } from '../../types'
import { AgentAvatar, agentShortChunk } from './AgentAvatar'
import { Icon } from './icons'
import { relTime, taskNameToTitle, swarmOverallStatus, shortDuration } from './types'
import { postMessage, usePanelVisibility } from '../../hooks'
import { ExtLink } from '../common'
import { renderTodoDescription } from '../../utils/markdown'
import { CMD_PALETTE_EVENTS } from './CommandPalette'
import { CloudActivityFeed } from './CloudActivityFeed'
import {
  isTerminalActive,
  isTerminalJustSpawned,
  reconcilePending,
  pruneExpiredPending,
  markTimedOutPending,
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

export interface WatchdogEventUI {
  ts: number
  kind: 'tick' | 'decision' | 'nudge' | 'rotate' | 'error'
  terminalId?: string
  agentType?: string
  message: string
  reason?: string
  tailLines?: string[]
  stalledForMs?: number
}

interface UnifiedAgent {
  kind: 'terminal' | 'headless' | 'cloud' | 'team' | 'watchdog'
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
  // Watchdog-specific
  watchdogEvents?: WatchdogEventUI[]
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

function kindBadge(kind: UnifiedAgent['kind']): string {
  switch (kind) {
    case 'terminal': return 'terminal'
    case 'headless': return 'headless'
    case 'cloud': return 'cloud'
    case 'team': return 'team'
    case 'watchdog': return 'watchdog'
  }
}

function statusLabel(status: UnifiedAgent['status']): string {
  return status
}

// Throughput counter -- live pulsing sparkline for LLM output tok/s
export function ThroughputCounter({ tokensPerSec }: { tokensPerSec: number }) {
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

interface UnifiedAgentsPaneProps {
  terminals: TerminalInfo[]
  tasks: TaskSummary[]
  tasksLoading: boolean
  unifiedTasks: UnifiedTask[]
  unifiedTasksLoading: boolean
  onDispatch: () => void
  onNavigate?: (tab: 'floor' | 'bench' | 'panel') => void
  openDispatchTrigger?: number
  openDetailTaskId?: string | null
  onDetailTaskConsumed?: () => void
  onThroughputChange?: (tokensPerSec: number) => void
  githubRepo?: string | null
  watchdogEnabled?: boolean
  watchdogEvents?: WatchdogEventUI[]
}

export function UnifiedAgentsPane({ terminals, tasks, tasksLoading, unifiedTasks, unifiedTasksLoading, onDispatch, onNavigate, openDispatchTrigger, openDetailTaskId, onDetailTaskConsumed, onThroughputChange, githubRepo, watchdogEnabled = false, watchdogEvents = [] }: UnifiedAgentsPaneProps) {
  const panelVisible = usePanelVisibility()
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [statPopover, setStatPopover] = useState<'shipped' | 'open' | 'running' | 'nextup' | 'files' | null>(null)
  const [dispatchOpen, setDispatchOpen] = useState(false)
  useEffect(() => {
    if (openDispatchTrigger !== undefined && openDispatchTrigger > 0) setDispatchOpen(true)
  }, [openDispatchTrigger])
  useEffect(() => {
    if (!openDetailTaskId) return
    const task = unifiedTasks.find(t => t.id === openDetailTaskId)
    if (!task) return
    setDetailSiblings([])
    setDetailTask(task)
    onDetailTaskConsumed?.()
  }, [openDetailTaskId, unifiedTasks, onDetailTaskConsumed])
  const [activeFilter, setActiveFilter] = useState<'all' | 'local' | 'cloud'>('all')
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null)
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
  // Sibling tasks for TaskDetailModal's in-header switcher. Populated when
  // the user hands off from DispatchModal; empty otherwise (direct task
  // click from queue cards doesn't carry a sibling set).
  const [detailSiblings, setDetailSiblings] = useState<UnifiedTask[]>([])
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
      // Two-step lifecycle: flip pending→timedOut at TTL (user sees the
      // warning), then fully remove once retention window has also passed.
      // Both functions return the same reference when nothing changes, so
      // the setState is a no-op in the steady state.
      const flipped = markTimedOutPending(prev, now)
      const pruned = pruneExpiredPending(flipped, now)
      return pruned
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

  // Listen for command-palette-dispatched events. We can't call into
  // App.tsx's state from here, and we don't want to lift detailTask
  // state up a level just for the palette — so the palette fires
  // window-level CustomEvents and we pick them up here.
  useEffect(() => {
    const onOpenTask = (e: Event) => {
      const ev = e as CustomEvent<{ taskId: string }>
      const taskId = ev.detail?.taskId
      if (!taskId) return
      const task = unifiedTasks.find((t) => t.id === taskId)
      if (!task) return
      setDetailSiblings([])
      setDetailTask(task)
    }
    const onFocusTerm = (e: Event) => {
      const ev = e as CustomEvent<{ terminalId: string }>
      const id = ev.detail?.terminalId
      if (!id) return
      postMessage({ type: 'focusTerminal', terminalId: id })
    }
    window.addEventListener(CMD_PALETTE_EVENTS.openTaskDetail, onOpenTask)
    window.addEventListener(CMD_PALETTE_EVENTS.focusTerminal, onFocusTerm)
    return () => {
      window.removeEventListener(CMD_PALETTE_EVENTS.openTaskDetail, onOpenTask)
      window.removeEventListener(CMD_PALETTE_EVENTS.focusTerminal, onFocusTerm)
    }
  }, [unifiedTasks])

  const baseItems = useMemo(() => {
    const list = buildUnifiedList(terminals, tasks)
    if (watchdogEnabled) {
      const lastEvent = watchdogEvents[watchdogEvents.length - 1]
      const lastNudge = [...watchdogEvents].reverse().find((e) => e.kind === 'nudge')
      const activity = lastNudge
        ? `Nudged ${lastNudge.terminalId?.split('-')[0] ?? 'terminal'} · ${relTime(new Date(lastNudge.ts).toISOString())}`
        : lastEvent
          ? `Last scan ${relTime(new Date(lastEvent.ts).toISOString())}`
          : 'Monitoring'
      list.unshift({
        kind: 'watchdog',
        id: 'watchdog',
        agentType: 'watchdog',
        displayName: 'Watchdog',
        activity,
        active: true,
        duration: '',
        timestamp: lastEvent ? new Date(lastEvent.ts).toISOString() : new Date().toISOString(),
        status: 'running',
        files: [],
        toolCalls: 0,
        watchdogEvents,
      })
    }
    return list
  }, [terminals, tasks, watchdogEnabled, watchdogEvents])

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
    // Only render still-pending dispatches as optimistic cards. Timed-out
    // ones are surfaced as a separate dismissable banner above the grid
    // (see `timedOutDispatches` + banner render below) so they stand out
    // visually instead of masquerading as a running agent.
    return pendingDispatches
      .filter((p) => (p.status ?? 'pending') !== 'timedOut')
      .map((p) => ({
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

  // Timed-out dispatches surfaced as a warning banner. Collected separately
  // so the banner renders above the active grid and can be individually
  // dismissed without affecting still-pending entries.
  const timedOutDispatches = useMemo(() => {
    void tick
    return pendingDispatches.filter((p) => (p.status ?? 'pending') === 'timedOut')
  }, [pendingDispatches, tick])

  const dismissPending = (id: string) => {
    setPendingDispatches((prev) => prev.filter((p) => p.id !== id))
  }

  const items = useMemo(() => [...optimisticItems, ...baseItems], [optimisticItems, baseItems])
  const activeItems = useMemo(() => items.filter((i) => i.active), [items])
  const recentItems = useMemo(() => items.filter((i) => !i.active), [items])

  const pendingTaskIds = useMemo(
    () => new Set(pendingDispatches.map((p) => p.taskId)),
    [pendingDispatches]
  )

  // Queue eligible pool: urgent/high todo tasks not currently being dispatched.
  // Project filter is applied on top of this for the NEXT UP strip.
  const queueEligible = useMemo(() => {
    const eligible = unifiedTasks.filter(
      (t) => t.status === 'todo' && (t.priority === 'urgent' || t.priority === 'high')
    )
    return filterDispatchedTaskIds(eligible, pendingTaskIds)
  }, [unifiedTasks, pendingTaskIds])

  // Repo name of the workspace currently open in the IDE (e.g. "swarmify"
  // from "muqsitnawaz/swarmify"). Used to default the Next Up filter so
  // dispatches stay scoped to the repo the user is actually working on.
  const workspaceRepoName = useMemo(() => {
    if (!githubRepo) return null
    return githubRepo.includes('/') ? githubRepo.split('/').pop()! : githubRepo
  }, [githubRepo])

  const [queueRepoFilter, setQueueRepoFilter] = useState<string>(() => workspaceRepoName ?? 'all')
  const queueRepoFilterUserSet = useRef(false)

  // Distinct repo names present in the eligible queue. Derived from the
  // repo:* label on each Linear issue (resolved to "owner/repo" at fetch
  // time). Shown as just the repo name in the dropdown since they all share
  // the same owner.
  const queueRepos = useMemo(() => {
    const seen = new Set<string>()
    for (const t of queueEligible) {
      const full = t.metadata.repo
      if (!full) continue
      const name = full.includes('/') ? full.split('/').pop()! : full
      seen.add(name)
    }
    return Array.from(seen).sort()
  }, [queueEligible])

  // Once the workspace repo is known and there's at least one task tagged
  // for it, snap the filter to it — but only if the user hasn't manually
  // overridden the dropdown.
  useEffect(() => {
    if (queueRepoFilterUserSet.current) return
    if (!workspaceRepoName) return
    if (queueRepos.includes(workspaceRepoName) && queueRepoFilter !== workspaceRepoName) {
      setQueueRepoFilter(workspaceRepoName)
    }
  }, [workspaceRepoName, queueRepos, queueRepoFilter])

  // When the selected repo drains out of the eligible pool (all its tasks
  // got dispatched), fall back to "all" rather than showing an empty queue
  // the user can't clear without touching the dropdown. Skip this for the
  // workspace repo so a transient empty queue doesn't drop the user's repo
  // scope.
  useEffect(() => {
    if (queueRepoFilter === 'all') return
    if (queueRepoFilter === workspaceRepoName) return
    if (!queueRepos.includes(queueRepoFilter)) {
      setQueueRepoFilter('all')
    }
  }, [queueRepoFilter, queueRepos, workspaceRepoName])

  const queueTasks = useMemo(() => {
    const filtered = queueRepoFilter === 'all'
      ? queueEligible
      : queueEligible.filter((t) => {
          const full = t.metadata.repo
          if (!full) return false
          const name = full.includes('/') ? full.split('/').pop()! : full
          return name === queueRepoFilter
        })
    return filtered.slice(0, 4)
  }, [queueEligible, queueRepoFilter])

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
      onThroughputChange?.(0)
      return
    }
    if (!panelVisible) return
    const poll = () => postMessage({ type: 'getFloorThroughput' })
    poll()
    const id = setInterval(poll, 2500)
    return () => clearInterval(id)
  }, [activeItems.length, onThroughputChange, panelVisible])
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data
      if (msg?.type === 'floorThroughputData' && typeof msg.tokensPerSec === 'number') {
        setLiveThroughput(msg.tokensPerSec)
        onThroughputChange?.(msg.tokensPerSec)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onThroughputChange])

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
      {/* Intake Q&A -- teammates waiting on a human answer */}
      {intakeTeams.length > 0 && (
        <div className="sw-intake-section">
          {intakeTeams.map((team) => (
            <IntakeBanner key={team.team} team={team.team} teammates={team.agents} />
          ))}
        </div>
      )}

      {/* Next Up -- scheduled / urgent tasks about to run */}
      {queueEligible.length > 0 && (
        <div className="sw-queue-section" ref={nextUpSectionRef}>
          <div className="sw-section-header-row">
            <span className="sw-section-label">Next Up</span>
            <span className="sw-section-count-pill">{queueTasks.length}</span>
            <span className="sw-section-hint">Click a card to configure and dispatch</span>
            <span className="sw-section-line" />
            {(workspaceRepoName || queueRepos.length >= 2) && (
              <select
                className="sw-queue-project-select mono"
                value={queueRepoFilter}
                onChange={(e) => {
                  queueRepoFilterUserSet.current = true
                  setQueueRepoFilter(e.target.value)
                }}
                aria-label="Filter Next Up by repo"
              >
                {workspaceRepoName && !queueRepos.includes(workspaceRepoName) && (
                  <option value={workspaceRepoName}>{workspaceRepoName} (this repo)</option>
                )}
                <option value="all">All repos</option>
                {queueRepos.map((r) => (
                  <option key={r} value={r}>
                    {r}{r === workspaceRepoName ? ' (this repo)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {queueTasks.length > 0 ? (
            <div className="sw-queue-cards">
              {queueTasks.map((task) => (
                <DispatchCard key={task.id} task={task} onOpen={setDetailTask} />
              ))}
            </div>
          ) : (
            <div className="sw-queue-empty">
              No tasks in repo <b>{queueRepoFilter}</b>.{' '}
              <button type="button" className="sw-link-btn" onClick={() => setQueueRepoFilter('all')}>
                Show all repos
              </button>
            </div>
          )}
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
                    data-foreman-id={`active-filter-${key}`}
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
              <button data-foreman-id="new-btn" className="sw-btn secondary sm" onClick={() => setNewMenuOpen((o) => !o)}>
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
            <button data-foreman-id="dispatch-btn" className="sw-btn primary sm" onClick={() => setDispatchOpen(true)}>
              <Icon name="dispatch" size={11} />
              Dispatch
            </button>
          </div>

          {timedOutDispatches.length > 0 && (
            <div className="sw-dispatch-timeout-banner" role="alert">
              {timedOutDispatches.map((p) => (
                <div key={p.id} className="sw-dispatch-timeout-row">
                  <Icon name="zap" size={12} />
                  <span className="sw-dispatch-timeout-text">
                    {optimisticActivityLabel(p)}
                  </span>
                  <button
                    className="sw-btn secondary sm"
                    onClick={() => {
                      postMessage({ type: 'focusRushCloudTerminal' })
                    }}
                    title="Jump to the Rush Cloud terminal for logs"
                  >
                    Show terminal
                  </button>
                  <button
                    className="sw-btn ghost sm"
                    onClick={() => dismissPending(p.id)}
                    aria-label="Dismiss"
                    title="Dismiss"
                  >
                    <Icon name="x" size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {(() => {
            const visibleActive = activeItems.filter((item) => activeFilter === 'all' || (activeFilter === 'cloud' ? item.kind === 'cloud' : item.kind !== 'cloud'))
            const visibleRecent = recentItems.slice(0, 7)
            const selectable = [...visibleActive, ...visibleRecent]
            const fallbackSelected = visibleActive[0] ?? null
            const selected = expandedAgentId
              ? selectable.find((i) => i.id === expandedAgentId) ?? fallbackSelected
              : fallbackSelected
            return (
              <div className="sw-floor-active">
                <div className="sw-floor-active-list">
                  {visibleActive.map((item) => (
                    <AgentCard
                      key={item.id}
                      item={item}
                      selected={selected?.id === item.id}
                      onSelect={(id) => setExpandedAgentId(id)}
                    />
                  ))}
                  {activeItems.length > 0 && visibleActive.length === 0 && (
                    <div className="sw-active-filter-empty">No {activeFilter} agents running.</div>
                  )}
                  {recentItems.length > 0 && (
                    <>
                      <div className="sw-floor-recent-divider">
                        <span>Recent</span>
                      </div>
                      {visibleRecent.map((item) => (
                        <AgentCard
                          key={item.id}
                          item={item}
                          selected={selected?.id === item.id}
                          onSelect={(id) => setExpandedAgentId(id)}
                          dimmed
                          onRetry={handleRetry}
                        />
                      ))}
                    </>
                  )}
                </div>
                <div className="sw-floor-active-detail">
                  {selected ? (
                    <DetailPane
                      item={selected}
                      onClose={() => setExpandedAgentId(null)}
                      onFocusTerminal={handleFocusTerminal}
                      onRetry={handleRetry}
                      onKill={handleKill}
                    />
                  ) : (
                    <div className="sw-floor-active-detail-empty">
                      <Icon name="inbox" size={22} />
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)' }}>
                        Select an agent to see its activity
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--ds-text-dim)' }}>
                        Each card shows current status, recent commands, and the files an agent has touched.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
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
          onOpenDetail={(task, siblings) => {
            setDispatchOpen(false)
            setDetailSiblings(siblings)
            setDetailTask(task)
          }}
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
          tasks={detailSiblings.length > 0 ? detailSiblings : undefined}
          onClose={() => { setDetailTask(null); setDetailSiblings([]) }}
          onBack={detailSiblings.length > 0
            ? () => { setDetailTask(null); setDetailSiblings([]); setDispatchOpen(true) }
            : undefined}
          onTaskSwitch={(next) => setDetailTask(next)}
          onDispatch={({ agent, target, cloudProvider, branch, codexEnv, notify }) => {
            handleDispatchTask(detailTask, agent, target, undefined, cloudProvider, notify, branch, codexEnv)
            setDetailTask(null)
            setDetailSiblings([])
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
  const [filter, setFilter] = useState('')
  // Empty pre-selection signals the "Linear task has no repo: label, pick
  // one from the owner's full list" flow. Switch the title + subcopy so the
  // user understands they must make a choice vs. narrow from multiple.
  const isEmptyPick = preSelected.length === 0
  // Filter only shows value when there are many rows to scroll — show it
  // when there are more than 8 repos (roughly one screen of the list).
  const showFilter = repos.length > 8
  const filterRef = useRef<HTMLInputElement | null>(null)
  const filteredRepos = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return repos
    return repos.filter((r) => r.toLowerCase().includes(q))
  }, [repos, filter])
  const confirm = () => {
    const selected = repos.filter((r) => checked.has(r))
    if (selected.length === 0) return
    onConfirm(selected)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      // Enter confirms the current selection. Skip when focus is in the
      // filter input (typing + Enter in a text field shouldn't submit) —
      // that case is handled inline below.
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement && e.target.type === 'text')) {
        if (checked.size > 0) { e.preventDefault(); confirm() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, checked, repos])
  useEffect(() => {
    if (showFilter) filterRef.current?.focus()
  }, [showFilter])
  const toggle = (r: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(r)) next.delete(r); else next.add(r)
      return next
    })
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
          {showFilter && (
            <input
              ref={filterRef}
              type="text"
              className="sw-dispatch-modal-search-input"
              placeholder={`Filter ${repos.length} repos...`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && checked.size > 0) {
                  e.preventDefault()
                  confirm()
                }
              }}
              style={{ width: '100%', marginBottom: 8 }}
            />
          )}
          <ul className="sw-dispatch-modal-list">
            {filteredRepos.map((r) => (
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
            {filteredRepos.length === 0 && (
              <li className="sw-dispatch-modal-row" style={{ opacity: 0.6, fontSize: 12, padding: '8px 12px' }}>
                No repos match "{filter}"
              </li>
            )}
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
function DispatchModal({ tasks, loading, onClose, onDispatch, onDispatchBatch, onComplete, onOpenDetail }: {
  tasks: UnifiedTask[]
  loading: boolean
  onClose: () => void
  onDispatch: (task: UnifiedTask, agentType: string, target: 'local' | 'cloud') => void
  onDispatchBatch: (tasks: UnifiedTask[], agentType: string, target: 'local' | 'cloud') => void
  onComplete: () => void
  // Called when the user clicks a single task row (not a checkbox). Parent
  // closes this list modal and opens TaskDetailModal with the full config
  // form + task-switcher so navigation between tasks stays fluid.
  onOpenDetail: (task: UnifiedTask, siblings: UnifiedTask[]) => void
}) {
  const [query, setQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgent' | 'high'>('all')
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
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

  const focusedTask = filtered.find((t) => t.id === focusedTaskId) || filtered[0]
  const batchMode = checkedIds.size > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
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
        onOpenDetail(focusedTask, filtered)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, filtered, focusedTask, batchMode, onOpenDetail])

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
                      ref={isFocused ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                      className={`sw-dispatch-modal-row ${isFocused ? 'selected' : ''} ${isChecked ? 'checked' : ''}`}
                      onClick={() => {
                        setFocusedTaskId(task.id)
                        // Hand off to parent: close this list modal and open
                        // the rich TaskDetailModal with sibling tasks so the
                        // switcher in its header is pre-populated.
                        onOpenDetail(task, filtered)
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

type IdentityLabel = { text: string; variant: 'plain' | 'cloud' | 'team' | 'plan' | 'ralph' | 'auto' }

function identityLabel(item: UnifiedAgent): IdentityLabel {
  const termLabel = item.terminal?.label?.trim()
  if (termLabel) return { text: termLabel, variant: 'plain' }
  if (item.kind === 'team') {
    const n = item.teamAgents?.length ?? 0
    return { text: n > 0 ? `TEAM · ${n}` : 'TEAM', variant: 'team' }
  }
  if (item.kind === 'cloud' || item.mode === 'cloud') {
    return { text: 'CLOUD', variant: 'cloud' }
  }
  if (item.mode === 'plan') return { text: 'PLAN', variant: 'plan' }
  if (item.mode === 'ralph') return { text: 'RALPH', variant: 'ralph' }
  if (item.mode === 'auto') return { text: 'AUTO', variant: 'auto' }
  const chunk = agentShortChunk(item.terminal?.sessionId) || item.id.slice(-8)
  return { text: chunk, variant: 'plain' }
}

function statusPhrase(item: UnifiedAgent): { word: string; tone: 'running' | 'idle' | 'failed' | 'completed' | 'waiting'; when: string } {
  if (item.status === 'failed') {
    return { word: 'Failed', tone: 'failed', when: item.timestamp ? relTime(item.timestamp) : '' }
  }
  if (item.status === 'completed') {
    return { word: 'Done', tone: 'completed', when: item.timestamp ? relTime(item.timestamp) : '' }
  }
  if (item.terminal?.waitingForInput && (item.status === 'running' || item.active)) {
    return { word: 'Waiting', tone: 'waiting', when: item.duration || (item.timestamp ? relTime(item.timestamp) : '') }
  }
  if (item.status === 'running' || item.active) {
    return { word: 'Running', tone: 'running', when: item.duration || (item.timestamp ? relTime(item.timestamp) : '') }
  }
  return { word: 'Idle', tone: 'idle', when: item.timestamp ? relTime(item.timestamp) : '' }
}

interface ScanCycle {
  ts: number
  events: WatchdogEventUI[]
}

function groupIntoCycles(events: WatchdogEventUI[]): ScanCycle[] {
  if (events.length === 0) return []
  const GAP_MS = 45_000
  const cycles: ScanCycle[] = []
  let current: ScanCycle = { ts: events[0].ts, events: [] }
  for (const ev of events) {
    if (ev.ts - current.ts > GAP_MS && current.events.length > 0) {
      cycles.push(current)
      current = { ts: ev.ts, events: [] }
    }
    current.events.push(ev)
    current.ts = ev.ts
  }
  if (current.events.length > 0) cycles.push(current)
  return cycles.reverse()
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatStalledFor(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

function WatchdogDetail({ events }: { events: WatchdogEventUI[] }) {
  const [expandedTails, setExpandedTails] = useState<Set<number>>(new Set())

  const toggleTail = (idx: number) => {
    setExpandedTails((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  if (events.length === 0) {
    return (
      <div className="sw-unified-detail-content">
        <div className="sw-unified-detail-empty" style={{ padding: '24px 0', textAlign: 'center' }}>
          No scans yet. Watchdog runs every minute — it will appear here once it checks a terminal.
        </div>
      </div>
    )
  }

  const cycles = groupIntoCycles(events)

  return (
    <div className="sw-unified-detail-content">
      {cycles.map((cycle, ci) => {
        const ticks = cycle.events.filter((e) => e.kind === 'tick')
        const nudges = cycle.events.filter((e) => e.kind === 'nudge')
        const rotates = cycle.events.filter((e) => e.kind === 'rotate')
        const errors = cycle.events.filter((e) => e.kind === 'error')

        return (
          <div key={ci} className="sw-unified-detail-section" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--ds-text-dim)' }}>
                {formatTime(cycle.events[0].ts)}
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--ds-text-dim)' }}>
                {ticks.length} terminal{ticks.length !== 1 ? 's' : ''} scanned
                {nudges.length > 0 && ` · ${nudges.length} nudged`}
                {rotates.length > 0 && ` · ${rotates.length} rotated`}
                {errors.length > 0 && ` · ${errors.length} error${errors.length !== 1 ? 's' : ''}`}
              </span>
            </div>

            {ticks.map((tick, ti) => {
              const globalIdx = ci * 100 + ti
              const isTailOpen = expandedTails.has(globalIdx)
              const decision = cycle.events.find(
                (e) => e.kind === 'decision' && e.terminalId === tick.terminalId
              )
              const nudge = cycle.events.find(
                (e) => e.kind === 'nudge' && e.terminalId === tick.terminalId
              )

              return (
                <div
                  key={ti}
                  style={{
                    background: 'var(--ds-bg-panel)',
                    border: '1px solid var(--ds-border-subtle)',
                    borderRadius: 6,
                    padding: '10px 12px',
                    marginBottom: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {tick.terminalId}
                    </span>
                    {tick.agentType && (
                      <span style={{ fontSize: 10.5, color: 'var(--ds-text-dim)' }}>({tick.agentType})</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 10.5, color: 'var(--ds-text-dim)' }}>
                      stalled {tick.stalledForMs !== undefined ? formatStalledFor(tick.stalledForMs) : tick.message}
                    </span>
                  </div>

                  {tick.tailLines && tick.tailLines.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <button
                        type="button"
                        className="sw-link-btn"
                        style={{ fontSize: 10.5, color: 'var(--ds-text-dim)', marginBottom: isTailOpen ? 6 : 0 }}
                        onClick={() => toggleTail(globalIdx)}
                      >
                        {isTailOpen ? 'Hide' : 'Show'} {tick.tailLines.length} lines read
                      </button>
                      {isTailOpen && (
                        <pre
                          style={{
                            margin: 0,
                            fontSize: 9.5,
                            lineHeight: 1.5,
                            color: 'var(--ds-text-dim)',
                            background: 'var(--muted)',
                            borderRadius: 4,
                            padding: '6px 8px',
                            overflow: 'auto',
                            maxHeight: 160,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                          }}
                        >
                          {tick.tailLines.join('\n')}
                        </pre>
                      )}
                    </div>
                  )}

                  {decision && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          className={`sw-badge ${nudge ? 'running' : 'ok'}`}
                          style={{ fontSize: 10 }}
                        >
                          {nudge ? 'NUDGE' : 'SKIP'}
                        </span>
                        {decision.reason && (
                          <span style={{ fontSize: 11, color: 'var(--ds-text-muted)' }}>
                            {decision.reason}
                          </span>
                        )}
                      </div>
                      {nudge && (
                        <div
                          style={{
                            fontSize: 11.5,
                            fontStyle: 'italic',
                            color: 'var(--ds-text)',
                            paddingLeft: 4,
                            borderLeft: '2px solid var(--brand)',
                          }}
                        >
                          "{nudge.message}"
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {rotates.map((ev, ri) => (
              <div
                key={`r${ri}`}
                style={{
                  background: 'var(--ds-bg-panel)',
                  border: '1px solid var(--ds-border-subtle)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span className="sw-badge ok" style={{ fontSize: 10 }}>ROTATE</span>
                <span className="mono" style={{ fontSize: 11 }}>{ev.terminalId}</span>
                <span style={{ fontSize: 11, color: 'var(--ds-text-muted)', flex: 1 }}>{ev.message}</span>
                {ev.reason && <span style={{ fontSize: 10.5, color: 'var(--ds-text-dim)' }}>{ev.reason}</span>}
              </div>
            ))}

            {errors.map((ev, ei) => (
              <div
                key={`e${ei}`}
                style={{
                  background: 'var(--ds-bg-panel)',
                  border: '1px solid var(--ds-border-subtle)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  marginBottom: 6,
                  display: 'flex',
                  gap: 6,
                  alignItems: 'flex-start',
                }}
              >
                <span className="sw-badge failed" style={{ fontSize: 10, flexShrink: 0 }}>ERROR</span>
                <span style={{ fontSize: 11, color: 'var(--ds-text-muted)' }}>{ev.message}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function AgentCard({ item, selected, onSelect, dimmed, onRetry }: {
  item: UnifiedAgent
  selected: boolean
  onSelect: (id: string) => void
  // Recent/completed agents render with a muted appearance to distinguish
  // them visually from currently-active ones.
  dimmed?: boolean
  // Only shown for completed/stopped swarm agents — lets the user rerun a
  // finished task without re-dispatching through the modal.
  onRetry?: (taskName: string) => void
}) {
  const label = identityLabel(item)
  const status = statusPhrase(item)
  const name = item.teammateName
    ? item.teammateName
    : item.agentType.charAt(0).toUpperCase() + item.agentType.slice(1)
  const filesCount = item.files.length
  const hasCounts = item.toolCalls > 0 || filesCount > 0
  const canRetry = !item.active && item.swarm && onRetry

  return (
    <button
      type="button"
      className={`sw-floor-agent-card ${selected ? 'selected' : ''} ${dimmed ? 'dimmed' : ''}`}
      onClick={() => onSelect(item.id)}
      aria-pressed={selected}
    >
      <div className="sw-floor-agent-card-top">
        <AgentAvatar id={item.agentType} size={24} />
        <span className="sw-floor-agent-card-name">{name}</span>
        <span className={`sw-floor-agent-card-chunk ${label.variant}`}>{label.text}</span>
        {canRetry && (
          <span
            role="button"
            tabIndex={0}
            className="sw-floor-agent-card-retry"
            onClick={(e) => { e.stopPropagation(); onRetry!(item.swarm!.task_name) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault(); e.stopPropagation()
                onRetry!(item.swarm!.task_name)
              }
            }}
            title="Retry this task"
          >
            Retry
          </span>
        )}
      </div>

      <div className="sw-floor-agent-card-status-line">
        <span className={`sw-floor-agent-card-status-word ${status.tone}`}>{status.word}</span>
        {status.when && <span>{status.tone === 'running' ? status.when : `· ${status.when}`}</span>}
      </div>

      {item.activity && (
        <div className="sw-floor-agent-card-activity">{item.activity}</div>
      )}

      {(hasCounts || item.linearIssue || item.prUrl) && (
        <div className="sw-floor-agent-card-meta">
          {hasCounts && (
            <span className="sw-floor-agent-card-meta-counts">
              {item.toolCalls > 0 && <>{item.toolCalls} tools</>}
              {item.toolCalls > 0 && filesCount > 0 && <span className="sw-floor-agent-card-meta-sep"> · </span>}
              {filesCount > 0 && <>{filesCount} files</>}
            </span>
          )}
          <span className="sw-floor-agent-card-meta-spacer" />
          {item.linearIssue && <span className="sw-tag-linear">{item.linearIssue}</span>}
          {item.prUrl && <span className="sw-tag-pr">#{item.prUrl.match(/\/pull\/(\d+)/)?.[1] || 'PR'}</span>}
        </div>
      )}
    </button>
  )
}

const IDLE_AFTER_MS = 2 * 60 * 1000

function friendlyRelTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Math.max(0, nowMs - then)
  if (diff < 10_000) return 'Just now'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day === 1) return 'yesterday'
  if (day < 7) return `${day}d ago`
  return `${Math.floor(day / 7)}w ago`
}

function DetailStatusRow({ item, onFocusTerminal }: { item: UnifiedAgent; onFocusTerminal: (t: TerminalInfo) => void }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])
  const tsMs = item.timestamp ? new Date(item.timestamp).getTime() : NaN
  const staleMs = Number.isFinite(tsMs) ? nowMs - tsMs : 0
  const stale = staleMs > IDLE_AFTER_MS
  const effectiveItem: UnifiedAgent =
    item.status === 'running' && stale ? { ...item, status: 'idle', active: false } : item
  const phrase = statusPhrase(effectiveItem)
  const rel = friendlyRelTime(item.timestamp, nowMs)
  const focus = item.terminal ? () => onFocusTerminal(item.terminal!) : undefined
  const clickProps = focus
    ? { onClick: focus, role: 'button' as const, tabIndex: 0, style: { cursor: 'pointer' as const } }
    : {}
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          {...clickProps}
          className={`sw-badge ${phrase.tone === 'completed' ? 'ok' : phrase.tone}`}
          title={focus ? 'Focus terminal' : undefined}
        >
          {phrase.word}
        </span>
        {item.prUrl && (
          <ExtLink
            href={item.prUrl}
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--brand)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Icon name="external" size={10} /> PR
          </ExtLink>
        )}
      </div>
      {rel && (
        <span className="sw-pill" {...clickProps} title={focus ? 'Focus terminal' : undefined}>
          {rel}
        </span>
      )}
    </div>
  )
}

function DetailPane({ item, onClose, onFocusTerminal, onRetry, onKill }: {
  item: UnifiedAgent
  onClose: () => void
  onFocusTerminal: (t: TerminalInfo) => void
  onRetry: (taskName: string) => void
  onKill: (taskName: string) => void
}) {
  const isActive = item.active

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, height: '100%', flex: 1 }}>
      <div className="sw-mc-pane-head">
        <AgentAvatar id={item.agentType} size={20} />
        <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {item.displayName}
        </span>
        <span className={`sw-unified-kind-badge ${item.kind}`}>{kindBadge(item.kind)}</span>
        {item.cloudProvider && <span className="mono sw-unified-provider">{item.cloudProvider}</span>}
        <div className="sw-spacer" />
        {item.swarm && (
          <>
            <button className="sw-btn secondary sm" onClick={() => onRetry(item.swarm!.task_name)}>
              <Icon name="refresh" size={11} />
              Retry
            </button>
            {isActive && (
              <button className="sw-btn danger sm" onClick={() => onKill(item.swarm!.task_name)}>
                <Icon name="x" size={11} />
                Kill
              </button>
            )}
          </>
        )}
        {item.terminal && (
          <button className="sw-btn secondary sm" onClick={() => onFocusTerminal(item.terminal!)}>
            <Icon name="terminal" size={11} />
            Focus
          </button>
        )}
        <button className="sw-btn secondary sm" onClick={onClose} aria-label="Close detail pane">
          <Icon name="x" size={11} />
        </button>
      </div>

      <div className="sw-mc-pane-body">
        <DetailStatusRow item={item} onFocusTerminal={onFocusTerminal} />

        {item.kind === 'watchdog' && <WatchdogDetail events={item.watchdogEvents ?? []} />}
        {item.terminal && <TerminalExpandedDetail terminal={item.terminal} />}
        {item.kind === 'team' && item.swarm && <TeamDetail swarm={item.swarm} onRetry={onRetry} onKill={onKill} />}
        {(item.kind === 'headless' || item.kind === 'cloud') && item.agent && (
          <AgentDetailView agent={item.agent} swarm={item.swarm} onRetry={onRetry} onKill={onKill} />
        )}
      </div>
    </div>
  )
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function filePillColor(touchedAtMs: number | undefined, now: number): string {
  if (touchedAtMs === undefined) return 'var(--ds-text-muted)'
  const elapsed = now - touchedAtMs
  if (elapsed <= 1000) return '#3b82f6'
  const t = Math.min((elapsed - 1000) / (179000), 1)
  const r = Math.round(59 + t * (156 - 59))
  const g = Math.round(130 + t * (163 - 130))
  const b = Math.round(246 + t * (175 - 246))
  return `rgb(${r},${g},${b})`
}

function TerminalExpandedDetail({ terminal }: { terminal: TerminalInfo }) {
  const now = useNow(5000)
  const cwdDisplay = terminal.cwd ? terminal.cwd.replace(/^\/Users\/[^/]+/, '~') : null
  const linkStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    padding: 0,
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  }
  return (
    <div className="sw-unified-detail-content">
      {(cwdDisplay || terminal.branch) && (
        <div className="sw-unified-detail-section">
          <div className="mono" style={{ fontSize: 11, color: 'var(--ds-text-dim)' }}>
            {cwdDisplay && terminal.cwd && (
              <button
                type="button"
                style={linkStyle}
                title="Reveal folder"
                onClick={() => postMessage({ type: 'revealFolder', path: terminal.cwd })}
              >
                {cwdDisplay}
              </button>
            )}
            {cwdDisplay && terminal.branch && <span>{' \u00b7 branch: '}</span>}
            {terminal.branch && (
              <button
                type="button"
                style={linkStyle}
                title="Open Source Control"
                onClick={() => postMessage({ type: 'openSourceControl' })}
              >
                {terminal.branch}
              </button>
            )}
          </div>
        </div>
      )}
      {terminal.firstUserMessage && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Task</div>
          <div className="sw-unified-detail-text">
            {renderTodoDescription(terminal.firstUserMessage, false)}
          </div>
        </div>
      )}
      {(terminal.quickSummary || terminal.messageCount) && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Activity</div>
          <div className="sw-unified-detail-stats">
            {terminal.messageCount && terminal.messageCount > 0 && <span>{terminal.messageCount} msgs</span>}
            {terminal.quickSummary && terminal.quickSummary.filesEdited > 0 && <span>{terminal.quickSummary.filesEdited} files edited</span>}
            {terminal.quickSummary && terminal.quickSummary.toolCalls > 0 && <span>{terminal.quickSummary.toolCalls} tool calls</span>}
            {terminal.quickSummary && terminal.quickSummary.webSearches > 0 && <span>{terminal.quickSummary.webSearches} web searches</span>}
          </div>
        </div>
      )}
      {((terminal.recentFiles && terminal.recentFiles.length > 0) || (terminal.recentTools && terminal.recentTools.length > 0)) && (
        <div className="sw-unified-detail-section">
          <div className="sw-unified-detail-split">
            <div className="sw-unified-detail-split-col">
              <div className="sw-section-label">Recent files</div>
              {terminal.recentFiles && terminal.recentFiles.length > 0 ? (
                <div className="sw-unified-detail-files">
                  {[...terminal.recentFiles]
                    .sort((a, b) => {
                      const ta = terminal.recentFileTimes?.[a]
                      const tb = terminal.recentFileTimes?.[b]
                      if (ta !== undefined && tb !== undefined) return tb - ta
                      if (ta !== undefined) return -1
                      if (tb !== undefined) return 1
                      return 0
                    })
                    .slice(0, 12)
                    .map((f) => {
                      const stat = terminal.recentFileStats?.[f]
                      const touchedAt = terminal.recentFileTimes?.[f]
                      const color = filePillColor(touchedAt, now)
                      return (
                        <button
                          key={f}
                          type="button"
                          className="mono sw-unified-file-pill sw-unified-file-pill-btn"
                          title={f}
                          style={{ borderColor: color, color }}
                          onClick={() => postMessage({ type: 'openTerminalFile', path: f })}
                        >
                          {f.split('/').pop()}
                          {stat && (
                            <span className="sw-unified-file-pill-stat">
                              {stat.added > 0 && <span style={{ color: 'var(--ds-diff-added, #4ade80)' }}>+{stat.added}</span>}
                              {stat.added > 0 && stat.removed > 0 && ' '}
                              {stat.removed > 0 && <span style={{ color: 'var(--ds-diff-removed, #f87171)' }}>-{stat.removed}</span>}
                            </span>
                          )}
                        </button>
                      )
                    })}
                </div>
              ) : (
                <div className="sw-unified-detail-empty">No files yet.</div>
              )}
            </div>
            <div className="sw-unified-detail-split-col">
              <div className="sw-section-label">Recent tools</div>
              {terminal.recentToolCalls && terminal.recentToolCalls.length > 0 ? (
                <div className="sw-floor-detail-tools">
                  {terminal.recentToolCalls.slice(0, 16).map((call, i) => (
                    <RecentToolCallRow key={`${call.name}-${i}`} call={call} />
                  ))}
                </div>
              ) : terminal.recentTools && terminal.recentTools.length > 0 ? (
                <div className="sw-floor-detail-tools">
                  {terminal.recentTools.slice(0, 12).map((tool, i) => (
                    <div key={`${tool}-${i}`} className="sw-floor-detail-tool-row">
                      <span className="sw-floor-detail-tool-name">{tool}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sw-unified-detail-empty">No tools yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function toolHeadlineSummary(call: RecentToolCall): string {
  const input = call.input
  if (!input || typeof input !== 'object') return ''
  const rec = input as Record<string, unknown>
  const candidateKeys = [
    'command',
    'file_path',
    'path',
    'target_file',
    'query',
    'pattern',
    'url',
    'description',
    'prompt',
  ]
  for (const key of candidateKeys) {
    const value = rec[key]
    if (typeof value === 'string' && value.trim()) {
      return value.length > 80 ? value.slice(0, 80) + '...' : value
    }
  }
  return ''
}

function RecentToolCallRow({ call }: { call: RecentToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const headline = toolHeadlineSummary(call)
  const inputJson = useMemo(() => {
    if (!expanded) return ''
    try {
      return JSON.stringify(call.input, null, 2)
    } catch {
      return String(call.input)
    }
  }, [expanded, call.input])
  return (
    <div className="sw-floor-detail-tool-item">
      <button
        type="button"
        className="sw-floor-detail-tool-row sw-floor-detail-tool-row-btn"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="sw-floor-detail-tool-name">{call.name}</span>
        {headline && <span className="sw-floor-detail-tool-arg mono">{headline}</span>}
        <span className="sw-floor-detail-tool-toggle">{expanded ? '-' : '+'}</span>
      </button>
      {expanded && (
        <div className="sw-floor-detail-tool-details">
          <div className="sw-floor-detail-tool-detail-section">
            <div className="sw-floor-detail-tool-detail-label">Input</div>
            <pre className="sw-floor-detail-tool-detail-pre mono">{inputJson || '(none)'}</pre>
          </div>
          {call.output !== undefined && (
            <div className="sw-floor-detail-tool-detail-section">
              <div className={`sw-floor-detail-tool-detail-label${call.isError ? ' err' : ''}`}>
                {call.isError ? 'Error' : 'Result'}
              </div>
              <pre className={`sw-floor-detail-tool-detail-pre mono${call.isError ? ' err' : ''}`}>
                {call.output || '(empty)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TeamDetail({ swarm, onRetry, onKill }: { swarm: TaskSummary; onRetry: (n: string) => void; onKill: (n: string) => void }) {
  const isActive = swarm.status_counts.running > 0
  return (
    <div className="sw-unified-detail-content">
      <div className="sw-unified-detail-section">
        <div className="sw-section-label">Agents</div>
        <div className="sw-unified-team-agents">
          {swarm.agents.map((a) => {
            const statusClass = a.status === 'running' ? 'running' : a.status === 'completed' ? 'ok' : a.status === 'failed' ? 'failed' : 'idle'
            const lastAction = a.bash_commands?.slice(-1)[0] || a.files_modified?.slice(-1)[0] || a.last_messages?.slice(-1)[0]?.slice(0, 80) || ''
            return (
              <div key={a.agent_id} className="sw-unified-team-agent">
                <AgentAvatar id={a.agent_type} size={16} />
                <span style={{ fontSize: 12, fontWeight: 550, textTransform: 'capitalize' }}>{a.agent_type}</span>
                <span className={`sw-badge ${statusClass}`}>{a.status}</span>
                <div className="sw-spacer" />
                {a.duration && <span className="mono" style={{ fontSize: 10.5, color: 'var(--ds-text-dim)' }}>{a.duration}</span>}
                {a.pr_url && (
                  <ExtLink href={a.pr_url} className="mono" style={{ fontSize: 10.5, color: 'var(--brand)' }}>
                    <Icon name="external" size={10} /> PR
                  </ExtLink>
                )}
                {lastAction && (
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--ds-text-dim)', gridColumn: '1 / -1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 24 }}>
                    {lastAction}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="sw-unified-detail-actions">
        <button className="sw-btn secondary sm" onClick={() => onRetry(swarm.task_name)}>
          <Icon name="refresh" size={11} />
          Retry
        </button>
        {isActive && (
          <button className="sw-btn danger sm" onClick={() => onKill(swarm.task_name)}>
            <Icon name="x" size={11} />
            Kill
          </button>
        )}
      </div>
    </div>
  )
}

function AgentDetailView({ agent, swarm, onRetry, onKill }: { agent: AgentDetail; swarm?: TaskSummary; onRetry: (n: string) => void; onKill: (n: string) => void }) {
  const isActive = agent.status === 'running'
  const isCloud = agent.mode === 'cloud' || !!agent.cloud_provider
  const allFiles = [...(agent.files_created || []), ...(agent.files_modified || [])]

  if (isCloud) {
    return (
      <div className="sw-unified-detail-content">
        {agent.repo_owner && agent.repo_name && (
          <div className="sw-unified-detail-section">
            <div className="sw-section-label">Repository</div>
            <div className="mono" style={{ fontSize: 12 }}>{agent.repo_owner}/{agent.repo_name}</div>
          </div>
        )}
        {agent.prompt && (
          <div className="sw-unified-detail-section">
            <div className="sw-section-label">Task</div>
            <div className="sw-unified-detail-text sw-cloud-prompt">
              {renderTodoDescription(agent.prompt, false)}
            </div>
          </div>
        )}
        {(agent.cloud_summary || isActive) && (
          <div className="sw-unified-detail-section">
            <div className="sw-section-label">Activity</div>
            {agent.cloud_summary ? (
              <CloudActivityFeed summary={agent.cloud_summary} />
            ) : (
              <div className="sw-unified-detail-text" style={{ color: 'var(--ds-text-dim)', fontStyle: 'italic' }}>
                Agent is running, no output yet...
              </div>
            )}
          </div>
        )}
        {swarm && (
          <div className="sw-unified-detail-actions">
            <button className="sw-btn secondary sm" onClick={() => onRetry(swarm.task_name)}>
              <Icon name="refresh" size={11} />
              Retry
            </button>
            {isActive && (
              <button className="sw-btn danger sm" onClick={() => onKill(swarm.task_name)}>
                <Icon name="x" size={11} />
                Stop
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="sw-unified-detail-content">
      {agent.prompt && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Task</div>
          <div className="sw-unified-detail-text">
            {renderTodoDescription(agent.prompt.slice(0, 500), false)}
          </div>
        </div>
      )}
      {agent.last_messages && agent.last_messages.length > 0 && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Latest</div>
          <div className="sw-unified-detail-text mono" style={{ fontSize: 11 }}>
            {agent.last_messages[agent.last_messages.length - 1]?.slice(0, 300)}
          </div>
        </div>
      )}
      {allFiles.length > 0 && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Files ({allFiles.length})</div>
          <div className="sw-unified-detail-files">
            {allFiles.slice(0, 8).map((f) => (
              <span key={f} className="mono sw-unified-file-pill">{f.split('/').pop()}</span>
            ))}
            {allFiles.length > 8 && <span className="mono" style={{ fontSize: 10.5, color: 'var(--ds-text-dim)' }}>+{allFiles.length - 8} more</span>}
          </div>
        </div>
      )}
      {swarm && (
        <div className="sw-unified-detail-actions">
          <button className="sw-btn secondary sm" onClick={() => onRetry(swarm.task_name)}>
            <Icon name="refresh" size={11} />
            Retry
          </button>
          {isActive && (
            <button className="sw-btn danger sm" onClick={() => onKill(swarm.task_name)}>
              <Icon name="x" size={11} />
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Format a Linear dueDate (YYYY-MM-DD) into short human text for the card.
// Returns null when no date. Uses local-day comparison so "Due today" lines up
// with the user's calendar rather than UTC midnight.
function formatDueDate(iso: string | undefined): { label: string; tone: 'overdue' | 'soon' | 'normal' } | null {
  if (!iso) return null
  const parts = iso.split('T')[0].split('-')
  if (parts.length < 3) return null
  const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2])
  if (!y || !m || !d) return null
  const due = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (diffDays < 0) {
    const n = Math.abs(diffDays)
    return { label: n === 1 ? 'Overdue 1d' : `Overdue ${n}d`, tone: 'overdue' }
  }
  if (diffDays === 0) return { label: 'Due today', tone: 'soon' }
  if (diffDays === 1) return { label: 'Due tomorrow', tone: 'soon' }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const label = `Due ${MONTHS[m - 1]} ${d}`
  return { label, tone: diffDays <= 3 ? 'soon' : 'normal' }
}

// Dispatch card with agent picker
function DispatchCard({ task, onOpen }: { task: UnifiedTask; onOpen: (task: UnifiedTask) => void }) {
  const priorityCls = task.priority === 'urgent' ? 'urgent' : task.priority === 'high' ? 'high' : 'medium'
  const repo = task.metadata.repo
  const due = formatDueDate(task.metadata.dueDate)
  const repoHref = repo ? `https://github.com/${repo}` : null

  const stopOpen = (e: React.MouseEvent) => { e.stopPropagation() }

  // Use div role=button (not a <button> element) so we can nest an anchor
  // (the repo chip via <ExtLink>) without invalid HTML. Nesting <a> inside
  // <button> is spec-invalid and caused React/VS Code to silently drop the
  // anchor click — that was the original "repo chip doesn't open" bug.
  return (
    <div
      role="button"
      tabIndex={0}
      data-foreman-id={`task-card-${task.metadata.identifier || task.id.slice(0, 8)}`}
      className="sw-queue-card sw-queue-card-clickable"
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(task)
        }
      }}
    >
      <div className="sw-queue-card-header">
        <div className={`sw-queue-priority-led ${priorityCls}`} />
        <span className="sw-queue-badge">{task.metadata.identifier || task.id.slice(0, 8)}</span>
        {repoHref ? (
          <ExtLink
            className="sw-queue-repo-chip mono"
            href={repoHref}
            onMouseDown={stopOpen}
            title={`Open ${repo} on GitHub`}
            style={{ marginLeft: 'auto' }}
          >
            {repo}
          </ExtLink>
        ) : repo ? (
          <span className="sw-queue-repo-chip mono" style={{ marginLeft: 'auto' }}>{repo}</span>
        ) : null}
      </div>
      <div className="sw-queue-title">{task.title}</div>
      {due && (
        <div className="sw-queue-meta-row">
          <span className={`sw-queue-due ${due.tone}`}>{due.label}</span>
        </div>
      )}
    </div>
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
  /**
   * Per-task-type overrides for agent/target/cloudProvider. Keyed by the
   * task's type bucket (see `taskTypeKey`) — e.g. `docs` tasks remember
   * Gemini while `engineering` tasks remember Claude without either
   * leaking into the other. Missing keys fall back to the global
   * `lastAgent`/`lastTarget`/`lastCloudProvider` fields above.
   */
  byTaskType?: Record<string, Partial<Pick<DispatchPrefs, 'lastAgent' | 'lastTarget' | 'lastCloudProvider'>>>
}

const DISPATCH_PREFS_KEY = 'swarmify.dispatchPrefs.v1'
const MRU_MAX = 10
const RESERVED_LABEL_PREFIXES = ['repo:', 'agent:', 'priority:']

/**
 * Derive a stable "task type" bucket from a task's metadata, used as the
 * key in `DispatchPrefs.byTaskType`. Strategy: pick the first label that
 * isn't a reserved routing label (repo:, agent:, priority:). Falls back
 * to `task.source` (linear / github / markdown) so tasks without useful
 * labels still get a source-level override.
 */
function taskTypeKey(task: UnifiedTask): string {
  const labels = (task.metadata.labels || []).map((l) => (typeof l === 'string' ? l.toLowerCase() : ''))
  for (const l of labels) {
    if (!l) continue
    if (RESERVED_LABEL_PREFIXES.some((p) => l.startsWith(p))) continue
    return l
  }
  return task.source || 'default'
}

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

/**
 * Merge the global prefs with any per-task-type overrides. Returns prefs
 * with agent/target/cloudProvider taking from the type-specific bucket
 * when present, falling back to the global defaults otherwise.
 */
function prefsForTask(p: DispatchPrefs, task: UnifiedTask): DispatchPrefs {
  const key = taskTypeKey(task)
  const override = p.byTaskType?.[key]
  if (!override) return p
  return {
    ...p,
    lastAgent: override.lastAgent ?? p.lastAgent,
    lastTarget: override.lastTarget ?? p.lastTarget,
    lastCloudProvider: override.lastCloudProvider ?? p.lastCloudProvider,
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
    byTaskType: {},
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

/**
 * Compact search input + typeahead dropdown in the TaskDetailModal header.
 * Lets the user jump between open tasks without closing the modal.
 * Current task is excluded from results. Empty query surfaces the first
 * 8 tasks so clicking the input gives an immediate browse list.
 */
function TaskSwitcher({ current, tasks, onPick }: {
  current: UnifiedTask
  tasks: UnifiedTask[]
  onPick: (task: UnifiedTask) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = tasks.filter((t) => t.id !== current.id)
    const filtered = q
      ? pool.filter((t) =>
          t.title.toLowerCase().includes(q) ||
          (t.metadata.identifier || '').toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q),
        )
      : pool
    return filtered.slice(0, 8)
  }, [tasks, current.id, query])
  return (
    <div className="sw-task-switcher" style={{ position: 'relative', marginLeft: 'auto', marginRight: 8 }}>
      <input
        ref={inputRef}
        type="text"
        className="sw-dispatch-modal-search-input"
        placeholder={`Switch task (${tasks.length - 1} open)`}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) {
            e.preventDefault()
            onPick(results[0])
            setQuery('')
            setOpen(false)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        style={{ width: 220, fontSize: 12 }}
      />
      {open && results.length > 0 && (
        <div className="sw-task-detail-repo-suggest" style={{ width: 360, maxHeight: 320, overflowY: 'auto' }}>
          {results.map((t) => (
            <button
              key={t.id}
              type="button"
              className="sw-task-detail-repo-suggest-item"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(t)
                setQuery('')
                setOpen(false)
              }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '6px 10px' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {t.metadata.identifier && (
                  <span className="sw-queue-badge" style={{ fontSize: 10 }}>{t.metadata.identifier}</span>
                )}
                {t.priority && (
                  <span className={`sw-queue-priority-label ${t.priority === 'urgent' ? 'urgent' : t.priority === 'high' ? 'high' : 'medium'}`} style={{ fontSize: 10 }}>
                    {t.priority.toUpperCase()}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{t.title.slice(0, 70)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TaskDetailModal({ task, tasks, onClose, onBack, onDispatch, onTaskSwitch }: {
  task: UnifiedTask
  // Sibling tasks for the in-header switcher. When provided, the modal
  // shows a search input that filters these and lets the user jump to
  // another task without closing the modal.
  tasks?: UnifiedTask[]
  onClose: () => void
  // When provided, renders a "Back" button in the header that returns
  // the user to wherever they came from (e.g. DispatchModal list). No
  // button is rendered when the modal is opened directly from a queue
  // card — in that case there's no "back" to go to.
  onBack?: () => void
  onDispatch: (args: {
    agent: string
    target: 'local' | 'cloud'
    cloudProvider: CloudProviderId
    branch: string
    codexEnv: string
    targetRepos: string[]
    notify: { onQuestion: boolean; onFinish: boolean; channel: string }
  }) => void
  onTaskSwitch?: (task: UnifiedTask) => void
}) {
  const prefs = useRef<DispatchPrefs>(loadDispatchPrefs())
  // Resolve per-task-type overrides at mount so e.g. `docs` tasks default
  // to Gemini while `engineering` tasks default to Claude, without the
  // two bleeding into each other. Falls back to global defaults when the
  // task's type has never been dispatched before.
  const seed = useMemo(() => prefsForTask(prefs.current, task), [task])
  const typeKey = useMemo(() => taskTypeKey(task), [task])
  const [agent, setAgent] = useState(seed.lastAgent)
  const [target, setTarget] = useState<'local' | 'cloud'>(seed.lastTarget)
  const [cloudProvider, setCloudProvider] = useState<CloudProviderId>(seed.lastCloudProvider)
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
    const byTaskType = { ...(prefs.current.byTaskType || {}) }
    // Persist the routing triple (agent/target/cloudProvider) under the
    // current task's type bucket so next time a task of the same type
    // opens, those are the seeded defaults. Notify/codexEnv stay global
    // because they're user-preference, not task-class.
    byTaskType[typeKey] = {
      lastAgent: agent,
      lastTarget: target,
      lastCloudProvider: cloudProvider,
    }
    const next: DispatchPrefs = {
      lastAgent: agent,
      lastTarget: target,
      lastCloudProvider: cloudProvider,
      notifyOnQuestion,
      notifyOnFinish,
      notifyChannel,
      lastCodexEnv: codexEnv,
      recentRepos: prefs.current.recentRepos,
      byTaskType,
    }
    saveDispatchPrefs(next)
    prefs.current = next
  }, [agent, target, cloudProvider, notifyOnQuestion, notifyOnFinish, notifyChannel, codexEnv, typeKey])

  // Re-seed state when the displayed task changes (via TaskSwitcher).
  // Without this, switching from a `docs` task to an `engineering` task
  // would keep the docs task's agent/target selection.
  const lastTypeKeyRef = useRef(typeKey)
  useEffect(() => {
    if (lastTypeKeyRef.current === typeKey) return
    lastTypeKeyRef.current = typeKey
    const override = prefs.current.byTaskType?.[typeKey]
    if (!override) return
    if (override.lastAgent) setAgent(override.lastAgent)
    if (override.lastTarget) setTarget(override.lastTarget)
    if (override.lastCloudProvider) setCloudProvider(override.lastCloudProvider)
  }, [typeKey])

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

  // Show the task switcher only when there are sibling tasks to jump to.
  const switcherEnabled = !!onTaskSwitch && !!tasks && tasks.length > 1

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
            {onBack && (
              <button
                type="button"
                className="sw-btn ghost sm"
                onClick={onBack}
                title="Back to dispatch list"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 6 }}
              >
                <span aria-hidden="true">&larr;</span>
                <span>Back</span>
              </button>
            )}
            <span className={`sw-queue-priority-led ${priorityCls}`} />
            {task.metadata.identifier && (
              <span className="sw-queue-badge">{task.metadata.identifier}</span>
            )}
            <span className={`sw-queue-priority-label ${priorityCls}`}>{priorityLabel}</span>
            <span className="sw-task-detail-meta">
              {task.source}{createdRel ? ` - created ${createdRel}` : ''}
            </span>
            {switcherEnabled && (
              <TaskSwitcher
                current={task}
                tasks={tasks || []}
                onPick={(t) => onTaskSwitch?.(t)}
              />
            )}
            <button className="sw-dispatch-modal-close" onClick={onClose} aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </div>
          <div className="sw-task-detail-title">{task.title}</div>
        </div>

        <div className="sw-task-detail-body">
          {task.description ? (
            <div className="sw-task-detail-desc">
              {renderTodoDescription(task.description, false)}
            </div>
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
