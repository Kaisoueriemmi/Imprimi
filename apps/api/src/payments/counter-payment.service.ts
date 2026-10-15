import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JobStatus, PaymentProvider } from '@prisma/client';
import { notFound } from '../common/api-exception';
import { DomainEvent, JobStatusChangedEvent } from '../events/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { CoinPaymentService } from './coin-payment.service';
import { PaymentProviders } from './payment-providers';
import { PaymentsService } from './payments.service';

/** Fallback: the customer pays the operator, who types the pickup code and presses "Encaissé". */
@Injectable()
export class CounterPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviders,
    private readonly payments: PaymentsService,
    private readonly coins: CoinPaymentService,
    private readonly events: EventEmitter2,
  ) {}

  /** Finds the job waiting for payment behind a pickup code. */
  async findByPickupCode(pickupCode: string): Promise<{ jobId: string; amountMillimes: number }> {
    const job = await this.prisma.printJob.findUnique({
      where: { activePickupCode: pickupCode },
      select: { id: true, status: true, priceMillimes: true },
    });
    if (!job || job.status !== JobStatus.AWAITING_PAYMENT || job.priceMillimes === null) {
      throw notFound();
    }
    return { jobId: job.id, amountMillimes: job.priceMillimes };
  }

  /** Records the cash payment and marks the job PAID. Coins already in the machine are given back. */
  async confirm(
    pickupCode: string,
    adminId: string,
  ): Promise<{ jobId: string; amountMillimes: number }> {
    const { jobId, amountMillimes } = await this.findByPickupCode(pickupCode);
    await this.coins.releaseForJob(jobId);

    const kioskId = await this.prisma.$transaction(async (tx) => {
      const payment = await this.providers
        .get(PaymentProvider.COUNTER)
        .createPayment(tx, { jobId, amountMillimes });
      await this.payments.completePayment(tx, {
        jobId,
        paymentId: payment.id,
        provider: PaymentProvider.COUNTER,
        actor: `admin:${adminId}`,
        confirmedById: adminId,
      });
      const job = await tx.printJob.findUniqueOrThrow({
        where: { id: jobId },
        select: { kioskId: true },
      });
      return job.kioskId;
    });

    this.events.emit(DomainEvent.JOB_STATUS_CHANGED, {
      jobId,
      kioskId,
      status: JobStatus.PAID,
    } satisfies JobStatusChangedEvent);
    return { jobId, amountMillimes };
  }
}
