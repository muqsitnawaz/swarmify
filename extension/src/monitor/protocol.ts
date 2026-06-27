// Wire protocol for the follower<->monitor tuple channel (foundation 3/3, #67).
//
// Followers REPORT their terminals as `(windowId, terminalId, pid, sessionId,
// workspacePath, agentType)` tuples to the elected monitor over the broadcast
// request channel (#66). The monitor keeps the union of every window's tuples
// and PUSHES the merged snapshot back as a fact, which each follower resolves
// against its own `vscode.Terminal` maps. These types are the single contract
// shared by `host.ts`, `follower.ts`, and the activation wiring — kept here so
// neither side hand-rolls (and drifts) the same shapes.

import { MonitorEvent } from './broadcastTypes';

/** A single agent terminal as seen by the window that owns it. */
export interface TerminalTuple {
  /** computeWindowId(sessionId, pid) of the reporting window. */
  windowId: string;
  /** Internal tracking id of the terminal (e.g. "CC-1705123456789-1"). */
  terminalId: string;
  /** OS pid of the terminal's shell, or null before `processId` resolves. */
  pid: number | null;
  /** CLI session UUID, or null before the agent reports one. */
  sessionId: string | null;
  /** Workspace folder the terminal was opened in, or null. */
  workspacePath: string | null;
  /** 'claude' | 'codex' | 'gemini' | ..., or null when unknown. */
  agentType: string | null;
}

/** Request `op` discriminators carried on the persistent connection. */
export const MONITOR_OP = {
  /** Follower -> monitor: replace this window's tuple slice. */
  reportTuples: 'report-tuples',
  /** Follower -> monitor: pull the current merged tuple set. */
  snapshot: 'snapshot',
  /**
   * Follower -> monitor: arm agentReady detection for a shell pid (#68). The
   * monitor's readiness detector runs the process-state probe (and the
   * session-file fast path when agentKey+sessionId are known) once per pid and
   * broadcasts an `agentReady` fact. This is the cross-window successor to the
   * window-local `armAgentReady(terminal, …)` call.
   */
  armAgent: 'arm-agent',
  /**
   * Follower -> monitor: arm shell-adoption detection for a shell pid (#68).
   * The monitor walks the descendant tree once and broadcasts a
   * ShellAdoptionInfo fact when a known agent CLI appears.
   */
  armShellAdoption: 'arm-shell-adoption',
} as const;

export interface ReportTuplesRequest {
  op: typeof MONITOR_OP.reportTuples;
  windowId: string;
  tuples: TerminalTuple[];
}

export interface SnapshotRequest {
  op: typeof MONITOR_OP.snapshot;
}

export interface ArmAgentRequest {
  op: typeof MONITOR_OP.armAgent;
  /** Shell pid (root of the process tree) to watch for an idle agent child. */
  pid: number;
  /** Known agent key, enabling the session-file fast path when paired with a sessionId. */
  agentKey?: string;
  sessionId?: string;
}

export interface ArmShellAdoptionRequest {
  op: typeof MONITOR_OP.armShellAdoption;
  /** Shell pid whose descendant tree is walked for a known agent CLI. */
  pid: number;
}

export type MonitorRequest =
  | ReportTuplesRequest
  | SnapshotRequest
  | ArmAgentRequest
  | ArmShellAdoptionRequest;

export interface ReportTuplesAck {
  ok: true;
  windowId: string;
  count: number;
}

export interface SnapshotReply {
  tuples: TerminalTuple[];
}

/** Generic ack for the fire-and-forget arm ops. */
export interface ArmAck {
  ok: true;
}

/** The readiness milestones the monitor broadcasts, keyed by pid (#68). */
export type ReadinessEventName =
  | 'tabReady'
  | 'shellReady'
  | 'promptReady'
  | 'agentReady';

