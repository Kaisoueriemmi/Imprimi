import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  ApiErrorCode,
  ConversionErrorCode,
  type JobView,
  type QrTokenResponse,
  type SessionResponse,
} from '@printbox/shared';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashApiKey } from '../src/common/api-key';
import { PrismaService } from '../src/prisma/prisma.service';
import { InMemoryStorageService } from '../src/storage/in-memory-storage.service';
import { StorageService } from '../src/storage/storage.service';
import { makeImage, makePdf } from '../src/testing/fixtures';

const API_ROOT = resolve(__dirname, '..');
const KIOSK_ID = 'kiosk-int';
const DISPLAY_KEY = 'pbd_integration-display-key';
const QR_SECRET = 'q'.repeat(40);

let container: StartedPostgreSqlContainer;
let app: INestApplication;
let storage: InMemoryStorageService;

const http = () => request(app.getHttpServer());

async function newSession(): Promise<SessionResponse> {
  const qr = await http()
    .post(`/api/kiosks/${KIOSK_ID}/qr-token`)
    .set('Authorization', `Bearer ${DISPLAY_KEY}`)
    .expect(200);
  const { token } = qr.body as QrTokenResponse;
  const res = await http().post('/api/sessions').send({ kioskId: KIOSK_ID, token }).expect(201);
  return res.body as SessionResponse;
}

function upload(session: SessionResponse, content: Buffer, filename: string): request.Test {
  return http()
    .post('/api/jobs')
    .set('Authorization', `Bearer ${session.sessionToken}`)
    .attach('file', content, { filename });
}

