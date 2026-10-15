import { PageSizes, PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import yazl from 'yazl';

/** Test-only helpers generating real files in memory. */

export async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage(PageSizes.A4);
  return Buffer.from(await doc.save());
}

export function makeImage(
  format: 'png' | 'jpeg',
  size: { width: number; height: number },
  exifOrientation?: number,
): Promise<Buffer> {
  let image = sharp({
    create: { ...size, channels: 3, background: { r: 51, g: 102, b: 204 } },
  });
  if (exifOrientation) image = image.withMetadata({ orientation: exifOrientation });
  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
}

export function makeZip(entries: Record<string, string>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(entries)) {
    zip.addBuffer(Buffer.from(content, 'utf8'), name);
  }
  zip.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
}

/** Smallest ZIP with the entries that identify a Word document (not renderable by LibreOffice). */
export function makeDocxSkeleton(): Promise<Buffer> {
  return makeZip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'word/document.xml': '<?xml version="1.0"?><w:document/>',
  });
}
