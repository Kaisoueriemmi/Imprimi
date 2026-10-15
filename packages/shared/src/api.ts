import { z } from 'zod';
import { ConversionStatus, PaymentProvider, PaymentStatus } from './enums';
import { colorModeSchema, idSchema, jobStatusSchema } from './schemas';

/** Machine-readable error codes. The web app translates them; `message` is a French fallback. */
export const ApiErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  /** The QR token is expired, forged or already used too many times: rescan the kiosk. */
  QR_EXPIRED: 'QR_EXPIRED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TOO_MANY_JOBS: 'TOO_MANY_JOBS',
  FILE_MISSING: 'FILE_MISSING',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  /** The file is still being converted, or its conversion failed. */
  JOB_NOT_READY: 'JOB_NOT_READY',
  /** The action is not allowed in the job's current status (e.g. options after checkout). */
  INVALID_JOB_STATE: 'INVALID_JOB_STATE',
  INVALID_PAGE_RANGE: 'INVALID_PAGE_RANGE',
  /** Colour or duplex requested on a kiosk that cannot do it. */
  OPTION_UNAVAILABLE: 'OPTION_UNAVAILABLE',
  PRICING_UNAVAILABLE: 'PRICING_UNAVAILABLE',
  PAYMENT_METHOD_UNAVAILABLE: 'PAYMENT_METHOD_UNAVAILABLE',
  /** Another customer is paying at the coin machine right now. */
  KIOSK_BUSY: 'KIOSK_BUSY',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: z.enum(ApiErrorCode),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Reasons a conversion fails, stored in `PrintJob.errorMessage` as a code. */
export const ConversionErrorCode = {
  TOO_MANY_PAGES: 'TOO_MANY_PAGES',
  PDF_ENCRYPTED: 'PDF_ENCRYPTED',
  CORRUPTED_FILE: 'CORRUPTED_FILE',
  CONVERSION_FAILED: 'CONVERSION_FAILED',
} as const;
export type ConversionErrorCode = (typeof ConversionErrorCode)[keyof typeof ConversionErrorCode];

// --- Kiosk screen -----------------------------------------------------------------------------

/** `POST /api/kiosks/:kioskId/qr-token` (authenticated with the kiosk display key). */
export const qrTokenResponseSchema = z.object({
  token: z.string(),
  /** What the QR code encodes: `<web>/k/<kioskId>?t=<token>`. */
  url: z.url(),
  expiresAt: z.iso.datetime(),
  /** Ask for a new token after this delay. */
  refreshInMs: z.number().int().positive(),
});
export type QrTokenResponse = z.infer<typeof qrTokenResponseSchema>;

// --- Customer session -------------------------------------------------------------------------

/** `POST /api/sessions`: exchanges the QR token for a customer session. */
export const createSessionRequestSchema = z.object({
  kioskId: idSchema,
  token: z.string().min(1).max(2048),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const sessionResponseSchema = z.object({
  sessionId: idSchema,
  /** Bearer token for every following call of this customer. */
  sessionToken: z.string(),
  expiresAt: z.iso.datetime(),
  kiosk: z.object({
    id: idSchema,
    name: z.string(),
    supportsColor: z.boolean(),
    supportsDuplex: z.boolean(),
  }),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// --- Print jobs -------------------------------------------------------------------------------

export const conversionStatusSchema = z.enum(ConversionStatus);
export const paymentProviderSchema = z.enum(PaymentProvider);
export const paymentStatusSchema = z.enum(PaymentStatus);

export const paymentViewSchema = z.object({
  id: idSchema,
  provider: paymentProviderSchema,
  status: paymentStatusSchema,
  amountMillimes: z.number().int().nonnegative(),
  /** Coins inserted so far (coin payments). */
  receivedMillimes: z.number().int().nonnegative(),
  /** Money owed back to the customer: change, or a refund when a coin payment is abandoned. */
  changeDueMillimes: z.number().int().nonnegative(),
  changeDispensedMillimes: z.number().int().nonnegative(),
});
export type PaymentView = z.infer<typeof paymentViewSchema>;

/** What the customer sees of a job. `POST /api/jobs` (multipart, field `file`) and `GET /api/jobs/:id`. */
export const jobViewSchema = z.object({
  id: idSchema,
  status: jobStatusSchema,
  conversionStatus: conversionStatusSchema,
  file: z.object({
    originalName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    pageCount: z.number().int().positive().nullable(),
  }),
  /** `GET /api/jobs/:id/thumbnail` returns a WebP of page 1 when true. */
  hasThumbnail: z.boolean(),
  copies: z.number().int().positive(),
  colorMode: colorModeSchema,
  duplex: z.boolean(),
  /** Normalised page selection (`"1-3,5"`); null = every page. */
  pageRange: z.string().nullable(),
  /** Pages that will come out of the printer: selected pages × copies. */
  totalPages: z.number().int().nonnegative().nullable(),
  /** Server-computed price; null until the file is converted. */
  priceMillimes: z.number().int().nonnegative().nullable(),
  /** 6-digit code, set at checkout: shown big on the phone, typed at the counter. */
  pickupCode: z.string().nullable(),
  /** Latest payment attempt. */
  payment: paymentViewSchema.nullable(),
  /** A `ConversionErrorCode` when the job failed during conversion. */
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type JobView = z.infer<typeof jobViewSchema>;

/**
 * `POST /api/jobs/:id/checkout`: freezes options and price, issues the pickup code
 * (UPLOADED → AWAITING_PAYMENT). FREE completes the payment at once (demo mode only).
 */
export const checkoutRequestSchema = z.object({
  method: z.enum(['COIN', 'COUNTER', 'FREE']),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/**
 * `POST /api/jobs/:id/coin-payment`: reserves the kiosk coin machine for this job.
 * Polled (and pushed over Socket.IO later) while the customer inserts coins.
 */
export const coinSessionViewSchema = z.object({
  jobId: idSchema,
  amountDueMillimes: z.number().int().nonnegative(),
  receivedMillimes: z.number().int().nonnegative(),
  /** The reservation lapses then (extended by each coin); inserted coins are given back. */
  expiresAt: z.iso.datetime(),
  /** PAID once enough coins were inserted. */
  jobStatus: jobStatusSchema,
  changeDueMillimes: z.number().int().nonnegative(),
});
export type CoinSessionView = z.infer<typeof coinSessionViewSchema>;
