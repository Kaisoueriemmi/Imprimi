import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { JobStatus } from '@prisma/client';
import { AgentEvent, JobDispatch, JobFailureReason, TIMINGS } from '@printbox/shared';
import { ApiException } from '../common/api-exception';
import { DomainEvent, JobStatusChangedEvent } from '../events/domain-events';
import { JobFilesService } from '../jobs/job-files.service';
import { JobStateService } from '../jobs/job-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AgentConnections } from './agent-connections';

export class UnknownJobError extends Error {
  constructor() {
    super('UNKNOWN_JOB');
  }
}

/**
 * Sends paid jobs to the kiosk agent and applies the status it reports.
 *
 * Every handler is idempotent: the agent retries its reports until acknowledged, and the server
 * resends queued jobs after each reconnection (the agent deduplicates by job id).
 */
@Injectable()
export class AgentJobsService {
  private readonly logger = new Logger(AgentJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobState: JobStateService,
    private readonly jobFiles: JobFilesService,
    private readonly connections: AgentConnections,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent(DomainEvent.JOB_STATUS_CHANGED)
  async onJobStatusChanged(event: JobStatusChangedEvent): Promise<void> {
    if (event.status !== JobStatus.PAID) return;
    try {
      await this.dispatchPending(event.kioskId);
    } catch (error) {
      this.logger.error({ kioskId: event.kioskId, err: error }, 'Dispatch after payment failed');
    }
  }

  /**
   * Sends every job this kiosk still has to print, oldest payment first: PAID jobs become
   * QUEUED; QUEUED and PRINTING ones are sent again (the agent knows what it already did).
   * Does nothing while the agent is offline: it gets everything on `agent:ready`.
   */
  async dispatchPending(kioskId: string): Promise<number> {
    const socket = this.connections.readySocket(kioskId);
    if (!socket) return 0;

    const jobs = await this.prisma.printJob.findMany({
      where: {
        kioskId,
        status: { in: [JobStatus.PAID, JobStatus.QUEUED, JobStatus.PRINTING] },
      },
      include: { files: true },
      orderBy: { paidAt: 'asc' },
    });

    let sent = 0;
    for (const job of jobs) {
      const file = job.files[0];
      if (!file?.pdfStorageKey || file.deletedAt) {
        await this.markFailed(kioskId, job.id, JobFailureReason.INVALID_JOB, 'file missing');
        continue;
      }
      if (job.status === JobStatus.PAID) {
        try {
          await this.jobState.transition({
            jobId: job.id,
            from: [JobStatus.PAID],
            to: JobStatus.QUEUED,
            actor: 'system',
            action: 'job.queued',
          });
          this.emitStatus(job.id, kioskId, JobStatus.QUEUED);
        } catch (error) {
          if (!(error instanceof ApiException)) throw error;
          continue; // changed meanwhile (another dispatch, cancellation)
        }
      }
      const dispatch: JobDispatch = {
        jobId: job.id,
        downloadUrl: await this.storage.presignGet(
          file.pdfStorageKey,
          TIMINGS.presignedDownloadTtlMs / 1000,
        ),
        copies: job.copies,
        colorMode: job.colorMode,
        duplex: job.duplex,
        pageRange: job.pageRange,
      };
      socket.emit(AgentEvent.JOB_DISPATCH, dispatch);
      sent += 1;
    }
    return sent;
  }

  async markPrinting(kioskId: string, jobId: string): Promise<void> {
    const status = await this.currentStatus(kioskId, jobId);
    if (status === JobStatus.PRINTING || status === JobStatus.PRINTED) return;
    await this.jobState.transition({
      jobId,
      from: [JobStatus.QUEUED],
      to: JobStatus.PRINTING,
      actor: `agent:${kioskId}`,
      action: 'job.printing',
    });
    this.emitStatus(jobId, kioskId, JobStatus.PRINTING);
  }

  /** The printer finished: job PRINTED and its files deleted right away. */
  async markPrinted(kioskId: string, jobId: string): Promise<void> {
    const status = await this.currentStatus(kioskId, jobId);
    if (status !== JobStatus.PRINTED) {
      // `job:printing` may have been lost: QUEUED → PRINTING → PRINTED keeps the state machine.
      if (status === JobStatus.QUEUED) await this.markPrinting(kioskId, jobId);
      await this.jobState.transition({
        jobId,
        from: [JobStatus.PRINTING],
        to: JobStatus.PRINTED,
        data: { printedAt: new Date() },
        actor: `agent:${kioskId}`,
        action: 'job.printed',
      });
      this.emitStatus(jobId, kioskId, JobStatus.PRINTED);
    }
    await this.jobFiles.deleteJobFiles(jobId);
  }

  /** Files are kept: an operator may reprint a FAILED job (or refund it). */
  async markFailed(
    kioskId: string,
    jobId: string,
    reason: JobFailureReason,
    detail?: string,
  ): Promise<void> {
    const status = await this.currentStatus(kioskId, jobId);
    if (status === JobStatus.FAILED || status === JobStatus.PRINTED) return;
    await this.jobState.transition({
      jobId,
      from: [JobStatus.PAID, JobStatus.QUEUED, JobStatus.PRINTING],
      to: JobStatus.FAILED,
      data: { errorMessage: reason },
      actor: `agent:${kioskId}`,
      action: 'job.failed',
      metadata: { reason, detail: detail?.slice(0, 500) ?? null },
    });
    this.logger.warn({ kioskId, jobId, reason }, 'Print job failed');
    this.emitStatus(jobId, kioskId, JobStatus.FAILED);
  }

  /** An agent may only report on its own kiosk's jobs. */
  private async currentStatus(kioskId: string, jobId: string): Promise<JobStatus> {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, kioskId },
      select: { status: true },
    });
    if (!job) throw new UnknownJobError();
    return job.status;
  }

  private emitStatus(jobId: string, kioskId: string, status: JobStatus): void {
    this.events.emit(DomainEvent.JOB_STATUS_CHANGED, {
      jobId,
      kioskId,
      status,
    } satisfies JobStatusChangedEvent);
  }
}
