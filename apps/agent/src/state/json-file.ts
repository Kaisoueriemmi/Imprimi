import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Reads a JSON state file. Missing → `fallback`. Unreadable (power cut during a write on an old
 * version) → the file is set aside as `.corrupt-<timestamp>` and `fallback` is returned.
 */
export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    await rename(path, `${path}.corrupt-${Date.now()}`);
    return fallback;
  }
}

/** Write-then-rename: a crash leaves either the old or the new file, never half of one. */
export async function writeJsonFileAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value), 'utf8');
  await rename(temporary, path);
}

/** Serialises async operations (one file write at a time). */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
