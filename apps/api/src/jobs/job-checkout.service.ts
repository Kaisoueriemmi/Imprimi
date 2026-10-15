import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConversionStatus, JobStatus, PaymentProvider, Prisma } from '@prisma/client';
import {
  ApiErrorCode,
  CheckoutRequest,
  JobView,
  PICKUP_CODE_LENGTH,
  PrintOptions,
} from '@printbox/shared';
import { randomInt } from 'node:crypto';
import { ApiException, notFound } from '../common/api-exception';
import { PrintSessionContext } from '../common/request-context';
import { AppConfigService } from '../config/env';
import { DomainEvent, JobStatusChangedEvent } from '../events/domain-events';
import { CoinPaymentService } from '../payments/coin-payment.service';
import { PaymentProviders } from '../payments/payment-providers';
import { PaymentsService } from '../payments/payments.service';
import { PricingService, Quote } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobFilesService } from './job-files.service';
import { invalidJobState, JobStateService } from './job-state.service';
import { JOB_VIEW_INCLUDE, toJobView } from './job-view';

const MAX_PICKUP_CODE_ATTEMPTS = 10;

type JobForCheckout = Prisma.PrintJobGetPayload<{
  include: { files: true; kiosk: { select: { supportsColor: true; supportsDuplex: true } } };
}>;

function isPickupCodeCollision(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    JSON.stringify(error.meta ?? {}).includes('activePickupCode')
  );
}

/** Uniformly random 6-digit code, leading zeros kept. */
export function generatePickupCode(): string {
  return String(randomInt(0, 10 ** PICKUP_CODE_LENGTH)).padStart(PICKUP_CODE_LENGTH, '0');
}

