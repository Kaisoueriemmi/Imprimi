import type { JobStatus } from '@printbox/shared';

/**
 * In-process domain events (@nestjs/event-emitter). Emitted after the database commit;
 * the Socket.IO gateways (agent, kiosk screen, customer phone) relay them.
 */
export const DomainEvent = {
  JOB_STATUS_CHANGED: 'job.status-changed',
  /** The coin machine reservation started, received a coin, or ended. */
  COIN_SESSION_UPDATED: 'coin.session-updated',
  /** The kiosk must pay money back: change after payment, or refund of abandoned coins. */
  COIN_CHANGE_DUE: 'coin.change-due',
} as const;

export interface JobStatusChangedEvent {
  jobId: string;
  kioskId: string;
  status: JobStatus;
}

export interface CoinSessionUpdatedEvent {
  kioskId: string;
  jobId: string;
  /** False once the reservation is over (paid, cancelled or lapsed). */
  active: boolean;
  amountDueMillimes: number;
  receivedMillimes: number;
  expiresAt: Date | null;
}

export interface CoinChangeDueEvent {
  kioskId: string;
  /** Idempotence key for the agent; changes with the amount still owed. See changeCommandId. */
  commandId: string;
  /** Null for a coin inserted while nobody was paying. */
  paymentId: string | null;
  amountMillimes: number;
  reason: 'CHANGE' | 'REFUND';
}

/**
 * Command id of a pay-back: one per payment and remaining amount. After a partial pay-back the
 * remaining amount differs, so a resent command for the rest is not mistaken for a duplicate.
 */
export function changeCommandId(
  reason: CoinChangeDueEvent['reason'],
  paymentId: string,
  remainingMillimes: number,
): string {
  return `${reason.toLowerCase()}:${paymentId}:${remainingMillimes}`;
}

/** Command id of the refund of a coin inserted while nobody was paying. */
export function orphanCoinCommandId(coinEventId: string): string {
  return `orphan:${coinEventId}`;
}
