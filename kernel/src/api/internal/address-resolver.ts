/**
 * Address Resolver — Overload Resolution Utility
 *
 * Shared utility for resolving TypeScript overloaded method signatures
 * that accept both A1 strings AND numeric (row, col) arguments.
 *
 * The typeof check on the first argument discriminates the overload:
 * - string → A1 notation, parse to (row, col)
 * - number → direct numeric, zero-cost passthrough
 */

import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';

import { KernelError, type KernelErrorCode } from '../../errors';

import { parseCellAddress, parseCellRange, rangeToA1 } from './utils';

type ResolverPath = string[];

interface AddressDiagnostic {
  code?: KernelErrorCode;
  validationKind: string;
  message: string;
  path: ResolverPath;
  expected: string;
  received: unknown;
  suggestion: string;
}

function failAddressDiagnostic({
  code = 'API_INVALID_ARGUMENT',
  validationKind,
  message,
  path,
  expected,
  received,
  suggestion,
}: AddressDiagnostic): never {
  throw new KernelError(code, message, {
    path,
    suggestion,
    context: {
      validationKind,
      path,
      expected,
      received,
      suggestion,
    },
  });
}

function validateRow(row: number, path: ResolverPath, received: unknown): void {
  if (!Number.isInteger(row)) {
    failAddressDiagnostic({
      validationKind: 'invalidRowIndex',
      message: `Invalid row index: ${String(row)}`,
      path,
      expected: `integer row index from 0 to ${MAX_ROWS - 1}`,
      received,
      suggestion: 'Use zero-based integer row indexes within the worksheet row limit.',
    });
  }

  if (row < 0 || row >= MAX_ROWS) {
    failAddressDiagnostic({
      validationKind: 'rowOutOfBounds',
      message: `Row index out of bounds: ${row}`,
      path,
      expected: `row index from 0 to ${MAX_ROWS - 1}`,
      received,
      suggestion: 'Use zero-based row indexes within the worksheet row limit.',
    });
  }
}

function validateCol(col: number, path: ResolverPath, received: unknown): void {
  if (!Number.isInteger(col)) {
    failAddressDiagnostic({
      validationKind: 'invalidColumnIndex',
      message: `Invalid column index: ${String(col)}`,
      path,
      expected: `integer column index from 0 to ${MAX_COLS - 1}`,
      received,
      suggestion: 'Use zero-based integer column indexes within the worksheet column limit.',
    });
  }

  if (col < 0 || col >= MAX_COLS) {
    failAddressDiagnostic({
      validationKind: 'columnOutOfBounds',
      message: `Column index out of bounds: ${col}`,
      path,
      expected: `column index from 0 to ${MAX_COLS - 1}`,
      received,
      suggestion: 'Use zero-based column indexes within the worksheet column limit.',
    });
  }
}

function validateCellBounds(
  cell: { row: number; col: number },
  basePath: ResolverPath,
  received: unknown,
): void {
  validateRow(cell.row, [...basePath, 'row'], received);
  validateCol(cell.col, [...basePath, 'col'], received);
}

function validateRangeBounds(
  range: { startRow: number; startCol: number; endRow: number; endCol: number },
  basePath: ResolverPath,
  received: unknown,
): void {
  validateRow(range.startRow, [...basePath, 'startRow'], received);
  validateCol(range.startCol, [...basePath, 'startCol'], received);
  validateRow(range.endRow, [...basePath, 'endRow'], received);
  validateCol(range.endCol, [...basePath, 'endCol'], received);
}

// =============================================================================
// Cell Address Resolution
// =============================================================================

/**
 * Resolve a cell address overload to numeric (row, col).
 *
 * @example
 * resolveCell("A1")      → { row: 0, col: 0 }
 * resolveCell(0, 0)      → { row: 0, col: 0 }
 * resolveCell("Sheet1!B2") → { row: 1, col: 1 }  (sheetName ignored)
 */
export function resolveCell(a: string | number, b?: number): { row: number; col: number } {
  if (typeof a === 'string') {
    const parsed = parseCellAddress(a);
    if (!parsed) {
      const parsedRange = parseCellRange(a);
      if (parsedRange) {
        failAddressDiagnostic({
          validationKind: 'expectedSingleCell',
          message: `Expected a single cell address but received range address: "${a}"`,
          path: ['address'],
          expected: 'single cell address such as "A1"',
          received: a,
          suggestion: 'Pass a single cell address, or call a range API for contiguous ranges.',
        });
      }
      throw new KernelError('API_INVALID_ADDRESS', `Invalid cell address: "${a}"`, {
        path: ['address'],
        suggestion: 'Pass a single cell address such as "A1".',
        context: {
          validationKind: 'invalidCellAddress',
          path: ['address'],
          expected: 'single cell address such as "A1"',
          received: a,
          suggestion: 'Pass a single cell address such as "A1".',
        },
      });
    }
    validateCellBounds(parsed, ['address'], a);
    return { row: parsed.row, col: parsed.col };
  }
  if (b === undefined) {
    failAddressDiagnostic({
      validationKind: 'missingCellColumn',
      message: `Invalid cell address: row=${a} provided without column`,
      path: ['col'],
      expected: 'numeric column argument',
      received: { row: a, col: undefined },
      suggestion: 'Call the numeric cell overload with both row and column arguments.',
    });
  }
  validateCellBounds({ row: a, col: b }, ['address'], { row: a, col: b });
  return { row: a, col: b };
}

