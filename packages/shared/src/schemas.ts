import { z } from 'zod';
import { PRINT_LIMITS } from './constants';
import { ColorMode, JobStatus, KioskStatus, PaperLevel } from './enums';

export const colorModeSchema = z.enum(ColorMode);
export const jobStatusSchema = z.enum(JobStatus);
export const kioskStatusSchema = z.enum(KioskStatus);
export const paperLevelSchema = z.enum(PaperLevel);

export const idSchema = z.string().min(1).max(64);

/** Options chosen by the customer. The price is always computed server-side from these. */
export const printOptionsSchema = z.object({
  copies: z.number().int().min(PRINT_LIMITS.minCopies).max(PRINT_LIMITS.maxCopies),
  colorMode: colorModeSchema,
  duplex: z.boolean(),
  /** e.g. `"1-3,5"`; `null` = every page. Parsed and bounded server-side. */
  pageRange: z.string().trim().max(100).nullable(),
});
export type PrintOptions = z.infer<typeof printOptionsSchema>;
