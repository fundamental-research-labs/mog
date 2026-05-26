/**
 * Large Fill Confirmation Dialog Slice
 *
 * Manages the confirmation dialog state for large fill operations.
 * Shown when a fill operation would affect more than 10,000 cells (LARGE_FILL_THRESHOLD).
 *
 * Performance and Error Handling
 */

import type { StateCreator } from 'zustand';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { FillDirection, FillOptions } from '@mog-sdk/contracts/fill';

// =============================================================================
// Types
// =============================================================================

/**
 * Pending fill operation data
 * Stored when user is prompted to confirm a large fill
 */
export interface PendingLargeFillData {
  /** Source range for the fill operation */
  sourceRange: CellRange;
  /** Target range for the fill operation */
  targetRange: CellRange;
  /** Fill direction (down, up, left, right) */
  direction: FillDirection;
  /** Fill options (seriesType, fillType, etc.) */
  options: FillOptions;
  /** Number of cells that will be affected */
  cellCount: number;
  /** Estimated duration in milliseconds */
  estimatedDuration: number;
}

/**
 * Large fill dialog state
 */
export interface LargeFillDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Pending fill data when dialog is open */
  pendingFill: PendingLargeFillData | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

/**
 * Large Fill Dialog Slice interface
 */
export interface LargeFillDialogSlice {
  largeFillDialog: LargeFillDialogState;
  /** Show the large fill confirmation dialog */
  showLargeFillConfirmation: (data: PendingLargeFillData) => void;
  /** Close the large fill dialog (cancel) */
  closeLargeFillDialog: () => void;
  /** Confirm and proceed with the large fill */
  confirmLargeFill: () => PendingLargeFillData | null;
}

// =============================================================================
// Default State
// =============================================================================

const DEFAULT_LARGE_FILL_DIALOG: LargeFillDialogState = {
  isOpen: false,
  pendingFill: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the large fill dialog slice
 */
export const createLargeFillDialogSlice: StateCreator<
  LargeFillDialogSlice,
  [],
  [],
  LargeFillDialogSlice
> = (set, get) => ({
  largeFillDialog: DEFAULT_LARGE_FILL_DIALOG,

  showLargeFillConfirmation: (data: PendingLargeFillData) => {
    set({
      largeFillDialog: {
        isOpen: true,
        pendingFill: data,
      },
    });
  },

  closeLargeFillDialog: () => {
    set({ largeFillDialog: DEFAULT_LARGE_FILL_DIALOG });
  },

  confirmLargeFill: () => {
    const pendingFill = get().largeFillDialog.pendingFill;
    // Close the dialog
    set({ largeFillDialog: DEFAULT_LARGE_FILL_DIALOG });
    // Return the pending fill data for execution
    return pendingFill;
  },
});
