/**
 * Sorting Contracts - Type definitions for spreadsheet sorting.
 *
 * Stream A1: Sort System (Cell Identity Model)
 *
 * This module defines sort options, criteria, and events. The sort system
 * uses the Cell Identity Model for column identification - sort criteria
 * reference columns by header CellId (not column index) to survive
 * concurrent structure changes.
 *
 * ARCHITECTURE (Cell Identity Model):
 *
 * Sort criteria use headerCellId (not columnIndex) for column identification.
 * This follows the same pattern as:
 * - FilterSortState.columnCellId (Layer 0 filters)
 * - IdentityRangeRef (formulas)
 * - IdentityMergedRegion (merged cells)
 *
 * Why CellId-based?
 * - Survives column insert/delete (column index shifts, CellId stable)
 * - CRDT-safe for concurrent structure changes
 * - Consistent with Cell Identity Model used throughout codebase
 * - Works with async/queued operations (no race conditions)
 *
 * Sort operation flow:
 *   SortOptions (CellId-based) → Resolve Positions → Compute Order → Reorder Rows → Emit Event
 *
 * IMPORTANT: Sort updates cell POSITIONS, not cell DATA.
 * This preserves Cell Identity - CellIds stay with their data.
 *
 * @see docs/architecture/cell-identity.md
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { CellRange, CellValue, SheetId } from '@mog/types-core/core';
import type { BaseEvent, StructureChangeSource } from '@mog/types-commands/event-base';

// =============================================================================
// Sort Direction & Type
// =============================================================================

/**
 * Sort direction.
 *
 * Note: 'asc' | 'desc' matches SortOrder from pivot.ts but without 'none'.
 * For sorting operations, we always have a direction.
 */
export type SortDirection = 'asc' | 'desc';

/**
 * What aspect of the cell to sort by.
 *
 * - value: Sort by cell computed value (default)
 * - cellColor: Sort by cell background color
 * - fontColor: Sort by cell font color
 */
export type SortBy = 'value' | 'cellColor' | 'fontColor';

/**
 * Position of color-matched rows in a color-based sort.
 *
 * - 'top': matched rows precede unmatched (Excel default; "color on top")
 * - 'bottom': matched rows follow unmatched
 */
export type ColorPosition = 'top' | 'bottom';

// =============================================================================
// Sort Criterion (Cell Identity Model)
// =============================================================================

/**
 * Single sort criterion - Cell Identity Model.
 *
 * ARCHITECTURE: Uses headerCellId for column identification, NOT column index.
 * This ensures sort criteria survives column insert/delete operations.
 *
 * Discriminated on `sortBy`: invalid combinations (e.g. `cellColor` without
 * `targetColor`) don't typecheck. Mirrors the Rust `SortMode` enum.
 *
 * Example:
 *   User sorts by column B (header "Name") ascending by value:
 *     { headerCellId: 'abc-123-...', direction: 'asc', sortBy: 'value' }
 *   Sort by yellow cells on top:
 *     { headerCellId: '…', direction: 'asc', sortBy: 'cellColor',
 *       targetColor: '#FFFF00', colorPosition: 'top' }
 */
export type SortCriterion = {
  /**
   * CellId of the header cell for this sort column.
   *
   * Why CellId (not column index)?
   * - Column index changes on insert/delete column
   * - CellId is stable - sort criterion follows the column
   * - CRDT-safe for concurrent structure changes
   */
  headerCellId: CellId;

  /** Sort direction (ascending or descending) */
  direction: SortDirection;

  /** Case sensitive string comparison (default: false) */
  caseSensitive?: boolean;
} & (
  | {
      sortBy: 'value';
      /**
       * Custom-list sort: values present in `customList` sort by their
       * list position; values not in the list sort *after* list members
       * (spreadsheet compatibility). Optional — when omitted, use natural-order
       * comparison.
       */
      customList?: CellValue[];
    }
  | {
      sortBy: 'cellColor' | 'fontColor';
      /** Hex color to match (e.g. '#FFFF00'). */
      targetColor: string;
      /** Whether matched rows go to top or bottom of the sorted range. */
      colorPosition: ColorPosition;
    }
);

// =============================================================================
// Sort Options
// =============================================================================

