import { KernelError } from '../../errors';
import { resolveCell, resolveRange } from '../internal/address-resolver';

describe('resolveCell', () => {
  describe('string (A1 notation)', () => {
    it('parses "A1" to {row: 0, col: 0}', () => {
      expect(resolveCell('A1')).toEqual({ row: 0, col: 0 });
    });

    it('parses "B2" to {row: 1, col: 1}', () => {
      expect(resolveCell('B2')).toEqual({ row: 1, col: 1 });
    });

    it('parses "Z1" to {row: 0, col: 25}', () => {
      expect(resolveCell('Z1')).toEqual({ row: 0, col: 25 });
    });

    it('parses "AA1" to {row: 0, col: 26}', () => {
      expect(resolveCell('AA1')).toEqual({ row: 0, col: 26 });
    });

    it('parses "AA10" to {row: 9, col: 26}', () => {
      expect(resolveCell('AA10')).toEqual({ row: 9, col: 26 });
    });

    it('is case insensitive: "a1" parses to {row: 0, col: 0}', () => {
      expect(resolveCell('a1')).toEqual({ row: 0, col: 0 });
    });
  });

  describe('sheet-qualified addresses', () => {
    it('ignores sheet name in "Sheet1!A1"', () => {
      expect(resolveCell('Sheet1!A1')).toEqual({ row: 0, col: 0 });
    });

    it('ignores quoted sheet name in "\'My Sheet\'!B3"', () => {
      expect(resolveCell("'My Sheet'!B3")).toEqual({ row: 2, col: 1 });
    });
  });

  describe('numeric (row, col)', () => {
    it('passes through (0, 0)', () => {
      expect(resolveCell(0, 0)).toEqual({ row: 0, col: 0 });
    });

    it('passes through (5, 10)', () => {
      expect(resolveCell(5, 10)).toEqual({ row: 5, col: 10 });
    });
  });

  describe('error cases', () => {
    it('throws KernelError for invalid A1 string', () => {
      expect(() => resolveCell('invalid')).toThrow(KernelError);
    });

    it('throws KernelError for empty string', () => {
      expect(() => resolveCell('')).toThrow(KernelError);
    });

    it('throws KernelError when col is undefined for numeric form', () => {
      expect(() => resolveCell(5)).toThrow(KernelError);
    });

    it('thrown error is instance of Error', () => {
      try {
        resolveCell('invalid');
        fail('Expected KernelError to be thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(KernelError);
      }
    });

    it('error message includes the invalid address string', () => {
      expect(() => resolveCell('xyz!')).toThrow(/Invalid cell address/);
    });
  });
});

describe('resolveRange', () => {
  describe('string (A1 range notation)', () => {
    it('parses "A1:B2" to correct bounds', () => {
      expect(resolveRange('A1:B2')).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
    });

    it('parses single cell range "A1:A1"', () => {
      expect(resolveRange('A1:A1')).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 0,
        endCol: 0,
      });
    });

    it('parses "A1:A10" to correct bounds', () => {
      expect(resolveRange('A1:A10')).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 9,
        endCol: 0,
      });
    });
  });

  describe('sheet-qualified ranges', () => {
    it('ignores sheet name in "Sheet1!A1:B2"', () => {
      expect(resolveRange('Sheet1!A1:B2')).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
    });

    it('parses "Sheet1!A1:C10" ignoring sheet name', () => {
      expect(resolveRange('Sheet1!A1:C10')).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 9,
        endCol: 2,
      });
    });
  });

  describe('numeric (startRow, startCol, endRow, endCol)', () => {
    it('passes through (0, 0, 1, 1)', () => {
      expect(resolveRange(0, 0, 1, 1)).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 1,
      });
    });

    it('passes through large coordinates', () => {
      expect(resolveRange(10, 20, 30, 40)).toEqual({
        startRow: 10,
        startCol: 20,
        endRow: 30,
        endCol: 40,
      });
    });
  });

  describe('error cases', () => {
    it('throws KernelError for invalid range string', () => {
      expect(() => resolveRange('invalid')).toThrow(KernelError);
    });

    it('accepts single-cell A1 notation as a valid range', () => {
      const result = resolveRange('A1');
      expect(result).toEqual({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    });

    it('throws KernelError when endRow and endCol are undefined', () => {
      expect(() =>
        resolveRange(0, 0, undefined as unknown as number, undefined as unknown as number),
      ).toThrow(KernelError);
    });

    it('throws KernelError when only endCol is undefined', () => {
      expect(() => resolveRange(0, 0, 1, undefined as unknown as number)).toThrow(KernelError);
    });

    it('throws KernelError when startCol is undefined', () => {
      expect(() => resolveRange(0, undefined as unknown as number)).toThrow(KernelError);
    });

    it('throws KernelError when only first arg is numeric', () => {
      expect(() => resolveRange(0)).toThrow(KernelError);
    });
  });
});
