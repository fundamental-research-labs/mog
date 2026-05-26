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

import type { CellRange } from '@mog-sdk/contracts/core';

import { KernelError } from '../../errors';

import { parseCellAddress, parseCellRange, rangeToA1 } from './utils';

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
      throw new KernelError('API_INVALID_ADDRESS', `Invalid cell address: "${a}"`, {
        context: { address: a },
      });
    }
    return { row: parsed.row, col: parsed.col };
  }
  if (b === undefined) {
    throw new KernelError(
      'API_INVALID_ADDRESS',
      `Invalid cell address: row=${a} provided without column`,
      {
        context: { row: a, col: undefined },
      },
    );
  }
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
    return {
      startRow: a.startRow,
      startCol: a.startCol,
      endRow: a.endRow,
      endCol: a.endCol,
    };
  }
  if (typeof a === 'string') {
    const parsed = parseCellRange(a);
    if (!parsed) {
      throw new KernelError('API_INVALID_ADDRESS', `Invalid range address: "${a}"`, {
        context: { address: a },
      });
    }
    return {
      startRow: parsed.startRow,
      startCol: parsed.startCol,
      endRow: parsed.endRow,
      endCol: parsed.endCol,
    };
  }
  if (b === undefined || c === undefined || d === undefined) {
    throw new KernelError(
      'API_INVALID_ADDRESS',
      `Invalid range address: expected 4 numeric arguments (startRow, startCol, endRow, endCol)`,
      {
        context: { startRow: a, startCol: b, endRow: c, endCol: d },
      },
    );
  }
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
  return { row: a, col: b as number, value: c as T };
}

/**
 * Normalize a range argument to an A1-style string.
 * Accepts either an A1 string (passed through) or a CellRange object (converted).
 */
export function resolveRangeToA1(range: string | CellRange): string {
  if (typeof range === 'string') return range;
  return rangeToA1(range);
}
