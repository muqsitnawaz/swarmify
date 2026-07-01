// SHELL adapter: real UnifiedAgent / RemoteSession / UnifiedTask -> Floor view-model.
//
// The view-model TYPES are owned by floorModel.ts (the shared webview contract) and
// the pure derivations (derivePhase / deriveNeeds / parseStructuredQuestion /
// toFloorTicket) live there too — this file only translates the real data shapes into
// the inputs those functions expect. No logic is reimplemented here.
//
// UnifiedAgent is declared locally in UnifiedAgentsPane.tsx and not exported; we accept
// a structural subset (UnifiedAgentLike) so TypeScript's structural typing lets the real
// object flow in without a circular import. RemoteSession lives in src/core (the
// extension-host build root) and cannot be imported from ui/ — its payload is mirrored
// here as RemoteSessionLike, matching the fields settings.vscode.ts sends over postMessage.

import {
  derivePhase,
  deriveNeeds,
  parseStructuredQuestion,
  toFloorTicket,
  type FloorAgent,
  type FloorTicket,
  type AgentAbbr,
} from './floorModel'
import type { UnifiedTask } from '../../types'

// ---------- structural inputs ----------

/** Structural subset of UnifiedAgentsPane's local UnifiedAgent that the adapter reads. */
export interface UnifiedAgentLike {
  id: string
  agentType: string
  displayName: string
  activity: string
  active: boolean
  timestamp: string
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'idle'
  files: string[]
  toolCalls: number
  prUrl?: string | null
  linearIssue?: string | null
  terminal?: {
    id?: string
    cwd?: string | null
    branch?: string | null
    waitingForInput?: boolean
    lastUserMessage?: string
    currentActivity?: string
  } | null
  agent?: {
    cwd?: string | null
    branch?: string | null
    repo_name?: string | null
    status?: string
    last_messages?: string[]
  } | null
}

/** Mirror of src/core/remoteSessions.ts RemoteSession, as it crosses postMessage. */
export interface RemoteSessionLike {
  host: string
  sessionId: string
  agentType: string
  cwd: string
  project: string
  phase: 'running' | 'idle' | 'waiting' | 'failed' | 'done'
  activity: string
  tokPerSec: number
  waitingForInput: boolean
  lastResponse: string
  prUrl: string | null
  ticket: string | null
  branch: string
  sinceMs: number
  startedAtMs: number
  topic: string
}

// ---------- primitive helpers ----------

const ABBR_BY_TYPE: Record<string, AgentAbbr> = {
  claude: 'CC',
  codex: 'CX',
  gemini: 'GX',
  cursor: 'CR',
  opencode: 'OC',
  amp: 'AG',
  agents: 'AG',
  grok: 'GK',
  kimi: 'GK',
}

/** agentType string -> terminal-tab prefix. Unknown types fall back to Shell. */
export function abbrFor(agentType: string): AgentAbbr {
  return ABBR_BY_TYPE[(agentType || '').toLowerCase()] ?? 'SH'
}

/**
 * Split a one-line activity string into the bold verb + trailing target the feed
 * renders (prototype actHtml: "▸ <b>${verb}</b> ${target}"). "$ cmd" reads as
 * Running cmd; otherwise the first word is the verb and the remainder the target.
 */
export function splitActivity(activity: string): { verb: string; target: string } {
  const t = (activity || '').trim()
  if (!t) return { verb: '', target: '' }
  if (t.startsWith('$')) return { verb: 'Running', target: t.replace(/^\$\s*/, '') }
  const sp = t.indexOf(' ')
  if (sp === -1) return { verb: t, target: '' }
  return { verb: t.slice(0, sp), target: t.slice(sp + 1) }
}

/**
 * Project scope for an agent. A repo name (from the CLI) wins; otherwise derive from
 * cwd, folding a worktree path ".../<repo>/.agents/worktrees/<slug>" back to <repo>
 * so parallel worktrees group under their repo. Empty cwd falls back to the label.
 */
export function deriveProject(cwd: string | null | undefined, repoName: string | null | undefined, fallback: string): string {
  if (repoName) return repoName
  if (cwd) {
    const wt = cwd.match(/([^/]+)\/\.agents\/worktrees\//)
    if (wt) return wt[1]
    const base = cwd.split('/').filter(Boolean).pop()
    if (base) return base
  }
  return fallback
}

/** Human elapsed label ("2s" / "14m" / "3h" / "1d") from an epoch-ms delta. */
export function sinceFromMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) return ''
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** Human elapsed label from an ISO timestamp, measured against now. */
export function sinceFromIso(iso: string, nowMs: number): string {
  const started = new Date(iso).getTime()
  if (!isFinite(started)) return ''
  return sinceFromMs(nowMs - started)
}

