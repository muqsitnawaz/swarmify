import React, { useEffect, useMemo, useState } from 'react'
import { postMessage } from '../../hooks'
import { getTaskSummaryStatus } from '../../utils'
import {
  RunningCounts,
  TerminalDetail,
  TaskSummary,
  BuiltInAgentConfig,
  IconConfig,
  ApprovalStatus,
} from '../../types'
import {
  deriveApprovalStatusFromTask,
  formatMixFromTask,
} from '../dashboard/helpers'
import { DashboardIntro } from '../dashboard/DashboardIntro'
import { ApprovalQueueSection } from '../dashboard/ApprovalQueueSection'
import { RunningAgentsSection } from '../dashboard/RunningAgentsSection'
import { AgentTerminalsSection } from '../dashboard/AgentTerminalsSection'
import { RecentSwarmsSection } from '../dashboard/RecentSwarmsSection'
import { ShortcutsSection } from '../dashboard/ShortcutsSection'

interface DashboardTabProps {
  showIntegrationCallout: boolean
  runningCounts: RunningCounts
  builtInAgents: BuiltInAgentConfig[]
  selectedAgentType: string | null
  agentTerminals: TerminalDetail[]
  agentTerminalsLoading: boolean
  sessionTasks: Record<string, TaskSummary[]>
  sessionTasksLoading: Record<string, boolean>
  tasks: TaskSummary[]
  tasksLoading: boolean
  tasksDisplayCount: number
  icons: IconConfig
  isLightTheme: boolean
  onAgentClick: (agentKey: string) => void
  onCloseAgentTerminals: () => void
  onOpenTerminalFile: (filePath: string) => void
  onNavigateToSettings: () => void
  onRefreshTasks: () => void
  onLoadMoreTasks: () => void
}

export function DashboardTab({
  showIntegrationCallout,
  runningCounts,
  builtInAgents,
  selectedAgentType,
  agentTerminals,
  agentTerminalsLoading,
  sessionTasks,
  sessionTasksLoading,
  tasks,
  tasksLoading,
  tasksDisplayCount,
  icons,
  isLightTheme,
  onAgentClick,
  onCloseAgentTerminals,
  onOpenTerminalFile,
  onNavigateToSettings,
  onRefreshTasks,
  onLoadMoreTasks,
}: DashboardTabProps) {
  const [expandedTerminalIds, setExpandedTerminalIds] = useState<Set<string>>(new Set())
  const [approvalStates, setApprovalStates] = useState<Record<string, ApprovalStatus>>({})
  const [mixEdits, setMixEdits] = useState<Record<string, string>>({})
  const [editingTask, setEditingTask] = useState<string | null>(null)

  const toggleExpanded = (terminalId: string) => {
    setExpandedTerminalIds(prev => {
      const next = new Set(prev)
      if (next.has(terminalId)) next.delete(terminalId)
      else next.add(terminalId)
      return next
    })
  }

  useEffect(() => {
    setApprovalStates(prev => {
      const next = { ...prev }
      tasks.forEach(task => {
        if (!next[task.task_name]) {
          next[task.task_name] = deriveApprovalStatusFromTask(task)
        }
      })
      return next
    })

    setMixEdits(prev => {
      const next = { ...prev }
      tasks.forEach(task => {
        if (!next[task.task_name]) {
          next[task.task_name] = formatMixFromTask(task)
        }
      })
      return next
    })
  }, [tasks])

  const pendingApprovals = useMemo(
    () => tasks.filter(task => (approvalStates[task.task_name] || deriveApprovalStatusFromTask(task)) === 'pending'),
    [tasks, approvalStates]
  )

  const currentRunningTask = useMemo(
    () => tasks.find(task => getTaskSummaryStatus(task) === 'running'),
    [tasks]
  )

  const currentMix = currentRunningTask ? mixEdits[currentRunningTask.task_name] || formatMixFromTask(currentRunningTask) : null

  const handleApprove = (taskName: string) => {
    setApprovalStates(prev => ({ ...prev, [taskName]: 'approved' }))
    setEditingTask(null)
    postMessage({ type: 'approveSwarmPlan', taskName })
  }

  const handleReject = (taskName: string) => {
    setApprovalStates(prev => ({ ...prev, [taskName]: 'rejected' }))
    setEditingTask(taskName)
  }

  const handleApplyEdits = (taskName: string) => {
    const mix = mixEdits[taskName]
    postMessage({ type: 'updateSwarmPlan', taskName, mix })
    setApprovalStates(prev => ({ ...prev, [taskName]: 'pending' }))
    setEditingTask(null)
  }

  const handleMixEditChange = (taskName: string, value: string) => {
    setMixEdits(prev => ({ ...prev, [taskName]: value }))
  }

  return (
    <div className="space-y-8">
      <DashboardIntro
        showIntegrationCallout={showIntegrationCallout}
        icons={icons}
        onNavigateToSettings={onNavigateToSettings}
      />

      <ApprovalQueueSection
        pendingApprovals={pendingApprovals}
        approvalStates={approvalStates}
        mixEdits={mixEdits}
        editingTask={editingTask}
        icons={icons}
        isLightTheme={isLightTheme}
        onApprove={handleApprove}
        onReject={handleReject}
        onApplyEdits={handleApplyEdits}
        onCancelEdit={() => setEditingTask(null)}
        onMixEditChange={handleMixEditChange}
      />

      <RunningAgentsSection
        builtInAgents={builtInAgents}
        runningCounts={runningCounts}
        selectedAgentType={selectedAgentType}
        currentMix={currentMix}
        icons={icons}
        isLightTheme={isLightTheme}
        onAgentClick={onAgentClick}
      />

      <AgentTerminalsSection
        selectedAgentType={selectedAgentType}
        agentTerminals={agentTerminals}
        agentTerminalsLoading={agentTerminalsLoading}
        sessionTasks={sessionTasks}
        expandedTerminalIds={expandedTerminalIds}
        icons={icons}
        isLightTheme={isLightTheme}
        onCloseAgentTerminals={onCloseAgentTerminals}
        onOpenTerminalFile={onOpenTerminalFile}
        onToggleExpanded={toggleExpanded}
      />

      <RecentSwarmsSection
        tasks={tasks}
        tasksLoading={tasksLoading}
        tasksDisplayCount={tasksDisplayCount}
        approvalStates={approvalStates}
        icons={icons}
        isLightTheme={isLightTheme}
        onApprove={handleApprove}
        onRefreshTasks={onRefreshTasks}
        onLoadMoreTasks={onLoadMoreTasks}
      />

      <ShortcutsSection />
    </div>
  )
}