/** Event `type` the monitor broadcasts. */
export const MONITOR_FACT = {
  tuplesSnapshot: 'monitor.tuples-snapshot',
  /** A terminal readiness milestone reached for a shell pid (#68). */
  readiness: 'monitor.readiness',
  /** A known agent CLI was adopted under a shell pid (#68). */
  shellAdoption: 'monitor.shell-adoption',
  /** A new/changed session file was parsed by the machine-wide watcher (#69). */
  session: 'monitor.session',
  /** A tracked session file was written (warmth signal for kill/restart). */
  sessionWarmth: 'monitor.session-warmth',
} as const;

export interface TuplesSnapshotPayload {
  tuples: TerminalTuple[];
}

/** A readiness milestone reached for a shell pid. */
export interface ReadinessFactPayload {
  pid: number;
  event: ReadinessEventName;
}

/** The mirror of `ShellAdoptionInfo` (terminalReadiness.ts), keyed by shell pid. */
export interface ShellAdoptionFactPayload {
  /** The shell pid whose descendant tree the agent was found in. */
  pid: number;
  agentKey: string;
  sessionId?: string;
  childPid: number;
}

/** Agent kinds the machine-wide session watcher recognizes. */
export type SessionAgentKind = 'claude' | 'codex' | 'gemini' | 'opencode';

/**
 * A new/changed session file parsed by the machine-wide watcher (#69). Carries
 * the same head metadata `sessionTracker` parses locally today, so a follower
 * runs the identical (window-local) correlation against its own terminals
 * without re-reading the file.
 */
export interface SessionFactPayload {
  agentType: SessionAgentKind;
  /** Absolute path to the session file. */
  filePath: string;
  /** session id derived from the filename. */
  fileSessionId: string;
  mtimeMs: number;
  forkedFromId?: string;
  codexCwd?: string;
  geminiProjectHash?: string;
  geminiSessionId?: string;
  opencodeDirectory?: string;
  opencodeSessionId?: string;
}

/** A tracked session file was written — keeps the follower's dormancy clock. */
export interface SessionWarmthPayload {
  filePath: string;
  ts: number;
}

/** Narrow a raw broadcast event to a tuples-snapshot fact. */
export function isTuplesSnapshot(
  event: MonitorEvent,
): event is MonitorEvent & { payload: TuplesSnapshotPayload } {
  return (
    event.type === MONITOR_FACT.tuplesSnapshot &&
    !!event.payload &&
    Array.isArray((event.payload as TuplesSnapshotPayload).tuples)
  );
}

/** Narrow a raw broadcast event to a readiness fact. */
export function isReadinessFact(
  event: MonitorEvent,
): event is MonitorEvent & { payload: ReadinessFactPayload } {
  const p = event.payload as ReadinessFactPayload | undefined;
  return (
    event.type === MONITOR_FACT.readiness &&
    !!p &&
    typeof p.pid === 'number' &&
    typeof p.event === 'string'
  );
}

/** Narrow a raw broadcast event to a shell-adoption fact. */
export function isShellAdoptionFact(
  event: MonitorEvent,
): event is MonitorEvent & { payload: ShellAdoptionFactPayload } {
  const p = event.payload as ShellAdoptionFactPayload | undefined;
  return (
    event.type === MONITOR_FACT.shellAdoption &&
    !!p &&
    typeof p.pid === 'number' &&
    typeof p.agentKey === 'string' &&
    typeof p.childPid === 'number'
  );
}

/** Narrow a raw broadcast event to a session fact. */
export function isSessionFact(
  event: MonitorEvent,
): event is MonitorEvent & { payload: SessionFactPayload } {
  const p = event.payload as SessionFactPayload | undefined;
  return (
    event.type === MONITOR_FACT.session &&
    !!p &&
    typeof p.agentType === 'string' &&
    typeof p.filePath === 'string'
  );
}

/** Narrow a raw broadcast event to a session-warmth fact. */
export function isSessionWarmth(
  event: MonitorEvent,
): event is MonitorEvent & { payload: SessionWarmthPayload } {
  const p = event.payload as SessionWarmthPayload | undefined;
  return (
    event.type === MONITOR_FACT.sessionWarmth &&
    !!p &&
    typeof p.filePath === 'string'
  );
}
