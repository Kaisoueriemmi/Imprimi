import type { KioskScreenState } from '@printbox/shared';

const storageKey = (kioskId: string) => `printbox.kiosk-key.${kioskId}`;

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The display key is given once in the URL fragment (`/kiosk/<id>#key=pbd_…`): a fragment is
 * never sent to the server nor written in its logs. It is then kept in this browser so the
 * kiosk restarts without it. Returns the key and whether the fragment must be removed.
 */
export function resolveDisplayKey(
  kioskId: string,
  hash: string,
  storage: KeyStorage | null,
): { key: string | null; stripHash: boolean } {
  const fromHash = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('key');
  if (fromHash?.startsWith('pbd_')) {
    try {
      storage?.setItem(storageKey(kioskId), fromHash);
    } catch {
      // Storage blocked: the key still works for this page load.
    }
    return { key: fromHash, stripHash: true };
  }
  let stored: string | null = null;
  try {
    stored = storage?.getItem(storageKey(kioskId)) ?? null;
  } catch {
    stored = null;
  }
  return { key: stored?.startsWith('pbd_') ? stored : null, stripHash: false };
}

export function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}

/** Amount still to insert and progress (0–100) of the coin payment shown on screen. */
export function coinProgress(payment: NonNullable<KioskScreenState['coinPayment']>): {
  remainingMillimes: number;
  percent: number;
} {
  const { amountDueMillimes: due, receivedMillimes: received } = payment;
  return {
    remainingMillimes: Math.max(0, due - received),
    percent: due === 0 ? 100 : Math.min(100, Math.floor((received / due) * 100)),
  };
}

/**
 * Delay until the next 04:00 local time: the screen reloads itself once a day so a browser
 * left running for weeks starts fresh (memory, new deployments).
 */
export function msUntilNextReload(now: Date, hour = 4): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}
