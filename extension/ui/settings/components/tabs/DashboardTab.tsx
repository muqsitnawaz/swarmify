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
  getRoleInfo,
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
  onNavigateToSettings,
  onRefreshTasks,
  onLoadMoreTasks,
}: DashboardTabProps) {
  const [expandedTerminalIds, setExpandedTerminalIds] = useState<Set<string>>(new Set())
  const [expandedSwarms, setExpandedSwarms] = useState<Set<string>>(new Set())
  const [approvalStates, setApprovalStates] = useState<Record<string, ApprovalStatus>>({})
  const [mixEdits, setMixEdits] = useState<Record<string, string>>({})
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [roleEdits, setRoleEdits] = useState<Record<string, Record<string, string>>>({})

  const toggleExpanded = (terminalId: string) => {
    setExpandedTerminalIds(prev => {
      const next = new Set(prev)
      if (next.has(terminalId)) next.delete(terminalId)
      else next.add(terminalId)
      return next
    })
  }

  const toggleSwarmHierarchy = (taskName: string) => {
    setExpandedSwarms(prev => {
      const next = new Set(prev)
      if (next.has(taskName)) next.delete(taskName)
      else next.add(taskName)
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

    setRoleEdits(prev => {
      const next = { ...prev }
      tasks.forEach(task => {
        if (!next[task.task_name]) {
          const defaults: Record<string, string> = {}
          task.agents.forEach(agent => {
            const generatedKey = `${task.task_name}-${Object.keys(defaults).length}`
            const key = agent.agent_id || agent.agent_type || agent.prompt || agent.last_messages?.[0] || generatedKey
            defaults[key] = getRoleInfo(agent.agent_type || 'agent').role
          })
          next[task.task_name] = defaults
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
    const roles = roleEdits[taskName] || {}
    postMessage({ type: 'updateSwarmPlan', taskName, mix, roles })
    setApprovalStates(prev => ({ ...prev, [taskName]: 'pending' }))
    setEditingTask(null)
  }

  const handleMixEditChange = (taskName: string, value: string) => {
    setMixEdits(prev => ({ ...prev, [taskName]: value }))
  }

  const handleRoleEditChange = (taskName: string, roleKey: string, value: string) => {
    setRoleEdits(prev => ({
      ...prev,
      [taskName]: { ...(prev[taskName] || {}), [roleKey]: value }
    }))
  }

  return (
    <div className="space-y-8">
      <DashboardIntro
        showIntegrationCallout={showIntegrationCallout}
        icons={icons}
        currentMix={currentMix}
        onNavigateToSettings={onNavigateToSettings}
      />

      <ApprovalQueueSection
        pendingApprovals={pendingApprovals}
        approvalStates={approvalStates}
        mixEdits={mixEdits}
        editingTask={editingTask}
        roleEdits={roleEdits}
        onApprove={handleApprove}
        onReject={handleReject}
        onApplyEdits={handleApplyEdits}
        onCancelEdit={() => setEditingTask(null)}
        onMixEditChange={handleMixEditChange}
        onRoleEditChange={handleRoleEditChange}
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
        onToggleExpanded={toggleExpanded}
      />

      <RecentSwarmsSection
        tasks={tasks}
        tasksLoading={tasksLoading}
        tasksDisplayCount={tasksDisplayCount}
        approvalStates={approvalStates}
        mixEdits={mixEdits}
        expandedSwarms={expandedSwarms}
        icons={icons}
        isLightTheme={isLightTheme}
        onToggleSwarmHierarchy={toggleSwarmHierarchy}
        onApprove={handleApprove}
        onRefreshTasks={onRefreshTasks}
        onLoadMoreTasks={onLoadMoreTasks}
      />

      <ShortcutsSection />
    </div>
  )
}
