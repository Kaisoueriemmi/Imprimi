import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { JobView, QrTokenResponse, SessionResponse } from '@printbox/shared';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { hashApiKey } from '../../src/common/api-key';
import { PrismaService } from '../../src/prisma/prisma.service';
import { InMemoryStorageService } from '../../src/storage/in-memory-storage.service';
import { StorageService } from '../../src/storage/storage.service';

const API_ROOT = resolve(__dirname, '../..');
export const QR_SECRET = 'q'.repeat(40);

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  storage: InMemoryStorageService;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** Real PostgreSQL (Testcontainers) + the whole AppModule, storage kept in memory. */
export async function startTestApp(extraEnv: Record<string, string> = {}): Promise<TestApp> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine',
  ).start();
  const databaseUrl = container.getConnectionUri();
  execFileSync(resolve(API_ROOT, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  // Runtime env wins over apps/api/.env in ConfigModule.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    PUBLIC_WEB_URL: 'http://web.test',
    CORS_ORIGINS: 'http://web.test',
    QR_TOKEN_SECRET: QR_SECRET,
    SESSION_TOKEN_SECRET: 's'.repeat(40),
    S3_ENDPOINT: 'http://s3.test',
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test-secret',
    CONVERSION_WORKER_ENABLED: 'true',
    // Tests drive the periodic tasks explicitly.
    SCHEDULER_ENABLED: 'false',
    PRICE_ROUNDING_MILLIMES: '100',
    PAYMENT_FREE_MODE: 'false',
    ...extraEnv,
  });

  // ConfigModule validates the environment when its module is imported: import after setting it.
  const { AppModule } = await import('../../src/app.module');
  const storage = new InMemoryStorageService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useValue(storage)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api', { exclude: ['health', 'metrics'] });
  // Listen once: supertest on an unbound server opens an ephemeral port per request, which
  // exhausts Windows' socket buffers (ENOBUFS) when tests poll.
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  return {
    app,
    prisma: app.get(PrismaService),
    storage,
    http: () => request(baseUrl.replace('[::1]', '127.0.0.1')),
    close: async () => {
      await app.close();
      await container.stop();
    },
  };
}

export async function createKiosk(
  t: TestApp,
  kiosk: { id: string; displayKey: string; supportsColor?: boolean; supportsDuplex?: boolean },
): Promise<void> {
  await t.prisma.kiosk.create({
    data: {
      id: kiosk.id,
      name: `Borne ${kiosk.id}`,
      apiKeyHash: hashApiKey(`pbk_${kiosk.id}`),
      displayKeyHash: hashApiKey(kiosk.displayKey),
      supportsColor: kiosk.supportsColor ?? true,
      supportsDuplex: kiosk.supportsDuplex ?? true,
    },
  });
}

export async function newSession(
  t: TestApp,
  kioskId: string,
  displayKey: string,
): Promise<SessionResponse> {
  const qr = await t
    .http()
    .post(`/api/kiosks/${kioskId}/qr-token`)
    .set('Authorization', `Bearer ${displayKey}`)
    .expect(200);
  const { token } = qr.body as QrTokenResponse;
  const res = await t.http().post('/api/sessions').send({ kioskId, token }).expect(201);
  return res.body as SessionResponse;
}

export function upload(
  t: TestApp,
  session: SessionResponse,
  content: Buffer,
  filename: string,
): request.Test {
  return t
    .http()
    .post('/api/jobs')
    .set('Authorization', `Bearer ${session.sessionToken}`)
    .attach('file', content, { filename });
}

export async function waitForConversion(
  t: TestApp,
  session: SessionResponse,
  jobId: string,
): Promise<JobView> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await t
      .http()
      .get(`/api/jobs/${jobId}`)
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(200);
    const job = res.body as JobView;
    if (job.conversionStatus === 'READY' || job.conversionStatus === 'FAILED') return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Job ${jobId} still converting after 30 s`);
}
