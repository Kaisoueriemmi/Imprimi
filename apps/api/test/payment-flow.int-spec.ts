import { EventEmitter2 } from '@nestjs/event-emitter';
import { ColorMode } from '@prisma/client';
import {
  ApiErrorCode,
  type CoinSessionView,
  type JobView,
  type SessionResponse,
  TIMINGS,
} from '@printbox/shared';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/common/password';
import { type CoinChangeDueEvent, DomainEvent } from '../src/events/domain-events';
import { ExpiryService } from '../src/maintenance/expiry.service';
import { CoinPaymentService } from '../src/payments/coin-payment.service';
import { CounterPaymentService } from '../src/payments/counter-payment.service';
import { makePdf } from '../src/testing/fixtures';
import {
  createKiosk,
  newSession,
  startTestApp,
  type TestApp,
  upload,
  waitForConversion,
} from './support/test-app';

const KIOSK = { id: 'kiosk-pay', displayKey: 'pbd_kiosk-pay' };
const BW_ONLY_KIOSK = { id: 'kiosk-bw', displayKey: 'pbd_kiosk-bw' };

let t: TestApp;
let coins: CoinPaymentService;
let sessionA: SessionResponse;
let sessionB: SessionResponse;
let changeDue: CoinChangeDueEvent[];

const auth = (session: SessionResponse) => ({ Authorization: `Bearer ${session.sessionToken}` });
const coin = (valueMillimes: number, eventId: string = randomUUID()) => ({
  eventId,
  valueMillimes,
});

/** A converted job of `pages` pages, still UPLOADED. */
async function readyJob(session: SessionResponse, pages: number): Promise<JobView> {
  const created = (await upload(t, session, await makePdf(pages), 'doc.pdf').expect(201))
    .body as JobView;
  const job = await waitForConversion(t, session, created.id);
  expect(job.conversionStatus).toBe('READY');
  return job;
}

async function checkedOutJob(session: SessionResponse, pages: number): Promise<JobView> {
  const job = await readyJob(session, pages);
  const res = await t
    .http()
    .post(`/api/jobs/${job.id}/checkout`)
    .set(auth(session))
    .send({ method: 'COIN' })
    .expect(200);
  return res.body as JobView;
}

function startCoins(session: SessionResponse, jobId: string) {
  return t.http().post(`/api/jobs/${jobId}/coin-payment`).set(auth(session));
}

beforeAll(async () => {
  t = await startTestApp();
  await createKiosk(t, KIOSK);
  await createKiosk(t, { ...BW_ONLY_KIOSK, supportsColor: false, supportsDuplex: false });
  await t.prisma.pricingRule.createMany({
    data: [
      {
        kioskId: null,
        colorMode: ColorMode.BW,
        pricePerPageMillimes: 100,
        duplexDiscountPercent: 10,
      },
      {
        kioskId: null,
        colorMode: ColorMode.COLOR,
        pricePerPageMillimes: 500,
        duplexDiscountPercent: 10,
      },
    ],
  });
  coins = t.app.get(CoinPaymentService);
  t.app.get(EventEmitter2).on(DomainEvent.COIN_CHANGE_DUE, (event: CoinChangeDueEvent) => {
    changeDue.push(event);
  });
  sessionA = await newSession(t, KIOSK.id, KIOSK.displayKey);
  sessionB = await newSession(t, KIOSK.id, KIOSK.displayKey);
});

beforeEach(() => {
  changeDue = [];
});

afterAll(async () => {
  await t?.close();
});

describe('options and server-side price', () => {
  it('prices a converted job with the default options', async () => {
    const job = await readyJob(sessionA, 3);
    expect(job).toMatchObject({ priceMillimes: 300, totalPages: 3, pageRange: null });
  });

  it('recomputes the price on every option change', async () => {
    const job = await readyJob(sessionA, 4);
    const res = await t
      .http()
      .patch(`/api/jobs/${job.id}/options`)
      .set(auth(sessionA))
      .send({ copies: 2, colorMode: 'COLOR', duplex: true, pageRange: ' 2 , 1 ' })
      .expect(200);
    // 2 pages × 2 copies × 0,500 DT = 2,000 DT, −10 % recto-verso = 1,800 DT.
    expect(res.body).toMatchObject({
      copies: 2,
      colorMode: 'COLOR',
      duplex: true,
      pageRange: '1-2',
      totalPages: 4,
      priceMillimes: 1800,
    });
  });

  it('rejects invalid pages and out-of-range copies', async () => {
    const job = await readyJob(sessionA, 2);
    const badRange = await t
      .http()
      .patch(`/api/jobs/${job.id}/options`)
      .set(auth(sessionA))
      .send({ copies: 1, colorMode: 'BW', duplex: false, pageRange: '3-5' })
      .expect(400);
    expect(badRange.body.code).toBe(ApiErrorCode.INVALID_PAGE_RANGE);

    const tooManyCopies = await t
      .http()
      .patch(`/api/jobs/${job.id}/options`)
      .set(auth(sessionA))
      .send({ copies: 21, colorMode: 'BW', duplex: false, pageRange: null })
      .expect(400);
    expect(tooManyCopies.body.code).toBe(ApiErrorCode.VALIDATION_FAILED);
  });

  it('refuses colour and duplex on a kiosk that cannot do them', async () => {
    const bwSession = await newSession(t, BW_ONLY_KIOSK.id, BW_ONLY_KIOSK.displayKey);
    const job = await readyJob(bwSession, 2);
    for (const options of [
      { copies: 1, colorMode: 'COLOR', duplex: false, pageRange: null },
      { copies: 1, colorMode: 'BW', duplex: true, pageRange: null },
    ]) {
      const res = await t
        .http()
        .patch(`/api/jobs/${job.id}/options`)
        .set(auth(bwSession))
        .send(options)
        .expect(400);
      expect(res.body.code).toBe(ApiErrorCode.OPTION_UNAVAILABLE);
    }
  });
});

