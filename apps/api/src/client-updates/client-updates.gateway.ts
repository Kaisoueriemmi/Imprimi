import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  AgentAck,
  clientAuthSchema,
  ClientEvent,
  jobSubscribeSchema,
  SocketNamespace,
} from '@printbox/shared';
import type { Namespace, Socket } from 'socket.io';
import {
  CoinSessionUpdatedEvent,
  DomainEvent,
  JobStatusChangedEvent,
} from '../events/domain-events';
import { JOB_VIEW_INCLUDE, toJobView } from '../jobs/job-view';
import { PrismaService } from '../prisma/prisma.service';
import { SessionTokenService } from '../sessions/session-token.service';

const PUSH_DEBOUNCE_MS = 100;
const room = (jobId: string) => `job:${jobId}`;
const sessionOf = (socket: Socket) => (socket.data as { sessionId: string }).sessionId;

/**
 * `/clients` namespace: the customer's phone follows its jobs live (payment, printing,
 * printed). Authenticated with the session token; a phone can only follow its own jobs.
 */
@WebSocketGateway({ namespace: SocketNamespace.CLIENTS })
export class ClientUpdatesGateway implements OnGatewayInit, OnModuleDestroy {
  private readonly logger = new Logger(ClientUpdatesGateway.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();

  @WebSocketServer()
  private readonly namespace!: Namespace;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SessionTokenService,
  ) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      const auth = clientAuthSchema.safeParse(socket.handshake.auth);
      if (!auth.success) return next(new Error('unauthorized'));
      this.tokens
        .verify(auth.data.sessionToken)
        .then((claims) =>
          this.prisma.session.findUnique({
            where: { id: claims.id },
            select: { id: true, expiresAt: true },
          }),
        )
        .then((session) => {
          if (!session || session.expiresAt <= new Date()) return next(new Error('unauthorized'));
          (socket.data as { sessionId: string }).sessionId = session.id;
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
  }

  @SubscribeMessage(ClientEvent.SUBSCRIBE)
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<AgentAck> {
    const parsed = jobSubscribeSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'INVALID_PAYLOAD' };
    const job = await this.prisma.printJob.findFirst({
      where: { id: parsed.data.jobId, sessionId: sessionOf(socket) },
      include: JOB_VIEW_INCLUDE,
    });
    if (!job) return { ok: false, error: 'NOT_FOUND' };
    await socket.join(room(job.id));
    socket.emit(ClientEvent.JOB_STATUS, toJobView(job));
    return { ok: true };
  }

  @OnEvent(DomainEvent.JOB_STATUS_CHANGED)
  onJobStatus(event: JobStatusChangedEvent): void {
    this.schedulePush(event.jobId);
  }

  @OnEvent(DomainEvent.COIN_SESSION_UPDATED)
  onCoinSession(event: CoinSessionUpdatedEvent): void {
    this.schedulePush(event.jobId);
  }

  onModuleDestroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
  }

  private schedulePush(jobId: string): void {
    if (this.pending.has(jobId)) return;
    this.pending.set(
      jobId,
      setTimeout(() => {
        this.pending.delete(jobId);
        void this.push(jobId);
      }, PUSH_DEBOUNCE_MS),
    );
  }

  private async push(jobId: string): Promise<void> {
    if (!this.namespace?.adapter.rooms.get(room(jobId))?.size) return;
    try {
      const job = await this.prisma.printJob.findUnique({
        where: { id: jobId },
        include: JOB_VIEW_INCLUDE,
      });
      if (job) this.namespace.to(room(jobId)).emit(ClientEvent.JOB_STATUS, toJobView(job));
    } catch (error) {
      this.logger.error({ jobId, err: error }, 'Could not push the job status');
    }
  }
}
