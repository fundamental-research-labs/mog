/**
 * API Utilities
 *
 * @stability stable
 *
 * Pure utility functions for A1 notation parsing, range geometry, and formatting.
 * No context dependency — safe for external use, semver-protected.
 *
 * Re-exports A1 parsing and range helpers from @mog-sdk/contracts.
 * Adds kernel-specific formatters (addressToA1, rangeToA1) that use contract types.
 */

import type { CellAddress, CellRange } from '@mog-sdk/contracts/core';

// =============================================================================
// Sub-namespace exports (preferred — use Utils.a1.parse(), Utils.range.contains())
// =============================================================================

import * as _a1Module from '@mog/spreadsheet-utils/a1';
import * as _rangeModule from '@mog/spreadsheet-utils/range';

/** A1 notation parsing, formatting, and validation. */
export const a1 = _a1Module;

/** Cell range geometry, navigation, and intersection utilities. */
export const range = _rangeModule;

// =============================================================================
// Flat re-exports (backward-compatible — prefer Utils.a1.* / Utils.range.*)
// =============================================================================

// Re-export A1 parsing and validation from the canonical source (spreadsheet-utils)
export {
  colToLetter,
  createRange,
  getRangeDimensions,
  isValidAddress,
  isValidCellRange as isValidRange,
  letterToCol,
  parseCellAddress,
  parseCellRange,
  quoteSheetName,
  toA1,
  toSheetA1,
} from '@mog/spreadsheet-utils/a1';

// Re-export range navigation utilities so kernel consumers can import from one place
export {
  containsRange,
  getAbsoluteResizedRange,
  getBoundingRect,
  getCellRange,
  getColumn,
  getColumnsAfter,
  getColumnsBefore,
  getEntireColumn,
  getEntireRow,
  getIntersection,
  getLastCell,
  getLastColumn,
  getLastRow,
  getOffsetRange,
  getResizedRange,
  getRow,
  getRowsAbove,
  getRowsBelow,
  normalizeRange,
  rangesOverlap,
} from '@mog/spreadsheet-utils/range';

// ============================================================================
// Kernel-specific helpers (use contract CellAddress/CellRange types)
// ============================================================================

import { quoteSheetName as _quoteSheetName, toA1 as _toA1 } from '@mog/spreadsheet-utils/a1';

/**
 * Check if a CellAddress is within a CellRange.
 */
export function isAddressInRange(address: CellAddress, range: CellRange): boolean {
  const n = {
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
  return (
    address.row >= n.startRow &&
    address.row <= n.endRow &&
    address.col >= n.startCol &&
    address.col <= n.endCol
  );
}

/**
 * Convert a CellAddress to A1 notation.
 *
 * @param sheetName - When `includeSheet` is true, use this resolved name instead of
 *   the raw `address.sheetId` (which is typically a UUID). Falls back to `address.sheetId`
 *   when omitted.
 */
export function addressToA1(
  address: CellAddress,
  includeSheet = false,
  sheetName?: string,
): string {
  const a1 = _toA1(address.row, address.col);
  const resolvedName = sheetName ?? address.sheetId;
  if (includeSheet && resolvedName) {
    return `${_quoteSheetName(resolvedName)}!${a1}`;
  }
  return a1;
}

/**
 * Convert a CellRange to A1 notation.
 *
 * @param sheetName - When `includeSheet` is true, use this resolved name instead of
 *   the raw `range.sheetId` (which is typically a UUID). Falls back to `range.sheetId`
 *   when omitted.
 */
export function rangeToA1(range: CellRange, includeSheet = false, sheetName?: string): string {
  const start = _toA1(range.startRow, range.startCol);
  const end = _toA1(range.endRow, range.endCol);
  const rangeRef = `${start}:${end}`;

  const resolvedName = sheetName ?? range.sheetId;
  if (includeSheet && resolvedName) {
    return `${_quoteSheetName(resolvedName)}!${rangeRef}`;
  }
  return rangeRef;
}
