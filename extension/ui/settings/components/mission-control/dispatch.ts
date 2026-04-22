import type { TaskSummary, TerminalDetail as TerminalInfo } from '../../types'

export type PendingDispatch = {
  id: string
  agentType: string
  target: 'local' | 'cloud'
  taskId: string
  taskIdentifier: string
  title: string
  createdAt: number
  targetRepo?: string
}

export const PENDING_DISPATCH_TTL_MS = 30000
export const JUST_SPAWNED_WINDOW_MS = 15000

export function isTerminalJustSpawned(createdAt: number | undefined, now: number): boolean {
  if (!createdAt) return false
  const ageMs = now - createdAt
  return ageMs >= 0 && ageMs < JUST_SPAWNED_WINDOW_MS
}

export function isTerminalActive(
  t: Pick<TerminalInfo, 'status' | 'currentActivity' | 'createdAt'>,
  now: number
): boolean {
  if (t.status === 'running') return true
  if (t.currentActivity) return true
  return isTerminalJustSpawned(t.createdAt, now)
}

export function reconcilePending(
  pending: PendingDispatch[],
  terminals: Pick<TerminalInfo, 'agentType' | 'createdAt'>[],
  tasks: TaskSummary[],
  matchSlackMs = 1000
): PendingDispatch[] {
  if (pending.length === 0) return pending
  const consumed = new Set<string>()
  for (const p of pending) {
    if (p.target === 'local') {
      const match = terminals.find((t) =>
        t.agentType === p.agentType && (t.createdAt || 0) >= p.createdAt - matchSlackMs
      )
      if (match) consumed.add(p.id)
    } else {
      const match = tasks.find((task) =>
        task.agents.some((a) =>
          a.agent_type === p.agentType &&
          a.started_at &&
          new Date(a.started_at).getTime() >= p.createdAt - matchSlackMs
        )
      )
      if (match) consumed.add(p.id)
    }
  }
  if (consumed.size === 0) return pending
  return pending.filter((p) => !consumed.has(p.id))
}

export function pruneExpiredPending(
  pending: PendingDispatch[],
  now: number,
  ttlMs = PENDING_DISPATCH_TTL_MS
): PendingDispatch[] {
  return pending.filter((p) => now - p.createdAt < ttlMs)
}

export function filterDispatchedTaskIds<T extends { id: string }>(
  tasks: T[],
  pendingTaskIds: Set<string>
): T[] {
  if (pendingTaskIds.size === 0) return tasks
  return tasks.filter((t) => !pendingTaskIds.has(t.id))
}

export function optimisticActivityLabel(p: PendingDispatch): string {
  const label = p.taskIdentifier || p.title.slice(0, 40)
  const suffix = p.targetRepo ? ` -> ${p.targetRepo}` : ''
  return p.target === 'cloud'
    ? `Queuing on Rush Cloud... (${label}${suffix})`
    : `Starting... (${label})`
}

/**
 * Parse `repo:<name>` labels into fully-qualified `owner/name` repo strings.
 * Returns all matches (a task can be tagged for multiple repos).
 * Returns [] if the owner is unknown or no repo labels exist.
 */
export function resolveReposFromLabels(
  labels: string[] | undefined,
  owner: string | null | undefined,
): string[] {
  if (!labels || labels.length === 0) return []
  if (!owner || !owner.trim()) return []
  const cleanOwner = owner.trim()
  const repos: string[] = []
  const seen = new Set<string>()
  for (const raw of labels) {
    if (typeof raw !== 'string') continue
    const match = raw.trim().match(/^repo:([A-Za-z0-9._-]+)$/)
    if (!match) continue
    const name = match[1]
    const full = `${cleanOwner}/${name}`
    if (seen.has(full)) continue
    seen.add(full)
    repos.push(full)
  }
  return repos
}
