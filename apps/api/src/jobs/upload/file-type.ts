import type { AllowedMimeType } from '@printbox/shared';
import { open } from 'node:fs/promises';
import yauzl from 'yauzl';

const PDF_MARKER = Buffer.from('%PDF-', 'latin1');
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** Readers tolerate junk before the PDF header; so do we, within the first KiB. */
const PDF_HEADER_SEARCH_BYTES = 1024;
/** A real DOCX has a few dozen entries; anything far beyond is suspicious. */
const MAX_DOCX_ENTRIES = 5000;

const DOCX_MIME: AllowedMimeType =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function startsWith(head: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, i) => head[i] === byte);
}

/** True when the ZIP at `path` has the entries that make it a Word document. */
function isDocx(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError || !zip) return resolve(false);
      let entries = 0;
      let hasContentTypes = false;
      let hasDocument = false;
      const finish = (result: boolean): void => {
        zip.close();
        resolve(result);
      };
      zip.on('error', () => finish(false));
      zip.on('entry', (entry: yauzl.Entry) => {
        entries += 1;
        if (entry.fileName === '[Content_Types].xml') hasContentTypes = true;
        if (entry.fileName === 'word/document.xml') hasDocument = true;
        if (hasContentTypes && hasDocument) return finish(true);
        if (entries > MAX_DOCX_ENTRIES) return finish(false);
        zip.readEntry();
      });
      zip.on('end', () => finish(hasContentTypes && hasDocument));
      zip.readEntry();
    });
  });
}

/**
 * Detects the real type of an uploaded file from its content (magic bytes), ignoring the
 * extension and the client-declared Content-Type. Returns null for anything not accepted.
 */
export async function detectFileType(path: string): Promise<AllowedMimeType | null> {
  const handle = await open(path, 'r');
  let head: Buffer;
  try {
    const buffer = Buffer.alloc(PDF_HEADER_SEARCH_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    head = buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }

  if (startsWith(head, JPEG)) return 'image/jpeg';
  if (startsWith(head, PNG)) return 'image/png';
  if (head.includes(PDF_MARKER)) return 'application/pdf';
  if (startsWith(head, ZIP) && (await isDocx(path))) return DOCX_MIME;
  return null;
}
