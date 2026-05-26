/**
 * Selection Actor Selectors
 *
 * Pure functions that extract data from selection state.
 * Moved from contracts to kernel (contracts holds types only).
 *
 * @module @mog-sdk/kernel/selectors
 */

import type { SelectionState } from '@mog-sdk/contracts/actors/selection';
import type { CellRange } from '@mog-sdk/contracts/core';

export { type SelectionState } from '@mog-sdk/contracts/actors/selection';

/**
 * Compute effective ranges from a `SelectionState`. Mirrors
 * `getEffectiveRanges` in the selection machine helpers.
 *
 * Effective list = `[...committedRanges, pendingRange]`. `committedRanges`
 * is empty in the default flow; populated when the user is building an
 * additive selection or when a multi-range `SET_SELECTION` (Go-To-Special,
 * formula auditing, etc.) flowed through.
 *
 */
function effectiveRanges(state: SelectionState): CellRange[] {
  const ctx = state.context;
  if (ctx.committedRanges.length > 0) {
    return [...ctx.committedRanges, ctx.pendingRange];
  }
  return [ctx.pendingRange];
}

/**
 * Selection selectors - pure functions that extract data from state.
 *
 * These are the SINGLE SOURCE OF TRUTH for extraction logic.
 * All other access patterns (accessors, snapshots, hooks) use these.
 */
