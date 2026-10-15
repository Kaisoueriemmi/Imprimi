import {
  type AgentAck,
  agentAckSchema,
  AgentEvent,
  type AgentHeartbeat,
  type CoinAccept,
  coinAcceptSchema,
  type CoinDispense,
  coinDispenseSchema,
  type JobDispatch,
  jobDispatchSchema,
  SocketNamespace,
  TIMINGS,
} from '@printbox/shared';
import { io, type Socket } from 'socket.io-client';
import type { z } from 'zod';
import type { AgentConfig } from '../config';
import type { Logger } from '../logger';
import type { Outbox } from '../state/outbox';

export interface AgentHandlers {
  dispatch(job: JobDispatch): Promise<void>;
  coinAccept(command: CoinAccept): Promise<void>;
  coinDispense(command: CoinDispense): Promise<void>;
}

const ACK_TIMEOUT_MS = 10_000;
const READY_RETRY_MS = 5_000;

/**
 * Outbound Socket.IO connection to the API (no port to open in the shop). Reconnects forever
 * with exponential backoff (1 s → 30 s, jittered). After each (re)connection it first flushes
 * the outbox, then sends `agent:ready`: the server only resends work and money owed once every
 * report of the previous connection has been counted.
 */
export class AgentClient {
  private socket: Socket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deps: {
      config: Pick<AgentConfig, 'apiUrl' | 'kioskId' | 'apiKey'>;
      logger: Logger;
      outbox: Outbox;
      handlers: AgentHandlers;
      heartbeat: () => Promise<AgentHeartbeat>;
    },
  ) {}

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  start(): void {
    const { config, logger, handlers } = this.deps;
    const socket = io(`${config.apiUrl.replace(/[/]+$/, '')}${SocketNamespace.AGENTS}`, {
      auth: { kioskId: config.kioskId, apiKey: config.apiKey },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
      timeout: 10_000,
    });
    this.socket = socket;

    socket.on('connect', () => {
      logger.info('Connected to the API');
      void this.announceReady(socket);
    });
    socket.on('disconnect', (reason) => logger.warn({ reason }, 'Disconnected from the API'));
    socket.on('connect_error', (error) =>
      logger.warn({ error: error.message }, 'Cannot reach the API'),
    );

    this.on(socket, AgentEvent.JOB_DISPATCH, jobDispatchSchema, (job) => handlers.dispatch(job));
    this.on(socket, AgentEvent.COIN_ACCEPT, coinAcceptSchema, (command) =>
      handlers.coinAccept(command),
    );
    this.on(socket, AgentEvent.COIN_DISPENSE, coinDispenseSchema, (command) =>
      handlers.coinDispense(command),
    );

    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
      // Retries messages the server could not process last time (INTERNAL error).
      if (this.deps.outbox.size > 0) this.requestFlush();
    }, TIMINGS.agentHeartbeatIntervalMs);
  }

  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.socket?.disconnect();
    this.socket = null;
  }

  /** Delivers pending outbox messages now if connected (otherwise on the next connection). */
  requestFlush(): void {
    if (!this.connected) return;
    void this.deps.outbox.flush((event, payload) => this.send(event, payload));
  }

  /** Sends one message and waits for the server acknowledgement. */
  async send(event: string, payload: unknown): Promise<AgentAck> {
    const socket = this.socket;
    if (!socket?.connected) throw new Error('offline');
    const ack: unknown = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload);
    return agentAckSchema.parse(ack);
  }

  private async announceReady(socket: Socket): Promise<void> {
    const { outbox, logger } = this.deps;
    const flushed = await outbox.flush((event, payload) => this.send(event, payload));
    if (socket !== this.socket || !socket.connected) return;
    if (!flushed) {
      logger.warn({ pending: outbox.size }, 'Outbox not delivered yet, ready postponed');
      setTimeout(() => {
        if (socket === this.socket && socket.connected) void this.announceReady(socket);
      }, READY_RETRY_MS);
      return;
    }
    try {
      const ack = await this.send(AgentEvent.READY, {});
      if (!ack.ok) throw new Error(ack.error ?? 'refused');
      logger.info('Ready: the server can send work');
    } catch (error) {
      logger.warn({ err: error }, 'agent:ready not acknowledged, retrying');
      setTimeout(() => {
        if (socket === this.socket && socket.connected) void this.announceReady(socket);
      }, READY_RETRY_MS);
      return;
    }
    await this.sendHeartbeat();
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.connected) return;
    try {
      this.socket?.emit(AgentEvent.HEARTBEAT, await this.deps.heartbeat());
    } catch (error) {
      this.deps.logger.warn({ err: error }, 'Heartbeat failed');
    }
  }

  private on<T extends z.ZodType>(
    socket: Socket,
    event: string,
    schema: T,
    handler: (payload: z.output<T>) => Promise<void>,
  ): void {
    socket.on(event, (payload: unknown) => {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        this.deps.logger.error({ event }, 'Invalid message from the server, ignored');
        return;
      }
      handler(parsed.data).catch((error: unknown) => {
        this.deps.logger.error({ event, err: error }, 'Handling a server message failed');
      });
    });
  }
}
