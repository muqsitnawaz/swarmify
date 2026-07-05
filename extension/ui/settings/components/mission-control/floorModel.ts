// Factory Floor — shared webview view-model + pure logic contract.
//
// Lives in ui/ (NOT src/core) because the webview bundle is isolated from the
// extension host: no ui/ file may import from src/*. Data crosses the boundary
// via postMessage; types are mirrored on each side.
//
// This file is the SEAM between the webview workstreams. Types below are authored
// up front so COMPONENTS and SHELL build against a stable contract; LOGIC fills
// the function bodies and adds floorModel.test.ts. No two agents edit this file
// except LOGIC (owner after this scaffold).
//
// Design source of truth: ~/Downloads/factory-floor-prototype/factory-floor.html
// (+ DESIGN.md). Field names mirror the prototype's AGENTS / TICKETS mock objects
// so the port is a 1:1 translation, not a redesign.

import type { UnifiedTask, RecentToolCall, ProjectRule } from '../../types'

export type { RecentToolCall }

// ---------- project resolution ----------
//
// Mirror of src/core/remoteSessions.ts resolveProject (hand-kept; the src/ and ui/
// builds cannot share imports, so the logic lives on both sides of the postMessage
// boundary). Keep the two in lockstep.

/** Glob -> RegExp. `**` spans path separators, `*` does not, `?` a single char.
 *  A trailing subpath always matches so a rule for a dir captures work inside it. */
function projectGlobToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp('^' + re + '(?:/.*)?$')
}

/** A rule pattern with no glob metacharacters is a path prefix; else a glob. */
function matchesProjectRule(cwd: string, pattern: string): boolean {
  const p = pattern.trim().replace(/\/+$/, '')
  if (!p) return false
  if (!/[*?]/.test(p)) return cwd === p || cwd.startsWith(p + '/')
  return projectGlobToRegExp(p).test(cwd)
}

function pathBasename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

/**
 * Resolve a session cwd to a display project. Order:
 *   1. user rules (first match wins) — glob or path-prefix against the cwd.
 *   2. worktree fold: `.../<repo>/.agents/worktrees/<slug>` -> `<repo>`.
 *   3. git repo root basename when `repoRoot` is supplied — so a monorepo subdir
 *      folds to the repo, not the leaf dir.
 *   4. ultimate fallback: the cwd's last path segment (legacy behavior).
 */
