import { JobStatus } from './enums';

/**
 * Allowed print-job transitions. Anything not listed is rejected.
 *
 *   UPLOADED → AWAITING_PAYMENT → PAID → QUEUED → PRINTING → PRINTED
 *
 * with FAILED / CANCELLED / EXPIRED branching off where it makes sense.
 */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  // FAILED here = the file could not be converted to PDF.
  UPLOADED: [JobStatus.AWAITING_PAYMENT, JobStatus.FAILED, JobStatus.CANCELLED, JobStatus.EXPIRED],
  AWAITING_PAYMENT: [JobStatus.PAID, JobStatus.CANCELLED, JobStatus.EXPIRED],
  PAID: [JobStatus.QUEUED, JobStatus.FAILED, JobStatus.CANCELLED],
  QUEUED: [JobStatus.PRINTING, JobStatus.FAILED, JobStatus.CANCELLED],
  PRINTING: [JobStatus.PRINTED, JobStatus.FAILED],
  // A failed job may be re-printed (back to QUEUED) or refunded/cancelled by an admin.
  FAILED: [JobStatus.QUEUED, JobStatus.CANCELLED],
  PRINTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/** Statuses during which a job holds an active pickup code. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  JobStatus.UPLOADED,
  JobStatus.AWAITING_PAYMENT,
  JobStatus.PAID,
  JobStatus.QUEUED,
  JobStatus.PRINTING,
];

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  JobStatus.PRINTED,
  JobStatus.CANCELLED,
  JobStatus.EXPIRED,
];

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export class InvalidJobTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Invalid job transition ${from} -> ${to}`);
    this.name = 'InvalidJobTransitionError';
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new InvalidJobTransitionError(from, to);
}

export function isActiveJobStatus(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status);
}
