import React from 'react'
import { Button } from '../ui/button'
import { SectionHeader } from '../common'
import { ApprovalStatus, TaskSummary } from '../../types'
import { APPROVAL_BADGE_STYLES, ROLE_OPTIONS, approvalLabel, buildHierarchy, formatMixFromTask } from './helpers'

interface ApprovalQueueSectionProps {
  pendingApprovals: TaskSummary[]
  approvalStates: Record<string, ApprovalStatus>
  mixEdits: Record<string, string>
  editingTask: string | null
  roleEdits: Record<string, Record<string, string>>
  onApprove: (taskName: string) => void
  onReject: (taskName: string) => void
  onApplyEdits: (taskName: string) => void
  onCancelEdit: () => void
  onMixEditChange: (taskName: string, value: string) => void
  onRoleEditChange: (taskName: string, roleKey: string, value: string) => void
}

export function ApprovalQueueSection({
  pendingApprovals,
  approvalStates,
  mixEdits,
  editingTask,
  roleEdits,
  onApprove,
  onReject,
  onApplyEdits,
  onCancelEdit,
  onMixEditChange,
  onRoleEditChange,
}: ApprovalQueueSectionProps) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="flex items-center justify-between mb-2">
        <SectionHeader className="mb-0">Approval Queue</SectionHeader>
        <span className="text-[11px] text-[var(--muted-foreground)]">
          Review and approve the distribution plan below
        </span>
      </div>
      {pendingApprovals.length === 0 ? (
        <div className="text-sm text-[var(--muted-foreground)]">All swarms are approved or running.</div>
      ) : (
        <div className="space-y-3">
          {pendingApprovals.map(task => {
            const mixValue = mixEdits[task.task_name] || formatMixFromTask(task)
            const hierarchy = buildHierarchy(task)
            const isEditing = editingTask === task.task_name
            const status = approvalStates[task.task_name] || 'pending'

            return (
              <div key={task.task_name} className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold break-words">{task.task_name}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">Review and approve the distribution plan below</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-1 rounded-full ${APPROVAL_BADGE_STYLES[status]}`}>
                      {approvalLabel(status)}
                    </span>
                    <Button size="sm" onClick={() => onApprove(task.task_name)} variant="secondary">
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onReject(task.task_name)}>
                      Request edits
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--background)] border border-[var(--border)]">
                    Mix of Agents: {mixValue}
                  </span>
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/30">
                    Pending Approval
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  {hierarchy.map(node => (
                    <div
                      key={`${task.task_name}-${node.label}`}
                      className="flex items-start gap-3 px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border)]"
                      title={`${node.role} · ${node.hint}`}
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold">{node.label}</span>
                        <span className="text-[11px] text-[var(--muted-foreground)]">
                          {node.role} · {node.hint}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--foreground)] flex-1">{node.reasoning}</div>
                    </div>
                  ))}
                </div>

                {isEditing && (
                  <div className="mt-3 space-y-2">
                    <label className="text-xs font-medium text-[var(--foreground)]">Adjust mix before approval</label>
                    <input
                      value={mixValue}
                      onChange={(event) => onMixEditChange(task.task_name, event.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      placeholder="70% Claude, 20% Codex, 10% Cursor"
                    />
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-[var(--foreground)]">Reassign roles</div>
                      {hierarchy.map(node => {
                        const roleKey = node.id || node.label
                        const value = roleEdits[task.task_name]?.[roleKey] || node.role
                        return (
                          <div key={`${task.task_name}-role-${roleKey}`} className="flex items-center gap-2">
                            <span className="text-xs w-36 truncate">{node.label}</span>
                            <select
                              value={value}
                              onChange={(event) => onRoleEditChange(task.task_name, roleKey, event.target.value)}
                              className="text-xs rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                            >
                              {ROLE_OPTIONS.map(option => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => onApplyEdits(task.task_name)}>Save mix</Button>
                      <Button size="sm" variant="ghost" onClick={onCancelEdit}>Cancel</Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
