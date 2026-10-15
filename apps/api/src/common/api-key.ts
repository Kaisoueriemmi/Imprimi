import { createHash, randomBytes } from 'node:crypto';

/** Prefixes make a leaked key easy to identify: `pbk_` agent key, `pbd_` kiosk display key. */
export type ApiKeyPrefix = 'pbk' | 'pbd';

/** 256 bits of randomness, base64url encoded. Shown once, only its hash is stored. */
export function generateApiKey(prefix: ApiKeyPrefix): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

/**
 * Keys are high-entropy random strings, so a plain SHA-256 is enough (no brute force possible)
 * and lets us look a kiosk up by key hash through a unique index.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}
