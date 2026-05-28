/**
 * Selection Machine - Keyboard Actions
 *
 * Handles keyboard-based navigation and selection:
 * - Arrow keys (moveActiveCell, extendSelection)
 * - Home/End keys (moveToHome, extendToHome, moveToEnd, extendToEnd)
 * - Tab/Enter navigation (moveTab, moveEnter, tabNavigate)
 * - Direct navigation (goToCell)
 * - Select all (selectAll)
 *
 * NOTE: Ctrl+Arrow (data-edge navigation) is handled by the KeyboardCoordinator
 * which dispatches MOVE_TO_EDGE_* actions to handlers/selection.ts.
 * The handlers use findDataEdge() algorithm for proper Excel-like behavior.
 *
 * NOTE: Ctrl+End and Ctrl+Shift+End are also handled by KeyboardCoordinator
 * which dispatches MOVE_TO_LAST_USED_CELL / EXTEND_TO_LAST_USED_CELL actions.
 * The fallback implementations in moveToEnd/extendToEnd use MAX_COLS as a
 * reasonable default for the End key (without Ctrl).
 *
 * Page navigation (Page Up/Down/Left/Right) is in page-actions.ts.
 *
 * All actions are pure state transitions using XState's assign() function.
 * No side effects - only state updates.
 *
 * @see core-actions.ts - Main export point
 * @see page-actions.ts - Page navigation actions
 * @see selection-machine.ts - State machine that uses these actions
 * @see handlers/selection.ts - Data-edge navigation handlers (MOVE_TO_EDGE_*)
 */

import { MAX_COLS, MAX_ROWS } from '@mog-sdk/contracts/core';
import { assign } from 'xstate';
import {
  clampCell,
  getMovingEdge,
  moveCellSkipHidden,
  normalizeRange,
} from '../../../shared/types';
import { getNextCellInSelection, hasCyclableStops } from './cycle';
import {
  buildExtendUpdate,
  getEffectiveRanges,
  getSelectAllRange,
  moveInAdditive,
  moveTo,
} from './helpers';
import { escapeMergeOnMove, resolveActiveCellArrowMove } from './merge-escape';
import { pageActions } from './page-actions';
import type { SelectionContext, SelectionEvent } from './types';

// =============================================================================
// ARROW KEY ACTIONS
// =============================================================================

/**
 * Move active cell in direction.
 * L0.5: Use moveCellSkipHidden to skip hidden rows/cols during navigation
 * Excel parity - Arrow collapse to directional edge of selection
 *
 * When `modes.additive` is on, the active cell moves and
 * `pendingRange` collapses to a single cell at the new position;
 * `committedRanges` are untouched. Non-additive flow is unchanged.
 */
const moveActiveCell = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_ARROW') return {};

    const lastRange = context.pendingRange;
    const isMultiCellSelection =
      lastRange.startRow !== lastRange.endRow || lastRange.startCol !== lastRange.endCol;

    // If there's a multi-cell selection, collapse to the directional edge
    // This matches Excel behavior where arrow keys collapse the selection to the edge
    // in the direction pressed, using the active cell's row/col for the other axis.
    //
    // skip the directional-collapse heuristic in additive mode —
    // Excel's additive arrow always moves the active cell to a single cell,
    // regardless of pending range size.
    if (isMultiCellSelection && !context.modes.additive) {
      let newCell: { row: number; col: number };
      const normalizedRange = normalizeRange(lastRange);

      switch (event.direction) {
        case 'left':
          // Collapse to leftmost column, same row as activeCell
          newCell = { row: context.activeCell.row, col: normalizedRange.startCol };
          break;
        case 'right':
          // Collapse to rightmost column, same row as activeCell
          newCell = { row: context.activeCell.row, col: normalizedRange.endCol };
          break;
        case 'up':
          // Collapse to topmost row, same column as activeCell
          newCell = { row: normalizedRange.startRow, col: context.activeCell.col };
          break;
        case 'down':
          // Collapse to bottommost row, same column as activeCell
          newCell = { row: normalizedRange.endRow, col: context.activeCell.col };
          break;
      }

      const escapedCell = escapeMergeOnMove(newCell, event.direction, context.getMergedRegionAt);
      return moveTo(escapedCell);
    }

    // Single cell selection: normal arrow key navigation
    const stepped = moveCellSkipHidden(
      context.activeCell,
      event.direction,
      1,
      context.isRowHidden,
      context.isColHidden,
    );
    // Plain active-cell arrows enter a merge at its origin, then exit past the
    // merge when the next arrow moves through that same region.
    const newCell = resolveActiveCellArrowMove(
      context.activeCell,
      stepped,
      event.direction,
      context.getMergedRegionAt,
    );
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

