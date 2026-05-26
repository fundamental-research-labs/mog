/**
 * Selection Machine - Header Actions
 *
 * Handles column and row header selection:
 * - Single column/row selection (selectSingleColumn, selectSingleRow)
 * - Multi-select with Ctrl (addColumnToSelection, addRowToSelection)
 * - Extend with Shift (extendToColumn, extendToRow)
 * - Drag selection (extendColumnSelection, extendRowSelection)
 * - Finalize header selection (finalizeHeaderSelection)
 *
 * All actions are pure state transitions using XState's assign() function.
 * No side effects - only state updates.
 *
 * rewritten to operate on the committed/pending range split
 * instead of splicing a flat `ranges: CellRange[]`. Behaviour is unchanged
 * from the user's perspective — what was `[...ranges, range]` is now
 * `committedRanges = [...committed, pendingRange]; pendingRange = range`,
 * and what was `[...ranges.slice(0, -1), range]` is now `pendingRange = range`
 * with `committedRanges` left alone.
 *
 * @see core-actions.ts - Main export point
 * @see selection-machine.ts - State machine that uses these actions
 */

import { assign } from 'xstate';
import {
  createFullColumnRange,
  createFullColumnRangeSpan,
  createFullRowRange,
  createFullRowRangeSpan,
} from '../../../shared/types';
import type { SelectionContext, SelectionEvent } from './types';

// =============================================================================
// COLUMN/ROW HEADER SELECTION ACTIONS
// =============================================================================

/**
 * Select a single column (clicking column header without modifiers).
 */
const selectSingleColumn = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'SELECT_COLUMN') return {};
    const range = createFullColumnRange(event.col);
    return {
      pendingRange: range,
      committedRanges: [],
      activeCell: { row: 0, col: event.col },
      anchorCol: event.col,
      anchorRow: null,
      anchor: null,
      tabOriginCol: null,
    };
  },
);

/**
 * Add a column to existing selection (Ctrl+click column header).
 *
 * Commits the current pending range and opens the new column span as the new
 * pending range. Same observable result as the previous
 * `[...context.ranges, range]` shape.
 */
const addColumnToSelection = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'SELECT_COLUMN') return {};
    const range = createFullColumnRange(event.col);
    return {
      committedRanges: [...context.committedRanges, context.pendingRange],
      pendingRange: range,
      activeCell: { row: 0, col: event.col },
      anchorCol: event.col,
      anchorRow: null,
    };
  },
);

/**
 * Extend selection to column (Shift+click column header).
 */
const extendToColumn = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'SELECT_COLUMN') return {};
    const fromCol = context.anchorCol ?? context.activeCell.col;
    const range = createFullColumnRangeSpan(fromCol, event.col);
    return {
      pendingRange: range,
      committedRanges: [],
      activeCell: { row: 0, col: event.col },
    };
  },
);

/**
 * Update column selection during drag (mousemove while selecting columns).
 *
 * replaces the previous
 * `ranges: [...context.ranges.slice(0, -1), range]` splice — the
 * "replace last" pattern is now "mutate pendingRange in place; committed
 * stays put."
 */
const extendColumnSelection = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'COLUMN_MOUSE_MOVE') return {};
    if (context.anchorCol === null) return {};
    const range = createFullColumnRangeSpan(context.anchorCol, event.col);
    return {
      pendingRange: range,
      activeCell: { row: 0, col: event.col },
    };
  },
);

/**
 * Select a single row (clicking row header without modifiers).
 */
const selectSingleRow = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'SELECT_ROW') return {};
    const range = createFullRowRange(event.row);
    return {
      pendingRange: range,
      committedRanges: [],
      activeCell: { row: event.row, col: 0 },
      anchorRow: event.row,
      anchorCol: null,
      anchor: null,
      tabOriginCol: null,
    };
  },
);

/**
 * Add a row to existing selection (Ctrl+click row header).
 *
 * same splice generalization as `addColumnToSelection` —
 * commits the current pending range and opens the row span as the new
 * pending range.
 */
const addRowToSelection = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'SELECT_ROW') return {};
    const range = createFullRowRange(event.row);
    return {
      committedRanges: [...context.committedRanges, context.pendingRange],
      pendingRange: range,
      activeCell: { row: event.row, col: 0 },
      anchorRow: event.row,
      anchorCol: null,
    };
  },
);

/**
 * Extend selection to row (Shift+click row header).
 */
const extendToRow = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'SELECT_ROW') return {};
    const fromRow = context.anchorRow ?? context.activeCell.row;
    const range = createFullRowRangeSpan(fromRow, event.row);
    return {
      pendingRange: range,
      committedRanges: [],
      activeCell: { row: event.row, col: 0 },
    };
  },
);

/**
 * Update row selection during drag (mousemove while selecting rows).
 *
 * same "replace last" generalization — mutate pending in place,
 * leave committed alone.
 */
const extendRowSelection = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'ROW_MOUSE_MOVE') return {};
    if (context.anchorRow === null) return {};
    const range = createFullRowRangeSpan(context.anchorRow, event.row);
    return {
      pendingRange: range,
      activeCell: { row: event.row, col: 0 },
    };
  },
);

/**
 * Clear column/row anchors when finishing selection.
 */
const finalizeHeaderSelection = assign(() => ({
  // Keep anchorCol/anchorRow for shift+click extension
}));

// =============================================================================
// EXPORT
// =============================================================================

export const headerActions = {
  selectSingleColumn,
  addColumnToSelection,
  extendToColumn,
  extendColumnSelection,
  selectSingleRow,
  addRowToSelection,
  extendToRow,
  extendRowSelection,
  finalizeHeaderSelection,
} as const;
