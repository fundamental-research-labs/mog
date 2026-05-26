/**
 * Fill Merge Conflict Dialog Slice
 *
 * Manages the fill merge conflict error dialog state.
 * Shown when a fill operation would split a merged cell region.
 *
 * Merged Cells Awareness
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Fill merge conflict dialog state
 */
export interface FillMergeConflictDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
}

// =============================================================================
// Slice Interface
// =============================================================================

/**
 * Fill Merge Conflict Dialog Slice interface
 */
export interface FillMergeConflictDialogSlice {
  fillMergeConflictDialog: FillMergeConflictDialogState;
  /** Open the fill merge conflict dialog */
  openFillMergeConflictDialog: () => void;
  /** Close the fill merge conflict dialog */
  closeFillMergeConflictDialog: () => void;
}

// =============================================================================
// Default State
// =============================================================================

const DEFAULT_FILL_MERGE_CONFLICT_DIALOG: FillMergeConflictDialogState = {
  isOpen: false,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the fill merge conflict dialog slice
 */
export const createFillMergeConflictDialogSlice: StateCreator<
  FillMergeConflictDialogSlice,
  [],
  [],
  FillMergeConflictDialogSlice
> = (set) => ({
  fillMergeConflictDialog: DEFAULT_FILL_MERGE_CONFLICT_DIALOG,

  openFillMergeConflictDialog: () => {
    set({
      fillMergeConflictDialog: {
        isOpen: true,
      },
    });
  },

  closeFillMergeConflictDialog: () => {
    set({ fillMergeConflictDialog: DEFAULT_FILL_MERGE_CONFLICT_DIALOG });
  },
});
