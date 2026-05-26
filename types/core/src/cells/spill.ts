/**
 * Spill Contracts (Stream AF: Array Formulas)
 *
 * Types for dynamic array spill behavior in Excel-compatible spreadsheets.
 *
 * ARCHITECTURE:
 * - Spill occurs when a formula returns a 2D array larger than 1x1
 * - The anchor cell contains the formula; spill cells show computed values
 * - Spill cells store `spillAnchor: CellId` pointing to the formula cell
 * - This enables efficient lookup, proper deletion, and CRDT-safe collaboration
 *
 * Excel Compatibility:
 * - Dynamic arrays spill automatically (Excel 365+)
 * - Legacy CSE (Ctrl+Shift+Enter) creates fixed-size array formulas
 * - #SPILL! error when spill range is blocked
 * - Spill cannot cross sheet boundaries
 *
 */

import type { CellRange, CellValue, SheetId } from '../core';
import type { CellId } from './cell-identity';

// =============================================================================
// Spill Result Types
// =============================================================================

/**
 * Result of evaluating an array-returning formula.
 *
 * Produced by the recalculation module when a formula returns CellValue[][].
 * Used by the spill orchestration layer to determine what to write.
 */
export interface SpillResult {
  /** The cell containing the array formula (anchor) */
  anchorCellId: CellId;

  /** Sheet containing the spill */
  sheetId: SheetId;

  /** The array values to spill (row-major order) */
  values: CellValue[][];

  /** Calculated spill range (anchor cell + extent) */
  spillRange: CellRange;

  /** Whether the spill is blocked by existing data */
  blocked: boolean;

  /** CellId of the cell blocking the spill, if any */
  blockingCellId?: CellId;
}

/**
 * Spill range info for a single anchor cell.
 *
 * Stored on anchor cells to track their spill extent.
 * Used for:
 * - Clearing old spill when formula result changes size
 * - Detecting when a cell is being entered in a spill range
 * - Selection highlighting of entire spill range
 */
export interface SpillRangeInfo {
  /** Number of rows the spill occupies (including anchor) */
  rows: number;

  /** Number of columns the spill occupies (including anchor) */
  cols: number;
}

// =============================================================================
// Array Formula State (Legacy CSE Support)
// =============================================================================

/**
 * Array formula state for legacy CSE formulas.
 *
 * CSE (Ctrl+Shift+Enter) creates fixed-size array formulas where:
 * - User pre-selects the output range
 * - Formula is stored once on the anchor cell
 * - All cells in the range are marked as array members
 * - Size is fixed (does not auto-resize like dynamic arrays)
 * - Formula bar shows {=formula} with curly braces
 *
 * Stored on the anchor cell only. Member cells reference back via spillAnchor.
 */
export interface ArrayFormulaState {
  /** The range this array formula occupies */
  range: CellRange;

  /**
   * Whether this is a legacy CSE formula.
   * - true: Fixed-size CSE formula (user-selected range)
   * - false: Dynamic spill formula (auto-sized)
   */
  isCSE: boolean;
}

// =============================================================================
// Spill Error Types
// =============================================================================

/**
 * Spill error reasons for diagnostics.
 */
export type SpillErrorReason =
  | 'blocked' // Another cell has data in the spill range
  | 'merged' // Spill range overlaps a merged region
  | 'cross_sheet' // Spill would cross sheet boundaries (not allowed)
  | 'bounds_overflow' // Spill would exceed sheet bounds (max rows/cols)
  | 'table_overlap' // Spill range overlaps a structured table
  | 'array_overlap'; // Spill range overlaps another array formula

/**
 * Detailed spill error information.
 *
 * Provides context for #SPILL! errors to help users understand
 * why their formula cannot spill.
 */
export interface SpillError {
  /** The type of obstruction */
  reason: SpillErrorReason;

  /** CellId of the blocking cell (if reason is 'blocked') */
  blockingCellId?: CellId;

  /** Human-readable description */
  message: string;
}

// =============================================================================
// Projection Types (Dynamic Array Architecture)
//
// The Rust compute-core now uses a ProjectionRegistry instead of phantom cells
// for dynamic arrays. These types model the projection concept on the TS side.
//
// "Projection" replaces the concept of "spill/phantom" — a projected position
// is a cell whose displayed value is computed by the projection registry from
// a source cell's array result, rather than stored as a separate phantom cell.
//
// These types coexist with the SpillResult/SpillRangeInfo types above.
// The old spill types will be removed in a future cleanup.
// =============================================================================

/**
 * Projection information for a cell position.
 *
 * Describes how a cell's displayed value is derived from a dynamic array
 * formula's projection. This replaces the old "spill phantom" concept:
 * instead of creating phantom CellIds for each spilled position, the
 * ProjectionRegistry maps (sheet, row, col) -> source cell + offset.
 *
 * @see compute-core/src/eval/projection_registry.rs
 */
export interface ProjectionInfo {
  /** Row of the source cell (the cell containing the array formula). */
  sourceRow: number;
  /** Column of the source cell. */
  sourceCol: number;
  /** Top-left row of the projection region (usually same as sourceRow). */
  originRow: number;
  /** Top-left column of the projection region (usually same as sourceCol). */
  originCol: number;
  /** Number of rows in the projected array. */
  rows: number;
  /** Number of columns in the projected array. */
  cols: number;
}
