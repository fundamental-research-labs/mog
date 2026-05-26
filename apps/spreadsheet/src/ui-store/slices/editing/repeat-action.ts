/**
 * Repeat Action Slice
 *
 * Manages the last repeatable action for F4 repeat functionality.
 * Stores the last formatting/structural action so it can be repeated on a new selection.
 *
 * Architecture:
 * - `lastRepeatableAction` is ephemeral UI state (not persisted, not synced)
 * - Only certain action types are repeatable (formatting, structure operations)
 * - Navigation, selection, clipboard, undo/redo are NOT repeatable
 *
 */

import type { ActionType } from '@mog-sdk/contracts/actions';
import type { StateCreator } from 'zustand';

/**
 * Stored information about a repeatable action.
 */
export interface RepeatableAction {
  /**
   * The action type that was executed.
   */
  actionType: ActionType;

  /**
   * Optional payload for the action (e.g., { size: 14 } for SET_FONT_SIZE).
   * Kept minimal - does NOT include selection ranges.
   */
  payload?: Record<string, unknown>;

  /**
   * Timestamp when the action was executed.
   * Used for debugging and potential time-based expiration.
   */
  timestamp: number;
}

/**
 * Repeat action state.
 */
export interface RepeatActionState {
  /**
   * The last repeatable action that can be repeated with F4.
   * null if no repeatable action has been executed yet.
   */
  lastRepeatableAction: RepeatableAction | null;
}

/**
 * Repeat action slice interface.
 */
export interface RepeatActionSlice extends RepeatActionState {
  /**
   * Set the last repeatable action.
   * Called by dispatcher after successful execution of a repeatable action.
   */
  setLastRepeatableAction: (action: RepeatableAction | null) => void;

  /**
   * Clear the last repeatable action.
   * Could be called on document close, etc.
   */
  clearLastRepeatableAction: () => void;
}

/**
 * Create the repeat action slice.
 */
export const createRepeatActionSlice: StateCreator<RepeatActionSlice, [], [], RepeatActionSlice> = (
  set,
) => ({
  // Initial state: no repeatable action
  lastRepeatableAction: null,

  // Set the last repeatable action
  setLastRepeatableAction: (action) => {
    set({ lastRepeatableAction: action });
  },

  // Clear the last repeatable action
  clearLastRepeatableAction: () => {
    set({ lastRepeatableAction: null });
  },
});