/**
 * Complete sort options - Cell Identity Model.
 *
 * The sort range itself is passed separately to sortRange().
 * For table sort integration, this aligns with FilterSortState.
 */
export interface SortOptions {
  /**
   * Sort criteria (primary, secondary, tertiary, etc.).
   * Each criterion uses headerCellId for column identification.
   * Evaluated in order - primary first, then secondary for ties, etc.
   */
  criteria: SortCriterion[];

  /**
   * Does the range have a header row?
   *
   * If true, the first row of the range is excluded from sorting.
   * Header cells provide display names for sort dialog columns.
   */
  hasHeaders?: boolean;

  /**
   * Sort by columns instead of rows (horizontal sort).
   *
   * Default is false (sort rows vertically).
   * When true, sorts columns left-to-right based on a row's values.
   */
  byColumns?: boolean;
}

// =============================================================================
// API-Friendly Sort Options
// =============================================================================

/**
 * Sort criterion for external API (user-friendly version).
 *
 * Uses column index instead of CellId for API ergonomics.
 * The SheetAPI.sortRange() method converts this to CellId-based SortCriterion.
 *
 * Same discriminated-union shape as `SortCriterion` so invalid combinations
 * (color sort without `targetColor`, etc.) don't typecheck.
 *
 * This is the same pattern as createFilter() - API accepts positions,
 * internally stores CellIds.
 */
export type ApiSortCriterion = {
  /** Column index to sort by (0-based, absolute) */
  column: number;

  /** Sort direction */
  direction: SortDirection;

  /** Case sensitive comparison (default: false) */
  caseSensitive?: boolean;
} & (
  | {
      /** What to sort by (default: 'value' if sortBy is omitted entirely) */
      sortBy?: 'value';
      /** Optional Excel custom-list sort: values not in list sort to end. */
      customList?: CellValue[];
    }
  | {
      sortBy: 'cellColor' | 'fontColor';
      /** Hex color to match (e.g. '#FFFF00'). */
      targetColor: string;
      /** Whether matched rows go to top or bottom of the sorted range. */
      colorPosition: ColorPosition;
    }
);

/**
 * Sort options for external API (user-friendly version).
 *
 * Used by SheetAPI.sortRange() for AI agent ergonomics.
 */
export interface ApiSortOptions {
  /** Sort criteria using column indices */
  sortBy: ApiSortCriterion[];

  /** Does the range have a header row? (default: auto-detect) */
  hasHeaders?: boolean;

  /** Sort only currently visible row slots, preserving hidden row positions. */
  visibleRowsOnly?: boolean;

  /** Sort by columns instead of rows (default: false) */
  byColumns?: boolean;
}

// =============================================================================
// Sort Result
// =============================================================================

/**
 * Result of a sort operation.
 *
 * Returned by domain module's computeSortedRowOrder() for orchestration.
 */
export interface SortResult {
  /** Original row indices in sorted order */
  sortedIndices: number[];

  /** Number of rows that changed position */
  rowsMoved: number;

  /** Whether any header CellIds couldn't be resolved (deleted columns) */
  hasUnresolvedCriteria: boolean;
}

// =============================================================================
// Events
// =============================================================================

/**
 * Emitted when a range is sorted.
 * Stream A1: Sort System
 */
export interface RangeSortedEvent extends BaseEvent {
  type: 'range:sorted';
  sheetId: SheetId;
  /** The range that was sorted */
  range: CellRange;
  /** Sort options used */
  options: SortOptions;
  /** Number of rows that changed position */
  rowsMoved: number;
  source: StructureChangeSource;
}

/**
 * Emitted when columns are sorted on a sheet.
 * Maps to the column-sorted event.
 */
export interface ColumnSortedEvent extends BaseEvent {
  type: 'sort:column-sorted';
  sheetId: SheetId;
  /** The range that was sorted */
  range: CellRange;
  /** Sort options used */
  options: SortOptions;
  source: StructureChangeSource;
}

/**
 * Emitted when rows are sorted on a sheet.
 * Maps to the row-sorted event.
 */
export interface RowSortedEvent extends BaseEvent {
  type: 'sort:row-sorted';
  sheetId: SheetId;
  /** The range that was sorted */
  range: CellRange;
  /** Sort options used */
  options: SortOptions;
  source: StructureChangeSource;
}
