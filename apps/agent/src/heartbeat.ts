import type { AgentHeartbeat } from '@printbox/shared';
import { statfs } from 'node:fs/promises';
import type { CoinController } from './coins/coin-controller';
import type { Printer } from './printing/printer';
import { AGENT_VERSION } from './version';

/** Everything the server shows about this kiosk (and alerts on). */
export async function collectHeartbeat(deps: {
  printer: Printer;
  coins: CoinController | null;
  localQueue: () => number;
  dataDir: string;
}): Promise<AgentHeartbeat> {
  const [printer, disk] = await Promise.all([deps.printer.state(), statfs(deps.dataDir)]);
  return {
    agentVersion: AGENT_VERSION,
    printer,
    coinDevice: deps.coins ? deps.coins.status() : null,
    diskFreeBytes: Math.max(0, Math.floor(Number(disk.bavail) * Number(disk.bsize))),
    localQueue: deps.localQueue(),
  };
}
