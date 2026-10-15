/* eslint-disable no-console -- command-line interface: console output is the product. */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Agent, createPrinter } from './agent';
import { loadAgentConfig } from './config';
import { createLogger } from './logger';
import { LIST_PRINTERS_SCRIPT, parseJsonList, runPowerShell } from './printing/powershell';
import { buildTestPdf } from './test-pdf';
import { AGENT_VERSION } from './version';

const HELP = `PrintBox agent ${AGENT_VERSION}

Usage: printbox-agent [command] [--config <path>]

Commands:
  run                    Connect to the API and print (default; what the Windows service runs)
  test-print             Print a test page on the configured printer
  printers               List the Windows printers (to fill "printerName")
  simulate-coin <value>  Insert a coin in the simulated coin machine (millimes, e.g. 500)
  check-config           Validate the config file
  version                Print the agent version

The config file defaults to agent.config.json next to the executable.`;

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Folder of printbox-agent.exe when packaged, the current folder otherwise. */
function defaultConfigPath(): string {
  const packaged = (process as NodeJS.Process & { pkg?: unknown }).pkg !== undefined;
  return join(packaged ? dirname(process.execPath) : process.cwd(), 'agent.config.json');
}

async function run(configPath: string): Promise<void> {
  const config = await loadAgentConfig(configPath);
  const logger = createLogger(config.logLevel, config.kioskId);
  const agent = new Agent(config, logger);
  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down');
    void agent.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (error) => logger.error({ err: error }, 'Unhandled rejection'));
  await agent.start();
}

async function testPrint(configPath: string): Promise<void> {
  const config = await loadAgentConfig(configPath);
  const logger = createLogger(config.logLevel, config.kioskId);
  const printer = createPrinter(config, logger);
  const workDir = join(config.dataDir, 'work');
  await mkdir(workDir, { recursive: true });
  const jobId = `test-${Date.now()}`;
  const pdfPath = join(workDir, `printbox-${jobId}.pdf`);
  await writeFile(
    pdfPath,
    buildTestPdf([
      'PrintBox - page de test',
      `Borne : ${config.kioskId}`,
      `Imprimante : ${config.printerName}`,
      `Agent ${AGENT_VERSION} - ${new Date().toISOString()}`,
    ]),
  );
  try {
    console.log(`Printing a test page on "${config.printerName}" (${config.printer})...`);
    await printer.print({
      jobId,
      pdfPath,
      copies: 1,
      colorMode: 'BW',
      duplex: false,
      pageRange: null,
    });
    console.log('Test page printed.');
  } finally {
    await rm(pdfPath, { force: true });
  }
}

async function listPrinters(): Promise<void> {
  const printers = parseJsonList<{ Name: string; Status: string }>(
    await runPowerShell(LIST_PRINTERS_SCRIPT),
  );
  if (printers.length === 0) console.log('No printer found.');
  for (const printer of printers) console.log(`${printer.Name}    (${printer.Status})`);
}

async function simulateCoin(configPath: string, value: string | undefined): Promise<void> {
  const config = await loadAgentConfig(configPath);
  const millimes = Number(value);
  if (!Number.isSafeInteger(millimes) || millimes <= 0) {
    throw new Error('Usage: printbox-agent simulate-coin <millimes>, e.g. 500 for 0,500 DT');
  }
  const res = await fetch(
    `http://127.0.0.1:${config.coinDevice.simulatorPort}/coin?value=${millimes}`,
    { method: 'POST' },
  );
  console.log(
    res.status === 200
      ? `Coin of ${millimes} millimes accepted.`
      : res.status === 409
        ? 'Coin rejected: nobody is paying right now (validator inhibited).'
        : `Simulator answered HTTP ${res.status}.`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith('--') ? args[0] : 'run';
  const configPath = resolve(
    option(args, '--config') ?? process.env.PRINTBOX_AGENT_CONFIG ?? defaultConfigPath(),
  );

  switch (command) {
    case 'run':
      return run(configPath);
    case 'test-print':
      return testPrint(configPath);
    case 'printers':
      return listPrinters();
    case 'simulate-coin':
      return simulateCoin(configPath, args[1]);
    case 'check-config': {
      const config = await loadAgentConfig(configPath);
      console.log(`Configuration OK: kiosk "${config.kioskId}", printer "${config.printerName}".`);
      return;
    }
    case 'version':
      console.log(AGENT_VERSION);
      return;
    case 'help':
    case '--help':
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command "${command}". Run "printbox-agent help".`);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
