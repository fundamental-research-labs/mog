/**
 * Selection Machine - Drag Actions
 *
 * Handles drag-based interactions:
 * - Fill handle (startFillHandle, updateFillHandle, clearFillHandle)
 * - Cell drag-drop (startDragCells, updateDragCells, clearDragCells)
 * - Header resize (startColumnResize, startRowResize, updateResize, finalizeResize, clearResize)
 * - Table resize (startTableResize, updateTableResize, finalizeTableResize, clearTableResize)
 *
 * All actions are pure state transitions using XState's assign() function.
 * No side effects - only state updates.
 *
 * @see core-actions.ts - Main export point
 * @see selection-machine.ts - State machine that uses these actions
 */

import { assign } from 'xstate';
import { getRangeEndCell } from '../../../shared/types';
import type { SelectionContext, SelectionEvent } from './types';

// =============================================================================
// FILL HANDLE ACTIONS
// =============================================================================

/**
 * Start fill handle drag - captures the SOURCE RANGE at drag start.
 * This is critical: fillSourceRange is immutable during drag and tells
 * the coordinator what cells to fill FROM.
 */
const startFillHandle = assign(({ context }: { context: SelectionContext }) => {
  // fillHandle drag operates on the trailing pending range
  // (the cell or block the user just selected). Committed ranges from a
  // multi-range selection are not used as fill sources.
  const sourceRange = context.pendingRange;
  const endCell = getRangeEndCell(sourceRange);
  return {
    fillSourceRange: sourceRange, // Captured at START, immutable during drag
    fillHandleStart: endCell,
    fillHandleEnd: endCell,
  };
});

/**
 * Update fill handle during drag.
 */
const updateFillHandle = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'FILL_HANDLE_DRAG' && event.type !== 'RIGHT_FILL_HANDLE_DRAG') return {};
    return {
      fillHandleEnd: event.cell,
    };
  },
);

/**
 * Clear all fill context. Called by CLEAR_FILL_CONTEXT event,
 * which the coordinator sends AFTER executing the fill operation.
 */
const clearFillHandle = assign(() => ({
  fillSourceRange: null,
  fillHandleStart: null,
  fillHandleEnd: null,
}));

// =============================================================================
// CELL DRAG-DROP ACTIONS
// =============================================================================

/**
 * Start dragging cells - captures the source range (current selection).
 * The source range is immutable during drag.
 */
const startDragCells = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'START_DRAG_CELLS') return {};
    // Cell drag-drop captures the first effective range as the
    // source. For non-additive selections this is the pending range; for
    // additive selections the leading committed range wins (matching the
    // previous `ranges[0]` semantics).
    const sourceRange =
      context.committedRanges.length > 0 ? context.committedRanges[0]! : context.pendingRange;
    return {
      dragSourceRange: sourceRange,
      dragTargetCell: event.cell,
      dragMode: event.ctrlKey ? ('copy' as const) : ('move' as const),
    };
  },
);

/**
 * Update drag target cell during mouse move.
 * Also updates dragMode if Ctrl key state changes.
 */
const updateDragCells = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'DRAG_CELLS_MOVE') return {};
    return {
      dragTargetCell: event.cell,
      dragMode: event.ctrlKey ? ('copy' as const) : ('move' as const),
    };
  },
);

/**
 * Clear drag context after drop (or cancel).
 * Coordinator reads dragSourceRange/dragTargetCell/dragMode before this.
 */
const clearDragCells = assign(() => ({
  dragSourceRange: null,
  dragTargetCell: null,
  dragMode: 'move' as const,
}));

// =============================================================================
// HEADER RESIZE ACTIONS
// =============================================================================

/**
 * Start column resize - captures the column index and starting size.
 * C.2: Supports multi-select resize when cols and startSizes are provided.
 */
const startColumnResize = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'START_COLUMN_RESIZE') return {};
    return {
      resizeType: 'column' as const,
      resizeIndex: event.col,
      resizeIndexes: event.cols ?? [event.col],
      resizeStartPosition: event.startPosition,
      resizeStartSize: event.startSize,
      resizeStartSizes: event.startSizes ?? new Map([[event.col, event.startSize]]),
      resizeCurrentSize: event.startSize,
    };
  },
);

/**
 * Start row resize - captures the row index and starting size.
 * C.2: Supports multi-select resize when rows and startSizes are provided.
 */
const startRowResize = assign(({ event }: { context: SelectionContext; event: SelectionEvent }) => {
  if (event.type !== 'START_ROW_RESIZE') return {};
  return {
    resizeType: 'row' as const,
    resizeIndex: event.row,
    resizeIndexes: event.rows ?? [event.row],
    resizeStartPosition: event.startPosition,
    resizeStartSize: event.startSize,
    resizeStartSizes: event.startSizes ?? new Map([[event.row, event.startSize]]),
    resizeCurrentSize: event.startSize,
  };
});

/**
 * Update resize during mouse move.
 * Calculates new size based on delta from start position.
 */
const updateResize = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'RESIZE_MOVE') return {};
    if (context.resizeStartPosition === null || context.resizeStartSize === null) return {};

    const delta = event.position - context.resizeStartPosition;
    // Minimum size of 10px to prevent invisible columns/rows
    const newSize = Math.max(10, context.resizeStartSize + delta);

    return {
      resizeCurrentSize: newSize,
    };
  },
);

/**
 * Clear resize context after resize ends.
 * DON'T clear - let coordinator read it first, similar to drag pattern.
 */
const finalizeResize = assign(() => ({
  // Context remains for coordinator to read
}));

/**
 * Clear resize context (called by coordinator after applying dimension change).
 */
const clearResize = assign(() => ({
  resizeType: null,
  resizeIndex: null,
  resizeIndexes: [],
  resizeStartPosition: null,
  resizeStartSize: null,
  resizeStartSizes: new Map(),
  resizeCurrentSize: null,
}));

// =============================================================================
// TABLE RESIZE ACTIONS (Tables - 10.4)
// =============================================================================

/**
 * Start table resize operation.
 */
const startTableResize = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'START_TABLE_RESIZE') return {};
    return {
      tableResizeId: event.tableId,
      tableResizeStartBounds: event.tableBounds,
      tableResizeTargetRow: event.tableBounds.endRow,
      tableResizeTargetCol: event.tableBounds.endCol,
    };
  },
);

/**
 * Update table resize target during drag.
 */
const updateTableResize = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'TABLE_RESIZE_MOVE') return {};
    return {
      tableResizeTargetRow: event.targetRow,
      tableResizeTargetCol: event.targetCol,
    };
  },
);

/**
 * Finalize table resize - DON'T clear context, coordinator reads it first.
 */
const finalizeTableResize = assign(() => ({
  // Context remains for coordinator to read
}));

/**
 * Clear table resize context (called by coordinator after applying resize).
 */
const clearTableResize = assign(() => ({
  tableResizeId: null,
  tableResizeStartBounds: null,
  tableResizeTargetRow: null,
  tableResizeTargetCol: null,
}));

// =============================================================================
// EXPORT
// =============================================================================

export const dragActions = {
  startFillHandle,
  updateFillHandle,
  clearFillHandle,
  startDragCells,
  updateDragCells,
  clearDragCells,
  startColumnResize,
  startRowResize,
  updateResize,
  finalizeResize,
  clearResize,
  startTableResize,
  updateTableResize,
  finalizeTableResize,
  clearTableResize,
} as const;
