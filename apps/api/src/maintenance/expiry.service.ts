import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JobStatus } from '@prisma/client';
import { TIMINGS } from '@printbox/shared';
import { ApiException } from '../common/api-exception';
import { AppConfigService } from '../config/env';
import { DomainEvent, JobStatusChangedEvent } from '../events/domain-events';
import { JobFilesService } from '../jobs/job-files.service';
import { JobStateService } from '../jobs/job-state.service';
import { CoinPaymentService } from '../payments/coin-payment.service';
import { PrismaService } from '../prisma/prisma.service';

const RUN_INTERVAL_MS = 60_000;
const BATCH_SIZE = 100;

/**
 * Every minute: ends lapsed coin machine reservations (coins refunded), then expires jobs left
 * unpaid for 30 minutes and deletes their files. Every step is idempotent (compare-and-set),
 * so a second instance running it at the same time does no harm.
 */
@Injectable()
export class ExpiryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryService.name);
  private readonly enabled: boolean;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly coins: CoinPaymentService,
    private readonly jobState: JobStateService,
    private readonly jobFiles: JobFilesService,
    private readonly events: EventEmitter2,
    @Inject(ConfigService) env: AppConfigService,
  ) {
    this.enabled = env.get('SCHEDULER_ENABLED', { infer: true });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.runOnce(), RUN_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.coins.expireLapsed(now);
      await this.expireUnpaidJobs(now);
    } catch (error) {
      this.logger.error({ err: error }, 'Expiry run failed');
    } finally {
      this.running = false;
    }
  }

  /** UPLOADED / AWAITING_PAYMENT jobs older than 30 min → EXPIRED, files deleted. */
  async expireUnpaidJobs(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - TIMINGS.unpaidJobExpiryMs);
    const jobs = await this.prisma.printJob.findMany({
      where: {
        status: { in: [JobStatus.UPLOADED, JobStatus.AWAITING_PAYMENT] },
        createdAt: { lt: cutoff },
      },
      select: { id: true, kioskId: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    let expired = 0;
    for (const job of jobs) {
      // A customer inserting coins right now is not abandoning the job.
      const paying = await this.prisma.kiosk.count({ where: { paymentJobId: job.id } });
      if (paying > 0) continue;
      try {
        await this.jobState.transition({
          jobId: job.id,
          from: [JobStatus.UPLOADED, JobStatus.AWAITING_PAYMENT],
          to: JobStatus.EXPIRED,
          actor: 'system',
          action: 'job.expired',
        });
      } catch (error) {
        if (error instanceof ApiException) continue; // changed meanwhile (paid, cancelled)
        throw error;
      }
      await this.jobFiles.deleteJobFiles(job.id);
      this.events.emit(DomainEvent.JOB_STATUS_CHANGED, {
        jobId: job.id,
        kioskId: job.kioskId,
        status: JobStatus.EXPIRED,
      } satisfies JobStatusChangedEvent);
      expired += 1;
    }
    if (expired > 0) this.logger.log({ expired }, 'Unpaid jobs expired');
    return expired;
  }
}
