import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversionStatus, JobStatus } from '@prisma/client';
import {
  AllowedMimeType,
  canTransition,
  ConversionErrorCode,
  UPLOAD_LIMITS,
} from '@printbox/shared';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfigService } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { prefixOf, StorageService, storageKeys } from '../storage/storage.service';
import { ConversionError } from './conversion-error';
import {
  docxToPdf,
  imageToPdf,
  inspectPdf,
  makeThumbnail,
  normalizeImage,
  renderFirstPage,
} from './converters';

const POLL_INTERVAL_MS = 2_000;
const RECOVERY_INTERVAL_MS = 60_000;
/** A PROCESSING file older than this belongs to a crashed worker. */
const STALE_AFTER_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const MAX_CLAIM_RACES = 5;

interface ClaimedFile {
  id: string;
  jobId: string;
  mimeType: string;
  storageKey: string;
}

interface ConversionResult {
  pageCount: number;
  pdfStorageKey: string;
  thumbnailStorageKey: string | null;
}

/**
 * Turns every uploaded file into a printable PDF, counts its pages and renders a thumbnail.
 *
 * The queue is the JobFile table itself: a file is claimed by an atomic
 * PENDING → PROCESSING update, so several workers (API process in dev, `worker` service in
 * Docker) never convert the same file twice. Files left PROCESSING by a crash are retried.
 */
