/**
 * Data Table Dialog Slice
 *
 * of Scenarios: Data Tables
 *
 * Manages state for the Data Table dialog, which allows users to explore
 * multiple scenarios by evaluating a formula with different input values.
 *
 * Spreadsheet compatibility: Data > Scenarios > Data Table
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Data Table calculation status
 */
export type DataTableStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Data Table result information
 */
export interface DataTableResultInfo {
  /** Number of cells computed */
  cellCount: number;
  /** Time taken in milliseconds */
  elapsedMs: number;
  /** Whether the operation was cancelled */
  cancelled: boolean;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Data Table dialog state
 */
export interface DataTableDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Row input cell reference (A1 notation for display) */
  rowInputCellRef: string;
  /** Column input cell reference (A1 notation for display) */
  colInputCellRef: string;
  /** Current calculation status */
  status: DataTableStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Result information from last calculation */
  result: DataTableResultInfo | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface DataTableDialogSlice {
  /** Data Table dialog state */
  dataTableDialog: DataTableDialogState;

  /** Open the Data Table dialog */
  openDataTableDialog: () => void;

  /** Close the Data Table dialog */
  closeDataTableDialog: () => void;

  /** Update row input cell reference */
  setDataTableRowInputCell: (ref: string) => void;

  /** Update column input cell reference */
  setDataTableColInputCell: (ref: string) => void;

  /** Update calculation status and optionally progress */
  setDataTableStatus: (status: DataTableStatus, progress?: number) => void;

  /** Update progress percentage */
  setDataTableProgress: (progress: number) => void;

  /** Set the result of Data Table calculation */
  setDataTableResult: (result: DataTableResultInfo | null) => void;

  /** Reset Data Table state (keep dialog open but clear inputs) */
  resetDataTableState: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialDataTableDialogState: DataTableDialogState = {
  isOpen: false,
  rowInputCellRef: '',
  colInputCellRef: '',
  status: 'idle',
  progress: 0,
  result: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createDataTableDialogSlice: StateCreator<
  DataTableDialogSlice,
  [],
  [],
  DataTableDialogSlice
> = (set, _get) => ({
  dataTableDialog: initialDataTableDialogState,

  openDataTableDialog: () => {
    set({
      dataTableDialog: {
        ...initialDataTableDialogState,
        isOpen: true,
      },
    });
  },

  closeDataTableDialog: () => {
    set({
      dataTableDialog: initialDataTableDialogState,
    });
  },

  setDataTableRowInputCell: (ref) => {
    set((state) => ({
      dataTableDialog: {
        ...state.dataTableDialog,
        rowInputCellRef: ref,
      },
    }));
  },

  setDataTableColInputCell: (ref) => {
    set((state) => ({
      dataTableDialog: {
        ...state.dataTableDialog,
        colInputCellRef: ref,
      },
    }));
  },

  setDataTableStatus: (status, progress) => {
    set((state) => ({
      dataTableDialog: {
        ...state.dataTableDialog,
        status,
        progress: progress ?? state.dataTableDialog.progress,
      },
    }));
  },

  setDataTableProgress: (progress) => {
    set((state) => ({
      dataTableDialog: {
        ...state.dataTableDialog,
        progress,
      },
    }));
  },

  setDataTableResult: (result) => {
    set((state) => ({
      dataTableDialog: {
        ...state.dataTableDialog,
        result,
        status: result?.cancelled
          ? 'cancelled'
          : result?.errorMessage
            ? 'failed'
            : result
              ? 'completed'
              : 'idle',
      },
    }));
  },

  resetDataTableState: () => {
    set((state) => ({
      dataTableDialog: {
        ...initialDataTableDialogState,
        isOpen: state.dataTableDialog.isOpen,
      },
    }));
  },
});
