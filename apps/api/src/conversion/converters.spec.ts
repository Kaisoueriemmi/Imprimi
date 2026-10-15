import { ConversionErrorCode } from '@printbox/shared';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeImage, makePdf } from '../testing/fixtures';
import { ConversionError } from './conversion-error';
import { docxToPdf, imageToPdf, inspectPdf, makeThumbnail, normalizeImage } from './converters';

async function expectConversionError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConversionError);
  expect((error as ConversionError).code).toBe(code);
}

describe('normalizeImage', () => {
  it('applies the EXIF orientation of phone photos', async () => {
    // Stored 800x600 but tagged "rotate 90°": the photo is really portrait.
    const photo = await makeImage('jpeg', { width: 800, height: 600 }, 6);
    const normalized = await normalizeImage(photo, 'image/jpeg');
    expect([normalized.width, normalized.height]).toEqual([600, 800]);
    expect(normalized.format).toBe('jpeg');
  });

  it('caps the resolution at A4 300 dpi', async () => {
    const huge = await makeImage('png', { width: 6000, height: 4000 });
    const normalized = await normalizeImage(huge, 'image/png');
    expect(Math.max(normalized.width, normalized.height)).toBe(3508);
    expect(normalized.format).toBe('png');
  });

  it('rejects a corrupted image', async () => {
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    await expectConversionError(
      normalizeImage(broken, 'image/jpeg'),
      ConversionErrorCode.CORRUPTED_FILE,
    );
  });
});

describe('imageToPdf', () => {
  it.each([
    ['portrait', { width: 600, height: 800 }, false],
    ['landscape', { width: 800, height: 600 }, true],
  ])(
    'puts a %s image on one A4 page with the same orientation',
    async (_label, size, landscape) => {
      const image = await normalizeImage(await makeImage('jpeg', size), 'image/jpeg');
      const pdf = await PDFDocument.load(await imageToPdf(image));
      expect(pdf.getPageCount()).toBe(1);
      const { width, height } = pdf.getPage(0).getSize();
      expect(Math.round(Math.max(width, height))).toBe(842);
      expect(Math.round(Math.min(width, height))).toBe(595);
      expect(width > height).toBe(landscape);
    },
  );
});

describe('inspectPdf', () => {
  it('counts pages', async () => {
    expect(await inspectPdf(await makePdf(7))).toEqual({ pageCount: 7, encrypted: false });
  });

  it('rejects a file that is not a readable PDF', async () => {
    await expectConversionError(
      inspectPdf(Buffer.from('%PDF-1.7 garbage')),
      ConversionErrorCode.CORRUPTED_FILE,
    );
  });
});

describe('makeThumbnail', () => {
  it('produces a small WebP', async () => {
    const thumb = await makeThumbnail(await makeImage('png', { width: 2000, height: 3000 }));
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(360);
  });
});

describe('docxToPdf', () => {
  it('reports a conversion failure when LibreOffice is unavailable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'printbox-docx-'));
    const input = join(dir, 'document.docx');
    await writeFile(input, 'irrelevant');
    await expectConversionError(
      docxToPdf(input, dir, join(dir, 'no-such-soffice')),
      ConversionErrorCode.CONVERSION_FAILED,
    );
  });
});
