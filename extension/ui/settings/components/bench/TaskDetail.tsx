import React from 'react'
import { Icon } from '../mission-control/icons'
import { TaskCalendar } from './TaskCalendar'
import type { FlatTask } from './TaskCard'
import type { CycleInfo } from '../../types'
import { renderTodoDescription } from '../../utils/markdown'

const SOURCE_CLASS: Record<string, string> = {
  linear: 'ln',
  github: 'gh',
}

const SOURCE_LABEL: Record<string, string> = {
  linear: 'LN',
  github: 'GH',
}

const STATUS_DISPLAY: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
}

interface TaskDetailProps {
  task: FlatTask
  cycleInfo?: CycleInfo | null
  onDispatch: (task: FlatTask) => void
  onDismiss: (taskId: string) => void
  onOpenExternal: (url: string) => void
}

export function TaskDetail({ task, cycleInfo, onDispatch, onDismiss, onOpenExternal }: TaskDetailProps) {
  const srcClass = SOURCE_CLASS[task.source]
  const srcLabel = SOURCE_LABEL[task.source]
  const identifier = task.metadata?.identifier
  const assignee = task.metadata?.assignee?.trim()
  const labels = task.metadata?.labels?.filter(Boolean) ?? []
  const url = task.metadata?.url
  const state = task.metadata?.state

  return (
    <>
      <div className="sw-bench-detail-head">
        <span className={`sw-source-badge ${srcClass}`}>{srcLabel}</span>
        <span className="detail-title">{task.title}</span>
        {task.priority && (
          <span className={`sw-priority-led ${task.priority}`} />
        )}
        {url && (
          <button
            className="sw-icon-btn"
            onClick={() => onOpenExternal(url)}
            title="Open externally"
          >
            <Icon name="external" size={14} />
          </button>
        )}
      </div>

      <div className="sw-bench-detail-body">
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div className="sw-detail-meta" style={{ flex: '0 0 auto', minWidth: 180 }}>
            <div className="sw-detail-meta-row">
              <span className="sw-detail-meta-label">Status</span>
              <span className="sw-detail-meta-value">
                <span className={`sw-status-led ${task.status}`}>
                  {STATUS_DISPLAY[task.status] || task.status}
                </span>
              </span>
            </div>

            {identifier && (
              <div className="sw-detail-meta-row">
                <span className="sw-detail-meta-label">ID</span>
                <span className="sw-detail-meta-value" style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}>
                  {identifier}
                </span>
              </div>
            )}

            {labels.length > 0 && (
              <div className="sw-detail-meta-row">
                <span className="sw-detail-meta-label">Labels</span>
                <span className="sw-detail-meta-value" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {labels.map(label => (
                    <span key={label} className="sw-label-chip">{label}</span>
                  ))}
                </span>
              </div>
            )}

            {state && state !== task.status && (
              <div className="sw-detail-meta-row">
                <span className="sw-detail-meta-label">State</span>
                <span className="sw-detail-meta-value" style={{ fontFamily: '"Geist Mono", monospace', fontSize: 11 }}>
                  {state}
                </span>
              </div>
            )}

            {assignee && (
              <div className="sw-detail-meta-row">
                <span className="sw-detail-meta-label">Assignee</span>
                <span className="sw-detail-meta-value">{assignee}</span>
              </div>
            )}
          </div>

          {task.metadata?.createdAt && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <TaskCalendar
                createdAt={task.metadata.createdAt}
                cycleInfo={task.source === 'linear' ? cycleInfo : null}
              />
            </div>
          )}
        </div>

        {task.description && (
          <>
            <div className="sw-panel-section-head">Description</div>
            <div className="sw-detail-desc">{renderTodoDescription(task.description, false)}</div>
          </>
        )}
      </div>

      <div className="sw-bench-detail-actions">
        <button
          className="sw-btn primary"
          onClick={() => onDispatch(task)}
        >
          <Icon name="dispatch" size={12} />
          Dispatch
        </button>
        <button
          className="sw-btn ghost"
          onClick={() => onDismiss(task.id)}
        >
          Dismiss
        </button>
        {url && (
          <>
            <span className="sw-spacer" />
            <button
              className="sw-btn secondary"
              onClick={() => onOpenExternal(url)}
            >
              <Icon name="external" size={12} />
              {task.source === 'linear' ? 'Open in Linear' : task.source === 'github' ? 'Open in GitHub' : 'Open'}
            </button>
          </>
        )}
      </div>
    </>
  )
}
