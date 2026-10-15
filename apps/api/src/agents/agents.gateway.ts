import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import {
  AgentAck,
  agentAuthSchema,
  AgentEvent,
  agentHeartbeatSchema,
  coinDispensedSchema,
  coinInsertedSchema,
  coinShortfallSchema,
  jobFailedSchema,
  jobRefSchema,
  SocketNamespace,
} from '@printbox/shared';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { hashApiKey } from '../common/api-key';
import { CoinPaymentService } from '../payments/coin-payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentCoinsService } from './agent-coins.service';
import { AgentConnections } from './agent-connections';
import { AgentJobsService, UnknownJobError } from './agent-jobs.service';
import { AgentStatusService } from './agent-status.service';

/** Kiosk id set on the socket by the handshake middleware. */
function kioskOf(socket: Socket): string {
  return (socket.data as { kioskId: string }).kioskId;
}

/**
 * `/agents` namespace: the print agent of each kiosk connects outbound (no port to open in the
 * shop) and authenticates with its kiosk id and API key in the handshake.
 */
@WebSocketGateway({ namespace: SocketNamespace.AGENTS })
export class AgentsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AgentsGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: AgentConnections,
    private readonly jobs: AgentJobsService,
    private readonly coins: AgentCoinsService,
    private readonly coinPayments: CoinPaymentService,
    private readonly status: AgentStatusService,
  ) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      const auth = agentAuthSchema.safeParse(socket.handshake.auth);
      if (!auth.success) return next(new Error('unauthorized'));
      this.prisma.kiosk
        .findUnique({ where: { apiKeyHash: hashApiKey(auth.data.apiKey) }, select: { id: true } })
        .then((kiosk) => {
          if (!kiosk || kiosk.id !== auth.data.kioskId) return next(new Error('unauthorized'));
          (socket.data as { kioskId: string }).kioskId = kiosk.id;
          next();
        })
        .catch(() => next(new Error('unavailable')));
    });
  }

  handleConnection(socket: Socket): void {
    const kioskId = kioskOf(socket);
    // One agent per kiosk: a new connection (restart, network switch) replaces the old one.
    this.connections.register(kioskId, socket)?.disconnect(true);
    this.logger.log({ kioskId }, 'Kiosk agent connected');
    this.status.emitChanged(kioskId);
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const kioskId = kioskOf(socket);
    if (kioskId && this.connections.unregister(kioskId, socket)) {
      // Also runs during shutdown, when the database may already be gone.
      await this.status.markOffline(kioskId).catch((error: unknown) => {
        this.logger.warn({ kioskId, err: error }, 'Could not mark the kiosk offline');
      });
    }
  }

  /** The agent flushed its outbox: restore the coin machine and resend pending work. */
  @SubscribeMessage(AgentEvent.READY)
  ready(@ConnectedSocket() socket: Socket): Promise<AgentAck> {
    return this.handle(socket, z.unknown(), undefined, async (kioskId) => {
      this.connections.markReady(kioskId, socket);
      await this.coins.syncOnReady(kioskId);
      await this.jobs.dispatchPending(kioskId);
    });
  }

  @SubscribeMessage(AgentEvent.HEARTBEAT)
  heartbeat(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<AgentAck> {
    return this.handle(socket, agentHeartbeatSchema, body, async (kioskId, heartbeat) => {
      await this.status.recordHeartbeat(kioskId, heartbeat);
    });
  }

  @SubscribeMessage(AgentEvent.JOB_ACK)
  jobAck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<AgentAck> {
    return this.handle(socket, jobRefSchema, body, async () => undefined);
  }

  @SubscribeMessage(AgentEvent.JOB_PRINTING)
  jobPrinting(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<AgentAck> {
    return this.handle(socket, jobRefSchema, body, (kioskId, { jobId }) =>
      this.jobs.markPrinting(kioskId, jobId),
    );
  }

  @SubscribeMessage(AgentEvent.JOB_PRINTED)
  jobPrinted(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<AgentAck> {
    return this.handle(socket, jobRefSchema, body, (kioskId, { jobId }) =>
      this.jobs.markPrinted(kioskId, jobId),
    );
  }

  @SubscribeMessage(AgentEvent.JOB_FAILED)
  jobFailed(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<AgentAck> {
    return this.handle(socket, jobFailedSchema, body, (kioskId, failure) =>
      this.jobs.markFailed(kioskId, failure.jobId, failure.reason, failure.detail),
    );
  }

  @SubscribeMessage(AgentEvent.COIN_INSERTED)
  coinInserted(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<AgentAck> {
    return this.handle(socket, coinInsertedSchema, body, async (kioskId, coin) => {
      await this.coinPayments.recordInserted(kioskId, coin);
    });
  }

  @SubscribeMessage(AgentEvent.COIN_DISPENSED)
  coinDispensed(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<AgentAck> {
    return this.handle(socket, coinDispensedSchema, body, (kioskId, coin) =>
      this.coinPayments.recordDispensed(kioskId, {
        eventId: coin.eventId,
        valueMillimes: coin.valueMillimes,
        paymentId: coin.paymentId,
      }),
    );
  }

  @SubscribeMessage(AgentEvent.COIN_SHORTFALL)
  coinShortfall(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<AgentAck> {
    return this.handle(socket, coinShortfallSchema, body, (kioskId, shortfall) =>
      this.coins.recordShortfall(kioskId, shortfall),
    );
  }

  /**
   * Validates the payload and turns the outcome into the acknowledgement. A negative ack for a
   * permanent error (bad payload, unknown job) tells the agent to drop the message; INTERNAL
   * tells it to retry later.
   */
  private async handle<T extends z.ZodType>(
    socket: Socket,
    schema: T,
    body: unknown,
    handler: (kioskId: string, payload: z.output<T>) => Promise<void>,
  ): Promise<AgentAck> {
    const kioskId = kioskOf(socket);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'INVALID_PAYLOAD' };
    try {
      await handler(kioskId, parsed.data);
      return { ok: true };
    } catch (error) {
      if (error instanceof UnknownJobError) return { ok: false, error: 'UNKNOWN_JOB' };
      this.logger.error({ kioskId, err: error }, 'Agent message handling failed');
      return { ok: false, error: 'INTERNAL' };
    }
  }
}
