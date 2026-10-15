import { ColorMode } from '@prisma/client';
import {
  type AgentAck,
  AgentEvent,
  type AgentHeartbeat,
  type JobView,
  KioskEvent,
  type KioskScreenState,
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

const KIOSK = { id: 'kiosk-screen', displayKey: 'pbd_kiosk-screen' };

let t: TestApp;
let baseUrl: string;
let session: SessionResponse;
const sockets: Socket[] = [];

interface Screen {
  socket: Socket;
  states: KioskScreenState[];
}

function connect<T>(
  namespace: string,
  auth: Record<string, string>,
  setup: (s: Socket) => T,
): Promise<T> {
  const socket = io(`${baseUrl}${namespace}`, {
    auth,
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  const result = setup(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(result));
    socket.once('connect_error', reject);
  });
}

const connectScreen = (displayKey = KIOSK.displayKey): Promise<Screen> =>
  connect(SocketNamespace.KIOSKS, { kioskId: KIOSK.id, displayKey }, (socket) => {
    const screen: Screen = { socket, states: [] };
    socket.on(KioskEvent.STATE, (state: KioskScreenState) => screen.states.push(state));
    return screen;
  });

const connectAgent = (): Promise<Socket> =>
  connect(SocketNamespace.AGENTS, { kioskId: KIOSK.id, apiKey: `pbk_${KIOSK.id}` }, (s) => s);

const send = (socket: Socket, event: string, payload: unknown) =>
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

const latest = (screen: Screen, match: (s: KioskScreenState) => boolean) => () =>
  [...screen.states].reverse().find(match);

const heartbeat = (status = 'Normal', paperLevel: 'OK' | 'EMPTY' = 'OK'): AgentHeartbeat => ({
  agentVersion: '0.1.0',
  printer: { name: 'HP', online: true, status, queuedJobs: 0, paperLevel },
  coinDevice: { connected: true, hopperLow: false },
  diskFreeBytes: 1_000_000_000,
  localQueue: 0,
});

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

describe('kiosk screen', () => {
  it('only accepts the display key of this kiosk (not the agent key)', async () => {
    await expect(connectScreen('pbd_wrong-display-key')).rejects.toThrow(/unauthorized/);
    await expect(connectScreen(`pbk_${KIOSK.id}`)).rejects.toThrow(/unauthorized/);
    await t
      .http()
      .get(`/api/kiosks/${KIOSK.id}/screen`)
      .set('Authorization', `Bearer pbk_${KIOSK.id}`)
      .expect(401);
  });

  it('shows "out of service" while the agent is offline, then follows its state', async () => {
    const screen = await connectScreen();
    const initial = await until(() => screen.states[0], 'initial state');
    expect(initial).toMatchObject({
      kioskId: KIOSK.id,
      name: `Borne ${KIOSK.id}`,
      outOfService: 'AGENT_OFFLINE',
      queue: [],
      coinPayment: null,
    });

    const agent = await connectAgent();
    await send(agent, AgentEvent.READY, {});
    await send(agent, AgentEvent.HEARTBEAT, heartbeat());
    await until(
      latest(screen, (s) => s.outOfService === null && s.status === 'ONLINE'),
      'in service',
    );

    await send(agent, AgentEvent.HEARTBEAT, heartbeat('PaperOut', 'EMPTY'));
    const error = await until(
      latest(screen, (s) => s.outOfService === 'DEVICE_ERROR'),
      'device error',
    );
    expect(error.paperLevel).toBe('EMPTY');

    agent.disconnect();
    await until(
      latest(screen, (s) => s.outOfService === 'AGENT_OFFLINE'),
      'agent offline again',
    );
  });

  it('shows the coin payment in progress and the print queue, with code hints only', async () => {
    const agent = await connectAgent();
    await send(agent, AgentEvent.READY, {});
    await send(agent, AgentEvent.HEARTBEAT, heartbeat());
    const screen = await connectScreen();

    const auth = { Authorization: `Bearer ${session.sessionToken}` };
    const created = (await upload(t, session, await makePdf(2), 'doc.pdf').expect(201))
      .body as JobView;
    await waitForConversion(t, session, created.id);
    const job = (
      await t
        .http()
        .post(`/api/jobs/${created.id}/checkout`)
        .set(auth)
        .send({ method: 'COIN' })
        .expect(200)
    ).body as JobView;
    await t.http().post(`/api/jobs/${job.id}/coin-payment`).set(auth).expect(200);

    const hint = `•••${job.pickupCode!.slice(-3)}`;
    const paying = await until(
      latest(screen, (s) => s.coinPayment !== null),
      'coin payment shown',
    );
    expect(paying.coinPayment).toMatchObject({
      codeHint: hint,
      amountDueMillimes: 200,
      receivedMillimes: 0,
    });

    await send(agent, AgentEvent.COIN_INSERTED, { eventId: randomUUID(), valueMillimes: 100 });
    await until(
      latest(screen, (s) => s.coinPayment?.receivedMillimes === 100),
      'first coin shown',
    );

    await send(agent, AgentEvent.COIN_INSERTED, { eventId: randomUUID(), valueMillimes: 100 });
    const queued = await until(
      latest(screen, (s) => s.coinPayment === null && s.queue.length > 0),
      'job in the queue',
    );
    expect(queued.queue).toEqual([{ codeHint: hint, status: 'QUEUED', pages: 2 }]);
    // The full pickup code never reaches the shared screen.
    expect(JSON.stringify(screen.states)).not.toContain(job.pickupCode!);

    await send(agent, AgentEvent.JOB_PRINTING, { jobId: job.id });
    await until(
      latest(screen, (s) => s.queue[0]?.status === 'PRINTING'),
      'printing shown',
    );
    await send(agent, AgentEvent.JOB_PRINTED, { jobId: job.id });
    await until(
      latest(screen, (s) => s.queue.length === 0),
      'queue emptied',
    );

    const rest = await t
      .http()
      .get(`/api/kiosks/${KIOSK.id}/screen`)
      .set('Authorization', `Bearer ${KIOSK.displayKey}`)
      .expect(200);
    expect(rest.body).toMatchObject({ kioskId: KIOSK.id, queue: [], coinPayment: null });
    expect(rest.headers['cache-control']).toBe('no-store');
  });
});
