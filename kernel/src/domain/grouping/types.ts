/**
 * Grouping Domain - Internal Types
 *
 * Types, interfaces, and constants used internally by the grouping domain module.
 * Public types (GroupDefinition, SheetGroupingConfig, etc.) are exported from
 * @mog-sdk/contracts.
 *
 * @see ../grouping.ts for main domain module
 */

import type { SheetId } from '@mog-sdk/contracts/core';
import type { SubtotalFunction } from '@mog-sdk/contracts/grouping';

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum outline level (Excel compatibility).
 * Excel supports 8 levels of outline grouping.
 */
export const MAX_OUTLINE_LEVEL = 8;

/**
 * SUBTOTAL function codes mapping.
 * Excel uses different codes for ignoring hidden values (100+) vs including them.
 *
 * - visible: Function code that includes hidden values
 * - hidden: Function code that ignores hidden values (101+)
 */
export const SUBTOTAL_FUNCTION_CODES: Record<
  SubtotalFunction,
  { visible: number; hidden: number }
> = {
  average: { visible: 1, hidden: 101 },
  count: { visible: 2, hidden: 102 },
  countNums: { visible: 3, hidden: 103 },
  max: { visible: 4, hidden: 104 },
  min: { visible: 5, hidden: 105 },
  product: { visible: 6, hidden: 106 },
  stdDev: { visible: 7, hidden: 107 },
  stdDevP: { visible: 8, hidden: 108 },
  sum: { visible: 9, hidden: 109 },
  var: { visible: 10, hidden: 110 },
  varP: { visible: 11, hidden: 111 },
};

// =============================================================================
// Internal Interfaces
// =============================================================================

/**
 * Interface for subtotals operation that requires cell access.
 * This is passed in from SpreadsheetStore which has the cell accessors.
 *
 * Subtotals need to read/write cells and manipulate rows, but the grouping
 * domain module doesn't have direct access to those operations.
 */
export interface SubtotalsCellAccessor {
  /** Get cell value at position */
  getCellValue: (sheetId: SheetId, row: number, col: number) => unknown;
  /** Set cell value at position */
  setCellValue: (sheetId: SheetId, row: number, col: number, value: string) => void;
  /** Insert rows at position */
  insertRows: (sheetId: SheetId, startRow: number, count: number) => void;
  /** Delete rows at position */
  deleteRows: (sheetId: SheetId, startRow: number, count: number) => void;
  /** Get raw formula at position */
  getCellRawValue: (sheetId: SheetId, row: number, col: number) => string;
}

/**
 * Represents a group boundary in the data.
 * Used by auto-outline and subtotals to detect where groups begin and end
 * based on value changes in a grouping column.
 */
export interface GroupBoundary {
  /** Value that identifies this group */
  groupValue: unknown;
  /** Start row of the group (0-indexed) */
  startRow: number;
  /** End row of the group (0-indexed, inclusive) */
  endRow: number;
}

// =============================================================================
// Helper Type Definitions
// =============================================================================

/**
 * Resolved group range from CellId references.
 * Null indicates the group's boundary cells were deleted.
 */
export type ResolvedGroupRange = {
  start: number;
  end: number;
} | null;

/**
 * Group with resolved CellId references.
 * Used internally when iterating over groups with their resolved positions.
 */
export interface ResolvedGroup<T> {
  group: T;
  range: { start: number; end: number };
}
