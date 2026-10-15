export interface PricingRuleValues {
  pricePerPageMillimes: number;
  duplexDiscountPercent: number;
}

export interface PriceInput {
  /** Pages selected in the document (one copy). */
  selectedPages: number;
  copies: number;
  duplex: boolean;
  rule: PricingRuleValues;
  /** The total is rounded up to a multiple of this (smallest coin the machine handles). */
  roundingMillimes: number;
}

/** Integer division rounding up, for non-negative operands. */
function ceilDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator - 1) / denominator);
}

/**
 * Price of a print job in millimes, integers only:
 *
 *   pages × copies × price per page,
 *   minus the duplex discount when printing recto-verso (at least 2 pages),
 *   rounded **up** to `roundingMillimes` so it can be paid with coins.
 *
 * Computed by the server only; clients display what the API returns.
 */
export function computePriceMillimes(input: PriceInput): number {
  const { selectedPages, copies, duplex, rule, roundingMillimes } = input;
  for (const value of [selectedPages, copies, rule.pricePerPageMillimes, roundingMillimes]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError('Price inputs must be non-negative integers');
    }
  }
  if (roundingMillimes === 0) throw new RangeError('roundingMillimes must be positive');
  const discount = duplex && selectedPages >= 2 ? rule.duplexDiscountPercent : 0;
  if (!Number.isInteger(discount) || discount < 0 || discount > 100) {
    throw new RangeError('duplexDiscountPercent must be an integer between 0 and 100');
  }

  const base = selectedPages * copies * rule.pricePerPageMillimes;
  // base × (100 − discount) / 100, rounded up to the coin step, in a single integer division.
  const steps = ceilDiv(base * (100 - discount), 100 * roundingMillimes);
  return steps * roundingMillimes;
}