describe('checkout', () => {
  it('issues a 6-digit pickup code and freezes options and price', async () => {
    const job = await checkedOutJob(sessionA, 2);
    expect(job.status).toBe('AWAITING_PAYMENT');
    expect(job.pickupCode).toMatch(/^[0-9]{6}$/);
    expect(job.priceMillimes).toBe(200);

    const stored = await t.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.activePickupCode).toBe(job.pickupCode);

    await t
      .http()
      .patch(`/api/jobs/${job.id}/options`)
      .set(auth(sessionA))
      .send({ copies: 5, colorMode: 'BW', duplex: false, pageRange: null })
      .expect(409);
    await t
      .http()
      .post(`/api/jobs/${job.id}/checkout`)
      .set(auth(sessionA))
      .send({ method: 'COIN' })
      .expect(409);
  });

  it('refuses the FREE method outside demo mode', async () => {
    const job = await readyJob(sessionA, 1);
    const res = await t
      .http()
      .post(`/api/jobs/${job.id}/checkout`)
      .set(auth(sessionA))
      .send({ method: 'FREE' })
      .expect(400);
    expect(res.body.code).toBe(ApiErrorCode.PAYMENT_METHOD_UNAVAILABLE);
  });
});

describe('coin machine payment', () => {
  it('counts coins once, then marks the job PAID and computes the change', async () => {
    const job = await checkedOutJob(sessionA, 3); // 0,300 DT
    const started = (await startCoins(sessionA, job.id).expect(200)).body as CoinSessionView;
    expect(started).toMatchObject({ amountDueMillimes: 300, receivedMillimes: 0 });

    const first = coin(200);
    expect(await coins.recordInserted(KIOSK.id, first)).toMatchObject({
      kind: 'partial',
      receivedMillimes: 200,
    });
    // The agent re-sends the same coin after a reconnection: not counted twice.
    expect(await coins.recordInserted(KIOSK.id, first)).toEqual({ kind: 'duplicate' });

    expect(await coins.recordInserted(KIOSK.id, coin(200))).toEqual({
      kind: 'paid',
      jobId: job.id,
      changeDueMillimes: 100,
    });

    const paid = (await t.http().get(`/api/jobs/${job.id}`).set(auth(sessionA)).expect(200))
      .body as JobView;
    expect(paid.status).toBe('PAID');
    expect(paid.payment).toMatchObject({
      provider: 'COIN',
      status: 'CONFIRMED',
      amountMillimes: 300,
      receivedMillimes: 400,
      changeDueMillimes: 100,
    });
    expect(changeDue).toEqual([
      expect.objectContaining({ kioskId: KIOSK.id, amountMillimes: 100, reason: 'CHANGE' }),
    ]);

    const kiosk = await t.prisma.kiosk.findUniqueOrThrow({ where: { id: KIOSK.id } });
    expect(kiosk.paymentJobId).toBeNull();
    const audit = await t.prisma.auditLog.findFirst({
      where: { entityId: job.id, action: 'job.paid' },
    });
    expect(audit?.actor).toBe(`agent:${KIOSK.id}`);

    // The hopper reports the change it paid back.
    const paymentId = paid.payment!.id;
    await coins.recordDispensed(KIOSK.id, { ...coin(100), paymentId });
    const payment = await t.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.changeDispensedMillimes).toBe(100);
  });

  it('serves one customer at a time; cancelling gives the coins back', async () => {
    const jobA = await checkedOutJob(sessionA, 2);
    const jobB = await checkedOutJob(sessionB, 2);

    await startCoins(sessionA, jobA.id).expect(200);
    const busy = await startCoins(sessionB, jobB.id).expect(409);
    expect(busy.body.code).toBe(ApiErrorCode.KIOSK_BUSY);

    await coins.recordInserted(KIOSK.id, coin(100));
    await t.http().delete(`/api/jobs/${jobA.id}/coin-payment`).set(auth(sessionA)).expect(204);
    expect(changeDue).toEqual([expect.objectContaining({ amountMillimes: 100, reason: 'REFUND' })]);
    const viewA = (await t.http().get(`/api/jobs/${jobA.id}`).set(auth(sessionA))).body as JobView;
    expect(viewA.status).toBe('AWAITING_PAYMENT');
    expect(viewA.payment).toMatchObject({ status: 'CANCELLED', changeDueMillimes: 100 });

    await startCoins(sessionB, jobB.id).expect(200);
    await t.http().delete(`/api/jobs/${jobB.id}/coin-payment`).set(auth(sessionB)).expect(204);
  });

  it('a lapsed reservation refunds the coins and frees the machine', async () => {
    const job = await checkedOutJob(sessionA, 2);
    await startCoins(sessionA, job.id).expect(200);
    await coins.recordInserted(KIOSK.id, coin(100));

    const later = new Date(Date.now() + TIMINGS.coinPaymentWindowMs + 60_000);
    expect(await coins.expireLapsed(later)).toBe(1);

    const kiosk = await t.prisma.kiosk.findUniqueOrThrow({ where: { id: KIOSK.id } });
    expect(kiosk.paymentJobId).toBeNull();
    expect(changeDue).toEqual([expect.objectContaining({ amountMillimes: 100, reason: 'REFUND' })]);
  });

  it('gives back a coin inserted while nobody is paying', async () => {
    expect(await coins.recordInserted(KIOSK.id, coin(500))).toEqual({
      kind: 'orphan',
      refundMillimes: 500,
    });
    expect(changeDue).toEqual([
      expect.objectContaining({ paymentId: null, amountMillimes: 500, reason: 'REFUND' }),
    ]);
  });
});