@Injectable()
export class ConversionWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConversionWorker.name);
  private readonly enabled: boolean;
  private readonly concurrency: number;
  private readonly libreOfficePath: string;
  private readonly pdftoppmPath: string;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly inFlight = new Set<Promise<void>>();
  private filling = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(ConfigService) env: AppConfigService,
  ) {
    this.enabled = env.get('CONVERSION_WORKER_ENABLED', { infer: true });
    this.concurrency = env.get('CONVERSION_CONCURRENCY', { infer: true });
    this.libreOfficePath = env.get('LIBREOFFICE_PATH', { infer: true });
    this.pdftoppmPath = env.get('PDFTOPPM_PATH', { infer: true });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timers.push(setInterval(() => this.kick(), POLL_INTERVAL_MS));
    this.timers.push(setInterval(() => void this.recoverStale(), RECOVERY_INTERVAL_MS));
    this.logger.log(`Conversion worker started (concurrency ${this.concurrency})`);
    void this.recoverStale().then(() => this.kick());
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    await Promise.allSettled([...this.inFlight]);
  }

  /** Starts work immediately instead of waiting for the next poll (called after an upload). */
  kick(): void {
    if (!this.enabled || this.stopped) return;
    void this.fill();
  }

  private async fill(): Promise<void> {
    if (this.filling) return;
    this.filling = true;
    try {
      while (!this.stopped && this.inFlight.size < this.concurrency) {
        const file = await this.claimNext();
        if (!file) break;
        const task = this.process(file).finally(() => {
          this.inFlight.delete(task);
          this.kick();
        });
        this.inFlight.add(task);
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Conversion queue polling failed');
    } finally {
      this.filling = false;
    }
  }

  private async claimNext(): Promise<ClaimedFile | null> {
    for (let race = 0; race < MAX_CLAIM_RACES; race++) {
      const candidate = await this.prisma.jobFile.findFirst({
        where: { conversionStatus: ConversionStatus.PENDING, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!candidate) return null;
      const claimed = await this.prisma.jobFile.updateMany({
        where: { id: candidate.id, conversionStatus: ConversionStatus.PENDING },
        data: {
          conversionStatus: ConversionStatus.PROCESSING,
          conversionStartedAt: new Date(),
          conversionAttempts: { increment: 1 },
        },
      });
      if (claimed.count === 1) {
        return this.prisma.jobFile.findUniqueOrThrow({
          where: { id: candidate.id },
          select: { id: true, jobId: true, mimeType: true, storageKey: true },
        });
      }
      // Another worker took it first: look for the next one.
    }
    return null;
  }

  private async process(file: ClaimedFile): Promise<void> {
    const startedAt = Date.now();
    const workDir = await mkdtemp(join(tmpdir(), 'printbox-conv-'));
    try {
      const result = await this.convert(file, workDir);
      await this.prisma.$transaction(async (tx) => {
        await tx.jobFile.update({
          where: { id: file.id },
          data: {
            conversionStatus: ConversionStatus.READY,
            pdfStorageKey: result.pdfStorageKey,
            thumbnailStorageKey: result.thumbnailStorageKey,
            pageCount: result.pageCount,
          },
        });
        await tx.printJob.updateMany({
          where: { id: file.jobId, status: JobStatus.UPLOADED },
          data: { totalPages: result.pageCount },
        });
      });
      this.logger.log(
        { jobId: file.jobId, pages: result.pageCount, durationMs: Date.now() - startedAt },
        'File converted',
      );
    } catch (error) {
      await this.fail(file, error);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async convert(file: ClaimedFile, workDir: string): Promise<ConversionResult> {
    const keys = storageKeys(prefixOf(file.storageKey));
    const original = await this.storage.getBuffer(file.storageKey);
    const mimeType = file.mimeType as AllowedMimeType;

    let pdfStorageKey = file.storageKey;
    let pageCount: number;
    let preview: Buffer | null = null;

    if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
      const image = await normalizeImage(original, mimeType);
      await this.storage.putBuffer(
        keys.pdf,
        Buffer.from(await imageToPdf(image)),
        'application/pdf',
      );
      pdfStorageKey = keys.pdf;
      pageCount = 1;
      preview = image.data;
    } else if (mimeType === 'application/pdf') {
      const info = await inspectPdf(original);
      this.assertPageLimit(info.pageCount);
      pageCount = info.pageCount;
      const pdfPath = join(workDir, 'document.pdf');
      await writeFile(pdfPath, original);
      preview = await this.tryRenderFirstPage(pdfPath, workDir, file.jobId);
      // A password-protected PDF that Poppler cannot open would not print either.
      if (info.encrypted && !preview && (await this.pdftoppmAvailable(workDir))) {
        throw new ConversionError(ConversionErrorCode.PDF_ENCRYPTED);
      }
    } else {
      const docxPath = join(workDir, 'document.docx');
      await writeFile(docxPath, original);
      const pdfPath = await docxToPdf(docxPath, workDir, this.libreOfficePath);
      const pdf = await readFile(pdfPath);
      pageCount = (await inspectPdf(pdf)).pageCount;
      this.assertPageLimit(pageCount);
      await this.storage.putBuffer(keys.pdf, pdf, 'application/pdf');
      pdfStorageKey = keys.pdf;
      preview = await this.tryRenderFirstPage(pdfPath, workDir, file.jobId);
    }

    this.assertPageLimit(pageCount);
    let thumbnailStorageKey: string | null = null;
    if (preview) {
      await this.storage.putBuffer(keys.thumbnail, await makeThumbnail(preview), 'image/webp');
      thumbnailStorageKey = keys.thumbnail;
    }
    return { pageCount, pdfStorageKey, thumbnailStorageKey };
  }

  private assertPageLimit(pageCount: number): void {
    if (pageCount > UPLOAD_LIMITS.maxPagesPerJob) {
      throw new ConversionError(ConversionErrorCode.TOO_MANY_PAGES);
    }
  }

  /** The thumbnail is a nicety: without Poppler (e.g. a Windows dev machine) we go on without it. */
  private async tryRenderFirstPage(
    pdfPath: string,
    workDir: string,
    jobId: string,
  ): Promise<Buffer | null> {
    try {
      return await renderFirstPage(pdfPath, workDir, this.pdftoppmPath);
    } catch (error) {
      this.logger.warn({ jobId, reason: (error as Error).message.slice(0, 200) }, 'No thumbnail');
      return null;
    }
  }

  private async pdftoppmAvailable(workDir: string): Promise<boolean> {
    try {
      await renderFirstPage(join(workDir, 'missing.pdf'), workDir, this.pdftoppmPath, 5_000);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
  }

  /** Rejects the file: objects deleted, file FAILED, job FAILED with the reason code. */
  private async fail(file: ClaimedFile, error: unknown): Promise<void> {
    const code =
      error instanceof ConversionError ? error.code : ConversionErrorCode.CONVERSION_FAILED;
    if (error instanceof ConversionError) {
      this.logger.warn({ jobId: file.jobId, code, err: error.cause }, 'File rejected');
    } else {
      this.logger.error({ jobId: file.jobId, err: error }, 'Conversion crashed');
    }

    const keys = storageKeys(prefixOf(file.storageKey));
    try {
      await this.storage.delete([...new Set([file.storageKey, keys.pdf, keys.thumbnail])]);
    } catch (deleteError) {
      this.logger.error({ jobId: file.jobId, err: deleteError }, 'Could not delete rejected file');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.jobFile.update({
        where: { id: file.id },
        data: { conversionStatus: ConversionStatus.FAILED, deletedAt: new Date() },
      });
      const job = await tx.printJob.findUnique({
        where: { id: file.jobId },
        select: { status: true },
      });
      if (job && canTransition(job.status, JobStatus.FAILED)) {
        await tx.printJob.update({
          where: { id: file.jobId },
          data: { status: JobStatus.FAILED, errorMessage: code, activePickupCode: null },
        });
      }
    });
  }

  /** Puts files abandoned by a crashed worker back in the queue, or fails them after 3 tries. */
  private async recoverStale(): Promise<void> {
    if (this.stopped) return;
    const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
    try {
      await this.prisma.jobFile.updateMany({
        where: {
          conversionStatus: ConversionStatus.PROCESSING,
          conversionStartedAt: { lt: staleBefore },
          conversionAttempts: { lt: MAX_ATTEMPTS },
        },
        data: { conversionStatus: ConversionStatus.PENDING },
      });
      const exhausted = await this.prisma.jobFile.findMany({
        where: {
          conversionStatus: ConversionStatus.PROCESSING,
          conversionStartedAt: { lt: staleBefore },
          conversionAttempts: { gte: MAX_ATTEMPTS },
        },
        select: { id: true, jobId: true, mimeType: true, storageKey: true },
      });
      for (const file of exhausted) {
        await this.fail(file, new ConversionError(ConversionErrorCode.CONVERSION_FAILED));
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Stale conversion recovery failed');
    }
  }
}
