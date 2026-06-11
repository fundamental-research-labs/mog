/**
 * Selection Machine - Mouse Actions
 *
 * Handles mouse-based selection interactions:
 * - Single click (setAnchorAndSelect)
 * - Shift+click (extendToCell)
 * - Ctrl+click (startMultiSelect)
 * - Mouse drag (updateDragSelection, finalizeDrag)
 *
 * All actions are pure state transitions using XState's assign() function.
 * No side effects - only state updates.
 *
 * `MOUSE_DOWN.mergedRegion` is intentionally absent; the machine resolves
 * merges through `ctx.getMergedRegionAt`, keeping merge handling on the same
 * path as keyboard navigation.
 *
 * @see core-actions.ts - Main export point
 * @see selection-machine.ts - State machine that uses these actions
 */

import { assign } from 'xstate';
import { normalizeRange, rangeFromAnchorAndCell } from '../../../shared/types';
import { buildExtendUpdate, computeDirection, moveTo } from './helpers';
import type { SelectionContext, SelectionEvent } from './types';

// =============================================================================
// MOUSE ACTIONS
// =============================================================================

/**
 * Set anchor and create single-cell selection on mouse down.
 * If clicking on a merged cell, selects the full merged region (resolved
 * through `ctx.getMergedRegionAt`).
 */
const setAnchorAndSelect = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'MOUSE_DOWN') return {};
    // machine-internal merge resolution.
    const merged = context.getMergedRegionAt?.(event.cell.row, event.cell.col) ?? null;
    if (merged) {
      const origin = { row: merged.startRow, col: merged.startCol };
      return {
        pendingRange: merged,
        committedRanges: [],
        activeCell: origin,
        anchor: origin,
        tabOriginCol: null, // Clear tab-enter data entry tracking on mouse click
      };
    }
    return moveTo(event.cell);
  },
);

/**
 * Extend selection to clicked cell (shift+click).
 * Mouse Shift+click keeps the original anchor but moves the active cell to
 * the clicked edge so follow-up edits and readbacks target the visible edge.
 */
const extendToCell = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'MOUSE_DOWN') return {};
    const anchor = context.anchor ?? context.activeCell;
    return buildExtendUpdate(anchor, event.cell, event.cell);
  },
);

/**
 * Start multi-select on ctrl+click.
 * Commits the current pending range into `committedRanges` and opens a new
 * single-cell `pendingRange` at the clicked cell, matching Excel's Ctrl-click
 * "start a new disjoint range" semantics.
 */
const startMultiSelect = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'MOUSE_DOWN') return {};
    const newRange = {
      startRow: event.cell.row,
      startCol: event.cell.col,
      endRow: event.cell.row,
      endCol: event.cell.col,
    };
    return {
      committedRanges: [...context.committedRanges, context.pendingRange],
      pendingRange: newRange,
      activeCell: event.cell,
      anchor: event.cell,
      // Multi-select starts a new range at a single cell, default direction
      direction: 'down-right' as const,
    };
  },
);

/**
 * Shift+Ctrl-click semantics: add a new disjoint range AND extend it from the
 * prior anchor. Commits the
 * current pending range into `committedRanges`, then opens a new pending
 * range that spans from the prior anchor to the clicked cell.
 */
const startMultiSelectAndExtend = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'MOUSE_DOWN') return {};
    const priorAnchor = context.anchor ?? context.activeCell;
    const newRange = rangeFromAnchorAndCell(priorAnchor, event.cell);
    return {
      committedRanges: [...context.committedRanges, context.pendingRange],
      pendingRange: newRange,
      activeCell: event.cell,
      anchor: priorAnchor,
      direction: computeDirection(priorAnchor, event.cell),
    };
  },
);

/**
 * Shift+F8 additive mode plus a raw Shift+click adds the clicked cell as a
 * disjoint single-cell range, then exits additive mode. Without this special
 * case the effective Ctrl+Shift composition extends from the previous anchor.
 */
const addSingleCellToSelectionAndExitAdditive = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'MOUSE_DOWN') return {};
    const newRange = {
      startRow: event.cell.row,
      startCol: event.cell.col,
      endRow: event.cell.row,
      endCol: event.cell.col,
    };
    return {
      committedRanges: [...context.committedRanges, context.pendingRange],
      pendingRange: newRange,
      activeCell: event.cell,
      anchor: event.cell,
      direction: 'down-right' as const,
      modes: {
        ...context.modes,
        additive: false,
      },
      tabOriginCol: null,
    };
  },
);

/**
 * Update selection during drag.
 * Bug A Fix (Issue 4): During drag, activeCell should stay at anchor (Excel behavior)
 * The selection range extends, but the "active cell" indicator remains where the drag started.
 *
 * drag mutates only `pendingRange`. When additive mode opened
 * the drag (committedRanges already non-empty), they stay intact for the
 * duration of the drag.
 */
const updateDragSelection = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'MOUSE_MOVE' || !context.anchor) return {};
    return {
      pendingRange: rangeFromAnchorAndCell(context.anchor, event.cell),
      // Update direction as drag changes
      direction: computeDirection(context.anchor, event.cell),
      // activeCell: stays at anchor (don't update it) - matches Excel behavior
    };
  },
);

/**
 * Finalize drag selection on mouse up.
 * Normalizes the pending range; committed ranges are already normalized.
 */
const finalizeDrag = assign(({ context }: { context: SelectionContext }) => {
  return {
    pendingRange: normalizeRange(context.pendingRange),
    // Keep anchor for potential shift-click extension
  };
});

// =============================================================================
// EXPORT
// =============================================================================

export const mouseActions = {
  setAnchorAndSelect,
  extendToCell,
  startMultiSelect,
  startMultiSelectAndExtend,
  addSingleCellToSelectionAndExitAdditive,
  updateDragSelection,
  finalizeDrag,
} as const;
