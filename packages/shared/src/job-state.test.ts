import { describe, expect, it } from 'vitest';
import { JobStatus } from './enums';
import {
  assertTransition,
  canTransition,
  InvalidJobTransitionError,
  JOB_TRANSITIONS,
  TERMINAL_JOB_STATUSES,
} from './job-state';

describe('job state machine', () => {
  it('allows the happy path', () => {
    const path: JobStatus[] = [
      JobStatus.UPLOADED,
      JobStatus.AWAITING_PAYMENT,
      JobStatus.PAID,
      JobStatus.QUEUED,
      JobStatus.PRINTING,
      JobStatus.PRINTED,
    ];
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    }
  });

  it('never leaves a terminal status', () => {
    for (const from of TERMINAL_JOB_STATUSES) {
      expect(JOB_TRANSITIONS[from]).toEqual([]);
    }
  });

  it.each([
    [JobStatus.AWAITING_PAYMENT, JobStatus.PRINTING],
    [JobStatus.UPLOADED, JobStatus.PAID],
    [JobStatus.PRINTED, JobStatus.QUEUED],
    [JobStatus.PRINTING, JobStatus.CANCELLED],
    [JobStatus.EXPIRED, JobStatus.PAID],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidJobTransitionError);
  });

  it('allows re-printing a failed job', () => {
    expect(canTransition(JobStatus.FAILED, JobStatus.QUEUED)).toBe(true);
  });
});
