import { Prisma } from '@prisma/client';
import { JobView } from '@printbox/shared';

/** Relations every customer-facing read loads. */
export const JOB_VIEW_INCLUDE = {
  files: true,
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.PrintJobInclude;

export type JobWithViewRelations = Prisma.PrintJobGetPayload<{ include: typeof JOB_VIEW_INCLUDE }>;

/** Customer-facing projection of a job (one file per job, latest payment attempt). */
export function toJobView(job: JobWithViewRelations): JobView {
  const file = job.files[0];
  if (!file) throw new Error(`Job ${job.id} has no file`);
  const payment = job.payments[0];
  return {
    id: job.id,
    status: job.status,
    conversionStatus: file.conversionStatus,
    file: {
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      pageCount: file.pageCount,
    },
    hasThumbnail: file.thumbnailStorageKey !== null && file.deletedAt === null,
    copies: job.copies,
    colorMode: job.colorMode,
    duplex: job.duplex,
    pageRange: job.pageRange,
    totalPages: job.totalPages,
    priceMillimes: job.priceMillimes,
    pickupCode: job.pickupCode,
    payment: payment
      ? {
          id: payment.id,
          provider: payment.provider,
          status: payment.status,
          amountMillimes: payment.amountMillimes,
          receivedMillimes: payment.receivedMillimes,
          changeDueMillimes: payment.changeDueMillimes,
          changeDispensedMillimes: payment.changeDispensedMillimes,
        }
      : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
  };
}