describe('counter fallback', () => {
  it('the operator confirms the payment with the pickup code', async () => {
    const admin = await t.prisma.adminUser.create({
      data: {
        email: 'op@test.tn',
        passwordHash: await hashPassword('x'.repeat(12)),
        role: 'OPERATOR',
      },
    });
    const job = await checkedOutJob(sessionA, 1);
    const counter = t.app.get(CounterPaymentService);

    await expect(counter.confirm('000000', admin.id)).rejects.toMatchObject({ status: 404 });
    expect(await counter.confirm(job.pickupCode!, admin.id)).toEqual({
      jobId: job.id,
      amountMillimes: 100,
    });

    const paid = (await t.http().get(`/api/jobs/${job.id}`).set(auth(sessionA))).body as JobView;
    expect(paid.status).toBe('PAID');
    expect(paid.payment).toMatchObject({ provider: 'COUNTER', status: 'CONFIRMED' });
    const payment = await t.prisma.payment.findUniqueOrThrow({ where: { id: paid.payment!.id } });
    expect(payment.confirmedById).toBe(admin.id);
    // Once paid, the code no longer finds a job awaiting payment.
    await expect(counter.confirm(job.pickupCode!, admin.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('expiry and cancellation', () => {
  // A fresh customer: sessionA has reached its 10-document limit by now.
  let sessionC: SessionResponse;

  beforeAll(async () => {
    sessionC = await newSession(t, KIOSK.id, KIOSK.displayKey);
  });

  it('expires a job left unpaid for 30 minutes and deletes its files', async () => {
    const job = await checkedOutJob(sessionC, 1);
    await t.prisma.printJob.update({
      where: { id: job.id },
      data: { createdAt: new Date(Date.now() - TIMINGS.unpaidJobExpiryMs - 60_000) },
    });

    expect(await t.app.get(ExpiryService).expireUnpaidJobs()).toBe(1);

    const stored = await t.prisma.printJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { files: true },
    });
    expect(stored.status).toBe('EXPIRED');
    expect(stored.activePickupCode).toBeNull();
    expect(stored.pickupCode).toBe(job.pickupCode);
    expect(stored.files[0]!.deletedAt).not.toBeNull();
    expect(t.storage.objects.has(stored.files[0]!.storageKey)).toBe(false);
  });

  it('lets the customer cancel an unpaid job; files are deleted at once', async () => {
    const job = await readyJob(sessionC, 1);
    const res = await t.http().delete(`/api/jobs/${job.id}`).set(auth(sessionC)).expect(200);
    expect((res.body as JobView).status).toBe('CANCELLED');
    const file = await t.prisma.jobFile.findFirstOrThrow({ where: { jobId: job.id } });
    expect(file.deletedAt).not.toBeNull();
  });
});
