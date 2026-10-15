import { JwtService } from '@nestjs/jwt';
import {
  ApiErrorCode,
  ConversionErrorCode,
  type JobView,
  type QrTokenResponse,
  type SessionResponse,
} from '@printbox/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeImage, makePdf } from '../src/testing/fixtures';
import {
  createKiosk,
  newSession,
  QR_SECRET,
  startTestApp,
  type TestApp,
  upload,
  waitForConversion,
} from './support/test-app';

const KIOSK_ID = 'kiosk-int';
const DISPLAY_KEY = 'pbd_integration-display-key';

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
  await createKiosk(t, { id: KIOSK_ID, displayKey: DISPLAY_KEY });
});

afterAll(async () => {
  await t?.close();
});

describe('QR code → session', () => {
  it('only the kiosk screen (display key) can get a QR token', async () => {
    await t.http().post(`/api/kiosks/${KIOSK_ID}/qr-token`).expect(401);
    await t
      .http()
      .post(`/api/kiosks/${KIOSK_ID}/qr-token`)
      .set('Authorization', 'Bearer pbd_wrong')
      .expect(401);
    await t
      .http()
      .post('/api/kiosks/other-kiosk/qr-token')
      .set('Authorization', `Bearer ${DISPLAY_KEY}`)
      .expect(401);

    const res = await t
      .http()
      .post(`/api/kiosks/${KIOSK_ID}/qr-token`)
      .set('Authorization', `Bearer ${DISPLAY_KEY}`)
      .expect(200);
    expect((res.body as QrTokenResponse).url.startsWith('http://web.test/k/kiosk-int?t=')).toBe(
      true,
    );
  });

  it('opens a session with the kiosk capabilities', async () => {
    const session = await newSession(t, KIOSK_ID, DISPLAY_KEY);
    expect(session.kiosk).toEqual({
      id: KIOSK_ID,
      name: `Borne ${KIOSK_ID}`,
      supportsColor: true,
      supportsDuplex: true,
    });
  });

  it('answers "Rescannez le QR sur la borne" to an expired QR token', async () => {
    const expired = await new JwtService().signAsync(
      { exp: Math.floor(Date.now() / 1000) - 10 },
      { secret: QR_SECRET, audience: 'printbox:qr', subject: KIOSK_ID, jwtid: 'old' },
    );
    const res = await t
      .http()
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
    const res = await t.http().post('/api/sessions').send({ kioskId: KIOSK_ID }).expect(400);
    expect(res.body.code).toBe(ApiErrorCode.VALIDATION_FAILED);
  });
});

describe('upload and conversion', () => {
  let session: SessionResponse;

  beforeAll(async () => {
    session = await newSession(t, KIOSK_ID, DISPLAY_KEY);
  });

  it('requires a valid session', async () => {
    const res = await t
      .http()
      .post('/api/jobs')
      .attach('file', Buffer.from('x'), 'a.pdf')
      .expect(401);
    expect(res.body.code).toBe(ApiErrorCode.SESSION_EXPIRED);
    await t.http().get('/api/jobs/anything').set('Authorization', 'Bearer forged').expect(401);
  });

  it('converts a PDF: pages counted, original kept as the printable file', async () => {
    const res = await upload(t, session, await makePdf(3), 'تقرير السنة.pdf').expect(201);
    const created = res.body as JobView;
    expect(created).toMatchObject({
      status: 'UPLOADED',
      conversionStatus: 'PENDING',
      file: { originalName: 'تقرير السنة.pdf', mimeType: 'application/pdf' },
    });

    const job = await waitForConversion(t, session, created.id);
    expect(job).toMatchObject({
      status: 'UPLOADED',
      conversionStatus: 'READY',
      totalPages: 3,
      file: { pageCount: 3 },
    });
    // Storage keys never contain the file name.
    expect([...t.storage.objects.keys()].some((key) => key.includes('تقرير'))).toBe(false);
  });

  it('turns a photo into a one-page A4 PDF with a WebP thumbnail', async () => {
    const photo = await makeImage('jpeg', { width: 1200, height: 1600 });
    const created = (await upload(t, session, photo, 'photo.jpg').expect(201)).body as JobView;

    const job = await waitForConversion(t, session, created.id);
    expect(job).toMatchObject({ conversionStatus: 'READY', totalPages: 1, hasThumbnail: true });

    const thumb = await t
      .http()
      .get(`/api/jobs/${created.id}/thumbnail`)
      .set('Authorization', `Bearer ${session.sessionToken}`)
      .expect(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect([...t.storage.objects.values()].some((o) => o.contentType === 'application/pdf')).toBe(
      true,
    );
  });

  it('checks the real type: a text file named .pdf is refused and not stored', async () => {
    const before = t.storage.objects.size;
    const res = await upload(t, session, Buffer.from('not a pdf at all'), 'fake.pdf').expect(415);
    expect(res.body.code).toBe(ApiErrorCode.UNSUPPORTED_FILE_TYPE);
    expect(t.storage.objects.size).toBe(before);
  });

  it('refuses files over 20 MB', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 0x25);
    const res = await upload(t, session, big, 'big.pdf').expect(413);
    expect(res.body.code).toBe(ApiErrorCode.FILE_TOO_LARGE);
  });

  it('fails a PDF over 50 pages and deletes its file', async () => {
    const created = (await upload(t, session, await makePdf(51), 'long.pdf').expect(201))
      .body as JobView;
    const job = await waitForConversion(t, session, created.id);
    expect(job).toMatchObject({
      status: 'FAILED',
      conversionStatus: 'FAILED',
      errorMessage: ConversionErrorCode.TOO_MANY_PAGES,
      hasThumbnail: false,
    });
    const file = await t.prisma.jobFile.findFirstOrThrow({ where: { jobId: created.id } });
    expect(file.deletedAt).not.toBeNull();
    expect(t.storage.objects.has(file.storageKey)).toBe(false);
  });

  it("does not expose a job to another customer's session", async () => {
    const created = (await upload(t, session, await makePdf(1), 'mine.pdf').expect(201))
      .body as JobView;
    const other = await newSession(t, KIOSK_ID, DISPLAY_KEY);
    await t
      .http()
      .get(`/api/jobs/${created.id}`)
      .set('Authorization', `Bearer ${other.sessionToken}`)
      .expect(404);
  });
});
