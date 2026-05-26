/**
 * Integration tests for chart range handling.
 *
 * Tests that range formats produced by engine are compatible
 * with the charts package parser.
 *
 * Background: rangeToString returns "B5" for single cells (not "B5:B5"),
 * so parseRange must accept both formats.
 */

import { parseRange } from '../../src/core/data-extractor';

// Inline the rangeToString logic to test cross-package compatibility
function rangeToString(startRow: number, startCol: number, endRow: number, endCol: number): string {
  const colToLetter = (col: number): string => {
    let result = '';
    col++;
    while (col > 0) {
      col--;
      result = String.fromCharCode(65 + (col % 26)) + result;
      col = Math.floor(col / 26);
    }
    return result;
  };

  const start = `${colToLetter(startCol)}${startRow + 1}`;
  const end = `${colToLetter(endCol)}${endRow + 1}`;

  // Single cells return just "B5" not "B5:B5"
  if (start === end) {
    return start;
  }
  return `${start}:${end}`;
}

describe('Chart Range Integration', () => {
  describe('single cell selection', () => {
    it('rangeToString returns single cell format', () => {
      const range = rangeToString(4, 1, 4, 1);
      expect(range).toBe('B5');
    });

    it('parseRange accepts single cell format', () => {
      const parsed = parseRange('B5');
      // parseRange now returns canonical CellRange format from contracts
      expect(parsed.startRow).toBe(4);
      expect(parsed.startCol).toBe(1);
      expect(parsed.endRow).toBe(4);
      expect(parsed.endCol).toBe(1);
    });

    it('rangeToString output works with parseRange', () => {
      const range = rangeToString(4, 1, 4, 1);
      expect(() => parseRange(range)).not.toThrow();

      const parsed = parseRange(range);
      expect(parsed.startRow).toBe(4);
      expect(parsed.startCol).toBe(1);
    });
  });

  describe('multi-cell selection', () => {
    it('rangeToString returns colon format', () => {
      const range = rangeToString(0, 0, 3, 1);
      expect(range).toBe('A1:B4');
    });

    it('parseRange handles multi-cell ranges', () => {
      const parsed = parseRange('A1:B4');
      // parseRange now returns canonical CellRange format from contracts
      expect(parsed.startRow).toBe(0);
      expect(parsed.startCol).toBe(0);
      expect(parsed.endRow).toBe(3);
      expect(parsed.endCol).toBe(1);
    });

    it('rangeToString output works with parseRange', () => {
      const range = rangeToString(0, 0, 3, 1);
      const parsed = parseRange(range);
      expect(parsed.startRow).toBe(0);
      expect(parsed.endRow).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('handles single row', () => {
      const range = rangeToString(0, 0, 0, 5);
      expect(range).toBe('A1:F1');
      expect(() => parseRange(range)).not.toThrow();
    });

    it('handles single column', () => {
      const range = rangeToString(0, 0, 10, 0);
      expect(range).toBe('A1:A11');
      expect(() => parseRange(range)).not.toThrow();
    });

    it('handles large ranges', () => {
      const range = rangeToString(0, 0, 999, 25);
      expect(range).toBe('A1:Z1000');
      expect(() => parseRange(range)).not.toThrow();
    });

    it('rejects invalid formats', () => {
      // parseA1Range from contracts throws on empty or invalid cell addresses
      expect(() => parseRange('')).toThrow();
      expect(() => parseRange('invalid')).toThrow();
      // Note: 'A1:B2:C3' doesn't throw - extra colons are ignored (parses as A1:B2)
    });
  });
});
