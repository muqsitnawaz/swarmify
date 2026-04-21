import React, { useMemo, useState } from 'react'
import type { TaskSummary, TerminalDetail as TerminalInfo, AgentDetail } from '../../types'
import { AgentAvatar, agentShortChunk } from './AgentAvatar'
import { Icon } from './icons'
import { relTime, taskNameToTitle, swarmOverallStatus, shortDuration } from './types'
import { postMessage } from '../../hooks'

type FilterTab = 'all' | 'terminal' | 'headless' | 'cloud' | 'team'

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
}

function buildUnifiedList(terminals: TerminalInfo[], tasks: TaskSummary[]): UnifiedAgent[] {
  const items: UnifiedAgent[] = []

  for (const t of terminals) {
    const chunk = agentShortChunk(t.sessionId) || (t.id ?? '').slice(-8)
    const isActive = t.status === 'running' || !!t.currentActivity
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
    })
  }

  for (const task of tasks) {
    const isTeam = task.agents.length > 1
    const isActive = task.status_counts.running > 0

    if (isTeam) {
      const status = swarmOverallStatus(task)
      const pr = task.agents.map((a) => a.pr_url).find(Boolean)
      const dur = task.agents.map((a) => a.duration).find(Boolean)
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
      })
    } else if (task.agents.length === 1) {
      const a = task.agents[0]
      const isCloud = a.mode === 'cloud' || !!a.cloud_provider
      const lastMsg = a.last_messages?.[a.last_messages.length - 1]
      const lastCmd = a.bash_commands?.[a.bash_commands.length - 1]
      const lastFile = a.files_modified?.[a.files_modified.length - 1]
      const activity = lastCmd ? `$ ${lastCmd}` : lastFile ? `Editing ${lastFile}` : lastMsg ? lastMsg.slice(0, 120) : a.prompt?.slice(0, 120) || 'working...'
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

interface UnifiedAgentsPaneProps {
  terminals: TerminalInfo[]
  tasks: TaskSummary[]
  tasksLoading: boolean
  onDispatch: () => void
}

export function UnifiedAgentsPane({ terminals, tasks, tasksLoading, onDispatch }: UnifiedAgentsPaneProps) {
  const [filter, setFilter] = useState<FilterTab>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const items = useMemo(() => buildUnifiedList(terminals, tasks), [terminals, tasks])

  const counts = useMemo(() => {
    const c = { terminal: 0, headless: 0, cloud: 0, team: 0 }
    for (const item of items) c[item.kind]++
    return c
  }, [items])

  const activeCount = useMemo(() => items.filter((i) => i.active).length, [items])

  const filtered = useMemo(() => {
    if (filter === 'all') return items
    return items.filter((i) => i.kind === filter)
  }, [items, filter])

  const activeItems = filtered.filter((i) => i.active)
  const recentItems = filtered.filter((i) => !i.active)

  const handleFocusTerminal = (t: TerminalInfo) => {
    postMessage({ type: 'focusTerminal', terminalId: t.id })
  }

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

  const handleRetry = (taskName: string) => {
    postMessage({ type: 'retrySwarm', taskName })
  }

  const handleKill = (taskName: string) => {
    postMessage({ type: 'killSwarm', taskName })
  }

  const filterTabs: Array<{ key: FilterTab; label: string; count: number }> = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'terminal', label: 'Terminal', count: counts.terminal },
    { key: 'headless', label: 'Headless', count: counts.headless },
    { key: 'cloud', label: 'Cloud', count: counts.cloud },
    { key: 'team', label: 'Teams', count: counts.team },
  ]

  return (
    <div className="sw-unified">
      <div className="sw-unified-head">
        <Icon name="zap" size={13} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Agents</span>
        <span className="sw-section-count">{activeCount > 0 ? `${activeCount} active` : items.length}</span>
        <div className="sw-spacer" />
        <button className="sw-btn secondary sm" onClick={() => handleNewAgent('claude')}>
          <Icon name="plus" size={11} />
          New
        </button>
        <button className="sw-btn primary sm" onClick={onDispatch}>
          <Icon name="dispatch" size={11} />
          Dispatch
        </button>
      </div>

      <div className="sw-unified-filters">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            className={`sw-unified-filter ${filter === tab.key ? 'active' : ''}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
            {tab.count > 0 && <span className="sw-unified-filter-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      <div className="sw-unified-body">
        {items.length === 0 && !tasksLoading && (
          <div className="sw-empty">
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

        {tasksLoading && items.length === 0 && (
          <div className="sw-empty">
            <div className="sw-empty-sub">Loading agents...</div>
          </div>
        )}

        {activeItems.length > 0 && activeItems.map((item) => (
          <AgentRow
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onFocusTerminal={handleFocusTerminal}
            onRetry={handleRetry}
            onKill={handleKill}
          />
        ))}

        {recentItems.length > 0 && activeItems.length > 0 && (
          <div className="sw-unified-divider">
            <span>Recent</span>
          </div>
        )}

        {recentItems.map((item) => (
          <AgentRow
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            onFocusTerminal={handleFocusTerminal}
            onRetry={handleRetry}
            onKill={handleKill}
          />
        ))}
      </div>
    </div>
  )
}

function statusDotClass(status: UnifiedAgent['status']): string {
  switch (status) {
    case 'running': return 'running pulse'
    case 'completed': return 'idle'
    case 'failed': return 'failed'
    case 'stopped': return 'idle'
    case 'idle': return 'idle'
  }
}

function kindBadge(kind: UnifiedAgent['kind']): string {
  switch (kind) {
    case 'terminal': return 'terminal'
    case 'headless': return 'headless'
    case 'cloud': return 'cloud'
    case 'team': return 'team'
  }
}

function statusLabel(status: UnifiedAgent['status']): string {
  switch (status) {
    case 'running': return 'running'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'stopped': return 'stopped'
    case 'idle': return 'idle'
  }
}

interface AgentRowProps {
  item: UnifiedAgent
  expanded: boolean
  onToggle: () => void
  onFocusTerminal: (t: TerminalInfo) => void
  onRetry: (taskName: string) => void
  onKill: (taskName: string) => void
}

function AgentRow({ item, expanded, onToggle, onFocusTerminal, onRetry, onKill }: AgentRowProps) {
  return (
    <div className={`sw-unified-row ${expanded ? 'expanded' : ''} ${item.active ? '' : 'inactive'}`}>
      <button className="sw-unified-row-main" onClick={onToggle}>
        <span className={`sw-dot ${statusDotClass(item.status)}`} />
        <AgentAvatar id={item.agentType} size={18} />
        <div className="sw-unified-row-info">
          <div className="sw-unified-row-name">
            <span className="mono">{item.displayName}</span>
            {item.kind === 'team' && item.teamAgents && (
              <span className="sw-unified-team-avatars">
                {[...new Set(item.teamAgents.map((a) => a.agent_type.toLowerCase()))].map((t) => (
                  <AgentAvatar key={t} id={t} size={14} />
                ))}
              </span>
            )}
          </div>
          <div className="sw-unified-row-activity mono">
            {item.activity}
          </div>
        </div>
        <div className="sw-unified-row-meta">
          {item.duration && <span className="mono sw-unified-row-dur">{item.duration}</span>}
          <span className={`sw-unified-kind-badge ${item.kind}`}>{kindBadge(item.kind)}</span>
          {item.cloudProvider && (
            <span className="mono sw-unified-provider">{item.cloudProvider}</span>
          )}
          {item.prUrl && (
            <a
              href={item.prUrl}
              target="_blank"
              rel="noreferrer"
              className="mono sw-unified-pr"
              onClick={(e) => e.stopPropagation()}
            >
              PR
            </a>
          )}
          {!item.active && item.status !== 'idle' && (
            <span className={`sw-badge ${item.status === 'completed' ? 'ok' : item.status}`}>
              {statusLabel(item.status)}
            </span>
          )}
          <span className="mono sw-unified-row-time">{relTime(item.timestamp)}</span>
        </div>
      </button>

      {expanded && (
        <div className="sw-unified-detail">
          {item.terminal && (
            <TerminalExpandedDetail terminal={item.terminal} onFocus={onFocusTerminal} />
          )}
          {item.kind === 'team' && item.swarm && (
            <TeamDetail swarm={item.swarm} onRetry={onRetry} onKill={onKill} />
          )}
          {(item.kind === 'headless' || item.kind === 'cloud') && item.agent && (
            <AgentDetailView agent={item.agent} swarm={item.swarm} onRetry={onRetry} onKill={onKill} />
          )}
        </div>
      )}
    </div>
  )
}

function TerminalExpandedDetail({ terminal, onFocus }: { terminal: TerminalInfo; onFocus: (t: TerminalInfo) => void }) {
  return (
    <div className="sw-unified-detail-content">
      {terminal.firstUserMessage && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Task</div>
          <div className="sw-unified-detail-text">{terminal.firstUserMessage}</div>
        </div>
      )}
      {terminal.quickSummary && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Activity</div>
          <div className="sw-unified-detail-stats">
            {terminal.quickSummary.filesEdited > 0 && <span>{terminal.quickSummary.filesEdited} files edited</span>}
            {terminal.quickSummary.toolCalls > 0 && <span>{terminal.quickSummary.toolCalls} tool calls</span>}
            {terminal.quickSummary.webSearches > 0 && <span>{terminal.quickSummary.webSearches} web searches</span>}
          </div>
        </div>
      )}
      {terminal.recentFiles && terminal.recentFiles.length > 0 && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Recent files</div>
          <div className="sw-unified-detail-files">
            {terminal.recentFiles.slice(0, 5).map((f) => (
              <span key={f} className="mono sw-unified-file-pill">{f.split('/').pop()}</span>
            ))}
          </div>
        </div>
      )}
      <div className="sw-unified-detail-actions">
        <button className="sw-btn secondary sm" onClick={() => onFocus(terminal)}>
          <Icon name="terminal" size={11} />
          Focus terminal
        </button>
      </div>
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
                  <a href={a.pr_url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 10.5, color: 'var(--brand)' }} onClick={(e) => e.stopPropagation()}>
                    <Icon name="external" size={10} /> PR
                  </a>
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
  const allFiles = [...(agent.files_created || []), ...(agent.files_modified || [])]
  return (
    <div className="sw-unified-detail-content">
      {agent.prompt && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Task</div>
          <div className="sw-unified-detail-text">{agent.prompt.slice(0, 300)}</div>
        </div>
      )}
      {agent.last_messages?.length > 0 && (
        <div className="sw-unified-detail-section">
          <div className="sw-section-label">Latest</div>
          <div className="sw-unified-detail-text mono" style={{ fontSize: 11 }}>
            {agent.last_messages[agent.last_messages.length - 1]?.slice(0, 200)}
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
