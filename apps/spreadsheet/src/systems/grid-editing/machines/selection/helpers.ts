/**
 * Selection Machine Shared Helpers
 *
 * Shared utility functions used across selection action modules.
 * This file exists to break circular dependencies between core-actions.ts
 * and the specialized action modules (keyboard-actions, mouse-actions, etc).
 *
 * @see core-actions.ts - Main export point that combines all actions
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import type { CellCoord, SelectionDirection } from '../../../shared/types';
import { rangeFromAnchorAndCell, singleCellRange } from '../../../shared/types';
import type { SelectionContext, SelectionModes } from './types';

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

/**
 * Default mode bundle. Modes are off by default; `extend` and `additive` are
 * mutually exclusive (enforced by SET_MODE handler), `end` is independent.
 */
export const initialSelectionModes: SelectionModes = {
  end: false,
  extend: false,
  additive: false,
};

/**
 * Initial context for the selection machine.
 * Used by resetSelection action and for machine initialization.
 */
export const initialSelectionContext: SelectionContext = {
  anchor: null,
  // selection-mode unification: ranges split into committed +
  // pending. `committedRanges` is empty whenever `modes.additive` is false;
  // `pendingRange` is always the range currently being edited.
  committedRanges: [],
  pendingRange: { startRow: 0, startCol: 0, endRow: 0, endCol: 0 },
  activeCell: { row: 0, col: 0 },
  // Default direction is down-right (typical for keyboard/mouse selection)
  direction: 'down-right',
  modes: initialSelectionModes,
  formulaRangeColor: null,
  inRangeSelectionMode: false,
  fillHandleStart: null,
  fillHandleEnd: null,
  fillSourceRange: null,
  anchorCol: null,
  anchorRow: null,
  // Issue 8: Settings Panel - defaults to true, synced from WorkbookSettings
  allowDragFill: true,
  // Cell drag-drop
  dragSourceRange: null,
  dragTargetCell: null,
  dragMode: 'move',
  // Header resize
  resizeType: null,
  resizeIndex: null,
  resizeIndexes: [],
  resizeStartPosition: null,
  resizeStartSize: null,
  resizeStartSizes: new Map(),
  resizeCurrentSize: null,
  // Tables - 10.4: Table resize
  tableResizeId: null,
  tableResizeStartBounds: null,
  tableResizeTargetRow: null,
  tableResizeTargetCol: null,
  // Tab-Enter data entry pattern
  tabOriginCol: null,
  // Layout-predicate callbacks (injected by coordinator via SET_LAYOUT_CALLBACKS)
  isRowHidden: undefined,
  isColHidden: undefined,
  getMergedRegionAt: undefined,
};

// =============================================================================
// EFFECTIVE RANGES (PUBLIC GETTER)
// =============================================================================

/**
 * Compute the effective selection range list for downstream consumers.
 *
 * Effective list = `[...committedRanges, pendingRange]`. `committedRanges`
 * is normally empty in the default flow and only populated when:
 * - the user is building an Additive (Shift+F8 / Ctrl-click) selection, or
 * - a multi-range `SET_SELECTION` came from Go-To-Special, formula
 * auditing, or a similar "replace with a computed multi-range" handler.
 *
 * In both cases the consumer-visible answer is the same: the full disjoint
 * range list, in the order the user / handler declared.
 *
 * This is the single source of truth for the public `selectionSelectors.ranges`
 * selector — direct reads of the deleted `ctx.ranges` field would not typecheck.
 *
 */
