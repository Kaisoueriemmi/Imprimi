/** 1 dinar tunisien (TND) = 1000 millimes. Every amount is stored as an integer number of millimes. */
export const MILLIMES_PER_DINAR = 1000;

/**
 * Formats an amount in millimes the Tunisian way: `250` → `"0,250 DT"`, `12500` → `"12,500 DT"`.
 * The narrow no-break space keeps the amount and the currency on one line.
 */
export function formatMillimes(millimes: number): string {
  if (!Number.isSafeInteger(millimes)) {
    throw new RangeError(`Amount must be an integer number of millimes, got ${millimes}`);
  }
  const sign = millimes < 0 ? '-' : '';
  const abs = Math.abs(millimes);
  const dinars = Math.floor(abs / MILLIMES_PER_DINAR);
  const rest = String(abs % MILLIMES_PER_DINAR).padStart(3, '0');
  const groupedDinars = String(dinars).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  return `${sign}${groupedDinars},${rest}\u00a0DT`;
}
