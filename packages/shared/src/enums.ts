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
  COUNTER: 'COUNTER',
  KONNECT: 'KONNECT',
  FLOUCI: 'FLOUCI',
  FREE: 'FREE',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

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
