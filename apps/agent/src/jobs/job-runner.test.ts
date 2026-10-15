import { AgentEvent, type JobDispatch } from '@printbox/shared';
import { access, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../logger';
import { FakePrinter } from '../printing/fake-printer';
import { PrintError } from '../printing/printer';
import { AgentLedger } from '../state/ledger';
import { buildTestPdf } from '../test-pdf';
import { JobRunner, type Reporter } from './job-runner';

let dir: string;
let workDir: string;
let printer: FakePrinter;
let ledger: AgentLedger;
let reports: Array<{ event: string; payload: { jobId?: string; reason?: string } }>;
let downloads: string[];

const reporter: Reporter = {
  report: async (event, payload) => {
    reports.push({ event, payload: payload as { jobId?: string; reason?: string } });
  },
};

const fakeDownload = async (url: string, destination: string): Promise<void> => {
  downloads.push(url);
  if (url.includes('expired')) throw new Error('HTTP 403');
  await writeFile(destination, buildTestPdf([url]));
};

function dispatch(jobId: string, extra: Partial<JobDispatch> = {}): JobDispatch {
  return {
    jobId,
    downloadUrl: `http://storage.test/${jobId}`,
    copies: 1,
    colorMode: 'BW',
    duplex: false,
    pageRange: null,
    ...extra,
  };
}

function runner(): JobRunner {
  return new JobRunner({
    printer,
    ledger,
    reporter,
    workDir,
    logger: silentLogger(),
    download: fakeDownload,
  });
}

const eventsOf = (jobId: string) =>
  reports.filter((r) => r.payload.jobId === jobId).map((r) => r.event);

const failureReasons = () =>
  reports.filter((r) => r.event === AgentEvent.JOB_FAILED).map((r) => r.payload.reason);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'printbox-agent-test-'));
  workDir = join(dir, 'work');
  await mkdir(workDir);
  printer = new FakePrinter(join(dir, 'out'));
  ledger = new AgentLedger(join(dir, 'ledger.json'));
  await ledger.load();
  reports = [];
  downloads = [];
});

describe('JobRunner', () => {
  it('acks, prints and reports, then deletes the local PDF', async () => {
    const jobs = runner();
    await jobs.receive(dispatch('j1', { copies: 2, pageRange: '1-2' }));
    await jobs.idle();

    expect(eventsOf('j1')).toEqual([
      AgentEvent.JOB_ACK,
      AgentEvent.JOB_PRINTING,
      AgentEvent.JOB_PRINTED,
    ]);
    expect(printer.printed.map((p) => [p.jobId, p.copies, p.pageRange])).toEqual([
      ['j1', 2, '1-2'],
    ]);
    await access(join(dir, 'out', 'j1.pdf'));
    expect(await readdir(workDir)).toEqual([]);
  });

  it('prints jobs one at a time, in arrival order', async () => {
    const jobs = runner();
    for (const id of ['a', 'b', 'c']) await jobs.receive(dispatch(id));
    await jobs.idle();
    expect(printer.printed.map((p) => p.jobId)).toEqual(['a', 'b', 'c']);
  });

  it('never prints a job twice, even when the server resends it', async () => {
    const jobs = runner();
    await jobs.receive(dispatch('j1'));
    await jobs.idle();
    await jobs.receive(dispatch('j1'));
    await jobs.idle();

    expect(printer.printed).toHaveLength(1);
    // The resend is answered "printed" again, so a lost report is repaired.
    expect(eventsOf('j1').filter((e) => e === AgentEvent.JOB_PRINTED)).toHaveLength(2);
  });

  it('reports a printer error and still deletes the local PDF', async () => {
    const jobs = runner();
    printer.failNext = new PrintError('PRINTER_ERROR', 'paper jam');
    await jobs.receive(dispatch('j1'));
    await jobs.idle();

    expect(eventsOf('j1')).toEqual([
      AgentEvent.JOB_ACK,
      AgentEvent.JOB_PRINTING,
      AgentEvent.JOB_FAILED,
    ]);
    expect(failureReasons()).toEqual(['PRINTER_ERROR']);
    expect(await readdir(workDir)).toEqual([]);
    expect(ledger.isStarted('j1')).toBe(false);
  });

  it('reports a failed download without printing', async () => {
    const jobs = runner();
    await jobs.receive(dispatch('expired-job'));
    await jobs.idle();
    expect(printer.printed).toHaveLength(0);
    expect(failureReasons()).toEqual(['DOWNLOAD_FAILED']);
  });

  it('on restart, reports a job interrupted mid-print as failed instead of printing it again', async () => {
    await ledger.markStarted('j-crash');
    await runner().recoverInterrupted();

    expect(printer.printed).toHaveLength(0);
    expect(failureReasons()).toEqual(['INTERRUPTED']);
    expect(ledger.interruptedJobs()).toEqual([]);
  });

  it('answers INTERRUPTED, without downloading, to a resend of a job that was mid-print', async () => {
    await ledger.markStarted('j-crash');
    const jobs = runner();
    await jobs.receive(dispatch('j-crash'));
    await jobs.idle();

    expect(downloads).toEqual([]);
    expect(printer.printed).toHaveLength(0);
    expect(failureReasons()).toEqual(['INTERRUPTED']);
  });
});
