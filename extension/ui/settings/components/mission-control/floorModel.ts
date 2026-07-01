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

import type { UnifiedTask } from '../../types'

// ---------- agent view-model ----------

/**
 * Single field everything keys off. Precedence when deriving from raw signals:
 *   waiting > failed > running > done(unreviewed) > done(settled) > idle
 * (waiting outranks failed: a waiting agent is reversible by the user right now.)
 * Prototype: factory-floor.html:330,363-364.
 */
export type FloorPhase = 'running' | 'idle' | 'waiting' | 'failed' | 'done'

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
  files: number
  tools: number
  needs: boolean         // waiting || failed || (done && unreviewed)
  pinned: boolean        // user-pinned (persisted in globalState)
  pr: string | null      // "#142" when a PR is open
  ticket: string | null  // "RUSH-812" when linked
  branch: string
  resp: string           // last response text (Anthropic Agent-view style)
  question: StructuredQuestion | null
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

export type CenterMode = 'agents' | 'backlog'
export type FloorGroupBy = 'host' | 'project' | 'status' | 'agent'
export type FloorSort = 'needs' | 'recent' | 'tok' | 'name'
export type TicketGroupBy = 'project' | 'priority' | 'source' | 'status'
export type TicketSort = 'priority' | 'id'

// ---------- stable rank constants (data — final, not stubs) ----------

/** Needs-you first ordering. Prototype: factory-floor.html:364. */
export const PHASE_RANK: Record<FloorPhase, number> = {
  waiting: 0,
  failed: 1,
  running: 2,
  done: 3,
  idle: 4,
}

/** Prototype: factory-floor.html:396. */
export const PRI_RANK: Record<TicketPriority, number> = {
  urgent: 0,
  high: 1,
  med: 2,
  low: 3,
}

// ---------- pure logic (LOGIC fills bodies; signatures are the contract) ----------

/** Raw signals -> FloorPhase, applying the precedence documented on FloorPhase. */
export function derivePhase(input: {
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'idle'
  waitingForInput: boolean
  active: boolean
  prOpenUnreviewed: boolean
}): FloorPhase {
  throw new Error('floorModel.derivePhase: implemented by LOGIC')
}

/** waiting || failed || (done && unreviewed). */
export function deriveNeeds(phase: FloorPhase, prOpenUnreviewed: boolean): boolean {
  throw new Error('floorModel.deriveNeeds: implemented by LOGIC')
}

/**
 * Detect a structured question in an agent's last response. Returns null when the
 * text is not a question. Shapes: choice ("A or B?" / "X vs Y"), confirm
 * ("merge it?"), destructive (DROP/DELETE/prod keywords), retry (phase==='failed').
 * clusterKey groups identical questions across agents for batch triage.
 */
export function parseStructuredQuestion(resp: string, phase: FloorPhase): StructuredQuestion | null {
  throw new Error('floorModel.parseStructuredQuestion: implemented by LOGIC')
}

/** Group agents by the chosen dimension. Prototype groupKey: factory-floor.html:412. */
export function groupAgents(agents: FloorAgent[], by: FloorGroupBy): Map<string, FloorAgent[]> {
  throw new Error('floorModel.groupAgents: implemented by LOGIC')
}

/** Sort within a group. 'needs' uses PHASE_RANK. Prototype: agentsCenter():624-630. */
export function sortAgents(agents: FloorAgent[], by: FloorSort): FloorAgent[] {
  throw new Error('floorModel.sortAgents: implemented by LOGIC')
}

/**
 * Cluster waiting agents by StructuredQuestion.clusterKey so N agents asking the
 * same thing collapse into one batch-triage card. Prototype: byQ in agentsCenter()
 * (factory-floor.html:629) + clusterCard() (598-607). Singletons return as [agent].
 */
export function clusterByQuestion(waiting: FloorAgent[]): FloorAgent[][] {
  throw new Error('floorModel.clusterByQuestion: implemented by LOGIC')
}

/** UnifiedTask -> FloorTicket. status: todo|in_progress|done -> todo|in-progress|done;
 *  priority: 'medium' -> 'med'; source: 'linear'->'LN','github'->'GH'. */
export function toFloorTicket(task: UnifiedTask): FloorTicket {
  throw new Error('floorModel.toFloorTicket: implemented by LOGIC')
}

export function groupTickets(tickets: FloorTicket[], by: TicketGroupBy): Map<string, FloorTicket[]> {
  throw new Error('floorModel.groupTickets: implemented by LOGIC')
}

export function sortTickets(tickets: FloorTicket[], by: TicketSort): FloorTicket[] {
  throw new Error('floorModel.sortTickets: implemented by LOGIC')
}
