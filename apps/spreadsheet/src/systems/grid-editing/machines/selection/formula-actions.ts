/**
 * Selection Machine - Formula Actions
 *
 * Handles formula range selection mode:
 * - Enter/exit formula mode (enterFormulaMode, exitFormulaMode)
 * - Enter/exit range selection mode (enterRangeSelectionMode, exitRangeSelectionMode)
 * - Set/update formula range (setFormulaRange, updateFormulaRange)
 *
 * All actions are pure state transitions using XState's assign() function.
 * No side effects - only state updates.
 *
 * @see core-actions.ts - Main export point
 * @see selection-machine.ts - State machine that uses these actions
 */

import { assign } from 'xstate';
import { singleCellRange } from '../../../shared/types';
import type { SelectionContext, SelectionEvent } from './types';
import { buildExtendUpdate, moveTo } from './helpers';

// =============================================================================
// FORMULA RANGE MODE ACTIONS
// =============================================================================

/**
 * Enter formula range selection mode.
 */
const enterFormulaMode = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'ENTER_FORMULA_RANGE_MODE') return {};
    return {
      formulaRangeColor: event.color,
      anchor: null,
    };
  },
);

/**
 * Exit formula range selection mode.
 */
const exitFormulaMode = assign(({ context }: { context: SelectionContext }) => ({
  formulaRangeColor: null,
  pendingRange: singleCellRange(context.activeCell),
  committedRanges: [],
  anchor: context.activeCell,
}));

/**
 * Enter range selection mode (for dialogs).
 */
const enterRangeSelectionMode = assign(() => ({
  inRangeSelectionMode: true,
}));

/**
 * Exit range selection mode.
 */
const exitRangeSelectionMode = assign(() => ({
  inRangeSelectionMode: false,
}));

/**
 * Set formula range anchor on mouse down in formula mode.
 */
const setFormulaRange = assign(
  ({ event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'MOUSE_DOWN') return {};
    return moveTo(event.cell);
  },
);

/**
 * Update formula range during drag in formula mode.
 */
const updateFormulaRange = assign(
  ({ context, event }: { context: SelectionContext; event: SelectionEvent }) => {
    if (event.type !== 'MOUSE_MOVE' || !context.anchor) return {};
    return buildExtendUpdate(context.anchor, event.cell);
  },
);

// =============================================================================
// EXPORT
// =============================================================================

export const formulaActions = {
  enterFormulaMode,
  exitFormulaMode,
  enterRangeSelectionMode,
  exitRangeSelectionMode,
  setFormulaRange,
  updateFormulaRange,
} as const;
