/**
 * Sort Dialog Slice
 *
 * Sort System
 *
 * Manages state for the multi-column Sort dialog.
 * Uses CellRange to identify the sort range; the dialog converts
 * column selections to CellId-based criteria on submit.
 */

import type { StateCreator } from 'zustand';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { SortBy, SortDirection } from '@mog-sdk/contracts/sorting';

// =============================================================================
// Types
// =============================================================================

export type SortDialogInitialCriterion =
  | {
      sortBy: 'value';
      columnIndex: number;
      direction: SortDirection;
    }
  | {
      sortBy: Extract<SortBy, 'cellColor' | 'fontColor'>;
      columnIndex: number;
      direction: SortDirection;
      targetColor: string;
      colorPosition: 'top' | 'bottom';
    };

export type SortDialogInitialKind =
  | { type: 'custom'; criterion: SortDialogInitialCriterion }
  | { type: 'cellColor'; criterion: SortDialogInitialCriterion }
  | { type: 'fontColor'; criterion: SortDialogInitialCriterion };

/**
 * Sort dialog state
 */
export interface SortDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** The range being sorted (captured when dialog opens) */
  range: CellRange | null;
  /** Whether the range has headers (auto-detected, user can override) */
  hasHeaders: boolean;
  /** Whether sorting should preserve hidden row slots */
  visibleRowsOnly: boolean;
  /** Initial sort level captured by the opener action */
  initialKind: SortDialogInitialKind;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface SortDialogSlice {
  /** Sort dialog state */
  sortDialog: SortDialogState;

  /** Open the sort dialog for a specific range */
  openSortDialog: (
    range: CellRange,
    hasHeaders?: boolean,
    initialKind?: SortDialogInitialKind,
    visibleRowsOnly?: boolean,
  ) => void;

  /** Close the sort dialog */
  closeSortDialog: () => void;

  /** Update hasHeaders setting */
  setSortDialogHasHeaders: (hasHeaders: boolean) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialSortDialogState: SortDialogState = {
  isOpen: false,
  range: null,
  hasHeaders: false,
  visibleRowsOnly: false,
  initialKind: {
    type: 'custom',
    criterion: { sortBy: 'value', columnIndex: 0, direction: 'asc' },
  },
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createSortDialogSlice: StateCreator<SortDialogSlice, [], [], SortDialogSlice> = (
  set,
) => ({
  sortDialog: initialSortDialogState,

  openSortDialog: (
    range: CellRange,
    hasHeaders: boolean = false,
    initialKind: SortDialogInitialKind = initialSortDialogState.initialKind,
    visibleRowsOnly: boolean = false,
  ) => {
    set({
      sortDialog: {
        isOpen: true,
        range,
        hasHeaders,
        visibleRowsOnly,
        initialKind,
      },
    });
  },

  closeSortDialog: () => {
    set({
      sortDialog: initialSortDialogState,
    });
  },

  setSortDialogHasHeaders: (hasHeaders: boolean) => {
    set((state) => ({
      sortDialog: {
        ...state.sortDialog,
        hasHeaders,
      },
    }));
  },
});
