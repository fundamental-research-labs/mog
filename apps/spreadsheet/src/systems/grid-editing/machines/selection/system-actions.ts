/**
 * Selection Machine - System Actions
 *
 * Handles system-level state management:
 * - Direct selection setting (setSelection — source-aware)
 * - Edit-focus activation without replacing navigation context (beginCellEdit)
 * - Selection reset (resetSelection)
 * - Settings updates (updateSettings)
 * - Layout-predicate callbacks (setLayoutCallbacks)
 * - Structure change handling (adjustForStructureChange)
 * - Selection-mode lifecycle (setMode, commitPending, exitAllModes,
 * deactivateEndMode)
 *
 * All actions are pure state transitions using XState's assign() function.
 * No side effects - only state updates.
 *
 * @see core-actions.ts - Main export point
 * @see selection-machine.ts - State machine that uses these actions
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import { assign } from 'xstate';

import type { CellCoord } from '../../../shared/types';
import { getMovingEdge, singleCellRange } from '../../../shared/types';
import {
  adjustPosition,
  adjustRange,
  getDeletedCellFallback,
  singleCellRange as singleCellRangeFromAdjusters,
} from '../../../shared/utils';
import { initialSelectionContext, initialSelectionModes } from './helpers';
import type { SelectionContext, SelectionEvent, SelectionModes } from './types';

// =============================================================================
// SYSTEM ACTIONS
// =============================================================================

function isSingleCellRange(range: CellRange): boolean {
  return (
    range.isFullColumn !== true &&
    range.isFullRow !== true &&
    range.startRow === range.endRow &&
    range.startCol === range.endCol
  );
}

function resolveSingleCellMergeSelection(
  context: SelectionContext,
  ranges: CellRange[],
  activeCell: CellCoord,
): { ranges: CellRange[]; activeCell: CellCoord } {
  if (ranges.length !== 1) return { ranges, activeCell };

  const target = ranges[0]!;
  if (
    !isSingleCellRange(target) ||
    target.startRow !== activeCell.row ||
    target.startCol !== activeCell.col
  ) {
    return { ranges, activeCell };
  }

  const merged = context.getMergedRegionAt?.(activeCell.row, activeCell.col) ?? null;
  if (!merged) return { ranges, activeCell };

  return {
    ranges: [merged],
    activeCell: { row: merged.startRow, col: merged.startCol },
  };
}

/**
 * Direct set selection. Source-aware: only `event.source === 'user'`
 * preserves modes and `committedRanges`. All other sources
 * (`'remote'` / `'agent'` / `'restore'`, including the sheet-switch restore
 * path at `subscriptions/sheet-switch-coordination.ts`) clear modes and
 * drop `committedRanges` before applying the new range, preventing stale
 * selection-mode indicators after sheet switches.
 *
 * The provided `ranges` array is interpreted as effective ranges:
 * - For `source === 'user'` with additive mode active, the trailing range
 * becomes `pendingRange`, the rest become `committedRanges`.
 * - Otherwise the full list collapses into one pendingRange (the trailing
 * range), and `committedRanges` is empty.
 *
 * Extended to support full state restoration including anchor fields.
 */
const setSelection = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'SET_SELECTION') return {};

    const source = event.source ?? 'user';
    const isUser = source === 'user';
    let ranges = event.ranges.length > 0 ? event.ranges : [singleCellRange(event.activeCell)];
    let activeCell = event.activeCell;
    ({ ranges, activeCell } = resolveSingleCellMergeSelection(context, ranges, activeCell));
    const trailing = ranges[ranges.length - 1]!;
    const leading = ranges.slice(0, -1);

    // Determine modes + committed/pending split.
    //
    // - Non-user source ('remote' / 'agent' / 'restore'): clear all modes,
    // drop committed ranges, and keep only the trailing range pending. This
    // prevents sheet-switch restore from resurrecting stale additive ranges
    // after the mode flags have been cleared.
    // - User source: preserve current modes; the input ranges always populate
    // committed (leading) + pending (trailing). Multi-range setSelection
    // from Go-To-Special / formula auditing therefore produces a real
    // multi-range selection without forcibly turning Additive mode on
    // (which would surprise the user with an "ADD" status indicator on a
    // programmatic action).
    const nextModes: SelectionModes = isUser ? context.modes : initialSelectionModes;
    const nextCommitted: CellRange[] = isUser ? leading : [];
    const nextPending: CellRange = trailing;

    return {
      committedRanges: nextCommitted,
      pendingRange: nextPending,
      modes: nextModes,
      activeCell,
      // Use provided anchor or fallback to activeCell for backwards compatibility
      anchor: event.anchor !== undefined ? event.anchor : activeCell,
      // Support column/row selection restoration
      anchorCol: event.anchorCol ?? null,
      anchorRow: event.anchorRow ?? null,
      // Clear tab-enter tracking when selection is set programmatically
      tabOriginCol: null,
    };
  },
);

