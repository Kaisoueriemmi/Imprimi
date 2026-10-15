import { Injectable } from '@nestjs/common';
import { ApiErrorCode, JobView, UPLOAD_LIMITS } from '@printbox/shared';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Readable } from 'node:stream';
import { ApiException, notFound } from '../common/api-exception';
import { PrintSessionContext } from '../common/request-context';
import { ConversionWorker } from '../conversion/conversion.worker';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, storageKeys } from '../storage/storage.service';
import { detectFileType } from './upload/file-type';
import { fileTooLarge, receiveSingleFile } from './upload/receive-upload';
import { JOB_VIEW_INCLUDE, toJobView } from './job-view';

/**
 * Requests slightly over the limit are read (the excess is discarded by the parser) so the phone
 * gets a clean 413 instead of a connection reset. Only clearly abusive sizes are cut immediately.
 */
const ABUSIVE_CONTENT_LENGTH = UPLOAD_LIMITS.maxFileBytes * 4;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly worker: ConversionWorker,
  ) {}

  /** Receives the customer's file, stores it and queues its conversion to PDF. */
  async createFromUpload(session: PrintSessionContext, req: Request): Promise<JobView> {
    const jobsInSession = await this.prisma.printJob.count({ where: { sessionId: session.id } });
    if (jobsInSession >= UPLOAD_LIMITS.maxJobsPerSession) {
      throw new ApiException(
        409,
        ApiErrorCode.TOO_MANY_JOBS,
        'Nombre maximal de documents atteint',
      );
    }

    const declaredLength = Number(req.headers['content-length']);
    if (declaredLength > ABUSIVE_CONTENT_LENGTH) {
      throw fileTooLarge(UPLOAD_LIMITS.maxFileBytes);
    }

    const received = await receiveSingleFile(req, {
      maxBytes: UPLOAD_LIMITS.maxFileBytes,
      directory: tmpdir(),
    });
    try {
      const mimeType = await detectFileType(received.path);
      if (!mimeType) {
        throw new ApiException(
          415,
          ApiErrorCode.UNSUPPORTED_FILE_TYPE,
          'Format non pris en charge (PDF, JPG, PNG ou DOCX)',
        );
      }

      // Random prefix: the key reveals neither the customer nor the file name.
      const keys = storageKeys(`files/${randomUUID()}`);
      await this.storage.putFile(keys.original, received.path, mimeType);
      try {
        const job = await this.prisma.printJob.create({
          data: {
            kioskId: session.kioskId,
            sessionId: session.id,
            files: {
              create: {
                originalName: received.originalName,
                mimeType,
                sizeBytes: received.sizeBytes,
                storageKey: keys.original,
              },
            },
          },
          include: JOB_VIEW_INCLUDE,
        });
        await this.prisma.session.updateMany({
          where: { id: session.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        this.worker.kick();
        return toJobView(job);
      } catch (error) {
        await this.storage.delete([keys.original]).catch(() => undefined);
        throw error;
      }
    } finally {
      await rm(received.path, { force: true });
    }
  }

  async getView(session: PrintSessionContext, jobId: string): Promise<JobView> {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, sessionId: session.id },
      include: JOB_VIEW_INCLUDE,
    });
    if (!job) throw notFound();
    return toJobView(job);
  }

  async thumbnail(session: PrintSessionContext, jobId: string): Promise<Readable> {
    const file = await this.prisma.jobFile.findFirst({
      where: {
        jobId,
        job: { sessionId: session.id },
        deletedAt: null,
        thumbnailStorageKey: { not: null },
      },
      select: { thumbnailStorageKey: true },
    });
    if (!file?.thumbnailStorageKey) throw notFound();
    return this.storage.getStream(file.thumbnailStorageKey);
  }
}
