import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const hopperSlotSchema = z.object({
  valueMillimes: z.number().int().positive(),
  count: z.number().int().nonnegative(),
});

export const agentConfigSchema = z.object({
  /** Base URL of the PrintBox API, e.g. https://api.printbox.tn */
  apiUrl: z.url(),
  kioskId: z.string().min(1),
  /** Agent key printed when the kiosk was created (`pbk_…`). */
  apiKey: z.string().startsWith('pbk_'),
  /** Exact Windows printer name, as shown by `printbox-agent printers`. */
  printerName: z.string().min(1),
  /** `fake` writes the PDFs to `<dataDir>/out` instead of printing (development, tests). */
  printer: z.enum(['windows', 'fake']).default('windows'),
  /** SumatraPDF.exe; when absent, a pinned portable version is downloaded into dataDir. */
  sumatraPath: z.string().min(1).optional(),
  /** Outbox, ledger and temporary PDFs. Relative paths are resolved from the config file. */
  dataDir: z.string().min(1).default('data'),
  coinDevice: z
    .object({
      /** `none`: no coin machine (counter payment only). `cctalk`: real hardware (not yet). */
      driver: z.enum(['none', 'simulated', 'cctalk']).default('none'),
      /** Serial port of the ccTalk bus, e.g. COM3. */
      port: z.string().optional(),
      /** Local HTTP port of the simulator (127.0.0.1 only). */
      simulatorPort: z.number().int().min(1024).max(65535).default(7575),
      /** Coins in the simulated hopper. */
      simulatedHopper: z.array(hopperSlotSchema).default([
        { valueMillimes: 500, count: 50 },
        { valueMillimes: 200, count: 50 },
        { valueMillimes: 100, count: 100 },
      ]),
    })
    .prefault({}),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export class AgentConfigError extends Error {
  override name = 'AgentConfigError';
}

/** Parses a raw config object; the error message lists every invalid field (never the key itself). */
export function parseAgentConfig(raw: unknown): AgentConfig {
  const result = agentConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new AgentConfigError(`Invalid agent.config.json:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Reads and validates the config; relative paths are made absolute from the file's folder. */
export async function loadAgentConfig(path: string): Promise<AgentConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new AgentConfigError(`Cannot read ${path}: ${(error as Error).message}`);
  }
  let raw: unknown;
  try {
    // Notepad on Windows may save a UTF-8 BOM.
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new AgentConfigError(`${path} is not valid JSON`);
  }
  const config = parseAgentConfig(raw);
  const base = dirname(resolve(path));
  const absolute = (p: string): string => (isAbsolute(p) ? p : resolve(base, p));
  return {
    ...config,
    dataDir: absolute(config.dataDir),
    ...(config.sumatraPath ? { sumatraPath: absolute(config.sumatraPath) } : {}),
  };
}
