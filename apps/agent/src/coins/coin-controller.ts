import { AgentEvent, type CoinAccept, type CoinDispense } from '@printbox/shared';
import { randomUUID } from 'node:crypto';
import type { Reporter } from '../jobs/job-runner';
import type { Logger } from '../logger';
import { SerialQueue } from '../state/json-file';
import type { AgentLedger } from '../state/ledger';
import type { CoinDevice } from './coin-device';

/**
 * Bridges the coin hardware and the server. Every coin in or out is written to the outbox with
 * its own id before anything else, so the server counts it exactly once even across network
 * cuts or restarts. Pay-back commands run one at a time and at most once (ledger).
 */
export class CoinController {
  private readonly dispensing = new SerialQueue();

  constructor(
    private readonly deps: {
      device: CoinDevice;
      ledger: AgentLedger;
      reporter: Reporter;
      logger: Logger;
    },
  ) {}

  async start(): Promise<void> {
    await this.deps.device.start((valueMillimes) => {
      this.onCoinInserted(valueMillimes).catch((error: unknown) => {
        this.deps.logger.fatal({ err: error, valueMillimes }, 'Could not record an inserted coin');
      });
    });
    // Nobody pays until the server says so.
    await this.deps.device.setAccepting(false);
  }

  stop(): Promise<void> {
    return this.deps.device.stop();
  }

  status(): { connected: boolean; hopperLow: boolean } {
    return this.deps.device.status();
  }

  /** Server command: open or close the validator. */
  async accept(command: CoinAccept): Promise<void> {
    await this.deps.device.setAccepting(command.enabled);
    this.deps.logger.info(
      {
        enabled: command.enabled,
        jobId: command.jobId,
        receivedMillimes: command.receivedMillimes,
        amountDueMillimes: command.amountDueMillimes,
      },
      'Coin validator',
    );
  }

  /** Server command: pay money back (change or refund). Executed once per command id. */
  dispense(command: CoinDispense): Promise<void> {
    return this.dispensing.run(async () => {
      const { ledger, reporter, device, logger } = this.deps;
      if (ledger.isCommandDone(command.commandId)) return;

      const paid = await device.dispense(command.amountMillimes, (valueMillimes) =>
        reporter.report(AgentEvent.COIN_DISPENSED, {
          eventId: randomUUID(),
          commandId: command.commandId,
          paymentId: command.paymentId,
          valueMillimes,
        }),
      );
      if (paid < command.amountMillimes) {
        const missingMillimes = command.amountMillimes - paid;
        logger.error(
          { commandId: command.commandId, missingMillimes },
          'Hopper could not pay everything back',
        );
        await reporter.report(AgentEvent.COIN_SHORTFALL, {
          commandId: command.commandId,
          paymentId: command.paymentId,
          missingMillimes,
        });
      }
      await ledger.markCommandDone(command.commandId);
    });
  }

  private async onCoinInserted(valueMillimes: number): Promise<void> {
    await this.deps.reporter.report(AgentEvent.COIN_INSERTED, {
      eventId: randomUUID(),
      valueMillimes,
    });
    this.deps.logger.info({ valueMillimes }, 'Coin inserted');
  }
}
