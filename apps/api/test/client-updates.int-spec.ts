import { ColorMode } from '@prisma/client';
import {
  type AgentAck,
  AgentEvent,
  ClientEvent,
  type JobView,
  type SessionResponse,
  SocketNamespace,
} from '@printbox/shared';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from '../src/testing/fixtures';
import {
  createKiosk,
  newSession,
  startTestApp,
  type TestApp,
  upload,
  waitForConversion,
} from './support/test-app';

const KIOSK = { id: 'kiosk-phone', displayKey: 'pbd_kiosk-phone' };

let t: TestApp;
let baseUrl: string;
let session: SessionResponse;
const sockets: Socket[] = [];

function connect(namespace: string, auth: Record<string, string>): Promise<Socket> {
  const socket = io(`${baseUrl}${namespace}`, {
    auth,
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const ack = (socket: Socket, event: string, payload: unknown) =>
  socket.timeout(5000).emitWithAck(event, payload) as Promise<AgentAck>;

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

beforeAll(async () => {
  t = await startTestApp();
  baseUrl = (await t.app.getUrl()).replace('[::1]', '127.0.0.1');
  await createKiosk(t, KIOSK);
  await t.prisma.pricingRule.create({
    data: {
      kioskId: null,
      colorMode: ColorMode.BW,
      pricePerPageMillimes: 100,
      duplexDiscountPercent: 0,
    },
  });
  session = await newSession(t, KIOSK.id, KIOSK.displayKey);
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.disconnect();
});

afterAll(async () => {
  await t?.close();
});

describe('/clients live job updates', () => {
  it('refuses an invalid session token', async () => {
    await expect(
      connect(SocketNamespace.CLIENTS, { sessionToken: 'x'.repeat(40) }),
    ).rejects.toThrow(/unauthorized/);
  });

  it("follows the customer's own job from payment to printed, not someone else's", async () => {
    const auth = { Authorization: `Bearer ${session.sessionToken}` };
    const created = (await upload(t, session, await makePdf(1), 'doc.pdf').expect(201))
      .body as JobView;
    await waitForConversion(t, session, created.id);
    await t
      .http()
      .post(`/api/jobs/${created.id}/checkout`)
      .set(auth)
      .send({ method: 'COIN' })
      .expect(200);

    const phone = await connect(SocketNamespace.CLIENTS, { sessionToken: session.sessionToken });
    const updates: JobView[] = [];
    phone.on(ClientEvent.JOB_STATUS, (view: JobView) => updates.push(view));
    expect(await ack(phone, ClientEvent.SUBSCRIBE, { jobId: created.id })).toEqual({ ok: true });
    await until(() => updates.find((u) => u.status === 'AWAITING_PAYMENT'), 'initial view');

    const stranger = await newSession(t, KIOSK.id, KIOSK.displayKey);
    const otherPhone = await connect(SocketNamespace.CLIENTS, {
      sessionToken: stranger.sessionToken,
    });
    expect(await ack(otherPhone, ClientEvent.SUBSCRIBE, { jobId: created.id })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });

    const agent = await connect(SocketNamespace.AGENTS, {
      kioskId: KIOSK.id,
      apiKey: `pbk_${KIOSK.id}`,
    });
    await ack(agent, AgentEvent.READY, {});
    await t.http().post(`/api/jobs/${created.id}/coin-payment`).set(auth).expect(200);
    await ack(agent, AgentEvent.COIN_INSERTED, { eventId: randomUUID(), valueMillimes: 100 });
    await until(() => updates.find((u) => u.status === 'QUEUED'), 'queued after payment');

    await ack(agent, AgentEvent.JOB_PRINTING, { jobId: created.id });
    await ack(agent, AgentEvent.JOB_PRINTED, { jobId: created.id });
    const printed = await until(() => updates.find((u) => u.status === 'PRINTED'), 'printed');
    expect(printed.payment).toMatchObject({ provider: 'COIN', status: 'CONFIRMED' });
  });
});
