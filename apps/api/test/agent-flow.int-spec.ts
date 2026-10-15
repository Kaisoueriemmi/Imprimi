import { ColorMode } from '@prisma/client';
import {
  type AgentAck,
  AgentEvent,
  type AgentHeartbeat,
  type CoinAccept,
  type CoinDispense,
  type JobDispatch,
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

const KIOSK = { id: 'kiosk-agent', displayKey: 'pbd_kiosk-agent' };
const AGENT_KEY = `pbk_${KIOSK.id}`; // createKiosk derives the agent key this way

let t: TestApp;
let baseUrl: string;
let session: SessionResponse;
const sockets: Socket[] = [];

/** A fake agent: records what the server sends, lets the test emit with acks. */
interface FakeAgent {
  socket: Socket;
  dispatches: JobDispatch[];
  accepts: CoinAccept[];
  dispenses: CoinDispense[];
  send: (event: string, payload: unknown) => Promise<AgentAck>;
}

function connectAgent(apiKey = AGENT_KEY): Promise<FakeAgent> {
  const socket = io(`${baseUrl}${SocketNamespace.AGENTS}`, {
    auth: { kioskId: KIOSK.id, apiKey },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  const agent: FakeAgent = {
    socket,
    dispatches: [],
    accepts: [],
    dispenses: [],
    send: (event, payload) => socket.timeout(5000).emitWithAck(event, payload) as Promise<AgentAck>,
  };
  socket.on(AgentEvent.JOB_DISPATCH, (d: JobDispatch) => agent.dispatches.push(d));
  socket.on(AgentEvent.COIN_ACCEPT, (c: CoinAccept) => agent.accepts.push(c));
  socket.on(AgentEvent.COIN_DISPENSE, (c: CoinDispense) => agent.dispenses.push(c));
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(agent));
    socket.once('connect_error', reject);
  });
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const heartbeat: AgentHeartbeat = {
  agentVersion: '0.1.0',
  printer: { name: 'HP', online: true, status: 'Normal', queuedJobs: 0, paperLevel: 'OK' },
  coinDevice: { connected: true, hopperLow: false },
  diskFreeBytes: 10_000_000_000,
  localQueue: 0,
};

const auth = () => ({ Authorization: `Bearer ${session.sessionToken}` });

/** Converted job, checked out, coin machine reserved. */
async function jobAwaitingCoins(pages: number): Promise<JobView> {
  const created = (await upload(t, session, await makePdf(pages), 'doc.pdf').expect(201))
    .body as JobView;
  await waitForConversion(t, session, created.id);
  const job = (
    await t
      .http()
      .post(`/api/jobs/${created.id}/checkout`)
      .set(auth())
      .send({ method: 'COIN' })
      .expect(200)
  ).body as JobView;
  await t.http().post(`/api/jobs/${job.id}/coin-payment`).set(auth()).expect(200);
  return job;
}

const jobStatus = async (jobId: string) =>
  (await t.prisma.printJob.findUniqueOrThrow({ where: { id: jobId } })).status;

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

describe('/agents gateway', () => {
  it('refuses an agent with a wrong key', async () => {
    await expect(connectAgent('pbk_wrong-key-0000')).rejects.toThrow(/unauthorized/);
  });

  it('records heartbeats: kiosk ONLINE, then OFFLINE on disconnect', async () => {
    const agent = await connectAgent();
    expect(await agent.send(AgentEvent.READY, {})).toEqual({ ok: true });
    expect(await agent.send(AgentEvent.HEARTBEAT, heartbeat)).toEqual({ ok: true });
    let kiosk = await t.prisma.kiosk.findUniqueOrThrow({ where: { id: KIOSK.id } });
    expect(kiosk).toMatchObject({ status: 'ONLINE', printerName: 'HP', paperLevelHint: 'OK' });

    await agent.send(AgentEvent.HEARTBEAT, {
      ...heartbeat,
      printer: { ...heartbeat.printer, status: 'PaperOut', paperLevel: 'EMPTY' },
    });
    kiosk = await t.prisma.kiosk.findUniqueOrThrow({ where: { id: KIOSK.id } });
    expect(kiosk.status).toBe('ERROR');

    expect(await agent.send(AgentEvent.HEARTBEAT, { nonsense: true })).toEqual({
      ok: false,
      error: 'INVALID_PAYLOAD',
    });

    agent.socket.disconnect();
    await until(
      async () =>
        (await t.prisma.kiosk.findUniqueOrThrow({ where: { id: KIOSK.id } })).status === 'OFFLINE',
      'kiosk OFFLINE',
    );
  });

  it('coins → PAID → change and dispatch → printed, files deleted', async () => {
    const agent = await connectAgent();
    await agent.send(AgentEvent.READY, {});
    const job = await jobAwaitingCoins(3); // 0,300 DT

    await until(
      () => agent.accepts.some((a) => a.enabled && a.jobId === job.id),
      'validator opened',
    );

    expect(
      await agent.send(AgentEvent.COIN_INSERTED, { eventId: randomUUID(), valueMillimes: 200 }),
    ).toEqual({
      ok: true,
    });
    const second = { eventId: randomUUID(), valueMillimes: 200 };
    await agent.send(AgentEvent.COIN_INSERTED, second);
    await agent.send(AgentEvent.COIN_INSERTED, second); // outbox resend: counted once

    await until(() => agent.dispatches.some((d) => d.jobId === job.id), 'job dispatched');
    expect(await jobStatus(job.id)).toBe('QUEUED');
    expect(agent.accepts.at(-1)).toMatchObject({ enabled: false });
    expect(agent.dispenses).toEqual([
      expect.objectContaining({
        amountMillimes: 100,
        commandId: expect.stringMatching(/^change:/),
      }),
    ]);
    const dispatch = agent.dispatches.find((d) => d.jobId === job.id)!;
    expect(dispatch).toMatchObject({ copies: 1, colorMode: 'BW', duplex: false, pageRange: null });
    expect(dispatch.downloadUrl).toMatch(/^http:\/\/storage\.test\/files\/.+\/original/);

    await agent.send(AgentEvent.JOB_ACK, { jobId: job.id });
    await agent.send(AgentEvent.JOB_PRINTING, { jobId: job.id });
    expect(await jobStatus(job.id)).toBe('PRINTING');
    await agent.send(AgentEvent.JOB_PRINTED, { jobId: job.id });
    expect(await agent.send(AgentEvent.JOB_PRINTED, { jobId: job.id })).toEqual({ ok: true }); // idempotent

    const stored = await t.prisma.printJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { files: true },
    });
    expect(stored.status).toBe('PRINTED');
    expect(stored.printedAt).not.toBeNull();
    expect(stored.files[0]!.deletedAt).not.toBeNull();

    // Change still owed: resent after a reconnection, until the hopper reports it.
    const command = agent.dispenses[0]!;
    agent.socket.disconnect();
    const again = await connectAgent();
    await again.send(AgentEvent.READY, {});
    await until(() => again.dispenses.length > 0, 'change resent');
    expect(again.dispenses[0]).toEqual(command);

    await again.send(AgentEvent.COIN_DISPENSED, {
      eventId: randomUUID(),
      commandId: command.commandId,
      paymentId: command.paymentId,
      valueMillimes: 100,
    });
    again.socket.disconnect();
    const third = await connectAgent();
    await third.send(AgentEvent.READY, {});
    await new Promise((r) => setTimeout(r, 200));
    expect(third.dispenses).toEqual([]);
  });

  it('a printer failure marks the job FAILED and keeps its files for a reprint', async () => {
    const agent = await connectAgent();
    await agent.send(AgentEvent.READY, {});
    const job = await jobAwaitingCoins(1);
    await agent.send(AgentEvent.COIN_INSERTED, { eventId: randomUUID(), valueMillimes: 100 });
    await until(() => agent.dispatches.some((d) => d.jobId === job.id), 'job dispatched');

    await agent.send(AgentEvent.JOB_PRINTING, { jobId: job.id });
    expect(
      await agent.send(AgentEvent.JOB_FAILED, {
        jobId: job.id,
        reason: 'PRINTER_ERROR',
        detail: 'paper jam',
      }),
    ).toEqual({ ok: true });

    const stored = await t.prisma.printJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { files: true },
    });
    expect(stored).toMatchObject({ status: 'FAILED', errorMessage: 'PRINTER_ERROR' });
    expect(stored.files[0]!.deletedAt).toBeNull();
  });

  it("rejects reports about another kiosk's job", async () => {
    const agent = await connectAgent();
    expect(await agent.send(AgentEvent.JOB_PRINTED, { jobId: 'not-mine' })).toEqual({
      ok: false,
      error: 'UNKNOWN_JOB',
    });
  });
});
