// Monitor host runtime — foundation 3/3 of the centralized-monitor epic (#64).
//
// The elected leader (#65) == the monitor. While this window holds the lease it
// runs ONE `MonitorBroadcastServer` (#66); followers connect to it, report their
// terminal tuples, and receive the merged snapshot back as a broadcast fact.
// When leadership is lost the host stops and its socket is unlinked, so the next
// leader can bind the same path (the client's auto-reconnect handles the gap).
//
// This module is the runtime only — the leader/follower lifecycle gating lives
// in `gate.ts` (`runOnLeaderOnly`). Kept vscode-free so it runs and tests in a
// plain process against real Unix sockets (see follower.test.ts).

import { MonitorBroadcastServer } from './broadcast';
import { MonitorEvent } from './broadcastTypes';
import {
  MONITOR_FACT,
  MONITOR_OP,
  MonitorRequest,
  ReportTuplesAck,
  SnapshotReply,
  TerminalTuple,
  TuplesSnapshotPayload,
} from './protocol';

export interface MonitorHostOptions {
  /** Override the broadcast socket path (tests). */
  socketPath?: string;
}

export class MonitorHost {
  private readonly server: MonitorBroadcastServer;
  // windowId -> that window's last-reported tuple slice. The union across all
  // slices is the global terminal set the monitor broadcasts. Slices are keyed
  // by window so a re-report replaces (never appends) a window's terminals.
  private readonly slices = new Map<string, TerminalTuple[]>();
  private running = false;

  constructor(options: MonitorHostOptions = {}) {
    this.server = new MonitorBroadcastServer({
      socketPath: options.socketPath,
      onRequest: (payload) => this.handleRequest(payload),
    });
  }

  /** Number of currently-connected follower sockets. */
  get clientCount(): number {
    return this.server.clientCount;
  }

  /** Bind the broadcast socket and begin serving followers. */
  async start(): Promise<void> {
    if (this.running) return;
    await this.server.start();
    this.running = true;
  }

  /** Stop serving, drop all tuple slices, and unlink the socket. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.slices.clear();
    await this.server.close();
  }

  /** The union of every window's reported tuples. */
  snapshot(): TerminalTuple[] {
    const out: TerminalTuple[] = [];
    for (const slice of this.slices.values()) out.push(...slice);
    return out;
  }

  private handleRequest(payload: unknown): ReportTuplesAck | SnapshotReply {
    const req = payload as MonitorRequest | undefined;
    const op = req?.op;
    if (req && op === MONITOR_OP.reportTuples) {
      this.slices.set(req.windowId, req.tuples ?? []);
      this.broadcastSnapshot();
      return { ok: true, windowId: req.windowId, count: req.tuples?.length ?? 0 };
    }
    if (req && op === MONITOR_OP.snapshot) {
      return { tuples: this.snapshot() };
    }
    throw new Error(`Unknown monitor request op: ${JSON.stringify(op)}`);
  }

  private broadcastSnapshot(): void {
    const payload: TuplesSnapshotPayload = { tuples: this.snapshot() };
    const event: MonitorEvent = {
      type: MONITOR_FACT.tuplesSnapshot,
      payload,
      ts: Date.now(),
    };
    this.server.broadcast(event);
  }
}
