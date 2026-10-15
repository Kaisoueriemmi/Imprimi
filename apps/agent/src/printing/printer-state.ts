import type { PaperLevel } from '@printbox/shared';
import type { PrinterState } from './printer';

/** One printer as returned by PRINTER_STATE_SCRIPT. */
export interface RawPrinterInfo {
  Name: string;
  Status: string;
  JobCount: number;
  Offline: boolean;
}

const OFFLINE_STATES = new Set(['Offline', 'ServerOffline', 'NotAvailable', 'ServerUnknown']);
const PAPER_OK_STATES = new Set([
  'Normal',
  'Printing',
  'Processing',
  'Busy',
  'IoActive',
  'PowerSave',
]);

/** Windows reports no paper level, only states: this is the best hint we can derive. */
function paperLevelOf(status: string): PaperLevel {
  if (status === 'PaperOut') return 'EMPTY';
  if (status === 'PaperProblem' || status === 'ManualFeed') return 'LOW';
  if (PAPER_OK_STATES.has(status)) return 'OK';
  return 'UNKNOWN';
}

export function toPrinterState(
  raw: RawPrinterInfo | undefined,
  expectedName: string,
): PrinterState {
  if (!raw) {
    return {
      name: expectedName,
      online: false,
      status: 'NotFound',
      queuedJobs: 0,
      paperLevel: 'UNKNOWN',
    };
  }
  return {
    name: raw.Name,
    online: !raw.Offline && !OFFLINE_STATES.has(raw.Status),
    status: raw.Status,
    queuedJobs: Math.max(0, Math.trunc(raw.JobCount)),
    paperLevel: paperLevelOf(raw.Status),
  };
}

/** Spooler job states that mean the printer needs someone. */
const BLOCKING_JOB_STATES = ['Error', 'Offline', 'PaperOut', 'Blocked', 'UserIntervention'];

export function isBlockingJobStatus(status: string): boolean {
  return BLOCKING_JOB_STATES.some((state) => status.includes(state));
}

export function isFinishedJobStatus(status: string): boolean {
  return status.includes('Printed') || status.includes('Completed');
}
