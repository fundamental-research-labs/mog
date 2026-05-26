/**
 * Sparkline Dialogs Slice
 *
 * Manages state for sparkline dialogs.
 */

import type { StateCreator } from 'zustand';

import type { SparklineType } from '@mog-sdk/contracts/sparklines';

/**
 * Sparkline dialog state
 */
export interface SparklineDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Selected sparkline type */
  sparklineType: SparklineType;
  /** Data range string (e.g., "A1:E1") */
  dataRange: string;
  /** Location range string (where sparklines will be placed, e.g., "F1") */
  locationRange: string;
}

/**
 * Edit Sparkline dialog state
 */
export interface EditSparklineDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** ID of the sparkline being edited */
  sparklineId: string | null;
  /** Row of the cell containing the sparkline */
  row: number;
  /** Column of the cell containing the sparkline */
  col: number;
}

export interface SparklineDialogsSlice {
  sparklineDialog: SparklineDialogState;
  editSparklineDialog: EditSparklineDialogState;
  openSparklineDialog: (dataRange?: string, locationRange?: string) => void;
  closeSparklineDialog: () => void;
  setSparklineType: (type: SparklineType) => void;
  setSparklineDataRange: (range: string) => void;
  setSparklineLocationRange: (range: string) => void;
  openEditSparklineDialog: (sparklineId: string, row: number, col: number) => void;
  closeEditSparklineDialog: () => void;
}

const initialSparklineDialog: SparklineDialogState = {
  isOpen: false,
  sparklineType: 'line',
  dataRange: '',
  locationRange: '',
};

const initialEditDialog: EditSparklineDialogState = {
  isOpen: false,
  sparklineId: null,
  row: 0,
  col: 0,
};

export const createSparklineDialogsSlice: StateCreator<
  SparklineDialogsSlice,
  [],
  [],
  SparklineDialogsSlice
> = (set) => ({
  sparklineDialog: initialSparklineDialog,
  editSparklineDialog: initialEditDialog,

  openSparklineDialog: (dataRange?: string, locationRange?: string) => {
    set({
      sparklineDialog: {
        isOpen: true,
        sparklineType: 'line',
        dataRange: dataRange ?? '',
        locationRange: locationRange ?? '',
      },
    });
  },

  closeSparklineDialog: () => {
    set({ sparklineDialog: initialSparklineDialog });
  },

  setSparklineType: (type: SparklineType) => {
    set((s) => ({
      sparklineDialog: {
        ...s.sparklineDialog,
        sparklineType: type,
      },
    }));
  },

  setSparklineDataRange: (range: string) => {
    set((s) => ({
      sparklineDialog: {
        ...s.sparklineDialog,
        dataRange: range,
      },
    }));
  },

  setSparklineLocationRange: (range: string) => {
    set((s) => ({
      sparklineDialog: {
        ...s.sparklineDialog,
        locationRange: range,
      },
    }));
  },

  openEditSparklineDialog: (sparklineId: string, row: number, col: number) => {
    set({
      editSparklineDialog: {
        isOpen: true,
        sparklineId,
        row,
        col,
      },
    });
  },

  closeEditSparklineDialog: () => {
    set({ editSparklineDialog: initialEditDialog });
  },
});
