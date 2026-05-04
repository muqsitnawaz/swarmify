import React from 'react'
import type { TaskSummary, TerminalDetail, UnifiedTask } from '../../types'
import { UnifiedAgentsPane, WatchdogEventUI } from './UnifiedAgentsPane'

interface MissionControlTabProps {
  tasks: TaskSummary[]
  tasksLoading: boolean
  terminals: TerminalDetail[]
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

export function MissionControlTab({ tasks, tasksLoading, terminals, unifiedTasks, unifiedTasksLoading, onDispatch, onNavigate, openDispatchTrigger, openDetailTaskId, onDetailTaskConsumed, onThroughputChange, githubRepo, watchdogEnabled, watchdogEvents }: MissionControlTabProps) {
  return (
    <UnifiedAgentsPane
      terminals={terminals}
      tasks={tasks}
      tasksLoading={tasksLoading}
      unifiedTasks={unifiedTasks}
      unifiedTasksLoading={unifiedTasksLoading}
      onDispatch={onDispatch}
      onNavigate={onNavigate}
      openDispatchTrigger={openDispatchTrigger}
      openDetailTaskId={openDetailTaskId}
      onDetailTaskConsumed={onDetailTaskConsumed}
      onThroughputChange={onThroughputChange}
      githubRepo={githubRepo}
      watchdogEnabled={watchdogEnabled}
      watchdogEvents={watchdogEvents}
    />
  )
}