export const selectionSelectors = {
  // ===========================================================================
  // Value Selectors (context fields)
  // ===========================================================================

  /** Get the active cell (where typing goes) */
  activeCell: (state: SelectionState) => state.context.activeCell,

  /**
   * Get the effective selected ranges.
   *
   * composed from `committedRanges` and `pendingRange` — the
   * former flat `context.ranges` field is gone. Consumers reading
   * `state.context.ranges` directly will not typecheck and must call this
   * selector instead.
   */
  ranges: effectiveRanges,

  /** Get the active range (first effective range, falling back to a single-cell range from activeCell). */
  activeRange: (state: SelectionState) => {
    const ranges = effectiveRanges(state);
    if (ranges.length > 0) {
      return ranges[0];
    }
    // Fallback to single-cell range from activeCell
    const { row, col } = state.context.activeCell;
    return { startRow: row, startCol: col, endRow: row, endCol: col };
  },

  /** read the committed (non-contiguous) ranges directly. */
  committedRanges: (state: SelectionState) => state.context.committedRanges,

  /** read the pending (currently-being-edited) range directly. */
  pendingRange: (state: SelectionState) => state.context.pendingRange,

  /** read the selection-mode bundle. */
  modes: (state: SelectionState) => state.context.modes,

  /** Get the anchor cell (where drag started) */
  anchor: (state: SelectionState) => state.context.anchor,

  /** Get the selection direction */
  direction: (state: SelectionState) => state.context.direction,

  /** Get the formula range color */
  formulaRangeColor: (state: SelectionState) => state.context.formulaRangeColor,

  /** Check if in range selection mode (for dialogs) */
  inRangeSelectionMode: (state: SelectionState) => state.context.inRangeSelectionMode,

  /** Get fill handle start cell */
  fillHandleStart: (state: SelectionState) => state.context.fillHandleStart,

  /** Get fill handle end cell */
  fillHandleEnd: (state: SelectionState) => state.context.fillHandleEnd,

  /** Get fill source range (captured at drag start) */
  fillSourceRange: (state: SelectionState) => state.context.fillSourceRange,

  /** Get anchor column for column selection */
  anchorCol: (state: SelectionState) => state.context.anchorCol,

  /** Get anchor row for row selection */
  anchorRow: (state: SelectionState) => state.context.anchorRow,

  /** Check if fill handle dragging is allowed */
  allowDragFill: (state: SelectionState) => state.context.allowDragFill,

  /** Get drag source range (cell drag-drop) */
  dragSourceRange: (state: SelectionState) => state.context.dragSourceRange,

  /** Get drag target cell (cell drag-drop) */
  dragTargetCell: (state: SelectionState) => state.context.dragTargetCell,

  /** Get drag mode ('move' or 'copy') */
  dragMode: (state: SelectionState): 'move' | 'copy' => state.context.dragMode,

  /** Get resize type ('column' or 'row') */
  resizeType: (state: SelectionState) => state.context.resizeType,

  /** Get resize index (single resize mode) */
  resizeIndex: (state: SelectionState) => state.context.resizeIndex,

  /** Get resize indexes (multi-select mode) */
  resizeIndexes: (state: SelectionState) => state.context.resizeIndexes,

  /** Get current resize size in pixels */
  resizeCurrentSize: (state: SelectionState) => state.context.resizeCurrentSize,

  /** Get table resize ID */
  tableResizeId: (state: SelectionState) => state.context.tableResizeId,

  /** Get table resize start bounds */
  tableResizeStartBounds: (state: SelectionState) => state.context.tableResizeStartBounds,

  /** Get table resize target row */
  tableResizeTargetRow: (state: SelectionState) => state.context.tableResizeTargetRow,

  /** Get table resize target column */
  tableResizeTargetCol: (state: SelectionState) => state.context.tableResizeTargetCol,

  // ===========================================================================
  // State Matching Selectors (state.matches())
  // ===========================================================================

  /** Check if in idle state (static selection, waiting for input) */
  isIdle: (state: SelectionState): boolean => state.matches('idle'),

  /** Check if actively selecting (mouse down, dragging to select range) */
  isSelecting: (state: SelectionState): boolean => state.matches('selecting'),

  /** Check if extending selection (Shift+click) */
  isExtending: (state: SelectionState): boolean => state.matches('extending'),

  /** Check if multi-selecting (Ctrl+click adding new ranges) */
  isMultiSelecting: (state: SelectionState): boolean => state.matches('multiSelecting'),

  /** Check if selecting range for formula (picking range while editing formula) */
  isSelectingRangeForFormula: (state: SelectionState): boolean =>
    state.matches('selectingRangeForFormula'),

  /** Check if dragging fill handle (autofill operation in progress) */
  isDraggingFillHandle: (state: SelectionState): boolean =>
    state.matches('draggingFillHandle') || state.matches('rightDraggingFillHandle'),

  /** Check if right-dragging fill handle (shows context menu on release) */
  isRightDraggingFillHandle: (state: SelectionState): boolean =>
    state.matches('rightDraggingFillHandle'),

  /** Check if dragging cells (move/copy operation) */
  isDraggingCells: (state: SelectionState): boolean => state.matches('draggingCells'),

  /** Check if selecting column (dragging across column headers) */
  isSelectingColumn: (state: SelectionState): boolean => state.matches('selectingColumn'),

  /** Check if selecting row (dragging across row headers) */
  isSelectingRow: (state: SelectionState): boolean => state.matches('selectingRow'),

  /** Check if resizing header (column/row resize handle drag) */
  isResizingHeader: (state: SelectionState): boolean => state.matches('resizingHeader'),

  /** Check if resizing table (table resize handle drag) */
  isResizingTable: (state: SelectionState): boolean => state.matches('resizingTable'),

  // ===========================================================================
  // Derived Selectors (computed from multiple values)
  // ===========================================================================

  /**
   * Check if actively selecting a range (for snapshot).
   * True when the user is dragging to select, extend, or multi-select.
   */
  isActivelySelecting: (state: SelectionState): boolean =>
    state.matches('selecting') || state.matches('extending') || state.matches('multiSelecting'),

  /** Check if in any drag operation (selecting, fill, cells, header resize) */
  isInDragOperation: (state: SelectionState): boolean =>
    state.matches('selecting') ||
    state.matches('extending') ||
    state.matches('multiSelecting') ||
    state.matches('draggingFillHandle') ||
    state.matches('rightDraggingFillHandle') ||
    state.matches('draggingCells') ||
    state.matches('selectingColumn') ||
    state.matches('selectingRow') ||
    state.matches('resizingHeader') ||
    state.matches('resizingTable'),

  /** Check if in formula mode */
  isInFormulaMode: (state: SelectionState): boolean =>
    state.matches('selectingRangeForFormula') || state.context.formulaRangeColor !== null,
};
