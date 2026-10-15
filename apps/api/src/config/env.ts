import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

const INSECURE_SECRET_MARKER = 'change-me';

const commaSeparatedUrls = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// URL'),

    /** Public URL of the web app, encoded in the kiosk QR codes. */
    PUBLIC_WEB_URL: z.url(),
    /** Origins allowed to call the API from a browser. */
    CORS_ORIGINS: commaSeparatedUrls,

    /** HMAC secret signing the short-lived QR tokens. */
    QR_TOKEN_SECRET: z.string().min(32),
    /** HMAC secret signing customer session tokens (distinct from the QR secret). */
    SESSION_TOKEN_SECRET: z.string().min(32),

    S3_ENDPOINT: z.url(),
    /**
     * Endpoint used in pre-signed URLs handed to clients outside the Docker network
     * (the print agent). Defaults to S3_ENDPOINT.
     */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(8),
    /** MinIO needs path-style URLs. */
    S3_FORCE_PATH_STYLE: z.stringbool().default(true),

    /** Runs the PDF conversion worker inside this process (dev). In Docker a `worker` service does it. */
    CONVERSION_WORKER_ENABLED: z.stringbool().default(true),
    CONVERSION_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    /** LibreOffice binary for DOCX → PDF. */
    LIBREOFFICE_PATH: z.string().min(1).default('soffice'),
    /** Poppler's pdftoppm, renders the page-1 thumbnail of PDFs. */
    PDFTOPPM_PATH: z.string().min(1).default('pdftoppm'),
  })
  .superRefine((env, ctx) => {
    if (env.QR_TOKEN_SECRET === env.SESSION_TOKEN_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_TOKEN_SECRET'],
        message: 'must differ from QR_TOKEN_SECRET',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    for (const key of [
      'QR_TOKEN_SECRET',
      'SESSION_TOKEN_SECRET',
      'S3_SECRET_ACCESS_KEY',
    ] as const) {
      if (env[key].includes(INSECURE_SECRET_MARKER)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'still contains the placeholder value from .env.example',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Typed ConfigService: `config.get('PORT', { infer: true })` returns a number. */
export type AppConfigService = ConfigService<Env, true>;

/** Used by ConfigModule: the API refuses to start with an invalid environment. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
