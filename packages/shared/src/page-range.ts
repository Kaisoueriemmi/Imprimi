/** Maximum comma-separated parts in a page range: keeps parsing cheap and the input sane. */
const MAX_PARTS = 50;

export type PageRangeError = 'SYNTAX' | 'OUT_OF_BOUNDS' | 'REVERSED';

export type PageRangeResult =
  | {
      ok: true;
      /** Selected pages, sorted, without duplicates. */
      pages: number[];
      /** Canonical form for SumatraPDF (`"1-3,5"`); null when every page is selected. */
      normalized: string | null;
    }
  | { ok: false; error: PageRangeError };

function isDigits(value: string): boolean {
  if (value.length === 0 || value.length > 6) return false;
  for (const char of value) {
    if (char < '0' || char > '9') return false;
  }
  return true;
}

/** `[1,2,3,5,7,8]` → `"1-3,5,7-8"`. */
function compress(pages: readonly number[]): string {
  const parts: string[] = [];
  let start = pages[0]!;
  let previous = start;
  for (const page of [...pages.slice(1), Number.NaN]) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`);
    start = page;
    previous = page;
  }
  return parts.join(',');
}

/**
 * Parses a customer page selection such as `"1-3, 5"` against a document of `pageCount` pages.
 * Empty or null input selects every page. Overlaps are merged (`"1-3,2"` → pages 1, 2, 3).
 */
export function parsePageRange(
  input: string | null | undefined,
  pageCount: number,
): PageRangeResult {
  const allPages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const trimmed = (input ?? '').trim();
  if (trimmed.length === 0) return { ok: true, pages: allPages, normalized: null };

  const parts = trimmed.split(',');
  if (parts.length > MAX_PARTS) return { ok: false, error: 'SYNTAX' };

  const selected = new Set<number>();
  for (const rawPart of parts) {
    const bounds = rawPart.split('-').map((bound) => bound.trim());
    if (bounds.length > 2 || !bounds.every(isDigits)) return { ok: false, error: 'SYNTAX' };
    const from = Number(bounds[0]);
    const to = Number(bounds[1] ?? bounds[0]);
    if (from > to) return { ok: false, error: 'REVERSED' };
    if (from < 1 || to > pageCount) return { ok: false, error: 'OUT_OF_BOUNDS' };
    for (let page = from; page <= to; page++) selected.add(page);
  }

  const pages = [...selected].sort((a, b) => a - b);
  return {
    ok: true,
    pages,
    normalized: pages.length === pageCount ? null : compress(pages),
  };
}
