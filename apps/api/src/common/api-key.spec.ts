import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey } from './api-key';

describe('api keys', () => {
  it('generates prefixed, unique, url-safe keys', () => {
    const a = generateApiKey('pbk');
    const b = generateApiKey('pbk');
    expect(a).toMatch(/^pbk_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashes deterministically without exposing the key', () => {
    const key = generateApiKey('pbd');
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiKey(key)).not.toContain(key);
  });
});
