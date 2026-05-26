/**
 * Advanced Filter Dialog Slice
 *
 * Manages state for the Advanced Filter dialog (Excel: Data > Sort & Filter > Advanced).
 * Allows criteria-based filtering with options to filter in place or copy to another location.
 *
 * Excel Parity: Advanced Filter Dialog
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Advanced Filter dialog state
 */
export interface AdvancedFilterDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Filter action: true = filter in place, false = copy to location */
  filterInPlace: boolean;
  /** List range (data range to filter) */
  listRange: string;
  /** Criteria range (range containing filter criteria) */
  criteriaRange: string;
  /** Copy to range (destination when copying) */
  copyToRange: string;
  /** Only show unique records */
  uniqueRecordsOnly: boolean;
  /** Error message to display */
  error: string | null;
}

export interface AdvancedFilterDialogSlice {
  advancedFilterDialog: AdvancedFilterDialogState;
  openAdvancedFilterDialog: (initialListRange?: string) => void;
  closeAdvancedFilterDialog: () => void;
  setAdvancedFilterInPlace: (filterInPlace: boolean) => void;
  setAdvancedFilterListRange: (listRange: string) => void;
  setAdvancedFilterCriteriaRange: (criteriaRange: string) => void;
  setAdvancedFilterCopyToRange: (copyToRange: string) => void;
  setAdvancedFilterUniqueRecordsOnly: (uniqueRecordsOnly: boolean) => void;
  setAdvancedFilterError: (error: string | null) => void;
  resetAdvancedFilterDialog: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialState: AdvancedFilterDialogState = {
  isOpen: false,
  filterInPlace: true,
  listRange: '',
  criteriaRange: '',
  copyToRange: '',
  uniqueRecordsOnly: false,
  error: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createAdvancedFilterDialogSlice: StateCreator<
  AdvancedFilterDialogSlice,
  [],
  [],
  AdvancedFilterDialogSlice
> = (set) => ({
  advancedFilterDialog: initialState,

  openAdvancedFilterDialog: (initialListRange) => {
    set({
      advancedFilterDialog: {
        ...initialState,
        isOpen: true,
        listRange: initialListRange ?? '',
      },
    });
  },

  closeAdvancedFilterDialog: () => {
    set((state) => ({
      advancedFilterDialog: {
        ...state.advancedFilterDialog,
        isOpen: false,
        error: null,
      },
    }));
  },

  setAdvancedFilterInPlace: (filterInPlace: boolean) => {
    set((state) => ({
      advancedFilterDialog: {
        ...state.advancedFilterDialog,
        filterInPlace,
      },
    }));
  },

  setAdvancedFilterListRange: (listRange: string) => {
    set((state) => ({
      advancedFilterDialog: {
        ...state.advancedFilterDialog,
        listRange,
        error: null,
      },
    }));
  },

  setAdvancedFilterCriteriaRange: (criteriaRange: string) => {
    set((state) => ({
      advancedFilterDialog: {
        ...state.advancedFilterDialog,
        criteriaRange,
        error: null,
      },
    }));
  },

  setAdvancedFilterCopyToRange: (copyToRange: string) => {
    set((state) => ({
      advancedFilterDialog: {
        ...state.advancedFilterDialog,
        copyToRange,
        error: null,
      },
    }));
  },

  setAdvancedFilterUniqueRecordsOnly: (uniqueRecordsOnly: boolean) => {
    set((state) => ({
      advancedFilterDialog: {
        ...state.advancedFilterDialog,
        uniqueRecordsOnly,
      },
    }));
  },

  setAdvancedFilterError: (error: string | null) => {
    set((state) => ({
      advancedFilterDialog: {
        ...state.advancedFilterDialog,
        error,
      },
    }));
  },

  resetAdvancedFilterDialog: () => {
    set({
      advancedFilterDialog: initialState,
    });
  },
});
