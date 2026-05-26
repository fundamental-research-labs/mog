/**
 * Merge Warning Dialog Slice
 *
 * Manages the merge data loss warning dialog state.
 * Shown when merging cells that contain data in non-top-left positions,
 * as those cells' data will be lost when merged.
 *
 * Formatting Parity - Merge Data Loss Warning
 */

import type { StateCreator } from 'zustand';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Type of merge operation being performed
 */
export type MergeOperationType = 'merge' | 'mergeAcross' | 'mergeAndCenter';

/**
 * Cell coordinate for identifying cells with data
 */
export interface CellCoord {
  row: number;
  col: number;
}

/**
 * Merge warning dialog state
 */
export interface MergeWarningDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** The range that will be merged */
  pendingRange: CellRange | null;
  /** Sheet ID where merge will occur */
  sheetId: SheetId | null;
  /** List of cells that contain data (non-top-left) */
  cellsWithData: CellCoord[];
  /** Type of merge operation */
  mergeType: MergeOperationType | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

/**
 * Merge Warning Dialog Slice interface
 */
export interface MergeWarningDialogSlice {
  mergeWarningDialog: MergeWarningDialogState;
  /** Open the merge warning dialog */
  openMergeWarningDialog: (
    sheetId: SheetId,
    range: CellRange,
    cellsWithData: CellCoord[],
    mergeType: MergeOperationType,
  ) => void;
  /** Close the merge warning dialog */
  closeMergeWarningDialog: () => void;
}

// =============================================================================
// Default State
// =============================================================================

const DEFAULT_MERGE_WARNING_DIALOG: MergeWarningDialogState = {
  isOpen: false,
  pendingRange: null,
  sheetId: null,
  cellsWithData: [],
  mergeType: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the merge warning dialog slice
 */
export const createMergeWarningDialogSlice: StateCreator<
  MergeWarningDialogSlice,
  [],
  [],
  MergeWarningDialogSlice
> = (set) => ({
  mergeWarningDialog: DEFAULT_MERGE_WARNING_DIALOG,

  openMergeWarningDialog: (
    sheetId: SheetId,
    range: CellRange,
    cellsWithData: CellCoord[],
    mergeType: MergeOperationType,
  ) => {
    set({
      mergeWarningDialog: {
        isOpen: true,
        pendingRange: range,
        sheetId,
        cellsWithData,
        mergeType,
      },
    });
  },

  closeMergeWarningDialog: () => {
    set({ mergeWarningDialog: DEFAULT_MERGE_WARNING_DIALOG });
  },
});
