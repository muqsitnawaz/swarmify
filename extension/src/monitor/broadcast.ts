import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  encodeFrame,
  FrameDecoder,
  MonitorEvent,
  MonitorFrame,
} from './broadcastTypes';

/**
 * Default socket path for the monitor broadcast channel. Deliberately separate
 * from the one-shot watchdog socket (`~/.agents/.tmp/watchdog.sock`) so this
 * parallel pub/sub channel never disturbs the existing request/reply bridge.
 */
export const MONITOR_SOCKET_PATH = path.join(
  os.homedir(),
  '.agents',
  '.tmp',
  'monitor-broadcast.sock'
);

/**
 * Handles a follower->monitor request arriving on a persistent connection. The
 * return value (or thrown error) is serialized back to the requesting client.
 * A later leader (#65) supplies the real handler (e.g. "register pids",
 * "give me the current snapshot"); the transport itself is leader-agnostic.
 */
export type MonitorRequestHandler = (
  payload: unknown,
  socket: net.Socket
) => Promise<unknown> | unknown;

export interface MonitorBroadcastServerOptions {
  socketPath?: string;
  onRequest?: MonitorRequestHandler;
}

/**
 * Listens on the monitor socket, maintains a live set of follower connections,
 * and pushes events to all of them. Dead sockets are evicted from the set on
 * 'error'/'close'/'end' and on any failed write, so a closed follower window
 * never blocks the fan-out.
 */
export class MonitorBroadcastServer {
  private readonly socketPath: string;
  private readonly onRequest?: MonitorRequestHandler;
  private server: net.Server | null = null;
  private readonly clients = new Set<net.Socket>();

  constructor(options: MonitorBroadcastServerOptions = {}) {
    this.socketPath = options.socketPath ?? MONITOR_SOCKET_PATH;
    this.onRequest = options.onRequest;
  }

  /** Number of currently-connected follower sockets. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Bind and start listening. Rejects if the socket address is already taken. */
  async start(): Promise<void> {
    await fs.mkdir(path.dirname(this.socketPath), { recursive: true });
    await this.unlinkSocket();
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => this.handleConnection(socket));
      const onListenError = (err: Error) => reject(err);
      server.once('error', onListenError);
      server.listen(this.socketPath, () => {
        server.removeListener('error', onListenError);
        server.on('error', (err) =>
          console.error('[MONITOR] broadcast server error:', err)
        );
        this.server = server;
        resolve();
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    socket.setEncoding('utf8');
    this.clients.add(socket);
    const decoder = new FrameDecoder();

    socket.on('data', (chunk: string) => {
      for (const frame of decoder.push(chunk)) {
        if (frame.kind === 'request') {
          void this.handleRequest(socket, frame.id, frame.payload);
        }
      }
    });

    const drop = () => {
      this.clients.delete(socket);
    };
    socket.on('error', drop);
    socket.on('close', drop);
    socket.on('end', drop);
  }

  private async handleRequest(
    socket: net.Socket,
    id: number,
    payload: unknown
  ): Promise<void> {
    if (!this.onRequest) {
      this.writeFrame(socket, {
        kind: 'response',
        id,
        error: 'No request handler registered',
      });
      return;
    }
    try {
      const result = await this.onRequest(payload, socket);
      this.writeFrame(socket, { kind: 'response', id, payload: result });
    } catch (err) {
      this.writeFrame(socket, {
        kind: 'response',
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Push an event to every connected follower. */
  broadcast(event: MonitorEvent): void {
    const line = encodeFrame({ kind: 'event', event });
    for (const socket of this.clients) {
      this.writeRaw(socket, line);
    }
  }

  private writeFrame(socket: net.Socket, frame: MonitorFrame): void {
    this.writeRaw(socket, encodeFrame(frame));
  }

  private writeRaw(socket: net.Socket, line: string): void {
    if (socket.destroyed || !socket.writable) {
      this.clients.delete(socket);
      return;
    }
    try {
      socket.write(line);
    } catch {
      this.clients.delete(socket);
      try {
        socket.destroy();
      } catch {
        // Already gone.
      }
    }
  }

  private async unlinkSocket(): Promise<void> {
    try {
      await fs.unlink(this.socketPath);
    } catch {
      // Nothing to clean up.
    }
  }

  /** Stop listening, drop all clients, and remove the socket file. */
  async close(): Promise<void> {
    for (const socket of this.clients) {
      try {
        socket.destroy();
      } catch {
        // Already gone.
      }
    }
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await this.unlinkSocket();
  }
}
