import { describe, expect, it } from 'vitest';
import { generatePickupCode } from './job-checkout.service';

describe('generatePickupCode', () => {
  it('always returns exactly 6 digits, leading zeros kept', () => {
    const codes = Array.from({ length: 5000 }, generatePickupCode);
    for (const code of codes) expect(code).toMatch(/^[0-9]{6}$/);
    // 5000 draws among 10^6: a code starting with 0 is all but certain (P ≈ 1 − 0.9^5000).
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
  });

  it('is spread over the whole range', () => {
    const codes = new Set(Array.from({ length: 2000 }, generatePickupCode));
    expect(codes.size).toBeGreaterThan(1990);
  });
});
