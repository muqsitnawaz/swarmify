import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { TaskSummary, TerminalDetail as TerminalInfo, AgentDetail } from '../../types'
import { AgentAvatar, agentShortChunk } from './AgentAvatar'
import { Icon } from './icons'
import { relTime, taskNameToTitle, swarmOverallStatus, shortDuration } from './types'
import { postMessage } from '../../hooks'
import { renderTodoDescription } from '../../utils/markdown'

const NEW_AGENT_MENU: Array<{ agent: string; name: string; keys: string[] }> = [
  { agent: 'claude', name: 'Claude', keys: ['Cmd', 'Shift', 'A'] },
  { agent: 'codex', name: 'Codex', keys: ['Cmd', 'Shift', 'B'] },
  { agent: 'gemini', name: 'Gemini', keys: ['Cmd', 'Shift', 'X'] },
  { agent: 'opencode', name: 'OpenCode', keys: ['Cmd', 'Shift', 'M'] },
  { agent: 'cursor', name: 'Cursor', keys: ['Cmd', 'Shift', 'U'] },
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
      const promptFirstLine = a.prompt?.split('\n')[0]?.slice(0, 120) || ''
      const activity = isCloud
        ? (promptFirstLine || 'cloud run')
        : (lastCmd ? `$ ${lastCmd}` : lastFile ? `Editing ${lastFile}` : lastMsg ? lastMsg.slice(0, 120) : promptFirstLine || 'working...')
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

  const counts = useMemo(() => {
    const c = { terminal: 0, cloud: 0, team: 0 }
    for (const item of items) {
      if (item.kind === 'headless') c.terminal++
      else c[item.kind]++
    }
    return c
  }, [items])

  const activeCount = useMemo(() => items.filter((i) => i.active).length, [items])

  const filtered = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'terminal') return items.filter((i) => i.kind === 'terminal' || i.kind === 'headless')
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
    { key: 'cloud', label: 'Cloud', count: counts.cloud },
    { key: 'team', label: 'Teams', count: counts.team },
  ]

  const selectedItem = expandedId ? items.find((i) => i.id === expandedId) ?? null : null

  return (
    <div className="sw-unified-split">
      <div className="sw-unified">
        <div className="sw-unified-head">
          <Icon name="zap" size={13} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Agents</span>
          <span className="sw-section-count">{activeCount > 0 ? `${activeCount} active` : items.length}</span>
          <div className="sw-spacer" />
          <div style={{ position: 'relative' }} ref={newMenuRef}>
            <button className="sw-btn secondary sm" onClick={() => setNewMenuOpen((o) => !o)}>
              <Icon name="plus" size={11} />
              New
              <Icon name="chevD" size={10} />
            </button>
            {newMenuOpen && (
              <div className="sw-menu">
                {NEW_AGENT_MENU.map((m) => (
                  <button
                    key={m.agent}
                    className="sw-menu-item"
                    onClick={() => {
                      setNewMenuOpen(false)
                      handleNewAgent(m.agent)
                    }}
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
              selected={expandedId === item.id}
              onSelect={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onFocusTerminal={handleFocusTerminal}
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
              selected={expandedId === item.id}
              onSelect={() => setExpandedId(expandedId === item.id ? null : item.id)}
              onFocusTerminal={handleFocusTerminal}
            />
          ))}
        </div>
      </div>

      <div className="sw-unified-detail-pane">
        {selectedItem ? (
          <DetailPane
            item={selectedItem}
            onFocusTerminal={handleFocusTerminal}
            onRetry={handleRetry}
            onKill={handleKill}
          />
        ) : (
          <div className="sw-empty" style={{ height: '100%' }}>
            <Icon name="inbox" size={24} />
            <div className="sw-empty-title">Select an agent to see details</div>
            <div className="sw-empty-sub">
              Click an agent in the list to view its full activity, files changed, and actions.
            </div>
          </div>
        )}
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
  selected: boolean
  onSelect: () => void
  onFocusTerminal: (t: TerminalInfo) => void
}

function AgentRow({ item, selected, onSelect, onFocusTerminal }: AgentRowProps) {
  return (
    <button
      className={`sw-unified-row ${selected ? 'selected' : ''} ${item.active ? '' : 'inactive'}`}
      onClick={() => {
        onSelect()
        if (item.terminal && item.kind === 'terminal') onFocusTerminal(item.terminal)
      }}
    >
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
        {!item.active && item.status !== 'idle' && (
          <span className={`sw-badge ${item.status === 'completed' ? 'ok' : item.status}`}>
            {statusLabel(item.status)}
          </span>
        )}
        <span className={`sw-unified-kind-badge ${item.kind}`}>{kindBadge(item.kind)}</span>
        <span className="mono sw-unified-row-time">{relTime(item.timestamp)}</span>
      </div>
    </button>
  )
}

function DetailPane({ item, onFocusTerminal, onRetry, onKill }: {
  item: UnifiedAgent
  onFocusTerminal: (t: TerminalInfo) => void
  onRetry: (taskName: string) => void
  onKill: (taskName: string) => void
}) {
  const isActive = item.active

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
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
            {!isActive && (
              <button className="sw-btn secondary sm" onClick={() => onRetry(item.swarm!.task_name)}>
                <Icon name="refresh" size={11} />
                Retry
              </button>
            )}
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
      </div>

      <div className="sw-mc-pane-body">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {item.duration && <span className="sw-pill mono">{item.duration}</span>}
          <span className="sw-pill">{relTime(item.timestamp)}</span>
          {item.status !== 'idle' && (
            <span className={`sw-badge ${item.status === 'completed' ? 'ok' : item.status}`}>
              {statusLabel(item.status)}
            </span>
          )}
          {item.prUrl && (
            <a href={item.prUrl} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 11, color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="external" size={10} /> PR
            </a>
          )}
        </div>

        {item.terminal && <TerminalExpandedDetail terminal={item.terminal} onFocus={onFocusTerminal} />}
        {item.kind === 'team' && item.swarm && <TeamDetail swarm={item.swarm} onRetry={onRetry} onKill={onKill} />}
        {(item.kind === 'headless' || item.kind === 'cloud') && item.agent && (
          <AgentDetailView agent={item.agent} swarm={item.swarm} onRetry={onRetry} onKill={onKill} />
        )}
      </div>
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
  const isCloud = agent.mode === 'cloud' || !!agent.cloud_provider
  const allFiles = [...(agent.files_created || []), ...(agent.files_modified || [])]

  if (isCloud) {
    return (
      <div className="sw-unified-detail-content">
        <div className="sw-cloud-meta">
          {agent.repo_owner && agent.repo_name && (
            <div className="sw-cloud-meta-row">
              <span className="sw-cloud-meta-label">Repository</span>
              <a href={`https://github.com/${agent.repo_owner}/${agent.repo_name}`} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {agent.repo_owner}/{agent.repo_name}
                <Icon name="external" size={10} />
              </a>
            </div>
          )}
          {agent.branch && (
            <div className="sw-cloud-meta-row">
              <span className="sw-cloud-meta-label">Branch</span>
              <span className="mono" style={{ fontSize: 12 }}>{agent.branch}</span>
            </div>
          )}
          {agent.pr_url && (
            <div className="sw-cloud-meta-row">
              <span className="sw-cloud-meta-label">Pull request</span>
              <a href={agent.pr_url} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, color: 'var(--brand)' }}>
                {agent.pr_url.match(/\/pull\/(\d+)/)?.[0] || 'View PR'}
              </a>
            </div>
          )}
          {agent.linear_issue && (
            <div className="sw-cloud-meta-row">
              <span className="sw-cloud-meta-label">Linear</span>
              <a href={`https://linear.app/issue/${agent.linear_issue}`} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, color: 'var(--brand)' }}>
                {agent.linear_issue}
              </a>
            </div>
          )}
        </div>
        {agent.prompt && (
          <div className="sw-unified-detail-section">
            <div className="sw-section-label">Task</div>
            <div className="sw-cloud-prompt">{renderTodoDescription(agent.prompt, false)}</div>
          </div>
        )}
        {agent.cloud_summary && (
          <div className="sw-unified-detail-section">
            <div className="sw-section-label">Output</div>
            <div className="sw-cloud-log">{renderTodoDescription(agent.cloud_summary, false)}</div>
          </div>
        )}
        {!agent.cloud_summary && isActive && (
          <div className="sw-unified-detail-section">
            <div className="sw-section-label">Output</div>
            <div className="sw-unified-detail-text" style={{ color: 'var(--ds-text-dim)', fontStyle: 'italic' }}>
              Running remotely. Output appears when the agent finishes.
            </div>
          </div>
        )}
        {swarm && (
          <div className="sw-unified-detail-actions">
            {!isActive && (
              <button className="sw-btn secondary sm" onClick={() => onRetry(swarm.task_name)}>
                <Icon name="refresh" size={11} />
                Retry
              </button>
            )}
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
          <div className="sw-unified-detail-text">{agent.prompt.slice(0, 500)}</div>
        </div>
      )}
      {agent.last_messages?.length > 0 && (
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
          {!isActive && (
            <button className="sw-btn secondary sm" onClick={() => onRetry(swarm.task_name)}>
              <Icon name="refresh" size={11} />
              Retry
            </button>
          )}
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
