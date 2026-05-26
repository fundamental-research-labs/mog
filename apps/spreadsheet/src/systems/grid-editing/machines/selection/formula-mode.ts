/**
 * Formula Mode Actions
 *
 * XState actions for formula range mode in the selection state machine.
 * These actions handle entering/exiting formula mode and range selection mode,
 * as well as tracking formula range selection during mouse interactions.
 *
 * Formula mode is activated when the user is editing a formula and clicks
 * on cells to insert references. Range selection mode is used for dialogs
 * that need the user to select a range.
 *
 * @module selection/formula-mode
 * @see ../selection-machine.ts - Main state machine that uses these actions
 * @see types.ts - SelectionContext and SelectionEvent definitions
 */

import { assign } from 'xstate';
import type { SelectionContext, SelectionEvent } from './types';

// =============================================================================
// ACTION FUNCTION TYPES
// =============================================================================

/**
 * Action function signature for XState setup().
 * Actions receive context and event.
 */
type ActionArgs = {
  context: SelectionContext;
  event: SelectionEvent;
};

// =============================================================================
// FORMULA MODE ACTIONS
// =============================================================================

/**
 * Enter formula range mode.
 * Called when the user starts editing a formula and the system
 * needs to allow cell/range clicking to insert references.
 *
 * @param event - ENTER_FORMULA_RANGE_MODE event with color for highlighting
 */
const enterFormulaMode = assign(({ event }: ActionArgs) => {
  if (event.type !== 'ENTER_FORMULA_RANGE_MODE') return {};
  return {
    formulaRangeColor: event.color,
  };
});

/**
 * Exit formula range mode.
 * Called when formula editing is complete or cancelled.
 * Clears the formula range highlighting color.
 */
const exitFormulaMode = assign(() => ({
  formulaRangeColor: null,
}));

// =============================================================================
// RANGE SELECTION MODE ACTIONS
// =============================================================================

/**
 * Enter range selection mode.
 * Used when dialogs need the user to select a range (e.g., chart data range).
 * This mode allows range selection without modifying the main cell selection.
 */
const enterRangeSelectionMode = assign(() => ({
  inRangeSelectionMode: true,
}));

/**
 * Exit range selection mode.
 * Called when the dialog closes or range selection is complete.
 */
const exitRangeSelectionMode = assign(() => ({
  inRangeSelectionMode: false,
}));

// =============================================================================
// FORMULA RANGE SELECTION ACTIONS
// =============================================================================

/**
 * Set formula range anchor on mouse down while in formula mode.
 * When clicking a cell during formula editing, this captures the click
 * as an anchor for potential range selection.
 *
 * Note: In formula mode, we don't replace the main selection.
 * The coordinator reads this anchor to insert into the formula.
 *
 * @param event - MOUSE_DOWN event with cell coordinates
 */
const setFormulaRange = assign(({ event }: ActionArgs) => {
  if (event.type !== 'MOUSE_DOWN') return {};
  return {
    anchor: event.cell,
    // In formula mode, we don't replace the main selection
    // The coordinator will read this and insert into the formula
  };
});

/**
 * Update formula range during mouse drag while in formula mode.
 * When dragging to select a range during formula editing, this tracks
 * the current cell position for range calculation.
 *
 * Note: We track the range being selected for the formula but don't
 * modify the main selection. The coordinator reads anchor + current
 * cell to determine the range.
 *
 * @param context - Current selection context with anchor
 * @param event - MOUSE_MOVE event with current cell coordinates
 */
const updateFormulaRange = assign(({ context, event }: ActionArgs) => {
  if (event.type !== 'MOUSE_MOVE' || !context.anchor) return {};
  // In formula mode, we track the range being selected for the formula
  // but don't modify the main selection
  return {
    // The coordinator will read anchor + current cell to get the range
  };
});

// =============================================================================
// FORMULA MODE ACTIONS EXPORT
// =============================================================================

/**
 * All formula mode action functions for the selection machine.
 * Export as an object to spread into XState's setup({ actions: ... }).
 *
 * These actions handle:
 * - Entering/exiting formula range mode (for formula cell reference insertion)
 * - Entering/exiting range selection mode (for dialog range inputs)
 * - Formula range selection via mouse interactions
 */
export const formulaModeActions = {
  // Formula mode entry/exit
  enterFormulaMode,
  exitFormulaMode,

  // Range selection mode entry/exit
  enterRangeSelectionMode,
  exitRangeSelectionMode,

  // Formula range selection (mouse interactions in formula mode)
  setFormulaRange,
  updateFormulaRange,
} as const;

/**
 * Type for the formula mode actions object, useful for type-safe action references.
 */
export type FormulaModeActions = typeof formulaModeActions;
