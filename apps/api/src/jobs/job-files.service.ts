import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { prefixOf, StorageService, storageKeys } from '../storage/storage.service';

/** Deletes the stored objects of a job and marks its files `deletedAt`. */
@Injectable()
export class JobFilesService {
  private readonly logger = new Logger(JobFilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Never throws: on a storage failure the files keep `deletedAt = null`, so the periodic
   * retention purge (Phase 8) tries again.
   */
  async deleteJobFiles(jobId: string): Promise<void> {
    const files = await this.prisma.jobFile.findMany({
      where: { jobId, deletedAt: null },
      select: { id: true, storageKey: true },
    });
    for (const file of files) {
      const keys = storageKeys(prefixOf(file.storageKey));
      try {
        await this.storage.delete([...new Set([file.storageKey, keys.pdf, keys.thumbnail])]);
        await this.prisma.jobFile.update({
          where: { id: file.id },
          data: { deletedAt: new Date() },
        });
      } catch (error) {
        this.logger.error({ jobId, err: error }, 'Could not delete job files, purge will retry');
      }
    }
  }
}
