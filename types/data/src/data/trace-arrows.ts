/**
 * Trace Arrows Types
 *
 * Types for formula auditing trace arrows visualization.
 *
 * CRITICAL: Trace arrows use CellId (stable identity) not row/col (mutable positions).
 * This ensures arrows survive structure changes (row/col insert/delete) - positions
 * are resolved at render time via CellPositionLookup.
 *
 * @see docs/architecture/cell-identity.md
 *
 * @module trace-arrows
 */

import type { CellId } from '@mog/types-core/cell-identity';
import type { SheetId } from '@mog/types-core/core';

// =============================================================================
// Trace Arrow Types
// =============================================================================

/**
 * Type of trace arrow - indicates direction of dependency.
 *
 * - precedent: Arrow from a cell that this cell depends on (input)
 * - dependent: Arrow to a cell that depends on this cell (output)
 */
export type TraceArrowType = 'precedent' | 'dependent';

/**
 * A trace arrow connecting two cells by their stable identities.
 *
 * IMPORTANT: Uses CellId (stable) not row/col (mutable).
 * Positions are resolved at render time via CellPositionLookup.
 * This ensures arrows follow cells when rows/cols are inserted/deleted.
 *
 * @example
 * // User traces precedents for cell with formula =A1+B1
 * // Creates two arrows: A1→target, B1→target
 * const arrow: TraceArrow = {
 *   id: 'prec-target-a1-0',
 *   fromCellId: 'abc-123...',  // CellId of A1 (stable)
 *   toCellId: 'def-456...',    // CellId of target (stable)
 *   type: 'precedent',
 *   crossSheet: false,
 *   fromSheetId: 'sheet-1',
 *   toSheetId: 'sheet-1',
 *   level: 1
 * };
 *
 * // After inserting column at A:
 * // - CellIds unchanged
 * // - Positions resolved at render time show B1→target, C1→target
 */
/**
 * Position data for a trace arrow endpoint.
 * Used as fallback when CellId lookup fails (e.g., empty cells without stored CellIds).
 */
export interface TraceArrowPosition {
  sheetId: SheetId;
  row: number;
  col: number;
}

export interface TraceArrow {
  /**
   * Unique ID for this arrow.
   * Used for React keys and targeted removal.
   * Format: `{type}-{targetCellId}-{sourceCellId}-{index}`
   */
  id: string;

  /**
   * Source cell identity (stable - never changes).
   * For precedents: the cell that is referenced
   * For dependents: the cell containing the formula
   */
  fromCellId: CellId;

  /**
   * Target cell identity (stable - never changes).
   * For precedents: the cell containing the formula
   * For dependents: the cell that references this one
   */
  toCellId: CellId;

  /**
   * Arrow direction: precedent = input, dependent = output.
   * Affects arrow color (blue for precedent, red for dependent).
   */
  type: TraceArrowType;

  /**
   * True if source and target are on different sheets.
   * Cross-sheet arrows render with dashed lines and a sheet indicator icon.
   */
  crossSheet: boolean;

  /**
   * Sheet containing the source cell (fromCellId).
   */
  fromSheetId: SheetId;

  /**
   * Sheet containing the target cell (toCellId).
   */
  toSheetId: SheetId;

  /**
   * Trace level: 1 = direct reference, 2+ = transitive.
   * Excel allows clicking "Trace Precedents" multiple times to show deeper levels.
   * Level 1 arrows are shown first, then level 2, etc.
   */
  level: number;

  /**
   * Fallback position for source cell.
   * Used when CellId lookup fails (e.g., empty cells that don't have stored CellIds).
   * The renderer should use this position directly when getCellPosition returns null.
   */
  fromPosition: TraceArrowPosition;

  /**
   * Fallback position for target cell.
   * Used when CellId lookup fails (e.g., empty cells that don't have stored CellIds).
   * The renderer should use this position directly when getCellPosition returns null.
   */
  toPosition: TraceArrowPosition;
}

// =============================================================================
// Trace Arrows State
// =============================================================================

/**
 * State for the trace arrows UI feature.
 *
 * This is ephemeral UI state (not persisted to Yjs) - when the user closes
 * the spreadsheet, trace arrows disappear. Use Zustand slice, not Yjs.
 */
export interface TraceArrowsState {
  /**
   * Map from sheetId to arrows visible on that sheet.
   * When switching sheets, only arrows for the current sheet are rendered.
   * Cross-sheet arrows appear on both the source and target sheets.
   */
  arrowsBySheet: Map<SheetId, TraceArrow[]>;

  /**
   * The cell that was the "root" of the current trace operation.
   * Used for UI highlighting and "Remove Arrows" context.
   */
  tracedCellId: CellId | null;

  /**
   * Sheet containing the traced cell.
   */
  tracedSheetId: SheetId | null;
}

// =============================================================================
// Trace Arrow Creation Options
// =============================================================================

/**
 * Options for creating a trace arrow.
 * Used by action handlers to construct TraceArrow objects.
 */
export interface CreateTraceArrowOptions {
  /** Source cell identity */
  fromCellId: CellId;
  /** Target cell identity */
  toCellId: CellId;
  /** Arrow type */
  type: TraceArrowType;
  /** Source sheet ID */
  fromSheetId: SheetId;
  /** Target sheet ID */
  toSheetId: SheetId;
  /** Trace level (default: 1) */
  level?: number;
  /** Source cell position (fallback for rendering) */
  fromPosition: { row: number; col: number };
  /** Target cell position (fallback for rendering) */
  toPosition: { row: number; col: number };
}
