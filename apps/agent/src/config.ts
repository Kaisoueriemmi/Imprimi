import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export const agentConfigSchema = z.object({
  /** Base URL of the PrintBox API, e.g. https://api.printbox.tn */
  apiUrl: z.url(),
  kioskId: z.string().min(1),
  /** Agent key printed when the kiosk was created (`pbk_…`). */
  apiKey: z.string().startsWith('pbk_'),
  /** Exact Windows printer name, as shown by `Get-Printer`. */
  printerName: z.string().min(1),
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
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new AgentConfigError(`${path} is not valid JSON`);
  }
  return parseAgentConfig(raw);
}
