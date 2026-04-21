import React from 'react'
import type { TaskSummary, TerminalDetail } from '../../types'
import { UnifiedAgentsPane } from './UnifiedAgentsPane'

interface MissionControlTabProps {
  tasks: TaskSummary[]
  tasksLoading: boolean
  terminals: TerminalDetail[]
  onDispatch: () => void
}

export function MissionControlTab({ tasks, tasksLoading, terminals, onDispatch }: MissionControlTabProps) {
  return (
    <UnifiedAgentsPane
      terminals={terminals}
      tasks={tasks}
      tasksLoading={tasksLoading}
      onDispatch={onDispatch}
    />
  )
}
