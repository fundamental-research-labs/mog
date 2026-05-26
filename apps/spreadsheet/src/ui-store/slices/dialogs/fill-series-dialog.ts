/**
 * Fill Series Dialog Slice
 *
 * Excel Parity Quickwin A9: Fill Series Dialog
 *
 * Manages state for the Fill Series dialog.
 * Uses position-based CellRange for the selection. CellIds are not used here
 * because the selection may include empty cells (which don't have CellIds),
 * and this is a transient modal operation where structural stability is not needed.
 */

import type { StateCreator } from 'zustand';

import type { CellRange } from '@mog-sdk/contracts/core';

import type { FillDirection, SeriesType } from '@mog-sdk/contracts/fill';

// =============================================================================
// Types
// =============================================================================

/**
 * Pending fill series options (Draft + Apply pattern)
 */
export interface PendingFillSeriesOptions {
  /** Fill direction */
  direction: FillDirection;
  /** Series type */
  seriesType: SeriesType;
  /** Date unit (when seriesType='date') */
  dateUnit?: 'day' | 'weekday' | 'month' | 'year';
  /** Step value */
  step: number;
  /** Stop value (optional) */
  stopValue?: number;
  /** Trend option */
  trend?: boolean;
}

/**
 * Fill series dialog state
 */
export interface FillSeriesDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** The user's selection range (contains both pattern cells and fill targets) */
  sourceRange: CellRange | null;
  /** Default fill direction (rows = horizontal, columns = vertical) */
  direction: 'row' | 'column';
  /** Pending options for execution (Draft + Apply pattern) */
  pendingOptions: PendingFillSeriesOptions | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface FillSeriesDialogSlice {
  /** Fill series dialog state */
  fillSeriesDialog: FillSeriesDialogState;

  /** Open the fill series dialog for a specific range */
  openFillSeriesDialog: (sourceRange: CellRange, direction: 'row' | 'column') => void;

  /** Close the fill series dialog */
  closeFillSeriesDialog: () => void;

  /** Set pending fill series options (Draft + Apply pattern) */
  setPendingFillSeriesOptions: (options: PendingFillSeriesOptions) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialFillSeriesDialogState: FillSeriesDialogState = {
  isOpen: false,
  sourceRange: null,
  direction: 'column',
  pendingOptions: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createFillSeriesDialogSlice: StateCreator<
  FillSeriesDialogSlice,
  [],
  [],
  FillSeriesDialogSlice
> = (set, get) => ({
  fillSeriesDialog: initialFillSeriesDialogState,

  openFillSeriesDialog: (sourceRange, direction) => {
    set({
      fillSeriesDialog: {
        isOpen: true,
        sourceRange,
        direction,
        pendingOptions: null,
      },
    });
  },

  closeFillSeriesDialog: () => {
    set({
      fillSeriesDialog: initialFillSeriesDialogState,
    });
  },

  setPendingFillSeriesOptions: (options) => {
    const current = get().fillSeriesDialog;
    set({
      fillSeriesDialog: {
        ...current,
        pendingOptions: options,
      },
    });
  },
});
