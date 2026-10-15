import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CoinController } from './coins/coin-controller';
import { CcTalkCoinDevice, type CoinDevice } from './coins/coin-device';
import { SimulatedCoinDevice } from './coins/simulated-coin-device';
import type { AgentConfig } from './config';
import { AgentClient } from './connection/agent-client';
import { collectHeartbeat } from './heartbeat';
import { JobRunner, type Reporter } from './jobs/job-runner';
import type { Logger } from './logger';
import { FakePrinter } from './printing/fake-printer';
import type { Printer } from './printing/printer';
import { ensureSumatra } from './printing/sumatra-installer';
import { WindowsSumatraPrinter } from './printing/windows-sumatra-printer';
import { AgentLedger } from './state/ledger';
import { Outbox } from './state/outbox';

/** SumatraPDF path, resolved (downloaded if needed) once and shared. */
function sumatraResolver(config: AgentConfig, logger: Logger): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= ensureSumatra(config.dataDir, logger, config.sumatraPath).catch(
      (error: unknown) => {
        pending = null; // retry on the next job
        throw error;
      },
    );
    return pending;
  };
}

export function createPrinter(config: AgentConfig, logger: Logger): Printer {
  return config.printer === 'fake'
    ? new FakePrinter(join(config.dataDir, 'out'))
    : new WindowsSumatraPrinter(config.printerName, sumatraResolver(config, logger), logger);
}

function createCoinDevice(config: AgentConfig, logger: Logger): CoinDevice | null {
  const { coinDevice } = config;
  switch (coinDevice.driver) {
    case 'none':
      return null;
    case 'simulated':
      return new SimulatedCoinDevice({
        port: coinDevice.simulatorPort,
        hopper: coinDevice.simulatedHopper,
        logger,
      });
    case 'cctalk':
      return new CcTalkCoinDevice(coinDevice.port);
  }
}

/** The running agent: connection, local print queue, coin machine, heartbeat. */
export class Agent {
  private client: AgentClient | null = null;
  private runner: JobRunner | null = null;
  private coins: CoinController | null = null;

  constructor(
    private readonly config: AgentConfig,
    private readonly logger: Logger,
    private readonly overrides: { printer?: Printer; coinDevice?: CoinDevice | null } = {},
  ) {}

  async start(): Promise<void> {
    const { config, logger } = this;
    const workDir = join(config.dataDir, 'work');
    // Leftover PDFs of a previous run are never printed from disk: the server resends the jobs.
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });

    const outbox = new Outbox(join(config.dataDir, 'outbox.json'), logger);
    const ledger = new AgentLedger(join(config.dataDir, 'ledger.json'));
    await Promise.all([outbox.load(), ledger.load()]);

    const reporter: Reporter = {
      report: async (event, payload) => {
        await outbox.add(event, payload);
        this.client?.requestFlush();
      },
    };

    const printer = this.overrides.printer ?? createPrinter(config, logger);
    const runner = new JobRunner({ printer, ledger, reporter, workDir, logger });
    this.runner = runner;

    const device =
      this.overrides.coinDevice === undefined
        ? createCoinDevice(config, logger)
        : this.overrides.coinDevice;
    if (device) {
      this.coins = new CoinController({ device, ledger, reporter, logger });
      await this.coins.start();
    }
    const coins = this.coins;

    await runner.recoverInterrupted();

    this.client = new AgentClient({
      config,
      logger,
      outbox,
      handlers: {
        dispatch: (job) => runner.receive(job),
        coinAccept: async (command) => {
          if (coins) await coins.accept(command);
          else if (command.enabled)
            logger.warn('Coin payment requested but no coin device is configured');
        },
        coinDispense: async (command) => {
          if (coins) await coins.dispense(command);
          else
            logger.error({ commandId: command.commandId }, 'Pay-back requested but no coin device');
        },
      },
      heartbeat: () =>
        collectHeartbeat({
          printer,
          coins,
          localQueue: () => runner.size,
          dataDir: config.dataDir,
        }),
    });
    this.client.start();
    logger.info(
      { printer: config.printer, coinDevice: config.coinDevice.driver, api: config.apiUrl },
      'PrintBox agent started',
    );
  }

  /** Stops accepting coins and work, lets the current print finish (up to 60 s). */
  async stop(): Promise<void> {
    this.client?.stop();
    await this.coins?.stop();
    await Promise.race([this.runner?.idle(), new Promise((r) => setTimeout(r, 60_000))]);
    this.logger.info('PrintBox agent stopped');
  }
}