/**
 * Extend selection in direction (shift+arrow).
 * activeCell stays at the anchor (Excel parity); the range geometry tracks
 * the moving edge via getMovingEdge(range, anchor).
 *
 * writes only to `pendingRange`. `committedRanges` is untouched
 * (empty in non-additive flows by invariant; preserved verbatim in additive).
 */
const extendSelection = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_ARROW') return {};
    // Use existing anchor, or establish it from activeCell on first extend
    const anchor = context.anchor ?? context.activeCell;
    // Get the "moving edge" - the corner opposite the anchor that should move
    // For first extend (single cell), the moving edge is the activeCell itself
    const movingEdge = getMovingEdge(context.pendingRange, anchor);
    // Move the moving edge in the arrow direction
    const stepped = moveCellSkipHidden(
      movingEdge,
      event.direction,
      1,
      context.isRowHidden,
      context.isColHidden,
    );
    // extend past a merge boundary so the moving edge doesn't
    // sit on the merge interior — matches the same machine-internal escape
    // used by `moveActiveCell`.
    const newEnd = escapeMergeOnMove(stepped, event.direction, context.getMergedRegionAt);
    return buildExtendUpdate(anchor, newEnd);
  },
);

// =============================================================================
// CTRL+ARROW KEY ACTIONS (fallback for unit tests)
// NOTE: Proper Ctrl+Arrow (data-edge navigation) is handled by:
// 1. KeyboardCoordinator (intercepts Ctrl+Arrow, dispatches MOVE_TO_EDGE_*)
// 2. Action handlers in handlers/selection.ts (MOVE_TO_EDGE_*, EXTEND_TO_EDGE_*)
// 3. findDataEdge() algorithm in navigation-utils.ts
//
// These fallback actions use a simple jumpAmount approach for:
// - Unit tests that send KEY_CTRL_ARROW directly to the selection machine
// - Cases where KeyboardCoordinator doesn't intercept (rare)
//
// The jumpAmount=10 is a placeholder; real Excel behavior uses data edges.
// =============================================================================

/**
 * Jump amount for Ctrl+Arrow fallback navigation.
 * Real data-edge navigation is handled by KeyboardCoordinator.
 */
const JUMP_AMOUNT = 10;

/**
 * Jump to edge in direction (Ctrl+Arrow).
 * Fallback implementation for unit tests - jumps by JUMP_AMOUNT or to boundary.
 */
const jumpToEdge = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_CTRL_ARROW') return {};
    const stepped = moveCellSkipHidden(
      context.activeCell,
      event.direction,
      JUMP_AMOUNT,
      context.isRowHidden,
      context.isColHidden,
    );
    const newCell = escapeMergeOnMove(stepped, event.direction, context.getMergedRegionAt);
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

/**
 * Extend selection to edge in direction (Ctrl+Shift+Arrow).
 * Fallback implementation for unit tests - extends by JUMP_AMOUNT or to boundary.
 * activeCell stays at the anchor (Excel parity); the range geometry tracks
 * the moving edge via getMovingEdge(range, anchor).
 */
const jumpToEdgeExtend = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_CTRL_ARROW') return {};
    const anchor = context.anchor ?? context.activeCell;
    // Use getMovingEdge to find the corner opposite the anchor
    const movingEdge = getMovingEdge(context.pendingRange, anchor);
    const stepped = moveCellSkipHidden(
      movingEdge,
      event.direction,
      JUMP_AMOUNT,
      context.isRowHidden,
      context.isColHidden,
    );
    const newEnd = escapeMergeOnMove(stepped, event.direction, context.getMergedRegionAt);
    return buildExtendUpdate(anchor, newEnd);
  },
);

