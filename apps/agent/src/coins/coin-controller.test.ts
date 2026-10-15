import { AgentEvent } from '@printbox/shared';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Reporter } from '../jobs/job-runner';
import { silentLogger } from '../logger';
import { AgentLedger } from '../state/ledger';
import { CoinController } from './coin-controller';
import { SimulatedCoinDevice } from './simulated-coin-device';

let device: SimulatedCoinDevice;
let coins: CoinController;
let reports: Array<{ event: string; payload: Record<string, unknown> }>;

const reporter: Reporter = {
  report: async (event, payload) => {
    reports.push({ event, payload: payload as Record<string, unknown> });
  },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'printbox-agent-test-'));
  const ledger = new AgentLedger(join(dir, 'ledger.json'));
  await ledger.load();
  device = new SimulatedCoinDevice({
    port: null,
    hopper: [
      { valueMillimes: 500, count: 1 },
      { valueMillimes: 100, count: 3 },
    ],
    logger: silentLogger(),
  });
  coins = new CoinController({ device, ledger, reporter, logger: silentLogger() });
  await coins.start();
  reports = [];
});

describe('CoinController', () => {
  it('rejects coins until the server opens the validator', async () => {
    expect(device.insert(500)).toBe(false);

    await coins.accept({ enabled: true, jobId: 'j1', amountDueMillimes: 700, receivedMillimes: 0 });
    expect(device.insert(500)).toBe(true);
    await flush();
    expect(reports).toEqual([
      {
        event: AgentEvent.COIN_INSERTED,
        payload: { eventId: expect.any(String), valueMillimes: 500 },
      },
    ]);

    await coins.accept({ enabled: false, jobId: null, amountDueMillimes: 0, receivedMillimes: 0 });
    expect(device.insert(200)).toBe(false);
  });

  it('gives each coin its own id, for server-side idempotence', async () => {
    await coins.accept({
      enabled: true,
      jobId: 'j1',
      amountDueMillimes: 1000,
      receivedMillimes: 0,
    });
    device.insert(100);
    device.insert(100);
    await flush();
    const ids = reports.map((r) => r.payload.eventId);
    expect(new Set(ids).size).toBe(2);
  });

  it('pays change back coin by coin, once per command', async () => {
    const command = { commandId: 'change:p1:600', paymentId: 'p1', amountMillimes: 600 };
    await coins.dispense(command);
    await coins.dispense(command); // resent after a reconnection

    const dispensed = reports.filter((r) => r.event === AgentEvent.COIN_DISPENSED);
    expect(dispensed.map((r) => r.payload.valueMillimes)).toEqual([500, 100]);
    expect(dispensed.every((r) => r.payload.commandId === 'change:p1:600')).toBe(true);
  });

  it('reports a shortfall when the hopper runs out', async () => {
    await coins.dispense({ commandId: 'refund:p2:1000', paymentId: 'p2', amountMillimes: 1000 });
    // Hopper: 500 + 3 × 100 = 800 → 200 missing.
    expect(reports.at(-1)).toEqual({
      event: AgentEvent.COIN_SHORTFALL,
      payload: { commandId: 'refund:p2:1000', paymentId: 'p2', missingMillimes: 200 },
    });
    expect(coins.status().hopperLow).toBe(true);
  });
});
