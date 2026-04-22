import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../mission-control/icons'
import { postMessage } from '../../hooks'
import { TaskCard } from './TaskCard'
import { TaskDetail } from './TaskDetail'
import { CycleBar } from './CycleBar'
import type { FlatTask } from './TaskCard'
import type {
  AgentSettings,
  ContextFile,
  CycleInfo,
  IconConfig,
  TaskSource,
  UnifiedTask,
  WorkspaceConfig,
} from '../../types'

const SOURCE_ORDER: Record<string, number> = {
  linear: 0,
  github: 1,
}

interface BenchTabProps {
  unifiedTasks: UnifiedTask[]
  cycleInfo: CycleInfo | null
  unifiedTasksLoading: boolean
  expandedSources: Set<TaskSource>
  availableSources: { linear: boolean; github: boolean }
  settings: AgentSettings | null
  defaultAgent: string
  contextFiles: ContextFile[]
  contextLoading: boolean
  collapsedDirs: Set<string>
  workspaceConfig: WorkspaceConfig | null
  workspaceConfigLoaded: boolean
  workspaceConfigExists: boolean
  workspacePath: string | null
  githubRepo: string | null
  dismissedTaskIds: Set<string>
  icons: IconConfig
  isLightTheme: boolean
  onToggleSource: (source: TaskSource) => void
  onSpawnAgentForTask: (task: UnifiedTask) => void
  onRefreshTasks: () => void
  onRefreshContext: () => void
  onUpdateTaskSources: (sources: Partial<any>) => void
  onToggleDir: (path: string) => void
  onOpenFile: (path: string) => void
  onInitWorkspaceConfig: () => void
  onSaveWorkspaceConfig: (config: WorkspaceConfig) => void
  onDismissTask: (taskId: string) => void
  onConnectLinear: () => void
  onConnectGitHub: () => void
}

const SOURCE_FILTERS: Array<{ key: TaskSource; label: string; cls: string }> = [
  { key: 'linear', label: 'LN', cls: 'ln' },
  { key: 'github', label: 'GH', cls: 'gh' },
]

export function BenchTab(props: BenchTabProps) {
  const {
    unifiedTasks,
    cycleInfo,
    unifiedTasksLoading,
    settings,
    dismissedTaskIds,
    onRefreshTasks,
    onSpawnAgentForTask,
    onDismissTask,
  } = props

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [activeFilters, setActiveFilters] = useState<Set<TaskSource>>(
    new Set(['linear', 'github'])
  )

  const toggleFilter = (source: TaskSource) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  const flatTasks = useMemo<FlatTask[]>(() => {
    const items: FlatTask[] = []

    const filteredUnified = unifiedTasks.filter(task => {
      if (dismissedTaskIds.has(task.id)) return false
      if (task.source === 'linear') return settings?.taskSources?.linear
      if (task.source === 'github') return settings?.taskSources?.github
      return true
    })

    filteredUnified
      .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source])
      .forEach(task => {
        items.push({
          id: task.id,
          source: task.source,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          metadata: task.metadata,
        })
      })

    return items
  }, [unifiedTasks, settings?.taskSources, dismissedTaskIds])

  const filteredTasks = useMemo(
    () => flatTasks.filter(t => activeFilters.has(t.source)),
    [flatTasks, activeFilters]
  )

  const selectedTask = useMemo(
    () => filteredTasks.find(t => t.id === selectedTaskId) ?? null,
    [filteredTasks, selectedTaskId]
  )

  useEffect(() => {
    if (filteredTasks.length === 0) return
    if (selectedTaskId && filteredTasks.some(t => t.id === selectedTaskId)) return
    setSelectedTaskId(filteredTasks[0].id)
  }, [filteredTasks, selectedTaskId])

  const handleDispatch = (task: FlatTask) => {
    const source = unifiedTasks.find(t => t.id === task.id)
    if (source) onSpawnAgentForTask(source)
  }

  const handleDismiss = (taskId: string) => {
    onDismissTask(taskId)
    if (selectedTaskId === taskId) setSelectedTaskId(null)
  }

  const handleOpenExternal = (url: string) => {
    postMessage({ type: 'openExternal', url })
  }

  const isLoading = unifiedTasksLoading

  return (
    <div className="sw-bench">
      {/* Left column: task list */}
      <div className="sw-bench-list">
        <div className="sw-bench-list-head">
          <span className="sw-section-label">Work Queue</span>
          <span className="sw-section-count">{filteredTasks.length}</span>
          <div className="sw-bench-list-filters">
            {SOURCE_FILTERS.map(f => (
              <button
                key={f.key}
                className={`sw-source-chip ${f.cls}${activeFilters.has(f.key) ? ' active' : ''}`}
                onClick={() => toggleFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            className="sw-icon-btn"
            onClick={onRefreshTasks}
            disabled={isLoading}
            title="Refresh tasks"
          >
            <Icon name="refresh" size={13} />
          </button>
        </div>

        {cycleInfo && <CycleBar cycleInfo={cycleInfo} />}

        <div className="sw-bench-list-body">
          {isLoading && filteredTasks.length === 0 ? (
            <div className="sw-empty">
              <span className="sw-empty-title">Loading tasks...</span>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="sw-empty">
              <span className="sw-empty-title">Work queue empty</span>
              <span className="sw-empty-sub">
                Connect Linear or GitHub to see tasks here.
              </span>
            </div>
          ) : (
            filteredTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                selected={task.id === selectedTaskId}
                onClick={() => setSelectedTaskId(task.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right column: task detail */}
      <div className="sw-bench-detail">
        {selectedTask ? (
          <TaskDetail
            task={selectedTask}
            cycleInfo={cycleInfo}
            onDispatch={handleDispatch}
            onDismiss={handleDismiss}
            onOpenExternal={handleOpenExternal}
          />
        ) : (
          <div className="sw-empty" style={{ flex: 1 }}>
            <Icon name="inbox" size={32} style={{ color: 'var(--ds-text-faint)' }} />
            <span className="sw-empty-title">Select a task to see details</span>
            <span className="sw-empty-sub">
              Click a task in the work queue to view its full description, metadata, and actions.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