// =============================================================================
// END-MODE ARROW FALLBACKS
//
// In production, the keyboard coordinator's End-mode handling is being
// migrated (the related wiring E) so KEY_ARROW carries End-mode semantics into
// the machine directly. The "real" data-edge navigation is async (calls
// Rust) and lives in handlers/selection/data-edge.ts; these in-machine
// fallbacks reuse the same JUMP_AMOUNT placeholder as jumpToEdge above so
// unit tests can drive KEY_ARROW + modes.end without going through the
// coordinator. When the production path routes End-mode + arrow to
// MOVE_TO_EDGE_* / EXTEND_TO_EDGE_* (coordinator), these fallbacks do not
// fire because the coordinator intercepts before the machine event.
// =============================================================================

const endModeMoveToEdge = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_ARROW') return {};
    const stepped = moveCellSkipHidden(
      context.activeCell,
      event.direction,
      JUMP_AMOUNT,
      context.isRowHidden,
      context.isColHidden,
    );
    const newCell = escapeMergeOnMove(stepped, event.direction, context.getMergedRegionAt);
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

const endModeExtendToEdge = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_ARROW') return {};
    const anchor = context.anchor ?? context.activeCell;
    const movingEdge = getMovingEdge(context.pendingRange, anchor);
    const stepped = moveCellSkipHidden(
      movingEdge,
      event.direction,
      JUMP_AMOUNT,
      context.isRowHidden,
      context.isColHidden,
    );
    const newEnd = escapeMergeOnMove(stepped, event.direction, context.getMergedRegionAt);
    return buildExtendUpdate(anchor, newEnd);
  },
);

// =============================================================================
// HOME/END KEY ACTIONS
// =============================================================================

/**
 * Move to home (Home or Ctrl+Home).
 */
const moveToHome = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_HOME') return {};
    const target = event.ctrlKey
      ? { row: 0, col: 0 } // Ctrl+Home = A1
      : { row: context.activeCell.row, col: 0 }; // Home = column A, same row
    // if the home target lands inside a merged region, treat
    // the approach as a leftward move (Home jumps left along the row;
    // Ctrl+Home jumps to the upper-left corner). The off-sheet fallback in
    // `escapeMergeOnMove` resolves to the merge origin when there's no
    // post-merge cell available.
    const newCell = escapeMergeOnMove(target, 'left', context.getMergedRegionAt);
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

/**
 * Shift+Home or Ctrl+Shift+Home: Extend selection to beginning.
 * Shift+Home extends to column 0 on the moving edge's row;
 * Ctrl+Shift+Home extends to A1. activeCell stays at the anchor (Excel parity);
 * the range geometry tracks the moving edge via getMovingEdge(range, anchor).
 */
const extendToHome = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_HOME') return {};
    const anchor = context.anchor ?? context.activeCell;
    const movingEdge = getMovingEdge(context.pendingRange, anchor);
    const target = event.ctrlKey
      ? { row: 0, col: 0 } // Ctrl+Shift+Home = extend to A1
      : { row: movingEdge.row, col: 0 }; // Shift+Home = extend to column A on moving edge's row
    const newEnd = escapeMergeOnMove(target, 'left', context.getMergedRegionAt);
    return buildExtendUpdate(anchor, newEnd);
  },
);

/**
 * Move to end (End or Ctrl+End).
 *
 * NOTE: Ctrl+End is properly handled by KeyboardCoordinator which dispatches
 * MOVE_TO_LAST_USED_CELL action. This fallback uses MAX constants for safety.
 * End key (without Ctrl) goes to last column of current row.
 */
const moveToEnd = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_END') return {};
    // Ctrl+End: Fallback to sheet bounds (actual last used cell handled by action handler)
    // End: Go to last column of current row
    const target = event.ctrlKey
      ? { row: MAX_ROWS - 1, col: MAX_COLS - 1 }
      : { row: context.activeCell.row, col: MAX_COLS - 1 };
    // End approaches from the left. If the target lands in a
    // merge that already abuts the right edge, the off-sheet fallback in
    // `escapeMergeOnMove` resolves to the merge origin.
    const newCell = escapeMergeOnMove(target, 'right', context.getMergedRegionAt);
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

