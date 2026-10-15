/* eslint-disable no-console -- placeholder entry point until the structured logger lands in Phase 4. */
import { resolve } from 'node:path';
import { loadAgentConfig } from './config';

async function main(): Promise<void> {
  const configPath = resolve(process.env.PRINTBOX_AGENT_CONFIG ?? 'agent.config.json');
  const config = await loadAgentConfig(configPath);
  console.log(`PrintBox agent configured for kiosk "${config.kioskId}" -> ${config.apiUrl}`);
  console.log('Socket.IO connection, heartbeat and printing arrive in Phase 4.');
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
