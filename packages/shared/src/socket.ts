import { z } from 'zod';
import { colorModeSchema, idSchema, kioskStatusSchema, paperLevelSchema } from './schemas';

/** Socket.IO namespaces. */
export const SocketNamespace = {
  /** Print agents running on the kiosk PCs (outbound connection from the agent). */
  AGENTS: '/agents',
  /** Customer phones, one room per job id. */
  CLIENTS: '/clients',
  /** Kiosk screens. */
  KIOSKS: '/kiosks',
} as const;

/** Event names. The payload schemas below are the single source of truth for each contract. */
export const AgentEvent = {
  HEARTBEAT: 'agent:heartbeat',
  JOB_DISPATCH: 'job:dispatch',
  JOB_ACK: 'job:ack',
  JOB_PRINTING: 'job:printing',
  JOB_PRINTED: 'job:printed',
  JOB_FAILED: 'job:failed',
} as const;

export const ClientEvent = {
  JOB_STATUS: 'job:status',
} as const;

export const KioskEvent = {
  STATE: 'kiosk:state',
} as const;

export const agentHeartbeatSchema = z.object({
  agentVersion: z.string().max(32),
  printer: z.object({
    name: z.string().max(200),
    online: z.boolean(),
    /** Raw Windows printer status (Get-Printer PrinterStatus), e.g. "Normal", "PaperOut". */
    status: z.string().max(100),
    queuedJobs: z.number().int().nonnegative(),
    paperLevel: paperLevelSchema,
  }),
  diskFreeBytes: z.number().int().nonnegative(),
});
export type AgentHeartbeat = z.infer<typeof agentHeartbeatSchema>;

/** Server → agent: a paid job to print. */
export const jobDispatchSchema = z.object({
  jobId: idSchema,
  /** Pre-signed URL, valid ~2 min. */
  downloadUrl: z.url(),
  copies: z.number().int().positive(),
  colorMode: colorModeSchema,
  duplex: z.boolean(),
  /** SumatraPDF page selection, e.g. `"1-3,5"`; `null` = all pages. */
  pageRange: z.string().nullable(),
});
export type JobDispatch = z.infer<typeof jobDispatchSchema>;

export const jobRefSchema = z.object({ jobId: idSchema });
export type JobRef = z.infer<typeof jobRefSchema>;

export const jobFailedSchema = z.object({
  jobId: idSchema,
  reason: z.string().max(500),
});
export type JobFailed = z.infer<typeof jobFailedSchema>;

/** Server → kiosk screen. */
export const kioskStateSchema = z.object({
  kioskId: idSchema,
  status: kioskStatusSchema,
  printerOnline: z.boolean(),
  queueLength: z.number().int().nonnegative(),
});
export type KioskState = z.infer<typeof kioskStateSchema>;