/**
 * Shift+End or Ctrl+Shift+End: Extend selection to end.
 *
 * NOTE: Ctrl+Shift+End is properly handled by KeyboardCoordinator which dispatches
 * EXTEND_TO_LAST_USED_CELL action. This fallback uses MAX constants for safety.
 * Shift+End (without Ctrl) extends to last column of current row.
 * activeCell stays at the anchor (Excel parity); the range geometry tracks
 * the moving edge via getMovingEdge(range, anchor).
 */
const extendToEnd = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_END') return {};
    const anchor = context.anchor ?? context.activeCell;
    const movingEdge = getMovingEdge(context.pendingRange, anchor);
    // Ctrl+Shift+End: Fallback to sheet bounds (actual last used cell handled by action handler)
    // Shift+End: Extend to last column on the moving edge's row
    const target = event.ctrlKey
      ? { row: MAX_ROWS - 1, col: MAX_COLS - 1 }
      : { row: movingEdge.row, col: MAX_COLS - 1 };
    const newEnd = escapeMergeOnMove(target, 'right', context.getMergedRegionAt);
    return buildExtendUpdate(anchor, newEnd);
  },
);

// =============================================================================
// DIRECT NAVIGATION (Issue 8 Wave 2B - Ctrl+G / Name Box)
// =============================================================================

/**
 * Go To: Navigate directly to a specified cell.
 * Used by Ctrl+G dialog and Name Box navigation.
 */
const goToCell = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'GO_TO') return {};
    const target = clampCell(event.cell);
    return context.modes.additive ? moveInAdditive(context, target) : moveTo(target);
  },
);

/**
 * Tab navigation - move horizontally (Tables)
 * L0.5: Skip hidden columns
 *
 * Tab-Enter data entry pattern: Records the column where Tab navigation
 * started (tabOriginCol). When Enter is pressed later, the cursor returns
 * to this column and moves down one row (Excel behavior).
 *
 * Selection-aware Tab wrap (tab):
 * - When the effective range list (`committedRanges + pendingRange`) has at
 * least two cyclable stops, Tab cycles through them in row-major order via
 * `getNextCellInSelection` from `./cycle.ts`. The cycle is hidden-aware
 * (skips hidden rows/cols) and merge-aware (treats each merge as one stop
 * at its origin). Multi-range selections cycle by walking ranges in order.
 * - Otherwise, Tab moves freely one cell in the row direction (right/left).
 *
 * This logic previously lived in `actions/handlers/selection/tab-enter.ts`
 * (`getNextCellInSelection` + `buildCyclingOptions`, ~250 LOC). Moving it here
 * lets the machine consume `ctx.getMergedRegionAt` / `ctx.isRowHidden` /
 * `ctx.isColHidden` instead of every handler rebuilding a viewport-merges
 * lookup, and centralizes merge-escape with the rest of the navigation paths.
 */
const moveTab = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_TAB') return {};

    const ranges = getEffectiveRanges(context);
    const cycleOptions = {
      isRowHidden: context.isRowHidden,
      isColHidden: context.isColHidden,
      getMergedRegionAt: context.getMergedRegionAt,
    };

    // Selection-aware Tab wrap: cycle within the effective ranges when there
    // are at least two cyclable stops. Single-cell or merge-collapsed-to-one
    // selections fall through to the free-movement path.
    if (hasCyclableStops(ranges, cycleOptions)) {
      const nextCell = getNextCellInSelection(
        context.activeCell,
        ranges,
        event.shiftKey ? 'backward' : 'forward',
        'tab',
        cycleOptions,
      );
      if (nextCell) {
        // Preserve range geometry — only the active cell moves.
        return {
          activeCell: nextCell,
          anchor: context.anchor,
          tabOriginCol: context.tabOriginCol ?? context.activeCell.col,
        };
      }
    }

    // Default (no cyclable stops, or cycle returned null): move freely.
    const direction = event.shiftKey ? 'left' : 'right';
    const stepped = moveCellSkipHidden(
      context.activeCell,
      direction,
      1,
      context.isRowHidden,
      context.isColHidden,
    );
    const newCell = escapeMergeOnMove(stepped, direction, context.getMergedRegionAt);
    const base = context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
    return {
      ...base,
      tabOriginCol: context.tabOriginCol ?? context.activeCell.col,
    };
  },
);

