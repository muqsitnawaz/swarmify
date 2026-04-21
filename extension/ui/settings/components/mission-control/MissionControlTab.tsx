import React from 'react'
import type { TaskSummary, TerminalDetail, UnifiedTask } from '../../types'
import { UnifiedAgentsPane } from './UnifiedAgentsPane'

interface MissionControlTabProps {
  tasks: TaskSummary[]
  tasksLoading: boolean
  terminals: TerminalDetail[]
  unifiedTasks: UnifiedTask[]
  unifiedTasksLoading: boolean
  onDispatch: () => void
  onNavigate?: (tab: 'floor' | 'bench' | 'panel') => void
}

export function MissionControlTab({ tasks, tasksLoading, terminals, unifiedTasks, unifiedTasksLoading, onDispatch, onNavigate }: MissionControlTabProps) {
  return (
    <UnifiedAgentsPane
      terminals={terminals}
      tasks={tasks}
      tasksLoading={tasksLoading}
      unifiedTasks={unifiedTasks}
      unifiedTasksLoading={unifiedTasksLoading}
      onDispatch={onDispatch}
      onNavigate={onNavigate}
    />
  )
}