/**
 * Begin editing a cell without replacing the user's navigation context.
 *
 * `SET_SELECTION` is the contract for true selection replacement and therefore
 * clears Tab/Enter data-entry state. Edit start is different: the editor needs
 * the active/focused cell to match the cell being edited, while Tab/Enter
 * commit navigation must still see the pre-edit effective ranges and
 * tabOriginCol.
 */
const beginCellEdit = assign(({ event }: { context: SelectionContext; event: SelectionEvent }) => {
  if (event.type !== 'BEGIN_CELL_EDIT') return {};

  return {
    activeCell: event.cell,
  };
});

/**
 * Reset selection to initial state.
 */
const resetSelection = assign(() => initialSelectionContext);

/**
 * Update settings from coordinator (synced from WorkbookSettings).
 * Issue 8: Settings Panel
 */
const updateSettings = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'UPDATE_SETTINGS') return {};
    return {
      allowDragFill: event.allowDragFill ?? context.allowDragFill,
    };
  },
);

/**
 * Set layout-predicate callbacks from coordinator. Renamed
 * from `setVisibilityCallbacks` and extended to carry `getMergedRegionAt`
 * so navigation events resolve merges through one machine-internal path. These
 * callbacks are used by navigation actions to skip hidden rows/cols and to
 * escape merged regions.
 */
const setLayoutCallbacks = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'SET_LAYOUT_CALLBACKS') return {};
    return {
      isRowHidden: event.isRowHidden,
      isColHidden: event.isColHidden,
      getMergedRegionAt: event.getMergedRegionAt,
    };
  },
);

/**
 * Adjust selection positions after a structure change (row/column insert/delete).
 * Issue 1: Structure Change Coordination
 *
 * This action:
 * 1. Adjusts activeCell - if deleted, moves to fallback position
 * 2. Adjusts pending and committed ranges - removes deleted ranges, adjusts others
 * 3. Adjusts anchor - if deleted, resets to activeCell
 *
 * @see ISSUE-1-STRUCTURE-CHANGE-COORDINATION.md
 */
const adjustForStructureChange = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'STRUCTURE_CHANGE') return {};

    const { change } = event;

    // 1. Adjust active cell
    let newActiveCell = adjustPosition(context.activeCell, change);
    if (newActiveCell === null) {
      // Active cell was deleted - move to fallback position, preserving the non-affected coordinate
      newActiveCell = getDeletedCellFallback(change, context.activeCell);
    }

    // 2a. Adjust pending range
    let newPending = adjustRange(context.pendingRange, change);
    if (newPending === null) {
      newPending = singleCellRangeFromAdjusters(newActiveCell);
    }

    // 2b. Adjust committed ranges (preserve order, drop deleted entries)
    const newCommitted = context.committedRanges
      .map((r) => adjustRange(r, change))
      .filter((r): r is CellRange => r !== null);

    // 3. Adjust anchor
    let newAnchor: CellCoord | null = null;
    if (context.anchor) {
      newAnchor = adjustPosition(context.anchor, change);
      if (newAnchor === null) {
        // Anchor was deleted - reset to active cell
        newAnchor = newActiveCell;
      }
    }

    // 4. Adjust column/row anchors for header selection
    let newAnchorCol = context.anchorCol;
    let newAnchorRow = context.anchorRow;

    if (newAnchorCol !== null) {
      if (change.type === 'columns:inserted' && newAnchorCol >= change.startCol) {
        newAnchorCol = newAnchorCol + change.count;
      } else if (change.type === 'columns:deleted') {
        const deleteEnd = change.startCol + change.count - 1;
        if (newAnchorCol >= change.startCol && newAnchorCol <= deleteEnd) {
          // Anchor column was deleted - clear it
          newAnchorCol = null;
        } else if (newAnchorCol > deleteEnd) {
          newAnchorCol = newAnchorCol - change.count;
        }
      }
    }

    if (newAnchorRow !== null) {
      if (change.type === 'rows:inserted' && newAnchorRow >= change.startRow) {
        newAnchorRow = newAnchorRow + change.count;
      } else if (change.type === 'rows:deleted') {
        const deleteEnd = change.startRow + change.count - 1;
        if (newAnchorRow >= change.startRow && newAnchorRow <= deleteEnd) {
          // Anchor row was deleted - clear it
          newAnchorRow = null;
        } else if (newAnchorRow > deleteEnd) {
          newAnchorRow = newAnchorRow - change.count;
        }
      }
    }

    return {
      activeCell: newActiveCell,
      pendingRange: newPending,
      committedRanges: newCommitted,
      anchor: newAnchor,
      anchorCol: newAnchorCol,
      anchorRow: newAnchorRow,
    };
  },
);

