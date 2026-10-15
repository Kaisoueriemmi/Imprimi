import { createServer, type Server } from 'node:http';
import type { Logger } from '../logger';
import type { CoinDevice } from './coin-device';

export interface HopperSlot {
  valueMillimes: number;
  count: number;
}

/** Below this many coins the hopper reports "low" (heartbeat), like a real level sensor. */
const HOPPER_LOW_THRESHOLD = 10;

/**
 * Coin machine simulator. Coins are "inserted" with `printbox-agent simulate-coin <millimes>`,
 * which calls a small HTTP endpoint bound to 127.0.0.1 only:
 *   POST /coin?value=500  → 200 {accepted:true}, or 409 when the validator is inhibited
 *   GET  /state           → accepting flag and hopper contents
 * The hopper pays back greedily with the largest coins it holds.
 */
export class SimulatedCoinDevice implements CoinDevice {
  readonly name = 'simulated';
  private accepting = false;
  private onCoin: ((valueMillimes: number) => void) | null = null;
  private server: Server | null = null;
  private readonly hopper: Map<number, number>;

  constructor(
    private readonly options: { port: number | null; hopper: HopperSlot[]; logger: Logger },
  ) {
    this.hopper = new Map(options.hopper.map((slot) => [slot.valueMillimes, slot.count]));
  }

  async start(onCoin: (valueMillimes: number) => void): Promise<void> {
    this.onCoin = onCoin;
    if (this.options.port === null) return;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && url.pathname === '/coin') {
        const value = Number(url.searchParams.get('value'));
        if (!Number.isSafeInteger(value) || value <= 0) {
          res
            .writeHead(400)
            .end(JSON.stringify({ error: 'value must be a positive integer of millimes' }));
          return;
        }
        const accepted = this.insert(value);
        res.writeHead(accepted ? 200 : 409).end(JSON.stringify({ accepted }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/state') {
        res.end(
          JSON.stringify({ accepting: this.accepting, hopper: Object.fromEntries(this.hopper) }),
        );
        return;
      }
      res.writeHead(404).end('{}');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port!, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.options.logger.info({ port: this.options.port }, 'Coin simulator listening on 127.0.0.1');
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
    this.server = null;
  }

  /** A coin put in the slot. Returns false when the validator rejects it (inhibited). */
  insert(valueMillimes: number): boolean {
    if (!this.accepting || !this.onCoin) return false;
    this.onCoin(valueMillimes);
    return true;
  }

  async setAccepting(enabled: boolean): Promise<void> {
    this.accepting = enabled;
  }

  get isAccepting(): boolean {
    return this.accepting;
  }

  async dispense(
    amountMillimes: number,
    onCoinOut: (valueMillimes: number) => Promise<void>,
  ): Promise<number> {
    let paid = 0;
    const values = [...this.hopper.keys()].sort((a, b) => b - a);
    for (const value of values) {
      while (paid + value <= amountMillimes && (this.hopper.get(value) ?? 0) > 0) {
        this.hopper.set(value, (this.hopper.get(value) ?? 0) - 1);
        paid += value;
        await onCoinOut(value);
      }
    }
    return paid;
  }

  status(): { connected: boolean; hopperLow: boolean } {
    const coins = [...this.hopper.values()].reduce((sum, count) => sum + count, 0);
    return { connected: true, hopperLow: coins < HOPPER_LOW_THRESHOLD };
  }
}
