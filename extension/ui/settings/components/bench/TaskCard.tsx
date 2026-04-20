import React from 'react'
import type { TaskSource, UnifiedTask, TodoItem } from '../../types'

const SOURCE_CLASS: Record<TaskSource, string> = {
  markdown: 'md',
  linear: 'ln',
  github: 'gh',
}

const SOURCE_LABEL: Record<TaskSource, string> = {
  markdown: 'MD',
  linear: 'LN',
  github: 'GH',
}

export interface FlatTask {
  id: string
  source: TaskSource
  title: string
  description?: string
  status: 'todo' | 'in_progress' | 'done'
  priority?: 'urgent' | 'high' | 'medium' | 'low'
  todoItem?: TodoItem
  filePath?: string
  metadata?: UnifiedTask['metadata']
}

interface TaskCardProps {
  task: FlatTask
  selected: boolean
  onClick: () => void
}

export function TaskCard({ task, selected, onClick }: TaskCardProps) {
  const srcClass = SOURCE_CLASS[task.source]
  const srcLabel = SOURCE_LABEL[task.source]
  const identifier = task.metadata?.identifier
  const assignee = task.metadata?.assignee?.trim()
  const labels = task.metadata?.labels?.filter(Boolean) ?? []

  return (
    <button
      className={`sw-task-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      style={{ width: '100%', textAlign: 'left' }}
    >
      <div className="sw-task-card-top">
        <span className={`sw-source-badge ${srcClass}`}>{srcLabel}</span>
        {task.priority && (
          <span className={`sw-priority-led ${task.priority}`} />
        )}
      </div>

      <div className="sw-task-card-title">{task.title}</div>

      {task.description && (
        <div className="sw-task-card-desc">{task.description}</div>
      )}

      {(identifier || assignee || labels.length > 0) && (
        <div className="sw-task-card-meta">
          {identifier && (
            <span className="sw-task-identifier">{identifier}</span>
          )}
          {assignee && (
            <span className="sw-label-chip">{assignee}</span>
          )}
          {labels.map(label => (
            <span key={`${task.id}-${label}`} className="sw-label-chip">
              {label}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