// =============================================================================
// SELECTION-MODE LIFECYCLE
// =============================================================================

/**
 * Set a single mode flag. Enforces invariants:
 *
 * - `extend` and `additive` are mutually exclusive — turning one on forces
 * the other off.
 * - Toggling `additive: false → true` while a multi-range selection exists
 * (a previous flat range list with length ≥ 2, expressed today as
 * non-empty `committedRanges`) keeps the existing committed list intact;
 * the pending range stays as-is.
 * - Toggling `additive: true → false` commits `pendingRange` into a flat
 * single range at the active cell (Excel's flatten-on-Esc behavior).
 * `committedRanges` is dropped (additive ⇒ committed empty by invariant).
 */
const setMode = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'SET_MODE') return {};

    let { end, extend, additive } = context.modes;

    if (event.mode === 'end') {
      end = event.value;
    } else if (event.mode === 'extend') {
      extend = event.value;
      // Mutual exclusion: turning extend on forces additive off.
      if (extend) additive = false;
    } else {
      // additive
      additive = event.value;
      // Mutual exclusion: turning additive on forces extend off.
      if (additive) extend = false;
    }

    const nextModes: SelectionModes = { end, extend, additive };

    // additive: true → false transition: flatten committed + pending into a
    // single range at the active cell.
    if (event.mode === 'additive' && !event.value && context.modes.additive) {
      return {
        modes: nextModes,
        committedRanges: [],
        pendingRange: singleCellRange(context.activeCell),
        anchor: context.activeCell,
      };
    }

    // additive: false → true while we still hold non-empty committedRanges
    // (only possible if a prior assign already populated them — e.g.,
    // Ctrl+click multi-select in a single mouse gesture). Preserve them as the
    // new committed list. Pending stays.
    // No work needed — the assign below carries them through verbatim.

    return { modes: nextModes };
  },
);

/**
 * Commit the current `pendingRange` into `committedRanges` and open a new
 * single-cell `pendingRange` at the active cell. Triggered by the second
 * Shift+F8 (Excel commit-and-continue), click outside the pending range
 * during ADD mode, etc. Leaves modes untouched.
 */
const commitPending = assign(({ context }: { context: SelectionContext }) => {
  return {
    committedRanges: [...context.committedRanges, context.pendingRange],
    pendingRange: singleCellRange(context.activeCell),
    anchor: context.activeCell,
  };
});

/**
 * Clear all three mode flags. Only flatten the selection when one of those
 * modes was actually active; otherwise preserve the current pendingRange so a
 * normal Shift+Arrow extension survives across the edit-start boundary.
 *
 * Excel parity: starting an edit (typing `=`, F2, etc.) on a multi-cell
 * Shift-extended selection must keep that range visible — it's what
 * Ctrl+Shift+Enter relies on to lay down a CSE array formula across the
 * whole rectangle. Collapsing unconditionally made `setArrayFormula` fall back
 * to the active anchor only.
 *
 * When exiting F8 extend mode, the active cell still moves to the moving
 * edge so the arrow-extended position sticks (Excel parity for sticky
 * extend mode).
 */
const exitAllModes = assign(({ context }: { context: SelectionContext }) => {
  const anyModeActive = context.modes.end || context.modes.extend || context.modes.additive;
  if (!anyModeActive) {
    return { modes: initialSelectionModes, committedRanges: [] };
  }
  const newActiveCell = context.modes.extend
    ? getMovingEdge(context.pendingRange, context.anchor ?? context.activeCell)
    : context.activeCell;
  if (context.modes.extend) {
    return {
      modes: initialSelectionModes,
      committedRanges: [],
      pendingRange: context.pendingRange,
      activeCell: newActiveCell,
      anchor: context.anchor ?? context.activeCell,
    };
  }

  return {
    modes: initialSelectionModes,
    committedRanges: [],
    pendingRange: singleCellRange(newActiveCell),
    activeCell: newActiveCell,
    anchor: newActiveCell,
  };
});

/**
 * Auto-deactivate `end` mode after a single navigation event consumes it.
 * Composed with the navigation action via XState's `actions: [...]` list
 * in the KEY_ARROW / KEY_HOME / KEY_END / PAGE_* transitions.
 */
const deactivateEndMode = assign(({ context }: { context: SelectionContext }) => {
  if (!context.modes.end) return {};
  return { modes: { ...context.modes, end: false } };
});

// =============================================================================
// EXPORT
// =============================================================================

export const systemActions = {
  setSelection,
  beginCellEdit,
  resetSelection,
  updateSettings,
  setLayoutCallbacks,
  adjustForStructureChange,
  // selection-mode lifecycle
  setMode,
  commitPending,
  exitAllModes,
  deactivateEndMode,
} as const;
