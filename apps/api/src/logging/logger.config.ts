import { RequestMethod } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../config/env';

const UNLOGGED_PATHS = new Set(['/health', '/metrics']);

/** Drops the query string: it may carry tokens (QR, pre-signed URLs). */
function pathOnly(url: string | undefined): string {
  return (url ?? '').split('?')[0] ?? '';
}

/**
 * Structured JSON logs (pretty-printed in development).
 * Privacy rule: never log file contents, file names, headers or query strings.
 */
export function buildLoggerParams(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Params {
  return {
    // Express 5 wildcard syntax (the library default "*" triggers a legacy-route warning).
    forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
          : undefined,
      genReqId: (req: IncomingMessage) => {
        const header = req.headers['x-request-id'];
        return typeof header === 'string' && header.length <= 64 ? header : randomUUID();
      },
      autoLogging: {
        ignore: (req: IncomingMessage) => UNLOGGED_PATHS.has(pathOnly(req.url)),
      },
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: pathOnly(req.url),
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      redact: {
        paths: ['req.headers', 'res.headers', '*.password', '*.apiKey', '*.token'],
        censor: '[redacted]',
      },
    },
  };
}
