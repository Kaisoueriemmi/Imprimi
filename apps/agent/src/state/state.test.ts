import type { AgentAck } from '@printbox/shared';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../logger';
import { AgentLedger } from './ledger';
import { Outbox } from './outbox';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'printbox-agent-test-'));
});

describe('Outbox', () => {
  it('survives a restart and keeps messages until acknowledged', async () => {
    const file = join(dir, 'outbox.json');
    const outbox = new Outbox(file, silentLogger());
    await outbox.load();
    await outbox.add('coin:inserted', { valueMillimes: 500 });
    await outbox.add('job:printed', { jobId: 'j1' });

    // Offline: nothing is lost.
    expect(await outbox.flush(() => Promise.reject(new Error('offline')))).toBe(false);

    const restarted = new Outbox(file, silentLogger());
    await restarted.load();
    expect(restarted.size).toBe(2);

    const sent: string[] = [];
    const ok = (event: string): Promise<AgentAck> => {
      sent.push(event);
      return Promise.resolve({ ok: true });
    };
    expect(await restarted.flush(ok)).toBe(true);
    expect(sent).toEqual(['coin:inserted', 'job:printed']);
    expect(restarted.size).toBe(0);
  });

  it('stops at a temporary server error, drops permanently rejected messages', async () => {
    const outbox = new Outbox(join(dir, 'outbox.json'), silentLogger());
    await outbox.add('job:printed', { jobId: 'unknown' });
    await outbox.add('job:printed', { jobId: 'j2' });

    const answers: AgentAck[] = [
      { ok: false, error: 'UNKNOWN_JOB' },
      { ok: false, error: 'INTERNAL' },
    ];
    expect(await outbox.flush(() => Promise.resolve(answers.shift()!))).toBe(false);
    expect(outbox.size).toBe(1); // the INTERNAL one is kept for a retry
  });
});

describe('AgentLedger', () => {
  it('remembers printed jobs, interrupted jobs and executed commands across restarts', async () => {
    const file = join(dir, 'ledger.json');
    const ledger = new AgentLedger(file);
    await ledger.load();
    await ledger.markStarted('j1');
    await ledger.markPrinted('j1');
    await ledger.markStarted('j2');
    await ledger.markCommandDone('change:p1:300');

    const restarted = new AgentLedger(file);
    await restarted.load();
    expect(restarted.isPrinted('j1')).toBe(true);
    expect(restarted.interruptedJobs()).toEqual(['j2']);
    expect(restarted.isCommandDone('change:p1:300')).toBe(true);
    expect(restarted.isCommandDone('change:p1:100')).toBe(false);
  });
});
