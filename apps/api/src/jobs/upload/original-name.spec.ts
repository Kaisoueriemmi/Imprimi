import { describe, expect, it } from 'vitest';
import { sanitizeOriginalName } from './original-name';

describe('sanitizeOriginalName', () => {
  it('keeps normal names, including Arabic and accents', () => {
    expect(sanitizeOriginalName('Relevé de notes.pdf')).toBe('Relevé de notes.pdf');
    expect(sanitizeOriginalName('تقرير.docx')).toBe('تقرير.docx');
  });

  it('drops directory parts', () => {
    expect(sanitizeOriginalName('../../etc/passwd')).toBe('passwd');
    expect(
      sanitizeOriginalName(['C:', 'Users', 'me', 'cv.pdf'].join(String.fromCharCode(92))),
    ).toBe('cv.pdf');
  });

  it('removes control characters and bounds the length', () => {
    expect(sanitizeOriginalName(`a${String.fromCharCode(0)}b${String.fromCharCode(10)}c.pdf`)).toBe(
      'abc.pdf',
    );
    expect(sanitizeOriginalName('x'.repeat(500))).toHaveLength(200);
  });

  it('falls back to "document"', () => {
    expect(sanitizeOriginalName(undefined)).toBe('document');
    expect(sanitizeOriginalName('   ')).toBe('document');
  });
});