export function getEffectiveRanges(
  ctx: Pick<SelectionContext, 'committedRanges' | 'pendingRange'>,
): CellRange[] {
  if (ctx.committedRanges.length > 0) {
    return [...ctx.committedRanges, ctx.pendingRange];
  }
  return [ctx.pendingRange];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Compute the selection direction from anchor to active cell.
 * This is used for Tab/Enter cycling to determine starting position.
 *
 * @param anchor - The anchor cell (where selection started)
 * @param active - The active cell (where selection ended)
 * @returns The direction from anchor to active
 *
 */
export function computeDirection(anchor: CellCoord, active: CellCoord): SelectionDirection {
  const isDown = active.row >= anchor.row;
  const isRight = active.col >= anchor.col;

  if (isDown && isRight) return 'down-right';
  if (isDown && !isRight) return 'down-left';
  if (!isDown && isRight) return 'up-right';
  return 'up-left';
}

/**
 * Single source of truth for shift-extend on the pending range. Callers choose
 * the active cell; keyboard-style extension uses the anchor default, while
 * mouse shift-click passes the clicked edge.
 *
 * `committedRanges` is intentionally not touched here — non-additive flows
 * keep it empty by invariant; additive flows leave it intact while the
 * pending range mutates.
 */
export function buildExtendUpdate(
  anchor: CellCoord,
  newEnd: CellCoord,
  activeCell: CellCoord = anchor,
): {
  pendingRange: CellRange;
  activeCell: CellCoord;
  anchor: CellCoord;
  direction: SelectionDirection;
} {
  return {
    pendingRange: rangeFromAnchorAndCell(anchor, newEnd),
    activeCell,
    anchor,
    direction: computeDirection(anchor, newEnd),
  };
}

/**
 * Move active cell and create single-cell selection.
 * For single-cell selections, direction defaults to 'down-right'.
 *
 * Non-additive: clears committed ranges (always empty by invariant) and
 * collapses pending to a single cell. Additive callers must call
 * `moveToPending` instead so committed ranges are preserved.
 */
export function moveTo(cell: CellCoord): {
  pendingRange: CellRange;
  committedRanges: CellRange[];
  activeCell: CellCoord;
  anchor: CellCoord;
  direction: SelectionDirection;
  tabOriginCol: null;
} {
  return {
    pendingRange: singleCellRange(cell),
    committedRanges: [],
    activeCell: cell,
    anchor: cell,
    // Single cell selections default to down-right
    direction: 'down-right',
    // Clear tab origin on non-Tab/Enter navigation (callers override if needed)
    tabOriginCol: null,
  };
}

/**
 * Additive-mode move: collapses pendingRange to a single cell at the new
 * active position. On the FIRST move after entering additive mode
 * (committedRanges is empty), auto-commits the current pendingRange so the
 * original selection is preserved — matching Excel's "freeze on first
 * navigate" behavior and the mouse path's startMultiSelect pattern.
 */
export function moveInAdditive(
  context: Pick<SelectionContext, 'committedRanges' | 'pendingRange'>,
  cell: CellCoord,
): {
  pendingRange: CellRange;
  committedRanges: CellRange[];
  activeCell: CellCoord;
  anchor: CellCoord;
  direction: SelectionDirection;
  tabOriginCol: null;
} {
  const base = moveToPending(cell);
  return {
    ...base,
    committedRanges:
      context.committedRanges.length === 0 ? [context.pendingRange] : context.committedRanges,
  };
}

/**
 * Additive-mode counterpart of `moveTo`: collapses `pendingRange` to a single
 * cell at the new active position, leaves `committedRanges` untouched. Used
 * when the user has Additive mode on and the keyboard/mouse intent is "move
 * the active cell" (matrix row 3 / mouse with raw-ctrl).
 */
export function moveToPending(cell: CellCoord): {
  pendingRange: CellRange;
  activeCell: CellCoord;
  anchor: CellCoord;
  direction: SelectionDirection;
  tabOriginCol: null;
} {
  return {
    pendingRange: singleCellRange(cell),
    activeCell: cell,
    anchor: cell,
    direction: 'down-right',
    tabOriginCol: null,
  };
}

/**
 * Get the bounds for select all using Excel-compatible sheet dimensions.
 *
 * Use MAX_ROWS and MAX_COLS from contracts for proper bounds.
 * - MAX_ROWS = 1,048,576 rows (Excel parity)
 * - MAX_COLS = 16,384 columns (Excel parity)
 *
 * All Row/Column Headers Highlighted on Select All
 * Sets both isFullRow and isFullColumn to ensure:
 * 1. All column headers are highlighted (hasFullRowSelection = true)
 * 2. All row headers are highlighted (hasFullColumnSelection = true)
 */
export function getSelectAllRange(): CellRange {
  return {
    startRow: 0,
    startCol: 0,
    endRow: MAX_ROWS - 1, // Zero-indexed: 0 to 1,048,575
    endCol: MAX_COLS - 1, // Zero-indexed: 0 to 16,383
    // Mark as full row AND full column selection
    // This triggers header highlighting for ALL headers
    isFullRow: true,
    isFullColumn: true,
  };
}
