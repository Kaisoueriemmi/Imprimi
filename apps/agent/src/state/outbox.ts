import type { AgentAck } from '@printbox/shared';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../logger';
import { readJsonFile, SerialQueue, writeJsonFileAtomic } from './json-file';

export interface OutboxMessage {
  id: string;
  event: string;
  payload: unknown;
  createdAt: string;
}

/** Sends one message and resolves with the server acknowledgement (rejects on timeout/offline). */
export type SendWithAck = (event: string, payload: unknown) => Promise<AgentAck>;

/** Server answers meaning "this message will never be accepted": drop it instead of retrying. */
const PERMANENT_ERRORS = new Set(['INVALID_PAYLOAD', 'UNKNOWN_JOB']);

/**
 * Persistent queue of agent → server messages (job statuses, coins). A message is written to
 * disk before anything else happens, and removed only once the server acknowledged it, so
 * neither a network cut nor a crash loses a status report or a coin.
 */
export class Outbox {
  private messages: OutboxMessage[] = [];
  private readonly writes = new SerialQueue();
  private flushing: Promise<boolean> | null = null;

  constructor(
    private readonly file: string,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<void> {
    this.messages = await readJsonFile<OutboxMessage[]>(this.file, []);
    if (this.messages.length > 0) {
      this.logger.info({ pending: this.messages.length }, 'Outbox restored');
    }
  }

  get size(): number {
    return this.messages.length;
  }

  /** Persists the message; resolves once it is on disk. */
  async add(event: string, payload: unknown): Promise<void> {
    this.messages.push({ id: randomUUID(), event, payload, createdAt: new Date().toISOString() });
    await this.persist();
  }

  /**
   * Sends the messages in order, one at a time. Stops at the first failure (offline, timeout,
   * server error) and keeps the rest for the next attempt. Resolves true when empty.
   */
  flush(send: SendWithAck): Promise<boolean> {
    this.flushing ??= this.doFlush(send).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(send: SendWithAck): Promise<boolean> {
    while (this.messages.length > 0) {
      const message = this.messages[0]!;
      let ack: AgentAck;
      try {
        ack = await send(message.event, message.payload);
      } catch {
        return false;
      }
      if (!ack.ok && !PERMANENT_ERRORS.has(ack.error ?? '')) return false;
      if (!ack.ok) {
        this.logger.warn({ event: message.event, error: ack.error }, 'Message rejected, dropped');
      }
      this.messages.shift();
      await this.persist();
    }
    return true;
  }

  private persist(): Promise<void> {
    const snapshot = [...this.messages];
    return this.writes.run(() => writeJsonFileAtomic(this.file, snapshot));
  }
}