export function resolveProject(
  cwd: string,
  rules: ProjectRule[] = [],
  repoRoot?: string | null,
): string {
  if (!cwd) return ''
  const norm = cwd.replace(/\/+$/, '')
  for (const rule of rules) {
    if (rule && matchesProjectRule(norm, rule.pattern)) return rule.project
  }
  const wt = norm.match(/\/([^/]+)\/\.agents\/worktrees\//)
  if (wt) return wt[1]
  if (repoRoot) {
    const base = pathBasename(repoRoot)
    if (base) return base
  }
  const parts = norm.split('/').filter(Boolean)
  return parts[parts.length - 1] || norm
}

// ---------- agent view-model ----------

/**
 * Single field everything keys off. Precedence when deriving from raw signals:
 *   waiting > failed > running > done(unreviewed) > done(settled) > idle
 * (waiting outranks failed: a waiting agent is reversible by the user right now.)
 * Prototype: factory-floor.html:330,363-364.
 *
 * 'stalled' is a running agent that has gone quiet past STALL_THRESHOLD_MS — the
 * process may be wedged, so it surfaces in Needs-You. Derived live from a heartbeat
 * (deriveStalled), not reported by the CLI.
 */
export type FloorPhase = 'running' | 'idle' | 'waiting' | 'failed' | 'done' | 'stalled'

/** Terminal-tab prefix per agent CLI (ui utils is the reference map). */
export type AgentAbbr = 'CC' | 'CX' | 'GX' | 'CR' | 'AG' | 'GK' | 'OC' | 'SH'

export type StructuredQuestionKind = 'choice' | 'confirm' | 'destructive' | 'retry'

/**
 * Parsed from an agent's last response. Drives the structured-reply buttons
 * (option chips vs Confirm/Cancel vs Retry) instead of a bare free-text box.
 * Prototype: QCLUSTERS + structuredReply(), factory-floor.html:369-379,591-597.
 */
export interface StructuredQuestion {
  kind: StructuredQuestionKind
  /** The question text shown above the option buttons. */
  text: string
  /** Multiple-choice options; first is the recommended/primary. Empty for retry. */
  options: string[]
  /** Stable key so identical questions across agents cluster for batch triage. */
  clusterKey: string
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** One item of an agent's task checklist, parsed from its latest TodoWrite call. */
export interface TodoItem {
  content: string
  status: TodoStatus
}

/**
 * The at-a-glance unit rendered in every Floor surface. Built by SHELL's adapter
 * from the real UnifiedAgent (+ cross-host session data). Mirrors prototype
 * AGENTS: factory-floor.html:336-347.
 */
export interface FloorAgent {
  id: string
  host: string          // 'this-mac' for local; remote hostname otherwise
  project: string       // repo or cwd basename (worktrees folded to their repo)
  name: string          // displayName / branch-derived label
  abbr: AgentAbbr       // agentType -> CC/CX/GX/...
  phase: FloorPhase
  verb: string          // current activity verb, e.g. "Editing"
  target: string        // activity object, e.g. "src/core/tasks.ts"
  tok: number           // output tok/s; 0 when not streaming
  since: string          // human elapsed, e.g. "2s", "14m", "3h"
  lastActivityMs: number // epoch ms of last observed activity; drives the live heartbeat. 0 when unknown.
  files: number
  tools: number
  needs: boolean         // waiting || failed || (done && unreviewed)
  pinned: boolean        // user-pinned (persisted in globalState)
  pr: string | null      // "#142" when a PR is open
  ticket: string | null  // "RUSH-812" when linked
  branch: string
  resp: string           // last response text (Anthropic Agent-view style)
  question: StructuredQuestion | null
  todos: TodoItem[]      // task checklist from the latest TodoWrite; empty when none
  summary: string        // the "what is it doing" line (CLI-provided); '' when unknown
  recent: RecentToolCall[] // rolling window of this session's recent tool calls; [] when none
}

// ---------- ticket view-model (Backlog) ----------

export type TicketSource = 'LN' | 'GH'
export type TicketPriority = 'urgent' | 'high' | 'med' | 'low'
export type TicketStatus = 'todo' | 'in-progress' | 'blocked' | 'done'

/** Mirrors prototype TICKETS (factory-floor.html:382-395); built from UnifiedTask. */
export interface FloorTicket {
  id: string           // metadata.identifier ("RUSH-812" / "#412") || id
  title: string
  project: string
  source: TicketSource
  pri: TicketPriority
  status: TicketStatus
  desc: string
  labels: string[]
}

// ---------- controls state ----------

export type CenterMode = 'agents' | 'backlog' | 'host'

// Host detail pane payloads. Mirror of extension/src/core/hostInventory.ts —
// the webview can't import from src/*, so the shape is redeclared here and
// crosses the boundary as JSON via the `hostInventory` message.
export interface HostResourceSummary {
  skills: number
  plugins: number
  mcp: number
  commands: number
  workflows: number
  memory: number
  hooks: number
  drift: number
}
export interface HostAgentVersion {
  version: string
  isDefault: boolean
  signedIn: boolean
  email: string | null
  plan: string | null
  sessionPercent: number | null
  weekPercent: number | null
  lastActive: string | null
  resources: HostResourceSummary | null
}
export interface HostAgentInfo {
  agent: string
  versions: HostAgentVersion[]
}
export interface HostMeta {
  name: string
  enrolled: boolean
  source: string | null
  target: string | null
  user: string | null
  os: string | null
  caps: string[]
  addedAt: string | null
  status: string | null
}
export interface HostInventory {
  host: string
  reachable: boolean
  error: string | null
  meta: HostMeta | null
  agents: HostAgentInfo[]
  fetchedAt: number
}
export type FloorGroupBy = 'host' | 'project' | 'status' | 'agent'
export type FloorSort = 'needs' | 'recent' | 'tok' | 'name'
export type TicketGroupBy = 'project' | 'priority' | 'source' | 'status'
export type TicketSort = 'priority' | 'id'

// ---------- stable rank constants (data — final, not stubs) ----------

/** Needs-you first ordering. Prototype: factory-floor.html:364.
 *  'stalled' sits just below failed: a wedged agent needs you, but a hard failure or an
 *  explicit question outranks it. */
export const PHASE_RANK: Record<FloorPhase, number> = {
  waiting: 0,
  failed: 1,
  stalled: 2,
  running: 3,
  done: 4,
  idle: 5,
}

/** A running agent silent this long is treated as stalled (amber). 2x -> dead (red). */
export const STALL_THRESHOLD_MS = 90_000

/** Prototype: factory-floor.html:396. */
export const PRI_RANK: Record<TicketPriority, number> = {
  urgent: 0,
  high: 1,
  med: 2,
  low: 3,
}

// ---------- canonical session identity ----------

/**
 * Where a session was observed. 'this-mac' sightings (a local tab OR the local sweep)
 * are 'local'; only a genuinely different host is 'remote'. Cloud tasks are 'cloud'.
 */
export type SessionOrigin = 'local' | 'remote' | 'cloud'

/**
 * Raw identity signals for one observed session. Shaped to fit what the adapter has:
 * local terminals carry a lazily-populated CLI UUID + a terminal id; the remote sweep
 * carries a host + a session id (UUID or file stem); cloud carries an opaque task id.
 */
export interface SessionKeyInput {
  origin: SessionOrigin
  host?: string | null
  /** The CLI session UUID — collision-free within an agent type, but populated lazily. */
  cliSessionUuid?: string | null
  /** Remote fallback: the session file's stem, used when the UUID is not yet known. */
  sessionFileStem?: string | null
  /** Provisional (pre-UUID) identity sources, in precedence order. */
  terminalId?: string | null
  cloudTaskId?: string | null
  agentId?: string | null
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

/**
 * One canonical identity per session, stable across the origins that report it. Mirrors
 * 02-floor-event-stream.md Decision 1:
 *   remote -> `${host}:${cliSessionUuid ?? sessionFileStem}`
 *   else   -> cliSessionUuid ?? `provisional:${terminalId | cloudTaskId | agentId}`
 * Prefer the CLI UUID (so a session seen as both a local tab and the local sweep collapses
 * to one key); namespace remote by host so the same UUID on two hosts does not collide;
 * fall back to a provisional key while the UUID is unknown and re-key once it arrives.
 */
export function sessionKey(input: SessionKeyInput): string {
  const uuid = firstNonEmpty(input.cliSessionUuid)
  const provisionalId = firstNonEmpty(input.terminalId, input.cloudTaskId, input.agentId) ?? 'unknown'
  if (input.origin === 'remote') {
    const host = firstNonEmpty(input.host) ?? 'unknown-host'
    const id = uuid ?? firstNonEmpty(input.sessionFileStem) ?? provisionalId
    return `${host}:${id}`
  }
  if (uuid) return uuid
  return `provisional:${provisionalId}`
}

// ---------- pure logic (LOGIC fills bodies; signatures are the contract) ----------

/** Raw signals -> FloorPhase, applying the precedence documented on FloorPhase. */
export function derivePhase(input: {
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'idle'
  waitingForInput: boolean
  active: boolean
  prOpenUnreviewed: boolean
}): FloorPhase {
  // Precedence: waiting > failed > running > done > idle.
  if (input.waitingForInput) return 'waiting'
  if (input.status === 'failed') return 'failed'
  // A stale 'running' whose process is no longer alive is really idle.
  if (input.status === 'running') return input.active ? 'running' : 'idle'
  if (input.status === 'completed') return 'done'
  // 'stopped' and 'idle' both settle to idle.
  return 'idle'
}

/** waiting || failed || stalled || (done && unreviewed). */
export function deriveNeeds(phase: FloorPhase, prOpenUnreviewed: boolean): boolean {
  return (
    phase === 'waiting' ||
    phase === 'failed' ||
    phase === 'stalled' ||
    (phase === 'done' && prOpenUnreviewed)
  )
}

/**
 * Is a running agent stalled? True when it has been silent past STALL_THRESHOLD_MS.
 * Only a running (or already-stalled) agent can stall — a waiting/failed/done/idle
 * agent is already categorized, and an idle agent is quiet on purpose. lastActivityMs
 * of 0 (unknown) never stalls, so a missing heartbeat can't raise a false alarm.
 * Pure so both the adapter (promote phase at poll time) and the live card agree.
 */
export function deriveStalled(lastActivityMs: number, phase: FloorPhase, now: number): boolean {
  if (phase !== 'running' && phase !== 'stalled') return false
  if (!Number.isFinite(lastActivityMs) || lastActivityMs <= 0) return false
  return now - lastActivityMs >= STALL_THRESHOLD_MS
}

/** Heartbeat severity from a silence age: live < threshold <= stale (amber) < 2x <= dead (red). */
export type HeartbeatLevel = 'live' | 'stale' | 'dead'
export function heartbeatLevel(ageMs: number): HeartbeatLevel {
  if (!Number.isFinite(ageMs) || ageMs < STALL_THRESHOLD_MS) return 'live'
  if (ageMs >= 2 * STALL_THRESHOLD_MS) return 'dead'
  return 'stale'
}

/** Minimal shape of a parsed tool call the checklist reads (name + raw input). */
export interface ToolCallLike {
  name: string
  input?: unknown
}

/**
 * The agent's current task checklist: the todos of its MOST RECENT TodoWrite call.
 * A later TodoWrite fully supersedes earlier ones (the agent rewrites the whole
 * list each time), so we take the newest, not a merge. `recentToolCalls` is stored
 * NEWEST-FIRST (session.summary.ts unshifts each call), so we scan from index 0 and
 * return the FIRST TodoWrite. Returns [] when there is no TodoWrite or the input is
 * malformed. (Caveat: recentToolCalls is capped at 24, so a checklist drops off once
 * >24 tool calls follow the last TodoWrite.) Pure so it's unit-tested.
 */
export function latestTodos(toolCalls: ReadonlyArray<ToolCallLike> | undefined): TodoItem[] {
  if (!toolCalls || toolCalls.length === 0) return []
  for (let i = 0; i < toolCalls.length; i++) {
    if (toolCalls[i]?.name !== 'TodoWrite') continue
    const input = toolCalls[i]?.input
    const raw = input && typeof input === 'object' ? (input as Record<string, unknown>).todos : undefined
    if (!Array.isArray(raw)) return []
    const todos: TodoItem[] = []
    for (const t of raw) {
      if (!t || typeof t !== 'object') continue
      const rec = t as Record<string, unknown>
      const content =
        typeof rec.content === 'string' ? rec.content :
        typeof rec.activeForm === 'string' ? rec.activeForm : ''
      if (!content) continue
      const status: TodoStatus =
        rec.status === 'completed' || rec.status === 'in_progress' ? rec.status : 'pending'
      todos.push({ content, status })
    }
    return todos
  }
  return []
}

/** completed / total tally for a checklist (total 0 when empty). */
export function todoProgress(todos: ReadonlyArray<TodoItem>): { done: number; total: number } {
  return { done: todos.filter((t) => t.status === 'completed').length, total: todos.length }
}

/**
 * Detect a structured question in an agent's last response. Returns null when the
 * text is not a question. Shapes: choice ("A or B?" / "X vs Y"), confirm
 * ("merge it?"), destructive (DROP/DELETE/prod keywords), retry (phase==='failed').
 * clusterKey groups identical questions across agents for batch triage.
 */
export function parseStructuredQuestion(resp: string, phase: FloorPhase): StructuredQuestion | null {
  const text = resp.trim()
  // A failed agent always needs a retry decision, question mark or not.
  if (phase === 'failed') {
    return { kind: 'retry', text, options: [], clusterKey: 'retry' }
  }
  // Everything else must actually be a question.
  if (!text.includes('?')) return null
  // Destructive keywords take safety precedence over choice/confirm shaping.
  if (/\b(DROP|DELETE|destructive|prod(uction)?|overwrite|force)\b/.test(text)) {
    return { kind: 'destructive', text, options: ['Confirm', 'Cancel'], clusterKey: slugifyQuestion(text) }
  }
  // Explicit alternatives -> a multiple-choice reply.
  const options = extractChoiceOptions(text)
  if (options.length >= 2) {
    return { kind: 'choice', text, options, clusterKey: slugifyQuestion(text) }
  }
  // Any other question is a yes/no confirmation.
  return { kind: 'confirm', text, options: ['Confirm', 'Hold'], clusterKey: slugifyQuestion(text) }
}

/** Normalized slug of the question intent so identical questions across agents collide. */
function slugifyQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]+/g, ' ') // strip punctuation and numbers
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join('-')
}

