/**
 * Range Selection Mode Slice
 *
 * Manages the state for range selection mode, which allows users to select
 * ranges from the sheet while a dialog is open. This implements Excel's
 * "collapse button" pattern used in dialogs like Sort, Conditional Formatting,
 * Data Validation, etc.
 *
 * Architecture:
 * - UI Store: Tracks which dialog/input is in range selection mode
 * - Coordinator: Handles dialog minimize/restore and selection coordination
 * - Component: CollapsibleRangeInput provides the reusable UI
 *
 */

import type { StateCreator } from 'zustand';

import { parseA1Range } from '@mog/spreadsheet-utils/a1';

import type { DialogStackSlice } from '../dialogs/dialog-stack';

// =============================================================================
// Types
// =============================================================================

/**
 * Range selection mode state.
 * Active when a dialog input is in "collapsed" mode waiting for range selection.
 */
export type RangeSelectionInputMode = 'range' | 'single-cell';

export interface RangeSelectionModeState {
  /** Whether range selection mode is currently active */
  active: boolean;
  /** ID of the dialog that initiated range selection */
  sourceDialogId: string | null;
  /** ID of the specific input within the dialog */
  sourceInputId: string | null;
  /** Current range being selected (live updated during selection) */
  currentRange: string;
  /** Whether to allow multiple ranges separated by commas */
  allowMultipleRanges: boolean;
  /** Whether the source input accepts ranges or auto-completes a single selected cell */
  inputMode: RangeSelectionInputMode;
  /** Callback to invoke when range selection completes (Enter pressed) */
  onComplete: ((range: string) => void) | null;
  /** Callback to invoke when range selection is cancelled (Escape pressed) */
  onCancel: (() => void) | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface RangeSelectionModeSlice {
  /** Range selection mode state */
  rangeSelectionMode: RangeSelectionModeState;

  /**
   * Start range selection mode.
   * This minimizes the dialog and enables range picking on the sheet.
   *
   * @param dialogId - ID of the dialog requesting range selection
   * @param inputId - ID of the specific input field
   * @param initialRange - Initial range value (if any)
   * @param options - Configuration options
   */
  startRangeSelectionMode: (
    dialogId: string,
    inputId: string,
    initialRange: string,
    options?: {
      allowMultipleRanges?: boolean;
      inputMode?: RangeSelectionInputMode;
      onComplete?: (range: string) => void;
      onCancel?: () => void;
    },
  ) => void;

  /**
   * Update the current range during selection.
   * Called by selection machine or mouse handler as user selects cells.
   *
   * @param range - New range string (e.g., "A1:B5")
   */
  updateRangeSelection: (range: string) => void;

  /**
   * Complete range selection mode.
   * This restores the dialog and applies the selected range.
   */
  completeRangeSelection: () => void;

  /**
   * Cancel range selection mode.
   * This restores the dialog and reverts to the original value.
   */
  cancelRangeSelection: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialRangeSelectionModeState: RangeSelectionModeState = {
  active: false,
  sourceDialogId: null,
  sourceInputId: null,
  currentRange: '',
  allowMultipleRanges: false,
  inputMode: 'range',
  onComplete: null,
  onCancel: null,
};

function isSingleCellReference(range: string): boolean {
  const normalized = range.trim().replace(/^=/, '');
  if (!normalized || normalized.includes(',') || normalized.includes('!')) {
    return false;
  }

  try {
    const parsed = parseA1Range(normalized);
    return (
      parsed.startRow === parsed.endRow &&
      parsed.startCol === parsed.endCol &&
      !parsed.isFullRow &&
      !parsed.isFullColumn
    );
  } catch {
    return false;
  }
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createRangeSelectionModeSlice: StateCreator<
  RangeSelectionModeSlice & DialogStackSlice,
  [],
  [],
  RangeSelectionModeSlice
> = (set, get) => ({
  rangeSelectionMode: initialRangeSelectionModeState,

  startRangeSelectionMode: (dialogId, inputId, initialRange, options = {}) => {
    const inputMode = options.inputMode ?? 'range';

    set({
      rangeSelectionMode: {
        active: true,
        sourceDialogId: dialogId,
        sourceInputId: inputId,
        currentRange: initialRange,
        allowMultipleRanges:
          inputMode === 'single-cell' ? false : (options.allowMultipleRanges ?? false),
        inputMode,
        onComplete: options.onComplete ?? null,
        onCancel: options.onCancel ?? null,
      },
    });
    // Minimize the entire dialog chain after setting active = true
    get().minimizeStack(dialogId);
  },

  updateRangeSelection: (range: string) => {
    const state = get().rangeSelectionMode;
    if (!state.active) return;
    const shouldCompleteSingleCell =
      state.inputMode === 'single-cell' && isSingleCellReference(range);

    if (state.inputMode === 'single-cell' && !shouldCompleteSingleCell) {
      return;
    }

    set({
      rangeSelectionMode: {
        ...state,
        currentRange: range,
      },
    });

    if (shouldCompleteSingleCell) {
      get().completeRangeSelection();
    }
  },

  completeRangeSelection: () => {
    const state = get().rangeSelectionMode;
    if (!state.active) return;

    const sourceDialogId = state.sourceDialogId;

    // Invoke completion callback if provided
    if (state.onComplete) {
      state.onComplete(state.currentRange);
    }

    // Restore the entire dialog chain before resetting state
    if (sourceDialogId) {
      get().restoreStack(sourceDialogId);
    }

    // Reset to initial state
    set({
      rangeSelectionMode: initialRangeSelectionModeState,
    });
  },

  cancelRangeSelection: () => {
    const state = get().rangeSelectionMode;
    if (!state.active) return;

    const sourceDialogId = state.sourceDialogId;

    // Invoke cancellation callback if provided
    if (state.onCancel) {
      state.onCancel();
    }

    // Restore the entire dialog chain before resetting state
    if (sourceDialogId) {
      get().restoreStack(sourceDialogId);
    }

    // Reset to initial state
    set({
      rangeSelectionMode: initialRangeSelectionModeState,
    });
  },
});
