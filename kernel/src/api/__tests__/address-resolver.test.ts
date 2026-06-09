import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';

import { KernelError, MogSdkError } from '../../errors';
import { resolveCell, resolveCellArgs, resolveRange } from '../internal/address-resolver';

function captureKernelError(fn: () => unknown): KernelError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(KernelError);
    return error as KernelError;
  }
  throw new Error('Expected KernelError to be thrown');
}

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
      const error = captureKernelError(() => resolveCell('invalid'));
      expect(error.code).toBe('API_INVALID_ADDRESS');
      expect(error.context).toEqual(
        expect.objectContaining({
          validationKind: 'invalidCellAddress',
          path: ['address'],
          expected: 'single cell address such as "A1"',
          received: 'invalid',
          suggestion: expect.stringContaining('single cell address'),
        }),
      );
    });

    it('throws KernelError for empty string', () => {
      expect(() => resolveCell('')).toThrow(KernelError);
    });

    it('throws KernelError when col is undefined for numeric form', () => {
      const error = captureKernelError(() => resolveCell(5));
      expect(error.code).toBe('API_INVALID_ARGUMENT');
      expect(error.context).toEqual(
        expect.objectContaining({
          validationKind: 'missingCellColumn',
          path: ['col'],
          expected: 'numeric column argument',
          received: { row: 5, col: undefined },
          suggestion: expect.stringContaining('both row and column'),
        }),
      );
    });

    it('reports a range string passed to a cell-only resolver', () => {
      const error = captureKernelError(() => resolveCell('H132:L132'));
      expect(error.code).toBe('API_INVALID_ARGUMENT');
      expect(error.path).toEqual(['address']);
      expect(error.suggestion).toContain('single cell address');
      expect(error.context).toEqual(
        expect.objectContaining({
          validationKind: 'expectedSingleCell',
          path: ['address'],
          expected: 'single cell address such as "A1"',
          received: 'H132:L132',
          suggestion: expect.stringContaining('single cell address'),
        }),
      );
    });

    it('reports malformed cell syntax distinctly from range syntax', () => {
      const error = captureKernelError(() => resolveCell('[1'));
      expect(error.code).toBe('API_INVALID_ADDRESS');
      expect(error.context).toEqual(
        expect.objectContaining({
          validationKind: 'invalidCellAddress',
          path: ['address'],
          received: '[1',
        }),
      );
    });

    it('reports negative numeric cell coordinates before bridge calls', () => {
      const rowError = captureKernelError(() => resolveCell(-1, 0));
      expect(rowError.context).toEqual(
        expect.objectContaining({
          validationKind: 'rowOutOfBounds',
          path: ['address', 'row'],
          received: { row: -1, col: 0 },
        }),
      );

      const colError = captureKernelError(() => resolveCell(0, -1));
      expect(colError.context).toEqual(
        expect.objectContaining({
          validationKind: 'columnOutOfBounds',
          path: ['address', 'col'],
          received: { row: 0, col: -1 },
        }),
      );
    });

    it('reports beyond-limit cell coordinates from numeric and A1 inputs', () => {
      const numericRowError = captureKernelError(() => resolveCell(MAX_ROWS, 0));
      expect(numericRowError.context).toEqual(
        expect.objectContaining({
          validationKind: 'rowOutOfBounds',
          path: ['address', 'row'],
          received: { row: MAX_ROWS, col: 0 },
        }),
      );

      const numericColError = captureKernelError(() => resolveCell(0, MAX_COLS));
      expect(numericColError.context).toEqual(
        expect.objectContaining({
          validationKind: 'columnOutOfBounds',
          path: ['address', 'col'],
          received: { row: 0, col: MAX_COLS },
        }),
      );

      const a1RowError = captureKernelError(() => resolveCell('A1048577'));
      expect(a1RowError.context).toEqual(
        expect.objectContaining({
          validationKind: 'rowOutOfBounds',
          path: ['address', 'row'],
          received: 'A1048577',
        }),
      );

      const a1ColError = captureKernelError(() => resolveCell('XFE1'));
      expect(a1ColError.context).toEqual(
        expect.objectContaining({
          validationKind: 'columnOutOfBounds',
          path: ['address', 'col'],
          received: 'XFE1',
        }),
      );
    });

    it('preserves structured diagnostics when wrapped as an SDK error', () => {
      const error = captureKernelError(() => resolveCell('H132:L132'));
      const sdkError = MogSdkError.from(error, 'worksheet.getValue');

      expect(sdkError.code).toBe('INVALID_ARGUMENT');
      expect(sdkError.operation).toBe('worksheet.getValue');
      expect(sdkError.details).toEqual(
        expect.objectContaining({
          validationKind: 'expectedSingleCell',
          path: ['address'],
          suggestion: expect.stringContaining('single cell address'),
        }),
      );
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

describe('resolveCellArgs', () => {
  it('validates numeric coordinates before returning payload-bearing cell args', () => {
    const error = captureKernelError(() => resolveCellArgs(0, MAX_COLS, 'value'));
    expect(error.context).toEqual(
      expect.objectContaining({
        validationKind: 'columnOutOfBounds',
        path: ['address', 'col'],
        received: { row: 0, col: MAX_COLS },
      }),
    );
  });

  it('reports a missing numeric column for payload-bearing cell overloads', () => {
    const error = captureKernelError(() => resolveCellArgs(5, 'value'));
    expect(error.context).toEqual(
      expect.objectContaining({
        validationKind: 'missingCellColumn',
        path: ['col'],
        received: { row: 5, col: 'value' },
      }),
    );
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
      const error = captureKernelError(() => resolveRange('invalid'));
      expect(error.code).toBe('API_INVALID_ADDRESS');
      expect(error.context).toEqual(
        expect.objectContaining({
          validationKind: 'invalidRangeAddress',
          path: ['range'],
          expected: 'single cell or contiguous range such as "A1:B2"',
          received: 'invalid',
          suggestion: expect.stringContaining('contiguous A1 range'),
        }),
      );
    });

    it('accepts single-cell A1 notation as a valid range', () => {
      const result = resolveRange('A1');
      expect(result).toEqual({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
    });

    it('throws KernelError when endRow and endCol are undefined', () => {
      const error = captureKernelError(() =>
        resolveRange(0, 0, undefined as unknown as number, undefined as unknown as number),
      );
      expect(error.code).toBe('API_INVALID_ARGUMENT');
      expect(error.context).toEqual(
        expect.objectContaining({
          validationKind: 'missingRangeBounds',
          path: ['endRow', 'endCol'],
          received: { startRow: 0, startCol: 0, endRow: undefined, endCol: undefined },
          suggestion: expect.stringContaining('startRow, startCol, endRow, and endCol'),
        }),
      );
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

    it('reports discontiguous comma-list ranges as non-contiguous input', () => {
      const error = captureKernelError(() => resolveRange('K76,82,86,87'));
      expect(error.code).toBe('API_INVALID_ARGUMENT');
      expect(error.context).toEqual(
        expect.objectContaining({
          validationKind: 'expectedContiguousRange',
          path: ['range'],
          expected: 'single contiguous range such as "A1:B2"',
          received: 'K76,82,86,87',
          suggestion: expect.stringContaining('comma-list ranges are not supported'),
        }),
      );
    });

    it('reports malformed ranges with invalid-range diagnostics', () => {
      const error = captureKernelError(() => resolveRange('A1:'));
      expect(error.code).toBe('API_INVALID_ADDRESS');
      expect(error.context).toEqual(
        expect.objectContaining({
          validationKind: 'invalidRangeAddress',
          path: ['range'],
          received: 'A1:',
        }),
      );
    });

    it('reports null range objects with structured diagnostics', () => {
      const error = captureKernelError(() => resolveRange(null as unknown as CellRange));
      expect(error.code).toBe('API_INVALID_ARGUMENT');
      expect(error.context).toEqual(
        expect.objectContaining({
          validationKind: 'invalidRangeObject',
          path: ['range'],
          expected: expect.stringContaining('CellRange object'),
          received: null,
          suggestion: expect.stringContaining('range string'),
        }),
      );
    });

    it('reports numeric range overloads missing any bound', () => {
      const missingStartCol = captureKernelError(() =>
        resolveRange(0, undefined as unknown as number, 1, 1),
      );
      expect(missingStartCol.context).toEqual(
        expect.objectContaining({
          validationKind: 'missingRangeBounds',
          path: ['startCol'],
        }),
      );

      const missingEndCol = captureKernelError(() =>
        resolveRange(0, 0, 1, undefined as unknown as number),
      );
      expect(missingEndCol.context).toEqual(
        expect.objectContaining({
          validationKind: 'missingRangeBounds',
          path: ['endCol'],
        }),
      );

      const missingAllButStart = captureKernelError(() => resolveRange(0));
      expect(missingAllButStart.context).toEqual(
        expect.objectContaining({
          validationKind: 'missingRangeBounds',
          path: ['startCol', 'endRow', 'endCol'],
        }),
      );
    });

    it('reports negative and beyond-limit range coordinates before bridge calls', () => {
      const negativeRow = captureKernelError(() => resolveRange(-1, 0, 1, 1));
      expect(negativeRow.context).toEqual(
        expect.objectContaining({
          validationKind: 'rowOutOfBounds',
          path: ['range', 'startRow'],
          received: { startRow: -1, startCol: 0, endRow: 1, endCol: 1 },
        }),
      );

      const negativeCol = captureKernelError(() => resolveRange(0, -1, 1, 1));
      expect(negativeCol.context).toEqual(
        expect.objectContaining({
          validationKind: 'columnOutOfBounds',
          path: ['range', 'startCol'],
          received: { startRow: 0, startCol: -1, endRow: 1, endCol: 1 },
        }),
      );

      const maxRow = captureKernelError(() => resolveRange(0, 0, MAX_ROWS, 1));
      expect(maxRow.context).toEqual(
        expect.objectContaining({
          validationKind: 'rowOutOfBounds',
          path: ['range', 'endRow'],
          received: { startRow: 0, startCol: 0, endRow: MAX_ROWS, endCol: 1 },
        }),
      );

      const maxCol = captureKernelError(() => resolveRange(0, 0, 1, MAX_COLS));
      expect(maxCol.context).toEqual(
        expect.objectContaining({
          validationKind: 'columnOutOfBounds',
          path: ['range', 'endCol'],
          received: { startRow: 0, startCol: 0, endRow: 1, endCol: MAX_COLS },
        }),
      );
    });

    it('reports beyond-limit A1 range coordinates after parsing', () => {
      const rowError = captureKernelError(() => resolveRange('A1:A1048577'));
      expect(rowError.context).toEqual(
        expect.objectContaining({
          validationKind: 'rowOutOfBounds',
          path: ['range', 'endRow'],
          received: 'A1:A1048577',
        }),
      );

      const colError = captureKernelError(() => resolveRange('A1:XFE1'));
      expect(colError.context).toEqual(
        expect.objectContaining({
          validationKind: 'columnOutOfBounds',
          path: ['range', 'endCol'],
          received: 'A1:XFE1',
        }),
      );
    });
  });
});
