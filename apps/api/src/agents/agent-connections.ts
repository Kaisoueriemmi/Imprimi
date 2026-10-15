import { Injectable } from '@nestjs/common';
import type { Socket } from 'socket.io';

interface Connection {
  socket: Socket;
  /** Set once the agent has flushed its outbox (`agent:ready`): work can be (re)sent. */
  ready: boolean;
}

/** The live agent socket of each kiosk (at most one). */
@Injectable()
export class AgentConnections {
  private readonly byKiosk = new Map<string, Connection>();

  /** Registers the socket; returns the previous one of this kiosk, to be disconnected. */
  register(kioskId: string, socket: Socket): Socket | undefined {
    const previous = this.byKiosk.get(kioskId)?.socket;
    this.byKiosk.set(kioskId, { socket, ready: false });
    return previous === socket ? undefined : previous;
  }

  /** True when `socket` was the kiosk's current connection (and is now removed). */
  unregister(kioskId: string, socket: Socket): boolean {
    if (this.byKiosk.get(kioskId)?.socket !== socket) return false;
    this.byKiosk.delete(kioskId);
    return true;
  }

  markReady(kioskId: string, socket: Socket): void {
    const connection = this.byKiosk.get(kioskId);
    if (connection?.socket === socket) connection.ready = true;
  }

  /** Any current connection (commands that are safe to send before `agent:ready`). */
  socket(kioskId: string): Socket | undefined {
    return this.byKiosk.get(kioskId)?.socket;
  }

  readySocket(kioskId: string): Socket | undefined {
    const connection = this.byKiosk.get(kioskId);
    return connection?.ready ? connection.socket : undefined;
  }

  isConnected(kioskId: string): boolean {
    return this.byKiosk.has(kioskId);
  }
}
