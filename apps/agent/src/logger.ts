import pino from 'pino';

export type Logger = pino.Logger;

/**
 * JSON lines on stdout; the Windows service wrapper (WinSW) writes them to rotated log files.
 * No pino transport: they run in worker threads that a packaged .exe cannot load.
 * Privacy: log job ids only, never file names or contents.
 */
export function createLogger(level: string, kioskId: string): Logger {
  return pino({ level, base: { kioskId }, timestamp: pino.stdTimeFunctions.isoTime });
}

/** A logger that discards everything (tests). */
export function silentLogger(): Logger {
  return pino({ level: 'silent' });
}
