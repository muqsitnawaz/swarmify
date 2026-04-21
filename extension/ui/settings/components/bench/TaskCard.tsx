import React, { useState, useEffect } from 'react'
import type { TaskSource, UnifiedTask, TodoItem } from '../../types'

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

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
  const createdAt = task.metadata?.createdAt

  const [, tick] = useState(0)
  useEffect(() => {
    if (!createdAt) return
    const id = setInterval(() => tick(n => n + 1), 60_000)
    return () => clearInterval(id)
  }, [createdAt])

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

      {(identifier || assignee || labels.length > 0 || createdAt) && (
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
          {createdAt && (
            <span className="sw-task-age">{relativeTime(createdAt)}</span>
          )}
        </div>
      )}
    </button>
  )
}
