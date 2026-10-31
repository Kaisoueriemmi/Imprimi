import { type SessionResponse, sessionResponseSchema } from '@printbox/shared';
import { z } from 'zod';

/** What survives a page reload (tab storage only: gone when the tab is closed). */
export interface StoredSession {
  session: SessionResponse;
  jobId: string | null;
}

const storedSchema = z.object({ session: sessionResponseSchema, jobId: z.string().nullable() });

/** A session about to expire is not worth resuming. */
const MIN_REMAINING_MS = 60_000;

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const keyOf = (kioskId: string) => `printbox.session.${kioskId}`;

export function loadSession(
  storage: SessionStorageLike | null,
  kioskId: string,
  now: number,
): StoredSession | null {
  try {
    const raw = storage?.getItem(keyOf(kioskId));
    if (!raw) return null;
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const { session } = parsed.data;
    if (session.kiosk.id !== kioskId) return null;
    if (Date.parse(session.expiresAt) - now < MIN_REMAINING_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveSession(
  storage: SessionStorageLike | null,
  kioskId: string,
  value: StoredSession,
): void {
  try {
    storage?.setItem(keyOf(kioskId), JSON.stringify(value));
  } catch {
    // Storage full or blocked: the flow still works, it just does not survive a reload.
  }
}

export function clearSession(storage: SessionStorageLike | null, kioskId: string): void {
  try {
    storage?.removeItem(keyOf(kioskId));
  } catch {
    // Blocked storage: nothing was saved either.
  }
}

/** `sessionStorage`, or null where it is unavailable (server render, blocked by the browser). */
export function browserStorage(): SessionStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
