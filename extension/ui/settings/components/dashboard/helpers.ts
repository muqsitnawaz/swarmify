import { AgentDetail, ApprovalStatus, TaskSummary, TerminalDetail } from '../../types'
import { getAgentDisplayName, getTaskSummaryStatus } from '../../utils'

export const SHORTCUTS = [
  ['Cmd+Shift+A', 'New agent'],
  ['Cmd+Shift+B', 'New secondary agent'],
  ['Cmd+Shift+L', 'Label agent'],
  ['Cmd+Shift+G', 'Commit & push'],
  ['Cmd+Shift+C', 'Clear & restart'],
  ['Cmd+R', 'Next agent'],
  ['Cmd+E', 'Previous agent'],
  ["Cmd+Shift+'", 'Prompts'],
]

export const PROMPT_PREVIEW_CHARS = 50

const AGENT_ROLE_HINTS: Record<string, { role: string; hint: string; bestFor: string }> = {
  claude: { role: 'lead', hint: 'Strategy and oversight', bestFor: 'Planning & orchestration' },
  codex: { role: 'fix', hint: 'Fast edits and refactors', bestFor: 'Fast fixes' },
  gemini: { role: 'research', hint: 'Deep research and options', bestFor: 'Research & exploration' },
  cursor: { role: 'trace', hint: 'Debugging and tracing', bestFor: 'Debugging traces' },
  opencode: { role: 'assist', hint: 'Editor-style assistance', bestFor: 'Lightweight edits' },
  shell: { role: 'shell', hint: 'Runs commands', bestFor: 'Command execution' },
}

export const ROLE_OPTIONS = Array.from(new Set(Object.values(AGENT_ROLE_HINTS).map(info => info.role)))

export const APPROVAL_BADGE_STYLES: Record<ApprovalStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-600 border border-amber-500/40',
  approved: 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/40',
  running: 'bg-emerald-500/20 text-emerald-700 border border-emerald-500/40',
  complete: 'bg-[var(--muted-foreground)]/15 text-[var(--muted-foreground)] border border-[var(--border)]',
  rejected: 'bg-red-500/15 text-red-600 border border-red-500/40',
}

export function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars).trim()}...`
}

export function truncateMiddle(value: string, headChars: number, tailChars: number): string {
  if (value.length <= headChars + tailChars + 3) return value
  return `${value.slice(0, headChars)}...${value.slice(-tailChars)}`
}

export function getTerminalPrompt(terminal: TerminalDetail): string {
  const raw = terminal.firstUserMessage || terminal.lastUserMessage || terminal.label || terminal.autoLabel || ''
  return raw.trim() || 'Waiting for first message...'
}

export function getFilesChangedCount(tasksForSession?: TaskSummary[]): number | null {
  if (!tasksForSession || tasksForSession.length === 0) return null
  const uniqueFiles = new Set<string>()
  for (const task of tasksForSession) {
    for (const agent of task.agents) {
      for (const file of agent.files_created || []) uniqueFiles.add(file)
      for (const file of agent.files_modified || []) uniqueFiles.add(file)
      for (const file of agent.files_deleted || []) uniqueFiles.add(file)
    }
  }
  return uniqueFiles.size
}

export function getRoleInfo(agentKey: string) {
  const key = agentKey?.toLowerCase() || ''
  return AGENT_ROLE_HINTS[key] || { role: 'agent', hint: 'Generalist support', bestFor: 'Balanced work' }
}

export function deriveApprovalStatusFromTask(task: TaskSummary): ApprovalStatus {
  if (task.approval_status) return task.approval_status
  const statusLabel = getTaskSummaryStatus(task)
  if (statusLabel === 'running') return 'running'
  if (statusLabel === 'done') return 'complete'
  return 'pending'
}

export function formatMixFromTask(task: TaskSummary): string {
  if (task.mix) return task.mix
  const counts: Record<string, number> = {}
  for (const agent of task.agents || []) {
    const key = (agent.agent_type || 'agent').toLowerCase()
    counts[key] = (counts[key] || 0) + 1
  }
  const total = Math.max(task.agent_count || 0, Object.values(counts).reduce((sum, val) => sum + val, 0))
  if (!total) return 'Mix not set'
  const parts = Object.entries(counts).map(([key, count]) => `${Math.round((count / total) * 100)}% ${getAgentDisplayName(key)}`)
  return parts.length ? parts.join(', ') : 'Mix not set'
}

function formatPlanReason(agent: AgentDetail): string {
  if (agent.prompt) return truncateText(agent.prompt, 120)
  if (agent.last_messages && agent.last_messages.length > 0) {
    return truncateText(agent.last_messages[agent.last_messages.length - 1], 120)
  }
  const info = getRoleInfo(agent.agent_type || 'agent')
  return `${getAgentDisplayName(agent.agent_type || 'agent')} selected for ${info.bestFor.toLowerCase()}.`
}

export type HierarchyNode = {
  id: string
  label: string
  role: string
  hint: string
  isParent: boolean
  reasoning: string
}

export function buildHierarchy(task: TaskSummary): HierarchyNode[] {
  const agents = task.agents || []
  if (!agents.length) return []
  const parent = agents.find(agent => (agent.agent_type || '').toLowerCase() === 'claude') || agents[0]
  const rest = agents.filter(agent => agent !== parent)

  const toNode = (agent: AgentDetail, isParent: boolean): HierarchyNode => {
    const info = getRoleInfo(agent.agent_type || 'agent')
    const name = getAgentDisplayName((agent.agent_type || '').toLowerCase() || 'agents')
    const suffix = agent.agent_id ? ` (${agent.agent_id})` : ''
    return {
      id: agent.agent_id,
      label: `${name}${suffix}`,
      role: info.role,
      hint: info.bestFor,
      isParent,
      reasoning: formatPlanReason(agent),
    }
  }

  return [toNode(parent, true), ...rest.map(agent => toNode(agent, false))]
}

export function approvalLabel(status: ApprovalStatus): string {
  switch (status) {
    case 'approved':
      return 'Approved'
    case 'running':
      return 'Running'
    case 'complete':
      return 'Complete'
    case 'rejected':
      return 'Changes requested'
    default:
      return 'Pending Approval'
  }
}
