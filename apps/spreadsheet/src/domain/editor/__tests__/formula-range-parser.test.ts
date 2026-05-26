/**
 * Tests for formula-range-parser.ts
 *
 * Tests for formula range parsing, active reference detection, and range updates.
 * Used for C.2 and C.3/H.3 features.
 *
 * @see ../formula-range-parser.ts
 */

import {
  extractFormulaRanges,
  findActiveReferenceIndex,
  updateFormulaReference,
} from '../formula-range-parser';

describe('formula-range-parser', () => {
  describe('extractFormulaRanges', () => {
    it('returns empty array for empty string', () => {
      expect(extractFormulaRanges('')).toEqual([]);
    });

    it('returns empty array for non-formula', () => {
      expect(extractFormulaRanges('hello world')).toEqual([]);
    });

    it('extracts single cell reference', () => {
      const result = extractFormulaRanges('=A1');
      expect(result).toHaveLength(1);
      expect(result[0].range).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });
      expect(result[0].text).toBe('A1');
      expect(result[0].startPos).toBe(1);
      expect(result[0].endPos).toBe(3);
      expect(result[0].index).toBe(0);
    });

    it('extracts multiple cell references', () => {
      const result = extractFormulaRanges('=A1+B2+C3');
      expect(result).toHaveLength(3);
      expect(result[0].text).toBe('A1');
      expect(result[1].text).toBe('B2');
      expect(result[2].text).toBe('C3');
    });

    it('extracts range reference', () => {
      const result = extractFormulaRanges('=SUM(A1:B10)');
      expect(result).toHaveLength(1);
      expect(result[0].range).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 9,
        endCol: 1,
      });
      expect(result[0].text).toBe('A1:B10');
    });

    it('handles absolute references', () => {
      const result = extractFormulaRanges('=$A$1+A$1+$A1');
      expect(result).toHaveLength(3);
      expect(result[0].text).toBe('$A$1');
      expect(result[1].text).toBe('A$1');
      expect(result[2].text).toBe('$A1');
      // All should resolve to the same cell (A1)
      expect(result[0].range).toEqual(result[1].range);
      expect(result[1].range).toEqual(result[2].range);
    });

    it('handles multi-letter columns', () => {
      const result = extractFormulaRanges('=AA1+ZZ100');
      expect(result).toHaveLength(2);
      expect(result[0].range.startCol).toBe(26); // AA = 26
      expect(result[1].range.startCol).toBe(701); // ZZ = 701
    });

    it('assigns different colors to each reference', () => {
      const result = extractFormulaRanges('=A1+B2+C3+D4+E5+F6+G7+H8');
      expect(result).toHaveLength(8);
      // First 8 colors should be from the palette
      const colors = result.map((r) => r.color);
      // At least some colors should be different
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBeGreaterThan(1);
    });

    it('handles sheet references', () => {
      const result = extractFormulaRanges("=Sheet1!A1+'Sheet Name'!B2");
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('Sheet1!A1');
      expect(result[1].text).toBe("'Sheet Name'!B2");
    });

    it('handles mixed references and ranges', () => {
      const result = extractFormulaRanges('=SUM(A1:B10)+C5*D100');
      expect(result).toHaveLength(3);
      expect(result[0].text).toBe('A1:B10');
      expect(result[1].text).toBe('C5');
      expect(result[2].text).toBe('D100');
    });
  });

  describe('findActiveReferenceIndex', () => {
    it('returns -1 for empty references', () => {
      expect(findActiveReferenceIndex([], 0)).toBe(-1);
    });

    it('returns -1 when cursor is not in any reference', () => {
      const refs = extractFormulaRanges('=A1+B2');
      // Cursor at position 0 (before =)
      expect(findActiveReferenceIndex(refs, 0)).toBe(-1);
    });

    it('returns index when cursor is inside reference', () => {
      const refs = extractFormulaRanges('=A1+B2');
      // Cursor inside A1 (position 2)
      expect(findActiveReferenceIndex(refs, 2)).toBe(0);
      // Cursor inside B2 (position 5)
      expect(findActiveReferenceIndex(refs, 5)).toBe(1);
    });

    it('returns index when cursor is at start of reference', () => {
      const refs = extractFormulaRanges('=A1+B2');
      // Cursor at start of A1 (position 1)
      expect(findActiveReferenceIndex(refs, 1)).toBe(0);
      // Cursor at start of B2 (position 4)
      expect(findActiveReferenceIndex(refs, 4)).toBe(1);
    });

    it('returns index when cursor is at end of reference', () => {
      const refs = extractFormulaRanges('=A1+B2');
      // Cursor at end of A1 (position 3)
      expect(findActiveReferenceIndex(refs, 3)).toBe(0);
      // Cursor at end of B2 (position 6)
      expect(findActiveReferenceIndex(refs, 6)).toBe(1);
    });
  });

  describe('updateFormulaReference', () => {
    it('updates single cell reference to single cell', () => {
      const refs = extractFormulaRanges('=A1');
      const result = updateFormulaReference('=A1', refs[0], {
        startRow: 1,
        startCol: 1,
        endRow: 1,
        endCol: 1,
      });
      expect(result.newFormula).toBe('=B2');
    });

    it('updates single cell reference to range', () => {
      const refs = extractFormulaRanges('=A1');
      const result = updateFormulaReference('=A1', refs[0], {
        startRow: 0,
        startCol: 0,
        endRow: 5,
        endCol: 2,
      });
      expect(result.newFormula).toBe('=A1:C6');
    });

    it('updates range reference to single cell', () => {
      const refs = extractFormulaRanges('=A1:B10');
      const result = updateFormulaReference('=A1:B10', refs[0], {
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });
      expect(result.newFormula).toBe('=A1');
    });

    it('updates range reference to different range', () => {
      const refs = extractFormulaRanges('=SUM(A1:B10)');
      const result = updateFormulaReference('=SUM(A1:B10)', refs[0], {
        startRow: 0,
        startCol: 0,
        endRow: 19,
        endCol: 3,
      });
      expect(result.newFormula).toBe('=SUM(A1:D20)');
    });

    it('preserves absolute markers', () => {
      const refs = extractFormulaRanges('=$A$1');
      const result = updateFormulaReference('=$A$1', refs[0], {
        startRow: 4,
        startCol: 2,
        endRow: 4,
        endCol: 2,
      });
      // Should preserve the $ markers
      expect(result.newFormula).toBe('=$C$5');
    });

    it('updates correct reference when multiple exist', () => {
      const formula = '=A1+B2+C3';
      const refs = extractFormulaRanges(formula);
      // Update B2 to D4
      const result = updateFormulaReference(formula, refs[1], {
        startRow: 3,
        startCol: 3,
        endRow: 3,
        endCol: 3,
      });
      expect(result.newFormula).toBe('=A1+D4+C3');
    });

    it('updates cursor position correctly', () => {
      const formula = '=A1+B2';
      const refs = extractFormulaRanges(formula);
      // Update A1 to AA100 (longer text)
      const result = updateFormulaReference(formula, refs[0], {
        startRow: 99,
        startCol: 26,
        endRow: 99,
        endCol: 26,
      });
      expect(result.newFormula).toBe('=AA100+B2');
      // Cursor should be at end of new reference
      expect(result.newCursorPosition).toBe(6); // After "AA100"
    });
  });
});
