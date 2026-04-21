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

// Gauge SVG arc component
function GaugeWidget({ value, max, color, label, sub }: { value: number; max: number; color: string; label: string; sub: string }) {
  const r = 40
  const circumference = 2 * Math.PI * r
  const pct = Math.min(value / Math.max(max, 1), 1)
  const offset = circumference * (1 - pct)
  return (
    <div className="sw-gauge-widget">
      <div className="sw-gauge-svg-wrap">
        <svg viewBox="0 0 100 100">
          <circle className="sw-gauge-bg" cx="50" cy="50" r={r} />
          <circle className="sw-gauge-arc" cx="50" cy="50" r={r}
            stroke={color}
            strokeDasharray={circumference}
            strokeDashoffset={offset} />
        </svg>
        <div className="sw-gauge-value">{value}</div>
      </div>
      <div className="sw-gauge-label">{label}</div>
      <div className="sw-gauge-sub">{sub}</div>
    </div>
  )
}

// Throughput counter (FPS-style)
function ThroughputCounter({ tokensPerSec }: { tokensPerSec: number }) {
  const sparkData = useMemo(() => {
    const bars = []
    for (let i = 0; i < 20; i++) {
      const base = tokensPerSec * (0.6 + Math.random() * 0.8)
      bars.push(Math.max(2, Math.min(24, base / 40)))
    }
    return bars
  }, [tokensPerSec])

  return (
    <div className="sw-throughput">
      <div className="sw-throughput-sparkline">
        {sparkData.map((h, i) => (
          <div key={i} className="sw-spark-bar" style={{ height: h }} />
        ))}
      </div>
      <div className="sw-throughput-value">{tokensPerSec}</div>
      <div className="sw-throughput-unit">
        <span className="sw-throughput-label">tok/s</span>
        <span className="sw-throughput-sub">throughput</span>
      </div>
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
}

export function UnifiedAgentsPane({ terminals, tasks, tasksLoading, unifiedTasks, unifiedTasksLoading, onDispatch }: UnifiedAgentsPaneProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const newMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!newMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) setNewMenuOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [newMenuOpen])

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

  // Gauge metrics
  const totalFiles = useMemo(() => {
    const fileSet = new Set<string>()
    for (const item of items) {
      for (const f of item.files) fileSet.add(f.split('/').pop() || f)
    }
    return fileSet.size
  }, [items])

  const totalPRs = useMemo(() => items.filter((i) => i.prUrl).length, [items])

  // Estimated throughput (mock for now -- will be wired to session parsing)
  const estimatedThroughput = useMemo(() => {
    const activeCount = activeItems.length
    if (activeCount === 0) return 0
    return Math.round(activeCount * 280 + Math.random() * 120)
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

  const handleDispatchTask = (task: UnifiedTask, agentType: string) => {
    postMessage({
      type: 'dispatchTask',
      taskId: task.id,
      agentType,
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
          {activeItems.length > 0 && <ThroughputCounter tokensPerSec={estimatedThroughput} />}
          <div className="sw-floor-status">
            System {activeItems.length > 0 ? 'nominal' : 'idle'} -- {activeItems.length} agent{activeItems.length !== 1 ? 's' : ''} online
          </div>
        </div>
      </div>

      {/* Gauges Row */}
      <div className="sw-gauges-row">
        <GaugeWidget value={activeItems.length} max={8} color="#F26D5B" label="Agents" sub={`of ${items.length} total`} />
        <GaugeWidget value={totalFiles} max={20} color="#22C55E" label="Files" sub="changed" />
        <GaugeWidget value={totalPRs} max={5} color="#3B82F6" label="PRs" sub="open" />
        <GaugeWidget value={queueTasks.length} max={10} color="#D4A72C" label="Queue" sub="pending" />
      </div>

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
            <button className="sw-btn primary sm" onClick={onDispatch}>
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

      {/* Recent Agents */}
      {recentItems.length > 0 && (
        <>
          <div className="sw-section-header-row" style={{ marginTop: 8 }}>
            <span className="sw-section-label">Recent</span>
            <span className="sw-section-count-pill">{recentItems.length}</span>
            <span className="sw-section-line" />
          </div>

          <div className="sw-agent-strips">
            {recentItems.slice(0, 5).map((item) => (
              <AgentStrip key={item.id} item={item} dimmed onFocus={handleFocusTerminal} onRetry={handleRetry} />
            ))}
          </div>
        </>
      )}

      {/* Dispatch Queue */}
      {queueTasks.length > 0 && (
        <div className="sw-queue-section">
          <div className="sw-section-header-row">
            <span className="sw-section-label">Dispatch Queue</span>
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
    </div>
  )
}

// Agent horizontal strip
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
          <div className="sw-strip-name">{item.agentType.charAt(0).toUpperCase() + item.agentType.slice(1)}</div>
          <div className="sw-strip-kind">{mode}</div>
        </div>
      </div>
      <div className="sw-strip-activity">
        {item.activity}
      </div>
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
