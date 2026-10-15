import { Injectable } from '@nestjs/common';
import { JobStatus, KioskStatus, PaymentProvider, PaymentStatus } from '@prisma/client';
import { KioskScreenState, OutOfServiceReason, pickupCodeHint } from '@printbox/shared';
import { AgentConnections } from '../agents/agent-connections';
import { PrismaService } from '../prisma/prisma.service';

const QUEUE_SHOWN = 8;

/** What the kiosk screen displays. Never exposes full pickup codes or file names. */
@Injectable()
export class KioskScreenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: AgentConnections,
  ) {}

  async state(kioskId: string, now = new Date()): Promise<KioskScreenState> {
    const kiosk = await this.prisma.kiosk.findUniqueOrThrow({
      where: { id: kioskId },
      select: {
        id: true,
        name: true,
        status: true,
        paperLevelHint: true,
        paymentJobId: true,
        paymentExpiresAt: true,
      },
    });

    const queue = await this.prisma.printJob.findMany({
      where: {
        kioskId,
        status: { in: [JobStatus.PAID, JobStatus.QUEUED, JobStatus.PRINTING] },
      },
      select: { pickupCode: true, status: true, totalPages: true },
      orderBy: { paidAt: 'asc' },
      take: QUEUE_SHOWN,
    });

    let coinPayment: KioskScreenState['coinPayment'] = null;
    if (kiosk.paymentJobId && kiosk.paymentExpiresAt && kiosk.paymentExpiresAt > now) {
      const job = await this.prisma.printJob.findUnique({
        where: { id: kiosk.paymentJobId },
        select: {
          pickupCode: true,
          payments: {
            where: { provider: PaymentProvider.COIN, status: PaymentStatus.PENDING },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      const payment = job?.payments[0];
      if (job && payment) {
        coinPayment = {
          codeHint: pickupCodeHint(job.pickupCode),
          amountDueMillimes: payment.amountMillimes,
          receivedMillimes: payment.receivedMillimes,
          expiresAt: kiosk.paymentExpiresAt.toISOString(),
        };
      }
    }

    return {
      kioskId: kiosk.id,
      name: kiosk.name,
      status: kiosk.status,
      outOfService: this.outOfService(kioskId, kiosk.status),
      paperLevel: kiosk.paperLevelHint,
      queue: queue.map((job) => ({
        codeHint: pickupCodeHint(job.pickupCode),
        status: job.status as 'PAID' | 'QUEUED' | 'PRINTING',
        pages: job.totalPages ?? 0,
      })),
      coinPayment,
      updatedAt: now.toISOString(),
    };
  }

  private outOfService(kioskId: string, status: KioskStatus): KioskScreenState['outOfService'] {
    if (!this.connections.isConnected(kioskId)) return OutOfServiceReason.AGENT_OFFLINE;
    // OFFLINE while connected = agent just (re)connected, first heartbeat on its way.
    if (status === KioskStatus.ERROR) return OutOfServiceReason.DEVICE_ERROR;
    return null;
  }
}
