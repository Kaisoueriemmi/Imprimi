import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Printer, type PrinterState, type PrintRequest } from './printer';
import { buildPrintSettings } from './sumatra-settings';

/**
 * Development and test printer: copies the PDF to `<outDir>/<jobId>.pdf` with the SumatraPDF
 * settings it would have used in `<jobId>.json`. Works on Linux and macOS.
 */
export class FakePrinter implements Printer {
  readonly printed: PrintRequest[] = [];
  /** Makes the next print fail (tests). */
  failNext: Error | null = null;

  constructor(
    private readonly outDir: string,
    private readonly name = 'PrintBox fake printer',
  ) {}

  async print(request: PrintRequest): Promise<void> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    await mkdir(this.outDir, { recursive: true });
    await copyFile(request.pdfPath, join(this.outDir, `${request.jobId}.pdf`));
    await writeFile(
      join(this.outDir, `${request.jobId}.json`),
      JSON.stringify({
        settings: buildPrintSettings(request),
        printedAt: new Date().toISOString(),
      }),
    );
    this.printed.push(request);
  }

  async state(): Promise<PrinterState> {
    return { name: this.name, online: true, status: 'Normal', queuedJobs: 0, paperLevel: 'OK' };
  }
}