// =============================================================================
// Range Address Resolution
// =============================================================================

/**
 * Resolve a range address overload to numeric bounds.
 *
 * @example
 * resolveRange("A1:B2")        → { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }
 * resolveRange(0, 0, 1, 1)     → { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }
 * resolveRange({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 })  → passthrough
 */
export function resolveRange(
  a: string | number | CellRange,
  b?: number,
  c?: number,
  d?: number,
): { startRow: number; startCol: number; endRow: number; endCol: number } {
  if (typeof a === 'object') {
    if (a === null) {
      failAddressDiagnostic({
        validationKind: 'invalidRangeObject',
        message: 'Invalid range argument: null',
        path: ['range'],
        expected: 'range string such as "A1:B2", CellRange object, or numeric start/end bounds',
        received: a,
        suggestion: 'Pass a range string such as "A1:B2" or a CellRange object.',
      });
    }
    const range = {
      startRow: a.startRow,
      startCol: a.startCol,
      endRow: a.endRow,
      endCol: a.endCol,
    };
    validateRangeBounds(range, ['range'], range);
    return range;
  }
  if (typeof a === 'string') {
    const parsed = parseCellRange(a);
    if (!parsed) {
      if (a.includes(',')) {
        failAddressDiagnostic({
          validationKind: 'expectedContiguousRange',
          message: `Expected a contiguous range address but received discontiguous range list: "${a}"`,
          path: ['range'],
          expected: 'single contiguous range such as "A1:B2"',
          received: a,
          suggestion: 'Pass one contiguous range; comma-list ranges are not supported by this API.',
        });
      }
      throw new KernelError('API_INVALID_ADDRESS', `Invalid range address: "${a}"`, {
        path: ['range'],
        suggestion: 'Pass a contiguous A1 range such as "A1:B2".',
        context: {
          validationKind: 'invalidRangeAddress',
          path: ['range'],
          expected: 'single cell or contiguous range such as "A1:B2"',
          received: a,
          suggestion: 'Pass a contiguous A1 range such as "A1:B2".',
        },
      });
    }
    const range = {
      startRow: parsed.startRow,
      startCol: parsed.startCol,
      endRow: parsed.endRow,
      endCol: parsed.endCol,
    };
    validateRangeBounds(range, ['range'], a);
    return range;
  }
  if (b === undefined || c === undefined || d === undefined) {
    const received = { startRow: a, startCol: b, endRow: c, endCol: d };
    const missing = [
      b === undefined ? 'startCol' : null,
      c === undefined ? 'endRow' : null,
      d === undefined ? 'endCol' : null,
    ].filter((name): name is string => name !== null);

    failAddressDiagnostic({
      validationKind: 'missingRangeBounds',
      message: `Invalid range address: expected 4 numeric arguments (startRow, startCol, endRow, endCol)`,
      path: missing,
      expected: 'numeric startRow, startCol, endRow, and endCol arguments',
      received,
      suggestion: 'Call the numeric range overload with startRow, startCol, endRow, and endCol.',
    });
  }
  validateRangeBounds({ startRow: a, startCol: b, endRow: c, endCol: d }, ['range'], {
    startRow: a,
    startCol: b,
    endRow: c,
    endCol: d,
  });
  return { startRow: a, startCol: b, endRow: c, endCol: d };
}

// =============================================================================
// Cell Address + Payload Resolution
// =============================================================================

/**
 * Resolve an overloaded (address, payload) signature.
 *
 * Handles two call shapes:
 * - `(a1String, payload)` — A1 notation
 * - `(row, col, payload)` — numeric addressing
 *
 * @returns `{ row, col, value }` where value is the payload argument.
 */
export function resolveCellArgs<T>(
  a: string | number,
  b: T | number,
  c?: T,
): { row: number; col: number; value: T } {
  if (typeof a === 'string') {
    const { row, col } = resolveCell(a);
    return { row, col, value: b as T };
  }
  if (typeof b !== 'number') {
    failAddressDiagnostic({
      validationKind: 'missingCellColumn',
      message: `Invalid cell address: row=${a} provided without numeric column`,
      path: ['col'],
      expected: 'numeric column argument',
      received: { row: a, col: b },
      suggestion: 'Call the numeric cell overload with row, column, and payload arguments.',
    });
  }
  const { row, col } = resolveCell(a, b);
  return { row, col, value: c as T };
}

/**
 * Normalize a range argument to an A1-style string.
 * Accepts either an A1 string (passed through) or a CellRange object (converted).
 */
export function resolveRangeToA1(range: string | CellRange): string {
  if (typeof range === 'string') return range;
  return rangeToA1(range);
}
