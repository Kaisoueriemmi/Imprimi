import type { Readable } from 'node:stream';

/**
 * Object storage used for uploaded files, converted PDFs and thumbnails.
 * Abstract class (not an interface) so it can serve as a NestJS injection token.
 * Keys never contain the customer's file name.
 */
export abstract class StorageService {
  /** Streams a local file to storage (multipart upload for large files). */
  abstract putFile(key: string, filePath: string, contentType: string): Promise<void>;
  abstract putBuffer(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract getBuffer(key: string): Promise<Buffer>;
  abstract getStream(key: string): Promise<Readable>;
  /** Deletes the given keys; missing keys are not an error. */
  abstract delete(keys: readonly string[]): Promise<void>;
  /** Short-lived GET URL reachable from outside the server network (print agent). */
  abstract presignGet(key: string, ttlSeconds: number): Promise<string>;
  /** Throws when the bucket is unreachable. Used by /health. */
  abstract ping(): Promise<void>;
}

/** Keys of the objects stored for one uploaded file, all under the same random prefix. */
export function storageKeys(prefix: string): { original: string; pdf: string; thumbnail: string } {
  return {
    original: `${prefix}/original`,
    pdf: `${prefix}/document.pdf`,
    thumbnail: `${prefix}/thumb.webp`,
  };
}

export function prefixOf(storageKey: string): string {
  return storageKey.slice(0, storageKey.lastIndexOf('/'));
}
