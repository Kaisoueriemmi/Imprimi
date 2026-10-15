import { Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { KioskEvent, kioskScreenAuthSchema, SocketNamespace } from '@printbox/shared';
import type { Namespace, Socket } from 'socket.io';
import { hashApiKey } from '../common/api-key';
import {
  CoinSessionUpdatedEvent,
  DomainEvent,
  JobStatusChangedEvent,
  KioskChangedEvent,
} from '../events/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { KioskScreenService } from './kiosk-screen.service';

/** Several events often arrive together (coin → PAID → QUEUED): push one state for all. */
const PUSH_DEBOUNCE_MS = 150;

const room = (kioskId: string) => `kiosk:${kioskId}`;

/**
 * `/kiosks` namespace: the kiosk screen (Chrome in kiosk mode) authenticates with the kiosk
 * display key and receives `kiosk:state` on connection and after every change.
 */
@WebSocketGateway({ namespace: SocketNamespace.KIOSKS })
export class KioskScreenGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(KioskScreenGateway.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();

  @WebSocketServer()
  private readonly namespace!: Namespace;

  constructor(
    private readonly prisma: PrismaService,
    private readonly screen: KioskScreenService,
  ) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      const auth = kioskScreenAuthSchema.safeParse(socket.handshake.auth);
      if (!auth.success || !auth.data.displayKey.startsWith('pbd_')) {
        return next(new Error('unauthorized'));
      }
      this.prisma.kiosk
        .findUnique({
          where: { displayKeyHash: hashApiKey(auth.data.displayKey) },
          select: { id: true },
        })
        .then((kiosk) => {
          if (!kiosk || kiosk.id !== auth.data.kioskId) return next(new Error('unauthorized'));
          (socket.data as { kioskId: string }).kioskId = kiosk.id;
          next();
        })
        .catch(() => next(new Error('unavailable')));
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const kioskId = (socket.data as { kioskId: string }).kioskId;
    await socket.join(room(kioskId));
    try {
      socket.emit(KioskEvent.STATE, await this.screen.state(kioskId));
    } catch (error) {
      this.logger.error({ kioskId, err: error }, 'Could not send the kiosk screen state');
    }
  }

  @OnEvent(DomainEvent.JOB_STATUS_CHANGED)
  onJobStatus(event: JobStatusChangedEvent): void {
    this.schedulePush(event.kioskId);
  }

  @OnEvent(DomainEvent.COIN_SESSION_UPDATED)
  onCoinSession(event: CoinSessionUpdatedEvent): void {
    this.schedulePush(event.kioskId);
  }

  @OnEvent(DomainEvent.KIOSK_CHANGED)
  onKioskChanged(event: KioskChangedEvent): void {
    this.schedulePush(event.kioskId);
  }

  onModuleDestroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
  }

  private schedulePush(kioskId: string): void {
    if (this.pending.has(kioskId)) return;
    this.pending.set(
      kioskId,
      setTimeout(() => {
        this.pending.delete(kioskId);
        void this.push(kioskId);
      }, PUSH_DEBOUNCE_MS),
    );
  }

  private async push(kioskId: string): Promise<void> {
    // Nothing to do when no screen of this kiosk is connected.
    if (!this.namespace?.adapter.rooms.get(room(kioskId))?.size) return;
    try {
      this.namespace.to(room(kioskId)).emit(KioskEvent.STATE, await this.screen.state(kioskId));
    } catch (error) {
      this.logger.error({ kioskId, err: error }, 'Could not push the kiosk screen state');
    }
  }
}
