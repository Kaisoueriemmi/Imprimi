import { describe, expect, it } from 'vitest';
import { computePriceMillimes } from './pricing';

const BW = { pricePerPageMillimes: 100, duplexDiscountPercent: 10 };
const COLOR = { pricePerPageMillimes: 500, duplexDiscountPercent: 10 };

describe('computePriceMillimes', () => {
  it('multiplies pages, copies and unit price', () => {
    expect(
      computePriceMillimes({
        selectedPages: 3,
        copies: 2,
        duplex: false,
        rule: BW,
        roundingMillimes: 100,
      }),
    ).toBe(600);
    expect(
      computePriceMillimes({
        selectedPages: 4,
        copies: 1,
        duplex: false,
        rule: COLOR,
        roundingMillimes: 100,
      }),
    ).toBe(2000);
  });

  it('applies the duplex discount', () => {
    // 10 pages × 100 = 1000, −10 % = 900.
    expect(
      computePriceMillimes({
        selectedPages: 10,
        copies: 1,
        duplex: true,
        rule: BW,
        roundingMillimes: 100,
      }),
    ).toBe(900);
  });

  it('ignores duplex for a single page (nothing on the back)', () => {
    expect(
      computePriceMillimes({
        selectedPages: 1,
        copies: 3,
        duplex: true,
        rule: BW,
        roundingMillimes: 100,
      }),
    ).toBe(300);
  });

  it('rounds up to the smallest coin', () => {
    // 3 pages × 100 = 300, −10 % = 270 → 300 with 100-millime coins, 300 with 50, 270 with 10.
    const input = { selectedPages: 3, copies: 1, duplex: true, rule: BW };
    expect(computePriceMillimes({ ...input, roundingMillimes: 100 })).toBe(300);
    expect(computePriceMillimes({ ...input, roundingMillimes: 50 })).toBe(300);
    expect(computePriceMillimes({ ...input, roundingMillimes: 10 })).toBe(270);
    // 7 × 100 = 700, −10 % = 630 → 700 with 100-millime coins.
    expect(
      computePriceMillimes({
        selectedPages: 7,
        copies: 1,
        duplex: true,
        rule: BW,
        roundingMillimes: 100,
      }),
    ).toBe(700);
  });

  it('stays exact on large jobs (integer arithmetic)', () => {
    expect(
      computePriceMillimes({
        selectedPages: 50,
        copies: 20,
        duplex: true,
        rule: COLOR,
        roundingMillimes: 10,
      }),
    ).toBe(450_000);
  });

  it('rejects invalid inputs', () => {
    const base = { selectedPages: 1, copies: 1, duplex: false, rule: BW, roundingMillimes: 100 };
    expect(() => computePriceMillimes({ ...base, copies: 1.5 })).toThrow(RangeError);
    expect(() => computePriceMillimes({ ...base, roundingMillimes: 0 })).toThrow(RangeError);
    expect(() =>
      computePriceMillimes({
        ...base,
        selectedPages: 2,
        duplex: true,
        rule: { ...BW, duplexDiscountPercent: 120 },
      }),
    ).toThrow(RangeError);
  });
});