/**
 * Enter navigation - move vertically (Tables)
 * L0.5: Skip hidden rows
 *
 * Tab-Enter data entry pattern: If tabOriginCol is set (user was Tab-navigating),
 * Enter returns to that column and moves down one row. Shift+Enter returns to
 * that column and moves up one row. The tabOriginCol is preserved so the user
 * can continue the Tab→Enter data entry cycle.
 *
 * When the effective range list has at least two
 * cyclable stops AND the user is *not* mid-Tab-Enter cycle (tabOriginCol is
 * null), Enter cycles in column-major order. Otherwise the data-entry pattern
 * (return-to-origin) takes precedence, matching the previous behavior.
 */
const moveEnter = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'KEY_ENTER') return {};

    // Tab-Enter data entry pattern: return to tab origin column. This branch
    // wins over selection cycling because tabOriginCol is only set when the
    // user was actively tabbing.
    if (context.tabOriginCol !== null) {
      const rowDelta = event.shiftKey ? -1 : 1;
      const targetRow = clampCell({
        row: context.activeCell.row + rowDelta,
        col: context.tabOriginCol,
      }).row;
      const newCell = { row: targetRow, col: context.tabOriginCol };
      const base = context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
      return {
        ...base,
        tabOriginCol: context.tabOriginCol,
      };
    }

    const ranges = getEffectiveRanges(context);
    const cycleOptions = {
      isRowHidden: context.isRowHidden,
      isColHidden: context.isColHidden,
      getMergedRegionAt: context.getMergedRegionAt,
    };

    // Selection-aware Enter wrap: column-major cycle when ranges support it.
    if (hasCyclableStops(ranges, cycleOptions)) {
      const nextCell = getNextCellInSelection(
        context.activeCell,
        ranges,
        event.shiftKey ? 'backward' : 'forward',
        'enter',
        cycleOptions,
      );
      if (nextCell) {
        return {
          activeCell: nextCell,
          anchor: context.anchor,
        };
      }
    }

    // Default: Enter moves down, Shift+Enter moves up
    const direction = event.shiftKey ? 'up' : 'down';
    const stepped = moveCellSkipHidden(
      context.activeCell,
      direction,
      1,
      context.isRowHidden,
      context.isColHidden,
    );
    const newCell = escapeMergeOnMove(stepped, direction, context.getMergedRegionAt);
    return context.modes.additive ? moveInAdditive(context, newCell) : moveTo(newCell);
  },
);

/**
 * Table-aware navigation - coordinator specifies exact target (Tables)
 */
const tabNavigate = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'TAB_NAVIGATE') return {};
    return context.modes.additive
      ? moveInAdditive(context, event.targetCell)
      : moveTo(event.targetCell);
  },
);

/**
 * Select all cells in the sheet.
 *
 * NOTE: Progressive Ctrl+A (current region -> all -> objects) is handled by
 * the action handler layer (SELECT_CURRENT_REGION in handlers/selection/select-all.ts),
 * not by this machine action. This machine action is the low-level "select entire sheet"
 * operation called by the coordinator when it determines the full sheet should be selected.
 * The handler uses Cells.getCurrentRegion() from the kernel and UIStore's CtrlAStateSlice
 * for the multi-press timing logic.
 */
const selectAll = assign(() => {
  const range = getSelectAllRange();
  return {
    pendingRange: range,
    committedRanges: [],
    activeCell: { row: range.startRow, col: range.startCol },
    anchor: { row: range.startRow, col: range.startCol },
    tabOriginCol: null, // Clear tab-enter tracking
  };
});

// =============================================================================
// EXPORT
// =============================================================================

export const keyboardActions = {
  moveActiveCell,
  extendSelection,
  // End-mode fallbacks: KEY_ARROW under modes.end.
  endModeMoveToEdge,
  endModeExtendToEdge,
  // Fallback Ctrl+Arrow handlers (for unit tests; real flow uses KeyboardCoordinator)
  jumpToEdge,
  jumpToEdgeExtend,
  moveToHome,
  extendToHome,
  moveToEnd,
  extendToEnd,
  // Re-export page actions
  ...pageActions,
  goToCell,
  moveTab,
  moveEnter,
  tabNavigate,
  selectAll,
} as const;
