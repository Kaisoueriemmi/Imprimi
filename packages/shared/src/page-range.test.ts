import { describe, expect, it } from 'vitest';
import { parsePageRange } from './page-range';

describe('parsePageRange', () => {
  it('selects every page when empty', () => {
    expect(parsePageRange(null, 3)).toEqual({ ok: true, pages: [1, 2, 3], normalized: null });
    expect(parsePageRange('  ', 2)).toEqual({ ok: true, pages: [1, 2], normalized: null });
  });

  it.each([
    ['1-3,5', [1, 2, 3, 5], '1-3,5'],
    [' 5 , 1 - 3 ', [1, 2, 3, 5], '1-3,5'],
    ['2', [2], '2'],
    ['1-3,2,3-4', [1, 2, 3, 4], '1-4'],
    ['7-8,1,3', [1, 3, 7, 8], '1,3,7-8'],
  ])('parses "%s"', (input, pages, normalized) => {
    expect(parsePageRange(input, 10)).toEqual({ ok: true, pages, normalized });
  });

  it('normalises a selection of every page to null', () => {
    expect(parsePageRange('1-2,3', 3)).toEqual({ ok: true, pages: [1, 2, 3], normalized: null });
  });

  it.each([
    ['a', 'SYNTAX'],
    ['1-', 'SYNTAX'],
    ['1-2-3', 'SYNTAX'],
    ['1,,2', 'SYNTAX'],
    ['-1', 'SYNTAX'],
    ['1.5', 'SYNTAX'],
    ['5-2', 'REVERSED'],
    ['0', 'OUT_OF_BOUNDS'],
    ['1-11', 'OUT_OF_BOUNDS'],
    ['11', 'OUT_OF_BOUNDS'],
  ])('rejects "%s" (%s)', (input, error) => {
    expect(parsePageRange(input, 10)).toEqual({ ok: false, error });
  });

  it('rejects absurdly long selections', () => {
    expect(parsePageRange(Array(60).fill('1').join(','), 10)).toEqual({
      ok: false,
      error: 'SYNTAX',
    });
  });
});
