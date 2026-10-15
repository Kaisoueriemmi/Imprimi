import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { Logger } from '../logger';
import { PrintError, type Printer, type PrinterState, type PrintRequest } from './printer';
import {
  isBlockingJobStatus,
  isFinishedJobStatus,
  type RawPrinterInfo,
  toPrinterState,
} from './printer-state';
import {
  parseJsonList,
  PRINT_JOBS_SCRIPT,
  PRINTER_STATE_SCRIPT,
  REMOVE_PRINT_JOBS_SCRIPT,
  runPowerShell,
} from './powershell';
import { buildPrintSettings } from './sumatra-settings';

const execFileAsync = promisify(execFile);

export interface WindowsPrinterTimings {
  /** SumatraPDF must have handed the job to the spooler within this delay. */
  spoolTimeoutMs: number;
  /** The whole print must finish within this delay. */
  completionTimeoutMs: number;
  /** A job blocked (paper out, error…) longer than this fails; an operator can reprint it. */
  blockedTimeoutMs: number;
  pollIntervalMs: number;
}

const DEFAULT_TIMINGS: WindowsPrinterTimings = {
  spoolTimeoutMs: 120_000,
  completionTimeoutMs: 10 * 60_000,
  blockedTimeoutMs: 3 * 60_000,
  pollIntervalMs: 2_000,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Production printer: SumatraPDF in silent CLI mode hands the PDF to the Windows spooler, then
 * the spooler queue is polled (Get-PrintJob) until the job has left it.
 */
export class WindowsSumatraPrinter implements Printer {
  private readonly timings: WindowsPrinterTimings;

  constructor(
    private readonly printerName: string,
    private readonly sumatraPath: () => Promise<string>,
    private readonly logger: Logger,
    timings: Partial<WindowsPrinterTimings> = {},
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  async print(request: PrintRequest): Promise<void> {
    const sumatra = await this.sumatraPath();
    const args = [
      '-print-to',
      this.printerName,
      '-print-settings',
      buildPrintSettings(request),
      '-silent',
      '-exit-on-print',
      request.pdfPath,
    ];
    try {
      await execFileAsync(sumatra, args, {
        timeout: this.timings.spoolTimeoutMs,
        windowsHide: true,
      });
    } catch (error) {
      throw new PrintError(
        'PRINTER_ERROR',
        `SumatraPDF failed: ${(error as Error).message.slice(0, 200)}`,
      );
    }
    await this.waitUntilPrinted(basename(request.pdfPath), request.jobId);
  }

  async state(): Promise<PrinterState> {
    try {
      const stdout = await runPowerShell(PRINTER_STATE_SCRIPT, {
        env: { PB_PRINTER: this.printerName },
      });
      return toPrinterState(parseJsonList<RawPrinterInfo>(stdout)[0], this.printerName);
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not read printer state');
      return toPrinterState(undefined, this.printerName);
    }
  }

  /** Polls the spooler until the job is gone (printed), blocked too long, or out of time. */
  private async waitUntilPrinted(documentName: string, jobId: string): Promise<void> {
    const env = { PB_PRINTER: this.printerName, PB_DOCUMENT: documentName };
    const startedAt = Date.now();
    let blockedSince: number | null = null;

    while (Date.now() - startedAt < this.timings.completionTimeoutMs) {
      const jobs = parseJsonList<{ Id: number; Status: string }>(
        await runPowerShell(PRINT_JOBS_SCRIPT, { env }),
      );
      const active = jobs.filter((job) => !isFinishedJobStatus(job.Status ?? ''));
      if (active.length === 0) return;

      if (active.some((job) => isBlockingJobStatus(job.Status ?? ''))) {
        blockedSince ??= Date.now();
        if (Date.now() - blockedSince > this.timings.blockedTimeoutMs) {
          await this.removeFromQueue(env, jobId);
          throw new PrintError('PRINTER_ERROR', `Printer blocked: ${active[0]!.Status}`);
        }
      } else {
        blockedSince = null;
      }
      await sleep(this.timings.pollIntervalMs);
    }
    await this.removeFromQueue(env, jobId);
    throw new PrintError('PRINT_TIMEOUT', 'Print did not finish in time');
  }

  /** A failed job must not come out later by surprise (and would be printed again on reprint). */
  private async removeFromQueue(env: Record<string, string>, jobId: string): Promise<void> {
    try {
      await runPowerShell(REMOVE_PRINT_JOBS_SCRIPT, { env });
    } catch (error) {
      this.logger.error({ jobId, err: error }, 'Could not remove the failed job from the spooler');
    }
  }
}
