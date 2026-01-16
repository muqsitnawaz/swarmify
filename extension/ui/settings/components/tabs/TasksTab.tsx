import React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { SectionHeader } from '../common'
import { renderTodoDescription } from '../../utils'
import { TodoFile, TodoItem, UnifiedTask, TaskSource, AgentSettings } from '../../types'
import { SOURCE_BADGES } from '../../constants'

interface TasksTabProps {
  todoFiles: TodoFile[]
  unifiedTasks: UnifiedTask[]
  todoLoading: boolean
  unifiedTasksLoading: boolean
  expandedSources: Set<TaskSource>
  availableSources: { linear: boolean; github: boolean }
  settings: AgentSettings | null
  onToggleSource: (source: TaskSource) => void
  onSpawnTodo: (item: TodoItem, filePath: string) => void
  onRefresh: () => void
  onUpdateTaskSources: (sources: Partial<AgentSettings['taskSources']>) => void
}

export function TasksTab({
  todoFiles,
  unifiedTasks,
  todoLoading,
  unifiedTasksLoading,
  expandedSources,
  availableSources,
  settings,
  onToggleSource,
  onSpawnTodo,
  onRefresh,
  onUpdateTaskSources,
}: TasksTabProps) {
  // Group unified tasks by source
  const tasksBySource = unifiedTasks.reduce((acc, task) => {
    if (!acc[task.source]) acc[task.source] = []
    acc[task.source].push(task)
    return acc
  }, {} as Record<TaskSource, UnifiedTask[]>)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader className="mb-0">Tasks</SectionHeader>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={todoLoading || unifiedTasksLoading}
        >
          Refresh
        </Button>
      </div>

      {unifiedTasksLoading && unifiedTasks.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted-foreground)]">Loading tasks...</div>
      ) : unifiedTasks.length === 0 && todoFiles.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted-foreground)]">
          No tasks found. Add a TODO.md file or connect Linear/GitHub.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Markdown Tasks */}
          {settings?.taskSources?.markdown && todoFiles.length > 0 && (
            <TaskSourceSection
              source="markdown"
              label="Markdown Files"
              badge={SOURCE_BADGES.markdown}
              count={todoFiles.reduce((sum, f) => sum + f.items.length, 0)}
              expanded={expandedSources.has('markdown')}
              onToggle={() => onToggleSource('markdown')}
            >
              <div className="space-y-3 pl-6">
                {todoFiles.map(file => (
                  <div key={file.path} className="space-y-2">
                    <div className="text-xs text-[var(--muted-foreground)] truncate">{file.path}</div>
                    {file.items.map((item, index) => (
                      <div key={`${file.path}-${index}-${item.line}`} className="flex items-start gap-3 pl-2">
                        <span
                          className={`mt-0.5 rounded px-2 py-0.5 text-xs ${
                            item.completed
                              ? 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
                              : 'bg-[var(--background)] text-[var(--foreground)]'
                          }`}
                        >
                          {item.completed ? 'Done' : 'Open'}
                        </span>
                        <div className="flex-1 min-w-0 space-y-1">
                          <span className={`text-sm ${item.completed ? 'line-through text-[var(--muted-foreground)]' : ''}`}>
                            {item.title || 'Untitled'}
                          </span>
                          {item.description && (
                            <div className="text-xs text-[var(--muted-foreground)]">
                              {renderTodoDescription(item.description, true)}
                            </div>
                          )}
                        </div>
                        {!item.completed && (
                          <Button size="sm" onClick={() => onSpawnTodo(item, file.path)}>
                            Run
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </TaskSourceSection>
          )}

          {/* Linear Tasks */}
          {settings?.taskSources?.linear && tasksBySource.linear && tasksBySource.linear.length > 0 && (
            <TaskSourceSection
              source="linear"
              label="Linear Issues"
              badge={SOURCE_BADGES.linear}
              count={tasksBySource.linear.length}
              expanded={expandedSources.has('linear')}
              onToggle={() => onToggleSource('linear')}
            >
              <div className="space-y-2 pl-6">
                {tasksBySource.linear.map(task => (
                  <div key={task.id} className="flex items-start gap-3">
                    <span className="mt-0.5 rounded px-2 py-0.5 text-xs bg-[var(--background)] text-[var(--foreground)]">
                      {task.metadata.identifier}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">{task.title}</div>
                      {task.priority && (
                        <span className="text-xs text-[var(--muted-foreground)] capitalize">{task.priority}</span>
                      )}
                    </div>
                    {task.metadata.url && (
                      <Button size="sm" variant="outline" onClick={() => window.open(task.metadata.url, '_blank')}>
                        Open
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </TaskSourceSection>
          )}

          {/* GitHub Tasks */}
          {settings?.taskSources?.github && tasksBySource.github && tasksBySource.github.length > 0 && (
            <TaskSourceSection
              source="github"
              label="GitHub Issues"
              badge={SOURCE_BADGES.github}
              count={tasksBySource.github.length}
              expanded={expandedSources.has('github')}
              onToggle={() => onToggleSource('github')}
            >
              <div className="space-y-2 pl-6">
                {tasksBySource.github.map(task => (
                  <div key={task.id} className="flex items-start gap-3">
                    <span className="mt-0.5 rounded px-2 py-0.5 text-xs bg-[var(--background)] text-[var(--foreground)]">
                      {task.metadata.identifier}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">{task.title}</div>
                      {task.metadata.labels && task.metadata.labels.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {task.metadata.labels.map(label => (
                            <span key={label} className="text-xs px-1.5 py-0.5 rounded bg-[var(--secondary)]">{label}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {task.metadata.url && (
                      <Button size="sm" variant="outline" onClick={() => window.open(task.metadata.url, '_blank')}>
                        Open
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </TaskSourceSection>
          )}
        </div>
      )}

      {/* Source toggles */}
      <div className="border-t border-[var(--border)] pt-4 mt-4">
        <div className="text-xs text-[var(--muted-foreground)] mb-2">Sources</div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={settings?.taskSources?.markdown ?? true}
              onCheckedChange={(checked) => onUpdateTaskSources({ markdown: !!checked })}
            />
            Markdown
          </label>
          <label className={`flex items-center gap-2 text-sm ${!availableSources.linear ? 'opacity-50' : 'cursor-pointer'}`}>
            <Checkbox
              checked={settings?.taskSources?.linear ?? false}
              disabled={!availableSources.linear}
              onCheckedChange={(checked) => onUpdateTaskSources({ linear: !!checked })}
            />
            Linear {!availableSources.linear && '(MCP not configured)'}
          </label>
          <label className={`flex items-center gap-2 text-sm ${!availableSources.github ? 'opacity-50' : 'cursor-pointer'}`}>
            <Checkbox
              checked={settings?.taskSources?.github ?? false}
              disabled={!availableSources.github}
              onCheckedChange={(checked) => onUpdateTaskSources({ github: !!checked })}
            />
            GitHub {!availableSources.github && '(MCP not configured)'}
          </label>
        </div>
      </div>
    </div>
  )
}

interface TaskSourceSectionProps {
  source: TaskSource
  label: string
  badge: { label: string; color: string }
  count: number
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function TaskSourceSection({
  label,
  badge,
  count,
  expanded,
  onToggle,
  children,
}: TaskSourceSectionProps) {
  return (
    <div className="rounded-xl bg-[var(--muted)] px-4 py-3 space-y-3">
      <div className="flex items-center gap-2 cursor-pointer" onClick={onToggle}>
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <span
          className="text-xs font-bold px-2 py-0.5 rounded"
          style={{ backgroundColor: badge.color, color: '#fff' }}
        >
          {badge.label}
        </span>
        <span className="text-sm font-medium">{label}</span>
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">{count} tasks</span>
      </div>
      {expanded && children}
    </div>
  )
}