/** "#142" from a GitHub PR url, or null when it isn't a recognizable PR link. */
export function floorPrLabel(url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(/\/pull\/(\d+)/)
  if (m) return `#${m[1]}`
  const n = url.match(/#(\d+)\s*$/)
  return n ? `#${n[1]}` : null
}

// ---------- adapters ----------

/**
 * Map a local UnifiedAgent to a FloorAgent. waiting comes from the terminal's
 * waitingForInput flag or a headless agent's input_required status; an open PR marks a
 * done agent unreviewed (needs-you). Phase + needs are derived by floorModel, not here.
 */
export function toFloorAgentFromUnified(
  u: UnifiedAgentLike,
  opts: { pinned: Set<string>; workspaceRepo?: string | null; nowMs: number },
): FloorAgent {
  const waitingForInput = u.terminal?.waitingForInput === true || u.agent?.status === 'input_required'
  const prOpenUnreviewed = !!u.prUrl
  const phase = derivePhase({
    status: u.status,
    waitingForInput,
    active: u.active,
    prOpenUnreviewed,
  })
  const needs = deriveNeeds(phase, prOpenUnreviewed)
  const lastMsgs = u.agent?.last_messages
  const resp = (lastMsgs && lastMsgs.length ? lastMsgs[lastMsgs.length - 1] : '') || u.activity || ''
  const { verb, target } = splitActivity(u.activity)
  const project = deriveProject(u.terminal?.cwd ?? u.agent?.cwd, u.agent?.repo_name, opts.workspaceRepo || '—')

  return {
    id: u.id,
    host: 'this-mac',
    project,
    name: u.displayName,
    abbr: abbrFor(u.agentType),
    phase,
    verb,
    target,
    tok: 0, // per-agent local tok/s isn't measured; the top bar shows the aggregate poll.
    since: sinceFromIso(u.timestamp, opts.nowMs),
    files: u.files.length,
    tools: u.toolCalls,
    needs,
    pinned: opts.pinned.has(u.id),
    pr: floorPrLabel(u.prUrl),
    ticket: u.linearIssue ?? null,
    branch: u.terminal?.branch ?? u.agent?.branch ?? '',
    resp,
    question: parseStructuredQuestion(resp, phase),
  }
}

/**
 * Map a cross-host RemoteSession to a FloorAgent. The backend already normalized the
 * phase + activity + throughput, so we trust those and only re-derive needs + the
 * structured question (both pure). Host stays the remote machine name.
 */
export function toFloorAgentFromRemote(r: RemoteSessionLike, pinned: Set<string>): FloorAgent {
  const phase = r.phase
  const prOpenUnreviewed = !!r.prUrl
  const needs = deriveNeeds(phase, prOpenUnreviewed)
  const { verb, target } = splitActivity(r.activity)
  const id = `remote-${r.host}-${r.sessionId}`
  const name = r.branch || r.ticket || r.sessionId.slice(0, 8)
  // Remote (Tier-1) sessions have no enriched last-response yet — fall back to the
  // session's task line (topic) so the card shows what it's working on, not blank.
  const resp = r.lastResponse || r.topic || ''

  return {
    id,
    host: r.host,
    project: deriveProject(r.cwd, r.project, r.project || '—'),
    name,
    abbr: abbrFor(r.agentType),
    phase,
    verb,
    target,
    tok: r.tokPerSec,
    since: sinceFromMs(r.sinceMs),
    files: 0,
    tools: 0,
    needs,
    pinned: pinned.has(id),
    pr: floorPrLabel(r.prUrl),
    ticket: r.ticket,
    branch: r.branch,
    resp,
    question: parseStructuredQuestion(resp, phase),
  }
}

/** Map local UnifiedAgents (watchdog rows should be filtered out by the caller). */
export function adaptUnified(
  agents: UnifiedAgentLike[],
  opts: { pinned: Set<string>; workspaceRepo?: string | null; nowMs: number },
): FloorAgent[] {
  return agents.map((a) => toFloorAgentFromUnified(a, opts))
}

/** Map genuinely-remote sessions (caller drops host === 'this-mac' to avoid double count). */
export function adaptRemote(sessions: RemoteSessionLike[], pinned: Set<string>): FloorAgent[] {
  return sessions.map((s) => toFloorAgentFromRemote(s, pinned))
}

/** UnifiedTask[] -> FloorTicket[] (delegates to floorModel.toFloorTicket). */
export function adaptTickets(tasks: UnifiedTask[]): FloorTicket[] {
  return tasks.map(toFloorTicket)
}
