import { readJsonFile, SerialQueue, writeJsonFileAtomic } from './json-file';

interface LedgerData {
  /** Jobs whose printing started (removed when printed or failed). */
  started: Record<string, string>;
  printed: Record<string, string>;
  /** Coin pay-back commands already executed. */
  commands: Record<string, string>;
}

/** Entries kept per section; older ones are pruned (the server never resends them). */
const MAX_ENTRIES = 2000;

function prune(entries: Record<string, string>): Record<string, string> {
  const sorted = Object.entries(entries).sort(([, a], [, b]) => b.localeCompare(a));
  return Object.fromEntries(sorted.slice(0, MAX_ENTRIES));
}

/**
 * What this kiosk already did, on disk. It makes the agent idempotent: a job printed once is
 * never printed again when the server resends it, a job interrupted by a crash is reported as
 * failed rather than printed twice, and a pay-back command is executed once.
 */
export class AgentLedger {
  private data: LedgerData = { started: {}, printed: {}, commands: {} };
  private readonly writes = new SerialQueue();

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    const stored = await readJsonFile<Partial<LedgerData>>(this.file, {});
    this.data = {
      started: stored.started ?? {},
      printed: stored.printed ?? {},
      commands: stored.commands ?? {},
    };
  }

  isPrinted(jobId: string): boolean {
    return jobId in this.data.printed;
  }

  isStarted(jobId: string): boolean {
    return jobId in this.data.started;
  }

  /** Jobs left "started" by a previous run that stopped mid-print. */
  interruptedJobs(): string[] {
    return Object.keys(this.data.started);
  }

  markStarted(jobId: string): Promise<void> {
    this.data.started[jobId] = new Date().toISOString();
    return this.persist();
  }

  markPrinted(jobId: string): Promise<void> {
    delete this.data.started[jobId];
    this.data.printed[jobId] = new Date().toISOString();
    return this.persist();
  }

  markFailed(jobId: string): Promise<void> {
    delete this.data.started[jobId];
    return this.persist();
  }

  isCommandDone(commandId: string): boolean {
    return commandId in this.data.commands;
  }

  markCommandDone(commandId: string): Promise<void> {
    this.data.commands[commandId] = new Date().toISOString();
    return this.persist();
  }

  private persist(): Promise<void> {
    this.data.printed = prune(this.data.printed);
    this.data.commands = prune(this.data.commands);
    const snapshot = structuredClone(this.data);
    return this.writes.run(() => writeJsonFileAtomic(this.file, snapshot));
  }
}
