import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../logger';
import { runPowerShell } from './powershell';

/** Pinned portable SumatraPDF: the download is checked against this SHA-256 before use. */
export const SUMATRA = {
  version: '3.6.1',
  url: 'https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip',
  sha256: '98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544',
  exe: 'SumatraPDF-3.6.1-64.exe',
} as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Path of SumatraPDF.exe: the configured one, or the portable copy in `<dataDir>/sumatra`,
 * downloaded and verified on first use.
 */
export async function ensureSumatra(
  dataDir: string,
  logger: Logger,
  configuredPath?: string,
): Promise<string> {
  if (configuredPath) {
    if (!(await exists(configuredPath)))
      throw new Error(`sumatraPath not found: ${configuredPath}`);
    return configuredPath;
  }
  const directory = join(dataDir, 'sumatra');
  const exe = join(directory, SUMATRA.exe);
  if (await exists(exe)) return exe;

  logger.info({ version: SUMATRA.version }, 'Downloading SumatraPDF');
  await mkdir(directory, { recursive: true });
  const response = await fetch(SUMATRA.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`SumatraPDF download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== SUMATRA.sha256) {
    throw new Error(`SumatraPDF checksum mismatch (got ${digest}); refusing to run it`);
  }

  const zipPath = join(directory, 'sumatra.zip');
  await writeFile(zipPath, archive);
  try {
    await runPowerShell(
      'Expand-Archive -LiteralPath $env:PB_ZIP -DestinationPath $env:PB_DEST -Force',
      {
        env: { PB_ZIP: zipPath, PB_DEST: directory },
        timeoutMs: 60_000,
      },
    );
  } finally {
    await rm(zipPath, { force: true });
  }
  // Guard against a partial extraction.
  await readFile(exe);
  logger.info({ path: exe }, 'SumatraPDF installed');
  return exe;
}
