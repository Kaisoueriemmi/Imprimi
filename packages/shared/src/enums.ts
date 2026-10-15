/**
 * Domain enums. The values MUST stay identical to the Prisma enums in
 * apps/api/prisma/schema.prisma (a test in apps/api enforces it).
 */

export const KioskStatus = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  ERROR: 'ERROR',
} as const;
export type KioskStatus = (typeof KioskStatus)[keyof typeof KioskStatus];

export const PaperLevel = {
  UNKNOWN: 'UNKNOWN',
  OK: 'OK',
  LOW: 'LOW',
  EMPTY: 'EMPTY',
} as const;
export type PaperLevel = (typeof PaperLevel)[keyof typeof PaperLevel];

export const ColorMode = {
  BW: 'BW',
  COLOR: 'COLOR',
} as const;
export type ColorMode = (typeof ColorMode)[keyof typeof ColorMode];

export const JobStatus = {
  UPLOADED: 'UPLOADED',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PAID: 'PAID',
  QUEUED: 'QUEUED',
  PRINTING: 'PRINTING',
  PRINTED: 'PRINTED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/** Normalisation of an uploaded file into a printable PDF. */
export const ConversionStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type ConversionStatus = (typeof ConversionStatus)[keyof typeof ConversionStatus];

export const PaymentProvider = {
  /** Coin machine at the kiosk (gives change). Main method. */
  COIN: 'COIN',
  /** Paid at the counter, confirmed by an operator. Fallback. */
  COUNTER: 'COUNTER',
  KONNECT: 'KONNECT',
  FLOUCI: 'FLOUCI',
  FREE: 'FREE',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

/** What the kiosk agent reports about coins. */
export const CoinEventKind = {
  /** A coin was accepted by the coin validator. */
  INSERTED: 'INSERTED',
  /** The hopper paid a coin back (change or refund). */
  DISPENSED: 'DISPENSED',
} as const;
export type CoinEventKind = (typeof CoinEventKind)[keyof typeof CoinEventKind];

export const PaymentStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const AdminRole = {
  OWNER: 'OWNER',
  OPERATOR: 'OPERATOR',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];
