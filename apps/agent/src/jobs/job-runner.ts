import { AgentEvent, type JobDispatch, type JobFailureReason } from '@printbox/shared';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../logger';
import { PrintError, type Printer } from '../printing/printer';
import type { AgentLedger } from '../state/ledger';
import { downloadPdf } from './download';

/** Persists a message for the server (outbox) and triggers its delivery. */
export interface Reporter {
  report(event: string, payload: unknown): Promise<void>;
}

interface LocalJob {
  dispatch: JobDispatch;
  pdfPath: string;
}

/**
 * Local print queue: jobs are downloaded as soon as they arrive (the pre-signed URL is short-
 * lived) and printed one at a time, in arrival order. The local PDF is deleted in every case.
 */
export class JobRunner {
  private readonly queue: LocalJob[] = [];
  /** Jobs received and not finished yet (downloading, queued or printing). */
  private readonly inProgress = new Set<string>();
  private draining: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      printer: Printer;
      ledger: AgentLedger;
      reporter: Reporter;
      workDir: string;
      logger: Logger;
      download?: (url: string, destination: string) => Promise<void>;
    },
  ) {}

  /** Jobs waiting locally, reported in the heartbeat. */
  get size(): number {
    return this.inProgress.size;
  }

  /**
   * Jobs left "started" by a crash are reported as failed instead of being printed again: a
   * second copy would have to be paid for, a failed job can be reprinted by an operator.
   */
  async recoverInterrupted(): Promise<void> {
    for (const jobId of this.deps.ledger.interruptedJobs()) {
      this.deps.logger.warn({ jobId }, 'Job was interrupted by a restart, reporting it as failed');
      await this.deps.ledger.markFailed(jobId);
      await this.fail(jobId, 'INTERRUPTED', 'agent restarted while printing');
    }
  }

  /** Handles `job:dispatch`; safe to call several times for the same job. */
  async receive(dispatch: JobDispatch): Promise<void> {
    const { jobId } = dispatch;
    await this.deps.reporter.report(AgentEvent.JOB_ACK, { jobId });

    if (this.deps.ledger.isPrinted(jobId)) {
      // Our "printed" report was lost or the server resent the job: never print twice.
      await this.deps.reporter.report(AgentEvent.JOB_PRINTED, { jobId });
      return;
    }
    if (this.deps.ledger.isStarted(jobId)) {
      await this.fail(jobId, 'INTERRUPTED', 'job was being printed when the agent stopped');
      return;
    }
    if (this.inProgress.has(jobId)) return;
    this.inProgress.add(jobId);

    const pdfPath = join(this.deps.workDir, `printbox-${jobId}.pdf`);
    try {
      await (this.deps.download ?? downloadPdf)(dispatch.downloadUrl, pdfPath);
    } catch (error) {
      this.inProgress.delete(jobId);
      await rm(pdfPath, { force: true });
      await this.fail(jobId, 'DOWNLOAD_FAILED', (error as Error).message);
      return;
    }
    this.queue.push({ dispatch, pdfPath });
    void this.drain();
  }

  /** Resolves once the queue is empty (tests, graceful shutdown). */
  async idle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private drain(): Promise<void> {
    this.draining ??= (async () => {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        await this.process(job);
        this.inProgress.delete(job.dispatch.jobId);
      }
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async process({ dispatch, pdfPath }: LocalJob): Promise<void> {
    const { jobId } = dispatch;
    const { ledger, printer, reporter, logger } = this.deps;
    try {
      await ledger.markStarted(jobId);
      await reporter.report(AgentEvent.JOB_PRINTING, { jobId });
      const startedAt = Date.now();
      await printer.print({
        jobId,
        pdfPath,
        copies: dispatch.copies,
        colorMode: dispatch.colorMode,
        duplex: dispatch.duplex,
        pageRange: dispatch.pageRange,
      });
      await ledger.markPrinted(jobId);
      await reporter.report(AgentEvent.JOB_PRINTED, { jobId });
      logger.info({ jobId, durationMs: Date.now() - startedAt }, 'Job printed');
    } catch (error) {
      const reason: JobFailureReason = error instanceof PrintError ? error.reason : 'PRINTER_ERROR';
      await ledger.markFailed(jobId);
      await this.fail(jobId, reason, (error as Error).message);
    } finally {
      await rm(pdfPath, { force: true });
    }
  }

  private async fail(jobId: string, reason: JobFailureReason, detail: string): Promise<void> {
    this.deps.logger.error({ jobId, reason, detail }, 'Job failed');
    await this.deps.reporter.report(AgentEvent.JOB_FAILED, {
      jobId,
      reason,
      detail: detail.slice(0, 500),
    });
  }
}
