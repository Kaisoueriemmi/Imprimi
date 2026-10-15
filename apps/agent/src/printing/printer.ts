import type { ColorMode, PaperLevel } from '@printbox/shared';

export interface PrintRequest {
  jobId: string;
  /** Local PDF, named after the job id only (the Windows queue never shows the customer's file name). */
  pdfPath: string;
  copies: number;
  colorMode: ColorMode;
  duplex: boolean;
  /** `"1-3,5"` or null for every page. */
  pageRange: string | null;
}

export interface PrinterState {
  name: string;
  online: boolean;
  /** Windows PrinterStatus name ("Normal", "PaperOut"…), or "NotFound". */
  status: string;
  queuedJobs: number;
  paperLevel: PaperLevel;
}

export type PrintFailure = 'PRINTER_ERROR' | 'PRINT_TIMEOUT';

export class PrintError extends Error {
  constructor(
    readonly reason: PrintFailure,
    message: string,
  ) {
    super(message);
    this.name = 'PrintError';
  }
}

/** Prints a PDF and reports the printer state. Resolves once the printer has finished. */
export interface Printer {
  print(request: PrintRequest): Promise<void>;
  state(): Promise<PrinterState>;
}
