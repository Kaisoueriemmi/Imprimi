const MAX_NAME_LENGTH = 200;
const BACKSLASH = String.fromCharCode(92);

/**
 * File name as shown back to the customer: no directory part, no control characters, bounded
 * length. Never used to build a storage key or a filesystem path, and never logged.
 */
export function sanitizeOriginalName(raw: string | undefined): string {
  const base = (raw ?? '').split('/').pop()?.split(BACKSLASH).pop() ?? '';
  let clean = '';
  for (const char of base) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) clean += char;
  }
  clean = clean.trim();
  if (clean.length === 0) return 'document';
  return Array.from(clean).slice(0, MAX_NAME_LENGTH).join('');
}
