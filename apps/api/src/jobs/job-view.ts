import type { JobFile, PrintJob } from '@prisma/client';
import { JobView } from '@printbox/shared';

/** Customer-facing projection of a job (one file per job). */
export function toJobView(job: PrintJob & { files: JobFile[] }): JobView {
  const file = job.files[0];
  if (!file) throw new Error(`Job ${job.id} has no file`);
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
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
  };
}
