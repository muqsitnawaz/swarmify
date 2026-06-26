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
} as const;

export interface ReportTuplesRequest {
  op: typeof MONITOR_OP.reportTuples;
  windowId: string;
  tuples: TerminalTuple[];
}

export interface SnapshotRequest {
  op: typeof MONITOR_OP.snapshot;
}

export type MonitorRequest = ReportTuplesRequest | SnapshotRequest;

export interface ReportTuplesAck {
  ok: true;
  windowId: string;
  count: number;
}

export interface SnapshotReply {
  tuples: TerminalTuple[];
}

/** Event `type` the monitor broadcasts after any window's tuples change. */
export const MONITOR_FACT = {
  tuplesSnapshot: 'monitor.tuples-snapshot',
} as const;

export interface TuplesSnapshotPayload {
  tuples: TerminalTuple[];
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
