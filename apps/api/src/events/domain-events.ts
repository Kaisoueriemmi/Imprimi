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
  /** Null for a coin inserted while nobody was paying. */
  paymentId: string | null;
  amountMillimes: number;
  reason: 'CHANGE' | 'REFUND';
}