/** Pull the choice labels out of "A) .. B) ..", "1. .. 2. ..", "X vs Y", or "X or Y". */
function extractChoiceOptions(text: string): string[] {
  const numbered = [...text.matchAll(/\d+[.)]\s*([^?\d][^?]*?)(?=\s*\d+[.)]|\?|$)/g)].map((m) => m[1])
  if (numbered.length >= 2) return numbered.map(cleanOption).filter(Boolean)

  const lettered = [...text.matchAll(/[A-Za-z][)]\s*([^?]*?)(?=\s*[A-Za-z][)]|\?|$)/g)].map((m) => m[1])
  if (lettered.length >= 2) return lettered.map(cleanOption).filter(Boolean)

  const core = questionCore(text)
  if (/\bvs\.?\b|\bversus\b/i.test(core)) {
    const parts = core.split(/\s+vs\.?\s+|\s+versus\s+/i)
    if (parts.length >= 2) return parts.map(cleanOption).filter(Boolean)
  }
  if (/\bor\b/i.test(core)) {
    const parts = stripLeadIn(core).split(/,?\s+or\s+/i)
    if (parts.length >= 2) return parts.map(cleanOption).filter(Boolean)
  }
  return []
}

/** Everything up to the first question mark, trimmed. */
function questionCore(text: string): string {
  const q = text.indexOf('?')
  return (q === -1 ? text : text.slice(0, q)).trim()
}

