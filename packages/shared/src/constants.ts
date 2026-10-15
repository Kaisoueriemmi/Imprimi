import { ColorMode } from './enums';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Upload limits (Phase 2). */
export const UPLOAD_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxPagesPerJob: 50,
  /** Detected by magic bytes, never by extension. */
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
} as const;
export type AllowedMimeType = (typeof UPLOAD_LIMITS.allowedMimeTypes)[number];

/** Print option bounds (Phase 3). */
export const PRINT_LIMITS = {
  minCopies: 1,
  maxCopies: 20,
} as const;

export const DEFAULT_COLOR_MODE = ColorMode.BW;

/** Pickup code shown to the customer and typed at the counter. */
export const PICKUP_CODE_LENGTH = 6;

/** Time-based rules, in milliseconds. */
export const TIMINGS = {
  /** Lifetime of a signed QR token. */
  qrTokenTtlMs: 90 * SECOND,
  /** The kiosk screen asks for a new QR token this often (< TTL so a displayed QR is always valid). */
  qrRefreshIntervalMs: 60 * SECOND,
  agentHeartbeatIntervalMs: 15 * SECOND,
  /** A kiosk with no heartbeat for this long is considered OFFLINE and triggers an alert. */
  kioskOfflineAfterMs: 2 * MINUTE,
  /** An unpaid job becomes EXPIRED after this delay. */
  unpaidJobExpiryMs: 30 * MINUTE,
  /** Safety net: any stored file older than this is purged whatever the job status. */
  fileMaxRetentionMs: 2 * 60 * MINUTE,
  /** Lifetime of the pre-signed URL the agent downloads the PDF from. */
  presignedDownloadTtlMs: 2 * MINUTE,
} as const;
