import React, { useEffect, useMemo, useState } from 'react'
import type { TaskSummary, TerminalDetail } from '../../types'
import { ActiveSwarmsPane } from './ActiveSwarmsPane'
import { AgentTerminalsPane } from './AgentTerminalsPane'
import { SwarmDetailPane } from './SwarmDetailPane'
import { CompletedSwarmsPane } from './CompletedSwarmsPane'
import { splitSwarms } from './types'
import { postMessage } from '../../hooks'

interface MissionControlTabProps {
  tasks: TaskSummary[]
  tasksLoading: boolean
  terminals: TerminalDetail[]
  onDispatch: () => void
}

const AGENT_SPAWN_COMMANDS: Record<string, string> = {
  claude: 'agents.newClaude',
  codex: 'agents.newCodex',
  gemini: 'agents.newGemini',
  opencode: 'agents.newOpencode',
  cursor: 'agents.newCursor',
}

export function MissionControlTab({ tasks, tasksLoading, terminals, onDispatch }: MissionControlTabProps) {
  const { active, completed } = useMemo(() => splitSwarms(tasks), [tasks])
  const [selectedTaskName, setSelectedTaskName] = useState<string | null>(null)

  // Auto-select: prefer first active, fall back to first completed
  useEffect(() => {
    if (selectedTaskName) return
    if (active.length > 0) {
      setSelectedTaskName(active[0].task_name)
    } else if (completed.length > 0) {
      setSelectedTaskName(completed[0].task_name)
    }
  }, [active, completed, selectedTaskName])

  const selectedSwarm =
    [...active, ...completed].find((s) => s.task_name === selectedTaskName) ?? null

  const handleFocusTerminal = (t: TerminalDetail) => {
    postMessage({ type: 'focusTerminal', terminalId: t.id })
  }

  const handleNewAgent = (agentKey: 'claude' | 'codex' | 'gemini' | 'opencode' | 'cursor') => {
    postMessage({ type: 'executeCommand', command: AGENT_SPAWN_COMMANDS[agentKey] })
  }

  const handleRetry = (swarm: TaskSummary) => {
    postMessage({ type: 'retrySwarm', taskName: swarm.task_name })
  }

  const handleKill = (swarm: TaskSummary) => {
    postMessage({ type: 'killSwarm', taskName: swarm.task_name })
  }

  const handleCopyId = (swarm: TaskSummary) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(swarm.task_name).catch(() => undefined)
    }
  }

  const handleClearCompleted = () => {
    postMessage({ type: 'clearCompletedSwarms' })
  }

  return (
    <div className="sw-mc-main">
      <div className="sw-mc-pane" style={{ display: 'grid', gridTemplateRows: '3fr 2fr', minHeight: 0 }}>
        <ActiveSwarmsPane
          swarms={active}
          selectedTaskName={selectedTaskName}
          onSelect={setSelectedTaskName}
          onDispatch={onDispatch}
        />
        <AgentTerminalsPane
          terminals={terminals}
          onFocus={handleFocusTerminal}
          onNewAgent={handleNewAgent}
        />
      </div>

      <div className="sw-mc-pane">
        {tasksLoading && !selectedSwarm ? (
          <div className="sw-mc-pane-body">
            <div className="sw-empty">
              <div className="sw-empty-sub">Loading swarms…</div>
            </div>
          </div>
        ) : (
          <SwarmDetailPane
            swarm={selectedSwarm}
            onRetry={handleRetry}
            onKill={handleKill}
            onCopyId={handleCopyId}
          />
        )}
      </div>

      <div className="sw-mc-pane">
        <CompletedSwarmsPane
          swarms={completed}
          onClear={handleClearCompleted}
          onSelect={(s) => setSelectedTaskName(s.task_name)}
        />
      </div>
    </div>
  )
}
