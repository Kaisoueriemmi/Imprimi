import { ApiErrorCode } from '@printbox/shared';
import busboy from 'busboy';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ApiException } from '../../common/api-exception';
import { sanitizeOriginalName } from './original-name';

export interface ReceivedFile {
  /** Temporary file; the caller deletes it. */
  path: string;
  originalName: string;
  sizeBytes: number;
}

const FILE_FIELD = 'file';

export const fileTooLarge = (maxBytes: number): ApiException =>
  new ApiException(
    413,
    ApiErrorCode.FILE_TOO_LARGE,
    `Fichier trop volumineux (max ${Math.round(maxBytes / 1024 / 1024)} Mo)`,
  );

const fileMissing = (): ApiException =>
  new ApiException(400, ApiErrorCode.FILE_MISSING, 'Aucun fichier reçu (champ "file")');

/**
 * Streams the single `file` field of a multipart request to a temporary file, never holding it
 * in memory. Aborts with 413 as soon as `maxBytes` is exceeded.
 */
export function receiveSingleFile(
  req: Request,
  options: { maxBytes: number; directory: string },
): Promise<ReceivedFile> {
  return new Promise<ReceivedFile>((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: { files: 1, fileSize: options.maxBytes, fields: 10, parts: 11 },
      });
    } catch {
      reject(fileMissing());
      return;
    }

    let received: Promise<ReceivedFile> | undefined;

    parser.on('file', (field, stream, info) => {
      if (field !== FILE_FIELD || received) {
        stream.resume();
        return;
      }
      const path = join(options.directory, `upload-${randomUUID()}`);
      const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
      let truncated = false;
      stream.on('limit', () => {
        truncated = true;
      });
      received = pipeline(stream, output).then(
        async () => {
          if (truncated) {
            await rm(path, { force: true });
            throw fileTooLarge(options.maxBytes);
          }
          if (output.bytesWritten === 0) {
            await rm(path, { force: true });
            throw fileMissing();
          }
          return {
            path,
            originalName: sanitizeOriginalName(info.filename),
            sizeBytes: output.bytesWritten,
          };
        },
        async (error: unknown) => {
          await rm(path, { force: true });
          throw error;
        },
      );
      // Avoid an unhandled rejection before 'close' attaches the real handlers.
      received.catch(() => undefined);
    });

    parser.on('error', () => reject(fileMissing()));
    parser.on('close', () => {
      if (!received) reject(fileMissing());
      else received.then(resolve, reject);
    });
    req.on('error', () => reject(fileMissing()));

    req.pipe(parser);
  });
}
