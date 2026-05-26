/**
 * Ctrl+A State Slice
 *
 * Manages the multi-press state tracking for Ctrl+A (Select All):
 * - First press: Select current region (contiguous data around active cell)
 * - Second press: Select all cells in sheet
 * - Third press: Select all objects (charts, shapes, etc.)
 * - After timing window expires, cycle resets to first press
 *
 * This slice replaces the module-level state that was previously in selection.ts:
 * ```typescript
 * let lastCtrlATime = 0;
 * let lastCtrlAState: 'region' | 'all' | 'objects' | 'none' = 'none';
 * ```
 *
 * Moving to UIStore provides:
 * - Session isolation for collaborative editing
 * - Testability with proper state management
 * - Consistency with other UI state patterns
 *
 */

import type { StateCreator } from 'zustand';

/**
 * The state of the Ctrl+A selection cycle.
 * - 'none': Initial state, no Ctrl+A pressed yet
 * - 'region': Current region selected (first press)
 * - 'all': All cells selected (second press)
 * - 'objects': All objects selected (third press)
 */
export type CtrlAState = 'region' | 'all' | 'objects' | 'none';

/**
 * State for Ctrl+A multi-press detection.
 */
export interface CtrlAStateSliceState {
  /**
   * Timestamp of the last Ctrl+A press.
   * Used to determine if we're within the timing window for cycling.
   */
  ctrlALastPressTime: number;

  /**
   * The state after the last Ctrl+A press.
   * Used to determine what the next state should be.
   */
  ctrlALastState: CtrlAState;

  /**
   * The timing window in milliseconds for consecutive Ctrl+A presses.
   * Presses within this window will cycle through states.
   * Default: 500ms (matches Excel behavior)
   */
  ctrlATimingWindowMs: number;
}

/**
 * Ctrl+A state slice interface.
 */
export interface CtrlAStateSlice extends CtrlAStateSliceState {
  /**
   * Record that a Ctrl+A press occurred with the given resulting state.
   * Updates the timestamp and state for next press detection.
   *
   * @param state - The state that was applied (region, all, or objects)
   */
  recordCtrlAPress: (state: CtrlAState) => void;

  /**
   * Get the next state for a Ctrl+A press based on timing window and current state.
   * Returns null if no state transition should occur (handled externally).
   *
   * The cycle is: region -> all -> objects -> region
   * If outside the timing window, always returns 'region' to start fresh.
   *
   * @returns The next state to transition to
   */
  getNextCtrlAState: () => CtrlAState;

  /**
   * Reset the Ctrl+A state to initial values.
   * Called when selection changes significantly or on certain operations.
   */
  resetCtrlAState: () => void;
}

/**
 * Create the Ctrl+A state slice.
 */
export const createCtrlAStateSlice: StateCreator<CtrlAStateSlice, [], [], CtrlAStateSlice> = (
  set,
  get,
) => ({
  // Initial state
  ctrlALastPressTime: 0,
  ctrlALastState: 'none',
  ctrlATimingWindowMs: 500,

  // Record a Ctrl+A press with the resulting state
  recordCtrlAPress: (state: CtrlAState) => {
    set({
      ctrlALastPressTime: Date.now(),
      ctrlALastState: state,
    });
  },

  // Get the next state based on timing and current state
  getNextCtrlAState: () => {
    const { ctrlALastPressTime, ctrlALastState, ctrlATimingWindowMs } = get();
    const now = Date.now();
    const isWithinWindow = now - ctrlALastPressTime < ctrlATimingWindowMs;

    // If outside timing window, start fresh with 'region'
    if (!isWithinWindow) {
      return 'region';
    }

    // Cycle through states: region -> all -> objects -> region
    switch (ctrlALastState) {
      case 'region':
        return 'all';
      case 'all':
        return 'objects';
      case 'objects':
        return 'region';
      case 'none':
      default:
        return 'region';
    }
  },

  // Reset to initial state
  resetCtrlAState: () => {
    set({
      ctrlALastPressTime: 0,
      ctrlALastState: 'none',
    });
  },
});