async function waitForConversion(session: SessionResponse, jobId: string): Promise<JobView> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await http()
      .get(`/api/jobs/${jobId}`)
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(200);
    const job = res.body as JobView;
    if (job.conversionStatus === 'READY' || job.conversionStatus === 'FAILED') return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Job ${jobId} still converting after 30 s`);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
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
  });

  // ConfigModule validates the environment when its module is imported: import after setting it.
  const { AppModule } = await import('../src/app.module');
  storage = new InMemoryStorageService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageService)
    .useValue(storage)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api', { exclude: ['health', 'metrics'] });
  await app.init();

  await app.get(PrismaService).kiosk.create({
    data: {
      id: KIOSK_ID,
      name: 'Borne test',
      apiKeyHash: hashApiKey('pbk_integration-agent-key'),
      displayKeyHash: hashApiKey(DISPLAY_KEY),
      supportsColor: true,
      supportsDuplex: true,
    },
  });
});

afterAll(async () => {
  await app?.close();
  await container?.stop();
});

describe('QR code → session', () => {
  it('only the kiosk screen (display key) can get a QR token', async () => {
    await http().post(`/api/kiosks/${KIOSK_ID}/qr-token`).expect(401);
    await http()
      .post(`/api/kiosks/${KIOSK_ID}/qr-token`)
      .set('Authorization', 'Bearer pbd_wrong')
      .expect(401);
    await http()
      .post('/api/kiosks/other-kiosk/qr-token')
      .set('Authorization', `Bearer ${DISPLAY_KEY}`)
      .expect(401);

    const res = await http()
      .post(`/api/kiosks/${KIOSK_ID}/qr-token`)
      .set('Authorization', `Bearer ${DISPLAY_KEY}`)
      .expect(200);
    expect((res.body as QrTokenResponse).url.startsWith('http://web.test/k/kiosk-int?t=')).toBe(
      true,
    );
  });

  it('opens a session with the kiosk capabilities', async () => {
    const session = await newSession();
    expect(session.kiosk).toEqual({
      id: KIOSK_ID,
      name: 'Borne test',
      supportsColor: true,
      supportsDuplex: true,
    });
  });

  it('answers "Rescannez le QR sur la borne" to an expired QR token', async () => {
    const expired = await new JwtService().signAsync(
      { exp: Math.floor(Date.now() / 1000) - 10 },
      { secret: QR_SECRET, audience: 'printbox:qr', subject: KIOSK_ID, jwtid: 'old' },
    );
    const res = await http()
      .post('/api/sessions')
      .send({ kioskId: KIOSK_ID, token: expired })
      .expect(401);
    expect(res.body).toEqual({
      statusCode: 401,
      code: ApiErrorCode.QR_EXPIRED,
      message: 'Rescannez le QR sur la borne',
    });
  });

  it('validates the request body', async () => {
    const res = await http().post('/api/sessions').send({ kioskId: KIOSK_ID }).expect(400);
    expect(res.body.code).toBe(ApiErrorCode.VALIDATION_FAILED);
  });
});

describe('upload and conversion', () => {
  let session: SessionResponse;

  beforeAll(async () => {
    session = await newSession();
  });

  it('requires a valid session', async () => {
    const res = await http()
      .post('/api/jobs')
      .attach('file', Buffer.from('x'), 'a.pdf')
      .expect(401);
    expect(res.body.code).toBe(ApiErrorCode.SESSION_EXPIRED);
    await http().get('/api/jobs/anything').set('Authorization', 'Bearer forged').expect(401);
  });

  it('converts a PDF: pages counted, original kept as the printable file', async () => {
    const res = await upload(session, await makePdf(3), 'تقرير السنة.pdf').expect(201);
    const created = res.body as JobView;
    expect(created).toMatchObject({
      status: 'UPLOADED',
      conversionStatus: 'PENDING',
      file: { originalName: 'تقرير السنة.pdf', mimeType: 'application/pdf' },
    });

    const job = await waitForConversion(session, created.id);
    expect(job).toMatchObject({
      status: 'UPLOADED',
      conversionStatus: 'READY',
      totalPages: 3,
      file: { pageCount: 3 },
    });
    // Storage keys never contain the file name.
    expect([...storage.objects.keys()].some((key) => key.includes('تقرير'))).toBe(false);
  });

  it('turns a photo into a one-page A4 PDF with a WebP thumbnail', async () => {
    const photo = await makeImage('jpeg', { width: 1200, height: 1600 });
    const created = (await upload(session, photo, 'photo.jpg').expect(201)).body as JobView;

    const job = await waitForConversion(session, created.id);
    expect(job).toMatchObject({ conversionStatus: 'READY', totalPages: 1, hasThumbnail: true });

    const thumb = await http()
      .get(`/api/jobs/${created.id}/thumbnail`)
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect([...storage.objects.values()].some((o) => o.contentType === 'application/pdf')).toBe(
      true,
    );
  });

  it('checks the real type: a text file named .pdf is refused and not stored', async () => {
    const before = storage.objects.size;
    const res = await upload(session, Buffer.from('not a pdf at all'), 'fake.pdf').expect(415);
    expect(res.body.code).toBe(ApiErrorCode.UNSUPPORTED_FILE_TYPE);
    expect(storage.objects.size).toBe(before);
  });

  it('refuses files over 20 MB', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 0x25);
    const res = await upload(session, big, 'big.pdf').expect(413);
    expect(res.body.code).toBe(ApiErrorCode.FILE_TOO_LARGE);
  });

  it('fails a PDF over 50 pages and deletes its file', async () => {
    const created = (await upload(session, await makePdf(51), 'long.pdf').expect(201))
      .body as JobView;
    const job = await waitForConversion(session, created.id);
    expect(job).toMatchObject({
      status: 'FAILED',
      conversionStatus: 'FAILED',
      errorMessage: ConversionErrorCode.TOO_MANY_PAGES,
      hasThumbnail: false,
    });
    const file = await app.get(PrismaService).jobFile.findFirstOrThrow({
      where: { jobId: created.id },
    });
    expect(file.deletedAt).not.toBeNull();
    expect(storage.objects.has(file.storageKey)).toBe(false);
  });

  it("does not expose a job to another customer's session", async () => {
    const created = (await upload(session, await makePdf(1), 'mine.pdf').expect(201))
      .body as JobView;
    const other = await newSession();
    await http()
      .get(`/api/jobs/${created.id}`)
      .set('Authorization', `Bearer ${other.sessionToken}`)
      .expect(404);
  });
});
