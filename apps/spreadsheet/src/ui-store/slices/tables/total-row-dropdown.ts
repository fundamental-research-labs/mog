/**
 * Total Row Dropdown Slice
 *
 * Manages state for the total row function dropdown in Excel-style tables.
 * When a user clicks on a total row cell, this dropdown appears showing
 * aggregation function options (None, Average, Count, Max, Min, Sum, etc.)
 *
 * Total Row Function Dropdown
 *
 */

import type { StateCreator } from 'zustand';

import type { TotalFunction } from '@mog-sdk/contracts/tables';

/**
 * Total row dropdown UI state.
 */
export interface TotalRowDropdownState {
  /** Whether the dropdown is open */
  isOpen: boolean;

  /** ID of the table containing the total row */
  tableId: string | null;

  /** Column index within the table (0-based) */
  columnIndex: number | null;

  /** Screen position for dropdown (fixed positioning) */
  position: { x: number; y: number } | null;

  /** Current function applied to this column (if any) */
  currentFunction: TotalFunction | null;
}

export interface TotalRowDropdownSlice {
  /** Total row dropdown state */
  totalRowDropdown: TotalRowDropdownState;

  /**
   * Open total row dropdown for a specific table column.
   *
   * @param tableId - The table ID
   * @param columnIndex - Column index within the table (0-based)
   * @param position - Screen coordinates for dropdown positioning
   * @param currentFunction - Currently applied function (or null for 'none')
   */
  openTotalRowDropdown: (
    tableId: string,
    columnIndex: number,
    position: { x: number; y: number },
    currentFunction: TotalFunction | null,
  ) => void;

  /** Close the total row dropdown */
  closeTotalRowDropdown: () => void;
}

const INITIAL_TOTAL_ROW_DROPDOWN_STATE: TotalRowDropdownState = {
  isOpen: false,
  tableId: null,
  columnIndex: null,
  position: null,
  currentFunction: null,
};

export const createTotalRowDropdownSlice: StateCreator<
  TotalRowDropdownSlice,
  [],
  [],
  TotalRowDropdownSlice
> = (set) => ({
  totalRowDropdown: INITIAL_TOTAL_ROW_DROPDOWN_STATE,

  openTotalRowDropdown: (tableId, columnIndex, position, currentFunction) => {
    set({
      totalRowDropdown: {
        isOpen: true,
        tableId,
        columnIndex,
        position,
        currentFunction,
      },
    });
  },

  closeTotalRowDropdown: () => {
    set({ totalRowDropdown: INITIAL_TOTAL_ROW_DROPDOWN_STATE });
  },
});
