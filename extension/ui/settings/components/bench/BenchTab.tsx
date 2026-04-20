import React, { useMemo, useState } from 'react'
import { Icon } from '../mission-control/icons'
import { TaskCard } from './TaskCard'
import { TaskDetail } from './TaskDetail'
import type { FlatTask } from './TaskCard'
import type {
  AgentSettings,
  ContextFile,
  IconConfig,
  TaskSource,
  TodoFile,
  TodoItem,
  UnifiedTask,
  WorkspaceConfig,
} from '../../types'

const SOURCE_ORDER: Record<TaskSource, number> = {
  markdown: 0,
  linear: 1,
  github: 2,
}

interface BenchTabProps {
  todoFiles: TodoFile[]
  unifiedTasks: UnifiedTask[]
  todoLoading: boolean
  unifiedTasksLoading: boolean
  expandedSources: Set<TaskSource>
  availableSources: { markdown?: boolean; linear: boolean; github: boolean }
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
  onSpawnTodo: (item: TodoItem, filePath: string) => void
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
  { key: 'markdown', label: 'MD', cls: 'md' },
  { key: 'linear', label: 'LN', cls: 'ln' },
  { key: 'github', label: 'GH', cls: 'gh' },
]

export function BenchTab(props: BenchTabProps) {
  const {
    todoFiles,
    unifiedTasks,
    todoLoading,
    unifiedTasksLoading,
    settings,
    dismissedTaskIds,
    onRefreshTasks,
    onSpawnTodo,
    onDismissTask,
  } = props

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [activeFilters, setActiveFilters] = useState<Set<TaskSource>>(
    new Set(['markdown', 'linear', 'github'])
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

    if (settings?.taskSources?.markdown ?? true) {
      todoFiles.forEach(file => {
        file.items.forEach((item, idx) => {
          if (item.completed) return
          const id = `md:${file.path}:${item.line}:${idx}`
          if (dismissedTaskIds.has(id)) return
          items.push({
            id,
            source: 'markdown',
            title: item.title || 'Untitled',
            description: item.description,
            status: 'todo',
            todoItem: item,
            filePath: file.path,
            metadata: { file: file.path, line: item.line },
          })
        })
      })
    }

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
  }, [todoFiles, unifiedTasks, settings?.taskSources, dismissedTaskIds])

  const filteredTasks = useMemo(
    () => flatTasks.filter(t => activeFilters.has(t.source)),
    [flatTasks, activeFilters]
  )

  const selectedTask = useMemo(
    () => filteredTasks.find(t => t.id === selectedTaskId) ?? null,
    [filteredTasks, selectedTaskId]
  )

  const handleDispatch = (task: FlatTask) => {
    if (task.source === 'markdown' && task.todoItem && task.filePath) {
      onSpawnTodo(task.todoItem, task.filePath)
    }
  }

  const handleDismiss = (taskId: string) => {
    onDismissTask(taskId)
    if (selectedTaskId === taskId) setSelectedTaskId(null)
  }

  const handleOpenExternal = (url: string) => {
    window.open(url, '_blank')
  }

  const isLoading = todoLoading || unifiedTasksLoading

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

        <div className="sw-bench-list-body">
          {isLoading && filteredTasks.length === 0 ? (
            <div className="sw-empty">
              <span className="sw-empty-title">Loading tasks...</span>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="sw-empty">
              <span className="sw-empty-title">Work queue empty</span>
              <span className="sw-empty-sub">
                Add a TODO.md file or connect Linear or GitHub to see tasks here.
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
