import { createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export interface DownloadOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const PDF_MARKER = Buffer.from('%PDF-', 'latin1');

/**
 * Downloads the job's PDF from its pre-signed URL (valid ~2 minutes, so the agent downloads as
 * soon as the job arrives) and checks it really is a PDF.
 */
export async function downloadPdf(
  url: string,
  destination: string,
  { timeoutMs = 60_000, maxBytes = 25 * 1024 * 1024 }: DownloadOptions = {},
): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('File too large');

  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(received > maxBytes ? new Error('File too large') : null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      limiter,
      createWriteStream(destination, { mode: 0o600 }),
    );
    const handle = await open(destination, 'r');
    try {
      const head = Buffer.alloc(1024);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      if (!head.subarray(0, bytesRead).includes(PDF_MARKER)) throw new Error('Not a PDF');
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}