/** Drop a leading "context:" preamble so the choice clause stands alone. */
function stripLeadIn(text: string): string {
  const i = text.lastIndexOf(':')
  return (i === -1 ? text : text.slice(i + 1)).trim()
}

/** Tidy a raw option fragment into a button label. */
function cleanOption(raw: string): string {
  const s = raw
    .replace(/^[\s,.;:]+/, '')
    .replace(/[\s,.;:?]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/^(a|an|the)\s+/i, '')
    .trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** Group agents by the chosen dimension. Prototype groupKey: factory-floor.html:412. */
export function groupAgents(agents: FloorAgent[], by: FloorGroupBy): Map<string, FloorAgent[]> {
  const accessor: Record<FloorGroupBy, (a: FloorAgent) => string> = {
    host: (a) => a.host,
    project: (a) => a.project,
    status: (a) => a.phase,
    agent: (a) => a.abbr,
  }
  const get = accessor[by]
  const groups = new Map<string, FloorAgent[]>()
  for (const a of agents) {
    const key = get(a)
    const bucket = groups.get(key)
    if (bucket) bucket.push(a)
    else groups.set(key, [a])
  }
  return groups
}

/** Sort within a group. 'needs' uses PHASE_RANK. Prototype: agentsCenter():624-630. */
export function sortAgents(agents: FloorAgent[], by: FloorSort): FloorAgent[] {
  const arr = [...agents]
  switch (by) {
    case 'needs':
      return arr.sort((a, b) => PHASE_RANK[a.phase] - PHASE_RANK[b.phase])
    case 'recent':
      return arr.sort((a, b) => sinceSeconds(a.since) - sinceSeconds(b.since))
    case 'tok':
      return arr.sort((a, b) => b.tok - a.tok)
    case 'name':
      return arr.sort((a, b) => a.name.localeCompare(b.name))
  }
}

/** Parse a human elapsed label ("2s", "14m", "3h", "1d") to seconds for recency sort. */
function sinceSeconds(since: string): number {
  const m = /^(\d+)\s*([smhd])/.exec(since.trim())
  if (!m) return Number.MAX_SAFE_INTEGER
  const unit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return Number(m[1]) * unit[m[2]]
}

/**
 * Cluster waiting agents by StructuredQuestion.clusterKey so N agents asking the
 * same thing collapse into one batch-triage card. Prototype: byQ in agentsCenter()
 * (factory-floor.html:629) + clusterCard() (598-607). Singletons return as [agent].
 */
export function clusterByQuestion(waiting: FloorAgent[]): FloorAgent[][] {
  const byKey = new Map<string, FloorAgent[]>()
  for (const a of waiting) {
    // Agents without a parsed question can never batch with another; key by id.
    const key = a.question ? a.question.clusterKey : a.id
    const bucket = byKey.get(key)
    if (bucket) bucket.push(a)
    else byKey.set(key, [a])
  }
  return [...byKey.values()]
}

/** UnifiedTask -> FloorTicket. status: todo|in_progress|done -> todo|in-progress|done;
 *  priority: 'medium' -> 'med'; source: 'linear'->'LN','github'->'GH'. */
export function toFloorTicket(task: UnifiedTask): FloorTicket {
  return {
    id: task.metadata.identifier ?? task.id,
    title: task.title,
    // UnifiedTask.metadata has no `project`; repo is the closest scope we have.
    project: task.metadata.repo ?? '',
    source: task.source === 'linear' ? 'LN' : 'GH',
    pri: toTicketPriority(task.priority),
    status: toTicketStatus(task.status),
    desc: task.description ?? '',
    labels: task.metadata.labels ?? [],
  }
}

function toTicketPriority(p: UnifiedTask['priority']): TicketPriority {
  switch (p) {
    case 'urgent':
      return 'urgent'
    case 'high':
      return 'high'
    case 'medium':
      return 'med'
    case 'low':
      return 'low'
    default:
      return 'med'
  }
}

function toTicketStatus(s: UnifiedTask['status']): TicketStatus {
  switch (s) {
    case 'in_progress':
      return 'in-progress'
    case 'done':
      return 'done'
    default:
      return 'todo'
  }
}

export function groupTickets(tickets: FloorTicket[], by: TicketGroupBy): Map<string, FloorTicket[]> {
  const accessor: Record<TicketGroupBy, (t: FloorTicket) => string> = {
    project: (t) => t.project,
    priority: (t) => t.pri,
    source: (t) => (t.source === 'LN' ? 'Linear' : 'GitHub'),
    status: (t) => t.status.replace('-', ' '),
  }
  const get = accessor[by]
  const groups = new Map<string, FloorTicket[]>()
  for (const t of tickets) {
    const key = get(t)
    const bucket = groups.get(key)
    if (bucket) bucket.push(t)
    else groups.set(key, [t])
  }
  return groups
}

export function sortTickets(tickets: FloorTicket[], by: TicketSort): FloorTicket[] {
  const arr = [...tickets]
  if (by === 'priority') return arr.sort((a, b) => PRI_RANK[a.pri] - PRI_RANK[b.pri])
  return arr.sort((a, b) => a.id.localeCompare(b.id))
}