/** Options and price, checkout (pickup code, price frozen) and cancellation, for the customer. */
@Injectable()
export class JobCheckoutService {
  private readonly freeMode: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly jobState: JobStateService,
    private readonly jobFiles: JobFilesService,
    private readonly providers: PaymentProviders,
    private readonly payments: PaymentsService,
    private readonly coins: CoinPaymentService,
    private readonly events: EventEmitter2,
    @Inject(ConfigService) env: AppConfigService,
  ) {
    this.freeMode = env.get('PAYMENT_FREE_MODE', { infer: true });
  }

  /** Changes the print options; the price is recomputed server-side every time. */
  async updateOptions(
    session: PrintSessionContext,
    jobId: string,
    options: PrintOptions,
  ): Promise<JobView> {
    const job = await this.loadOwnJob(session, jobId);
    if (job.status !== JobStatus.UPLOADED) throw invalidJobState();
    const quote = await this.quote(job, options);

    const updated = await this.prisma.printJob.updateMany({
      where: { id: job.id, status: JobStatus.UPLOADED },
      data: {
        copies: options.copies,
        colorMode: options.colorMode,
        duplex: options.duplex,
        pageRange: quote.pageRange,
        totalPages: quote.totalPages,
        priceMillimes: quote.priceMillimes,
      },
    });
    if (updated.count === 0) throw invalidJobState();
    return this.view(job.id);
  }

  /**
   * UPLOADED → AWAITING_PAYMENT: the price is recomputed with today's tariffs and frozen, and a
   * pickup code unique among active jobs is issued. FREE (demo only) pays at once.
   */
  async checkout(
    session: PrintSessionContext,
    jobId: string,
    request: CheckoutRequest,
  ): Promise<JobView> {
    if (request.method === 'FREE' && !this.freeMode) {
      throw new ApiException(
        400,
        ApiErrorCode.PAYMENT_METHOD_UNAVAILABLE,
        'Moyen de paiement indisponible',
      );
    }
    const job = await this.loadOwnJob(session, jobId);
    if (job.status !== JobStatus.UPLOADED) throw invalidJobState();
    const quote = await this.quote(job, {
      copies: job.copies,
      colorMode: job.colorMode,
      duplex: job.duplex,
      pageRange: job.pageRange,
    });

    for (let attempt = 1; ; attempt++) {
      const pickupCode = generatePickupCode();
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.jobState.transition(
            {
              jobId: job.id,
              from: [JobStatus.UPLOADED],
              to: JobStatus.AWAITING_PAYMENT,
              data: {
                pickupCode,
                activePickupCode: pickupCode,
                pageRange: quote.pageRange,
                totalPages: quote.totalPages,
                priceMillimes: quote.priceMillimes,
              },
              actor: `session:${session.id}`,
              action: 'job.checkout',
              metadata: { method: request.method, priceMillimes: quote.priceMillimes },
            },
            tx,
          );
          if (request.method === 'FREE') {
            const payment = await this.providers
              .get(PaymentProvider.FREE)
              .createPayment(tx, { jobId: job.id, amountMillimes: quote.priceMillimes });
            await this.payments.completePayment(tx, {
              jobId: job.id,
              paymentId: payment.id,
              provider: PaymentProvider.FREE,
              actor: `session:${session.id}`,
            });
          }
        });
        break;
      } catch (error) {
        if (isPickupCodeCollision(error) && attempt < MAX_PICKUP_CODE_ATTEMPTS) continue;
        throw error;
      }
    }

    this.emitStatus(
      job.id,
      job.kioskId,
      request.method === 'FREE' ? JobStatus.PAID : JobStatus.AWAITING_PAYMENT,
    );
    return this.view(job.id);
  }

  /** The customer abandons a job before it is paid: files are deleted right away. */
  async cancel(session: PrintSessionContext, jobId: string): Promise<JobView> {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, sessionId: session.id },
      select: { id: true, kioskId: true },
    });
    if (!job) throw notFound();
    await this.coins.releaseForJob(job.id);
    await this.jobState.transition({
      jobId: job.id,
      from: [JobStatus.UPLOADED, JobStatus.AWAITING_PAYMENT],
      to: JobStatus.CANCELLED,
      actor: `session:${session.id}`,
      action: 'job.cancelled',
    });
    await this.jobFiles.deleteJobFiles(job.id);
    this.emitStatus(job.id, job.kioskId, JobStatus.CANCELLED);
    return this.view(job.id);
  }

  private async loadOwnJob(session: PrintSessionContext, jobId: string): Promise<JobForCheckout> {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, sessionId: session.id },
      include: { files: true, kiosk: { select: { supportsColor: true, supportsDuplex: true } } },
    });
    if (!job) throw notFound();
    return job;
  }

  private async quote(job: JobForCheckout, options: PrintOptions): Promise<Quote> {
    const file = job.files[0];
    if (!file || file.conversionStatus !== ConversionStatus.READY || !file.pageCount) {
      throw new ApiException(
        409,
        ApiErrorCode.JOB_NOT_READY,
        'Le document est encore en préparation',
      );
    }
    if (options.colorMode === 'COLOR' && !job.kiosk.supportsColor) {
      throw new ApiException(
        400,
        ApiErrorCode.OPTION_UNAVAILABLE,
        "L'impression couleur n'est pas disponible sur cette borne",
      );
    }
    if (options.duplex && !job.kiosk.supportsDuplex) {
      throw new ApiException(
        400,
        ApiErrorCode.OPTION_UNAVAILABLE,
        "Le recto-verso n'est pas disponible sur cette borne",
      );
    }
    return this.pricing.quote({ kioskId: job.kioskId, pageCount: file.pageCount, options });
  }

  private async view(jobId: string): Promise<JobView> {
    return toJobView(
      await this.prisma.printJob.findUniqueOrThrow({
        where: { id: jobId },
        include: JOB_VIEW_INCLUDE,
      }),
    );
  }

  private emitStatus(jobId: string, kioskId: string, status: JobStatus): void {
    this.events.emit(DomainEvent.JOB_STATUS_CHANGED, {
      jobId,
      kioskId,
      status,
    } satisfies JobStatusChangedEvent);
  }
}
