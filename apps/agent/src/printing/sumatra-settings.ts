import type { PrintRequest } from './printer';

/** Only digits, commas and dashes: the page range comes from the server, but double-check it. */
function isSafePageRange(range: string): boolean {
  if (range.length === 0 || range.length > 200) return false;
  for (const char of range) {
    const ok = (char >= '0' && char <= '9') || char === ',' || char === '-';
    if (!ok) return false;
  }
  return true;
}

/**
 * SumatraPDF `-print-settings` value: `<pages>,<copies>x,duplexlong|simplex,color|monochrome`,
 * e.g. `"1-3,5,2x,duplexlong,monochrome"`.
 */
export function buildPrintSettings(
  request: Pick<PrintRequest, 'copies' | 'duplex' | 'colorMode' | 'pageRange'>,
): string {
  if (!Number.isInteger(request.copies) || request.copies < 1 || request.copies > 99) {
    throw new RangeError(`Invalid copies: ${request.copies}`);
  }
  const parts: string[] = [];
  if (request.pageRange !== null) {
    if (!isSafePageRange(request.pageRange)) {
      throw new RangeError('Invalid page range');
    }
    parts.push(request.pageRange);
  }
  parts.push(`${request.copies}x`);
  parts.push(request.duplex ? 'duplexlong' : 'simplex');
  parts.push(request.colorMode === 'COLOR' ? 'color' : 'monochrome');
  return parts.join(',');
}
