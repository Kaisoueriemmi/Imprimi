import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Runs a PowerShell script and returns its stdout. Values (printer name, document name) are
 * passed through environment variables, never interpolated into the script: no injection.
 */
export async function runPowerShell(
  script: string,
  options: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env: { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? 15_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout;
}

/** Printer of `$env:PB_PRINTER`, as compact JSON, or nothing when it does not exist. */
export const PRINTER_STATE_SCRIPT = [
  '$p = Get-Printer -Name $env:PB_PRINTER -ErrorAction SilentlyContinue;',
  'if ($p) {',
  "  $p | Select-Object Name, @{n='Status';e={$_.PrinterStatus.ToString()}}, JobCount,",
  "    @{n='Offline';e={[bool]$_.WorkOffline}} | ConvertTo-Json -Compress",
  '}',
].join(' ');

/** Spooler jobs of `$env:PB_PRINTER` whose document name contains `$env:PB_DOCUMENT`. */
export const PRINT_JOBS_SCRIPT = [
  'Get-PrintJob -PrinterName $env:PB_PRINTER -ErrorAction SilentlyContinue |',
  "  Where-Object { $_.DocumentName -like ('*' + $env:PB_DOCUMENT + '*') } |",
  "  Select-Object Id, @{n='Status';e={$_.JobStatus.ToString()}} | ConvertTo-Json -Compress",
].join(' ');

export const REMOVE_PRINT_JOBS_SCRIPT = [
  'Get-PrintJob -PrinterName $env:PB_PRINTER -ErrorAction SilentlyContinue |',
  "  Where-Object { $_.DocumentName -like ('*' + $env:PB_DOCUMENT + '*') } | Remove-PrintJob",
].join(' ');

export const LIST_PRINTERS_SCRIPT =
  "Get-Printer | Select-Object Name, @{n='Status';e={$_.PrinterStatus.ToString()}} | ConvertTo-Json -Compress";

/** ConvertTo-Json gives an object for one item, an array for several, nothing for none. */
export function parseJsonList<T>(stdout: string): T[] {
  const text = stdout.trim();
  if (text.length === 0) return [];
  const value = JSON.parse(text) as T | T[];
  return Array.isArray(value) ? value : [value];
}
