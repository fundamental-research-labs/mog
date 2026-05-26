/**
 * Selection Error Slice (formerly "Selection Modes Slice").
 *
 * Originally a bundle of three keyboard-toggled mode flags (`endMode`,
 * `extendSelectionMode`, `addToSelectionMode`) plus the validation-error
 * state. retired the mode flags: they now live on the
 * selection actor's `ctx.modes` bundle (`{ end, extend, additive }`) and
 * are driven by `commands.selection.setMode(...)` /
 * `commands.selection.exitAllModes()`. UI consumers subscribe via
 * `useSelectionMode(mode)` / `useSelectionModeIndicator()` from
 * `hooks/selection/use-granular-selection.ts`.
 *
 * Only the validation-error state survives in this slice — kept here for
 * convenience; it is a pure UI concern (red-border feedback) with no
 * state-machine semantics.
 *
 */

import type { StateCreator } from 'zustand';

/**
 * Selection error state for showing red border on invalid operations.
 * Red Border for Invalid Operations
 */
export interface SelectionError {
  /** The type of error */
  type: 'merge_conflict' | 'protection' | 'array_formula' | 'invalid_range';
  /** Optional message describing the error */
  message?: string;
  /** Timestamp when the error was set (for auto-clearing) */
  timestamp: number;
}

/**
 * Selection error state.
 */
export interface SelectionModesState {
  /**
   * Selection error state for rendering red border.
   * Red Border for Invalid Operations
   *
   * When set, the selection layer renders a red border to indicate
   * an invalid operation (e.g., trying to paste into merged cells,
   * editing protected cells, etc.). The error auto-clears after 2 seconds.
   */
  selectionError: SelectionError | null;
}

/**
 * Selection error slice interface.
 *
 * The legacy mode-flag fields (`endMode`, `extendSelectionMode`,
 * `addToSelectionMode`) and their toggle methods (`activateEndMode`,
 * `deactivateEndMode`, `toggleExtendSelectionMode`,
 * `toggleAddToSelectionMode`, `exitSelectionModes`) were retired in
 * see file header.
 */
export interface SelectionModesSlice extends SelectionModesState {
  /**
   * Set a selection error to show red border.
   * Red Border for Invalid Operations
   *
   * The error automatically clears after 2 seconds.
   *
   * @param type - The type of error (merge_conflict, protection, etc.)
   * @param message - Optional message describing the error
   */
  setSelectionError: (type: SelectionError['type'], message?: string) => void;

  /**
   * Clear the selection error.
   * Red Border for Invalid Operations
   */
  clearSelectionError: () => void;
}

// Auto-clear timeout handle (module-level for cleanup)
let selectionErrorTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Create the selection modes slice.
 */
export const createSelectionModesSlice: StateCreator<
  SelectionModesSlice,
  [],
  [],
  SelectionModesSlice
> = (set) => ({
  // Initial state
  selectionError: null,

  // Red Border for Invalid Operations
  // Set a selection error to show red border
  setSelectionError: (type, message) => {
    // Clear any existing timeout
    if (selectionErrorTimeout) {
      clearTimeout(selectionErrorTimeout);
    }

    const timestamp = Date.now();
    set({
      selectionError: { type, message, timestamp },
    });

    // Auto-clear after 2 seconds (Excel-like behavior)
    selectionErrorTimeout = setTimeout(() => {
      set((state) => {
        // Only clear if this is still the same error (timestamp match)
        if (state.selectionError?.timestamp === timestamp) {
          return { selectionError: null };
        }
        return state;
      });
    }, 2000);
  },

  // Red Border for Invalid Operations
  // Clear the selection error
  clearSelectionError: () => {
    if (selectionErrorTimeout) {
      clearTimeout(selectionErrorTimeout);
      selectionErrorTimeout = null;
    }
    set({ selectionError: null });
  },
});
