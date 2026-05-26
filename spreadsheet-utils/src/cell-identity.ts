/**
 * Cell Identity Runtime Utilities
 *
 * Grid key utilities and type guards extracted from
 * @mog-sdk/contracts/cell-identity.
 *
 * ID generation (generateCellId, generateRowId, generateColId, generateSheetId)
 * has been moved to Rust compute-core. See compute-api for the Rust implementation.
 *
 * Types remain in @mog-sdk/contracts/cell-identity.
 */

import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  IdentityFormulaRef,
  IdentityCellRef,
  IdentityRangeRef,
} from '@mog-sdk/contracts/cell-identity';

// =============================================================================
// Grid Index Key Utilities
// =============================================================================

/**
 * Create a grid index key from sheet, row, and col.
 *
 * The grid index enables O(1) lookup of "what cell is at position X,Y?"
 * This is essential for rendering and hit testing.
 */
export function createGridKey(sheet: SheetId, row: number, col: number): string {
  return `${sheet}:${row}:${col}`;
}

/**
 * Parse a grid index key back to components.
 */
export function parseGridKey(key: string): { sheet: SheetId; row: number; col: number } | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;

  const row = parseInt(parts[1], 10);
  const col = parseInt(parts[2], 10);

  if (isNaN(row) || isNaN(col)) return null;

  return { sheet: toSheetId(parts[0]), row, col };
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard for IdentityCellRef.
 */
export function isIdentityCellRef(ref: IdentityFormulaRef): ref is IdentityCellRef {
  return ref.type === 'cell';
}

/**
 * Type guard for IdentityRangeRef.
 */
export function isIdentityRangeRef(ref: IdentityFormulaRef): ref is IdentityRangeRef {
  return ref.type === 'range';
}
