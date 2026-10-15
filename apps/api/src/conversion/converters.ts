import { ConversionErrorCode } from '@printbox/shared';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { EncryptedPDFError, PageSizes, PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { ConversionError } from './conversion-error';

const execFileAsync = promisify(execFile);

/** A4 in PDF points (portrait). */
const [A4_WIDTH, A4_HEIGHT] = PageSizes.A4;
/** 10 mm margin. */
const MARGIN = 28.35;
/** Long side of an A4 page at 300 dpi: no need to keep more pixels than the printer can use. */
const MAX_IMAGE_SIDE = 3508;
/** Rejects decompression bombs (≈ 80 MP). */
const MAX_INPUT_PIXELS = 80_000_000;
const THUMBNAIL_WIDTH = 360;

export interface NormalizedImage {
  data: Buffer;
  width: number;
  height: number;
  format: 'jpeg' | 'png';
}

/**
 * Applies the EXIF orientation (phone photos), caps the resolution, flattens transparency on
 * white, and re-encodes in the same family (JPEG stays JPEG, PNG stays lossless).
 */
export async function normalizeImage(
  input: Buffer,
  mimeType: 'image/jpeg' | 'image/png',
): Promise<NormalizedImage> {
  try {
    const base = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({
        width: MAX_IMAGE_SIDE,
        height: MAX_IMAGE_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' });
    const format = mimeType === 'image/png' ? 'png' : 'jpeg';
    const encoded =
      format === 'png' ? base.png({ compressionLevel: 9 }) : base.jpeg({ quality: 88 });
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, format };
  } catch (error) {
    throw new ConversionError(ConversionErrorCode.CORRUPTED_FILE, { cause: error });
  }
}

/** One A4 page, oriented like the image, the image scaled to fit inside the margins and centred. */
export async function imageToPdf(image: NormalizedImage): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const embedded =
    image.format === 'png' ? await doc.embedPng(image.data) : await doc.embedJpg(image.data);
  const landscape = image.width > image.height;
  const pageWidth = landscape ? A4_HEIGHT : A4_WIDTH;
  const pageHeight = landscape ? A4_WIDTH : A4_HEIGHT;
  const scale = Math.min(
    (pageWidth - 2 * MARGIN) / image.width,
    (pageHeight - 2 * MARGIN) / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  const page = doc.addPage([pageWidth, pageHeight]);
  page.drawImage(embedded, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  });
  return doc.save();
}

export interface PdfInfo {
  pageCount: number;
  /** Encrypted with at least an owner password (printing may still be allowed). */
  encrypted: boolean;
}

/** Page count of a PDF; rejects unreadable files. */
export async function inspectPdf(data: Uint8Array): Promise<PdfInfo> {
  try {
    const doc = await PDFDocument.load(data, { updateMetadata: false });
    return { pageCount: doc.getPageCount(), encrypted: false };
  } catch (error) {
    if (!(error instanceof EncryptedPDFError)) {
      throw new ConversionError(ConversionErrorCode.CORRUPTED_FILE, { cause: error });
    }
  }
  // The page tree is not encrypted, so pages can be counted without the password.
  try {
    const doc = await PDFDocument.load(data, { updateMetadata: false, ignoreEncryption: true });
    return { pageCount: doc.getPageCount(), encrypted: true };
  } catch (error) {
    throw new ConversionError(ConversionErrorCode.PDF_ENCRYPTED, { cause: error });
  }
}

/** DOCX → PDF with LibreOffice headless. Returns the path of the produced PDF. */
export async function docxToPdf(
  inputPath: string,
  workDir: string,
  libreOfficePath: string,
  timeoutMs = 90_000,
): Promise<string> {
  // A private profile per run: concurrent conversions would otherwise lock each other out.
  const profile = pathToFileURL(join(workDir, 'lo-profile')).href;
  try {
    await execFileAsync(
      libreOfficePath,
      [
        '--headless',
        '--norestore',
        '--nolockcheck',
        `-env:UserInstallation=${profile}`,
        '--convert-to',
        'pdf',
        '--outdir',
        workDir,
        inputPath,
      ],
      { timeout: timeoutMs, windowsHide: true },
    );
  } catch (error) {
    throw new ConversionError(ConversionErrorCode.CONVERSION_FAILED, { cause: error });
  }
  return join(workDir, `${basename(inputPath, extname(inputPath))}.pdf`);
}

/** Renders page 1 of a PDF to PNG with Poppler's pdftoppm. Throws when it cannot. */
export async function renderFirstPage(
  pdfPath: string,
  workDir: string,
  pdftoppmPath: string,
  timeoutMs = 30_000,
): Promise<Buffer> {
  const outputBase = join(workDir, 'page-1');
  await execFileAsync(
    pdftoppmPath,
    [
      '-f',
      '1',
      '-l',
      '1',
      '-png',
      '-scale-to',
      String(THUMBNAIL_WIDTH * 2),
      '-singlefile',
      pdfPath,
      outputBase,
    ],
    { timeout: timeoutMs, windowsHide: true },
  );
  return readFile(`${outputBase}.png`);
}

/** Small, compressed preview for slow mobile connections. */
export function makeThumbnail(image: Buffer): Promise<Buffer> {
  return sharp(image, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 60 })
    .toBuffer();
}
