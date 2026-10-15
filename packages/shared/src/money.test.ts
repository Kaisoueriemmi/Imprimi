import { describe, expect, it } from 'vitest';
import { formatMillimes } from './money';

describe('formatMillimes', () => {
  it.each([
    [0, '0,000\u00a0DT'],
    [250, '0,250\u00a0DT'],
    [1000, '1,000\u00a0DT'],
    [12500, '12,500\u00a0DT'],
    [1234567, '1\u202f234,567\u00a0DT'],
    [-50, '-0,050\u00a0DT'],
  ])('formats %i millimes as %s', (input, expected) => {
    expect(formatMillimes(input)).toBe(expected);
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatMillimes(0.5)).toThrow(RangeError);
  });
});
