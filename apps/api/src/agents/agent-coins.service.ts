import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PaymentProvider, PaymentStatus } from '@prisma/client';
import { AgentEvent, CoinAccept, CoinDispense, CoinShortfall } from '@printbox/shared';
import {
  changeCommandId,
  CoinChangeDueEvent,
  CoinSessionUpdatedEvent,
  DomainEvent,
} from '../events/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { AgentConnections } from './agent-connections';

/** How far back unpaid change is still resent to the kiosk. */
const OUTSTANDING_CHANGE_WINDOW_MS = 24 * 60 * 60_000;

/** Relays coin machine commands to the kiosk agent. */
@Injectable()
export class AgentCoinsService {
  private readonly logger = new Logger(AgentCoinsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: AgentConnections,
  ) {}

  @OnEvent(DomainEvent.COIN_SESSION_UPDATED)
  onCoinSession(event: CoinSessionUpdatedEvent): void {
    const accept: CoinAccept = {
      enabled: event.active,
      jobId: event.active ? event.jobId : null,
      amountDueMillimes: event.amountDueMillimes,
      receivedMillimes: event.receivedMillimes,
    };
    this.connections.socket(event.kioskId)?.emit(AgentEvent.COIN_ACCEPT, accept);
  }

  /** If the agent is offline the command is resent from the database on `agent:ready`. */
  @OnEvent(DomainEvent.COIN_CHANGE_DUE)
  onChangeDue(event: CoinChangeDueEvent): void {
    const command: CoinDispense = {
      commandId: event.commandId,
      paymentId: event.paymentId,
      amountMillimes: event.amountMillimes,
    };
    this.connections.socket(event.kioskId)?.emit(AgentEvent.COIN_DISPENSE, command);
  }

  /**
   * After a reconnection (outbox already flushed, so dispensed coins are counted): restores the
   * validator state and resends every pay-back still owed.
   */
  async syncOnReady(kioskId: string, now = new Date()): Promise<void> {
    const socket = this.connections.readySocket(kioskId);
    if (!socket) return;

    const kiosk = await this.prisma.kiosk.findUniqueOrThrow({
      where: { id: kioskId },
      select: { paymentJobId: true, paymentExpiresAt: true },
    });
    const reserved = kiosk.paymentJobId && kiosk.paymentExpiresAt && kiosk.paymentExpiresAt > now;
    const pending = reserved
      ? await this.prisma.payment.findFirst({
          where: {
            jobId: kiosk.paymentJobId!,
            provider: PaymentProvider.COIN,
            status: PaymentStatus.PENDING,
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const accept: CoinAccept = {
      enabled: Boolean(pending),
      jobId: pending ? kiosk.paymentJobId : null,
      amountDueMillimes: pending?.amountMillimes ?? 0,
      receivedMillimes: pending?.receivedMillimes ?? 0,
    };
    socket.emit(AgentEvent.COIN_ACCEPT, accept);

    const owed = await this.prisma.payment.findMany({
      where: {
        job: { kioskId },
        provider: PaymentProvider.COIN,
        status: { in: [PaymentStatus.CONFIRMED, PaymentStatus.CANCELLED] },
        createdAt: { gt: new Date(now.getTime() - OUTSTANDING_CHANGE_WINDOW_MS) },
      },
      select: { id: true, status: true, changeDueMillimes: true, changeDispensedMillimes: true },
    });
    for (const payment of owed) {
      const remaining = payment.changeDueMillimes - payment.changeDispensedMillimes;
      if (remaining <= 0) continue;
      const reason = payment.status === PaymentStatus.CONFIRMED ? 'CHANGE' : 'REFUND';
      const command: CoinDispense = {
        commandId: changeCommandId(reason, payment.id, remaining),
        paymentId: payment.id,
        amountMillimes: remaining,
      };
      socket.emit(AgentEvent.COIN_DISPENSE, command);
    }
  }

  /** The hopper could not pay everything back: recorded for the operator (alerts in Phase 7). */
  async recordShortfall(kioskId: string, shortfall: CoinShortfall): Promise<void> {
    this.logger.error({ kioskId, ...shortfall }, 'Coin hopper could not pay back the full amount');
    await this.prisma.auditLog.create({
      data: {
        actor: `agent:${kioskId}`,
        action: 'coin.change-shortfall',
        entity: shortfall.paymentId ? 'Payment' : 'Kiosk',
        entityId: shortfall.paymentId ?? kioskId,
        metadata: { commandId: shortfall.commandId, missingMillimes: shortfall.missingMillimes },
      },
    });
  }
}
