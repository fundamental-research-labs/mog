/**
 * Cell Identity Model Tests
 *
 * Tests for CellId generation, grid key utilities, and type guards.
 */

import {
  createGridKey,
  isIdentityCellRef,
  isIdentityRangeRef,
  parseGridKey,
} from '@mog/spreadsheet-utils/cell-identity';
import { sheetId } from '@mog-sdk/contracts/core';
import type {
  IdentityCellRef,
  IdentityFormulaRef,
  IdentityRangeRef,
} from '@mog-sdk/contracts/cells/cell-identity';

describe('Cell Identity Model', () => {
  describe('createGridKey', () => {
    it('should create key from sheet, row, and col', () => {
      const key = createGridKey(sheetId('sheet-1'), 5, 3);
      expect(key).toBe('sheet-1:5:3');
    });

    it('should handle zero indices', () => {
      const key = createGridKey(sheetId('sheet-1'), 0, 0);
      expect(key).toBe('sheet-1:0:0');
    });

    it('should handle large indices', () => {
      const key = createGridKey(sheetId('sheet-1'), 1000000, 16384);
      expect(key).toBe('sheet-1:1000000:16384');
    });

    it('should handle sheet IDs with special characters', () => {
      const key = createGridKey(sheetId('my-sheet_123'), 10, 20);
      expect(key).toBe('my-sheet_123:10:20');
    });
  });

  describe('parseGridKey', () => {
    it('should parse valid key', () => {
      const result = parseGridKey('sheet-1:5:3');
      expect(result).toEqual({
        sheet: 'sheet-1',
        row: 5,
        col: 3,
      });
    });

    it('should handle zero indices', () => {
      const result = parseGridKey('sheet-1:0:0');
      expect(result).toEqual({
        sheet: 'sheet-1',
        row: 0,
        col: 0,
      });
    });

    it('should return null for invalid format', () => {
      expect(parseGridKey('invalid')).toBeNull();
      expect(parseGridKey('sheet:row')).toBeNull();
      expect(parseGridKey('sheet:1:2:3')).toBeNull();
    });

    it('should return null for non-numeric row/col', () => {
      expect(parseGridKey('sheet:a:b')).toBeNull();
      expect(parseGridKey('sheet:1:b')).toBeNull();
      expect(parseGridKey('sheet:a:2')).toBeNull();
    });

    it('should round-trip with createGridKey', () => {
      const original = { sheet: sheetId('test-sheet'), row: 42, col: 99 };
      const key = createGridKey(original.sheet, original.row, original.col);
      const parsed = parseGridKey(key);
      expect(parsed).toEqual(original);
    });
  });

  describe('Type Guards', () => {
    describe('isIdentityCellRef', () => {
      it('should return true for cell refs', () => {
        const cellRef: IdentityCellRef = {
          type: 'cell',
          id: 'abc-123',
          rowAbsolute: false,
          colAbsolute: false,
        };
        expect(isIdentityCellRef(cellRef)).toBe(true);
      });

      it('should return false for range refs', () => {
        const rangeRef: IdentityRangeRef = {
          type: 'range',
          startId: 'abc-123',
          endId: 'def-456',
          startRowAbsolute: false,
          startColAbsolute: false,
          endRowAbsolute: false,
          endColAbsolute: false,
        };
        expect(isIdentityCellRef(rangeRef)).toBe(false);
      });
    });

    describe('isIdentityRangeRef', () => {
      it('should return true for range refs', () => {
        const rangeRef: IdentityRangeRef = {
          type: 'range',
          startId: 'abc-123',
          endId: 'def-456',
          startRowAbsolute: true,
          startColAbsolute: true,
          endRowAbsolute: true,
          endColAbsolute: true,
        };
        expect(isIdentityRangeRef(rangeRef)).toBe(true);
      });

      it('should return false for cell refs', () => {
        const cellRef: IdentityCellRef = {
          type: 'cell',
          id: 'abc-123',
          rowAbsolute: true,
          colAbsolute: true,
        };
        expect(isIdentityRangeRef(cellRef)).toBe(false);
      });
    });

    it('should work with union types', () => {
      const refs: IdentityFormulaRef[] = [
        { type: 'cell', id: 'a', rowAbsolute: false, colAbsolute: false },
        {
          type: 'range',
          startId: 'b',
          endId: 'c',
          startRowAbsolute: false,
          startColAbsolute: false,
          endRowAbsolute: false,
          endColAbsolute: false,
        },
      ];

      const cellRefs = refs.filter(isIdentityCellRef);
      const rangeRefs = refs.filter(isIdentityRangeRef);

      expect(cellRefs.length).toBe(1);
      expect(rangeRefs.length).toBe(1);
      expect(cellRefs[0].id).toBe('a');
      expect(rangeRefs[0].startId).toBe('b');
    });
  });
});
