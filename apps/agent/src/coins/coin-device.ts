/**
 * Coin machine hardware: a validator that accepts coins and a hopper that pays coins back.
 * Implementations: SimulatedCoinDevice (development, tests); a ccTalk driver once the hardware
 * is chosen (see DECISIONS.md D27).
 */
export interface CoinDevice {
  readonly name: string;
  /** Starts the device; `onCoin` is called for every coin the validator accepted. */
  start(onCoin: (valueMillimes: number) => void): Promise<void>;
  stop(): Promise<void>;
  /** Inhibited validators reject coins (they drop back into the return tray). */
  setAccepting(enabled: boolean): Promise<void>;
  /**
   * Pays back up to `amountMillimes`, calling `onCoinOut` after each coin really left the
   * hopper. Resolves with the amount paid, which is lower when the hopper runs out.
   */
  dispense(
    amountMillimes: number,
    onCoinOut: (valueMillimes: number) => Promise<void>,
  ): Promise<number>;
  status(): { connected: boolean; hopperLow: boolean };
}

/** Real coin hardware over ccTalk: not implemented until the device model is chosen. */
export class CcTalkCoinDevice implements CoinDevice {
  readonly name = 'cctalk';

  constructor(private readonly port: string | undefined) {}

  start(): Promise<void> {
    return Promise.reject(
      new Error(
        `ccTalk driver not implemented yet (port ${this.port ?? 'unset'}): choose the coin ` +
          'validator and hopper first, then implement this class (DECISIONS.md D27).',
      ),
    );
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }

  setAccepting(): Promise<void> {
    return Promise.reject(new Error('ccTalk driver not implemented'));
  }

  dispense(): Promise<number> {
    return Promise.reject(new Error('ccTalk driver not implemented'));
  }

  status(): { connected: boolean; hopperLow: boolean } {
    return { connected: false, hopperLow: false };
  }
}
