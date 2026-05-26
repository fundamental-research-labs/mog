/**
 * Filter Dropdown Slice
 *
 * Manages state for the AutoFilter dropdown menu (value/condition filter UI).
 *
 * ARCHITECTURE: This slice uses CellId (not column index) to identify the header cell.
 * This follows the Cell Identity Model - the filter dropdown operates on a specific
 * header cell identified by its stable CellId, not its transient column position.
 *
 * B4 UPDATE: Added pending state for Draft + Apply pattern.
 * Components store pending configs here before dispatching actions.
 *
 * @see layer-0-filter-state-foundation.md for Cell Identity Model
 */

import type { StateCreator } from 'zustand';

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { FilterOperator } from '@mog-sdk/contracts/filter';

/**
 * Pending filter config for number/text/date filters (Draft + Apply pattern).
 */
export interface PendingFilterConfig {
  filterId: string;
  headerCellId: CellId;
  type: 'number' | 'text' | 'date';
  operator: FilterOperator;
  value?: string;
  value2?: string; // For 'between' operator
}

/**
 * Pending Top 10 filter config (Draft + Apply pattern).
 */
export interface PendingTop10Config {
  filterId: string;
  headerCellId: CellId;
  type: 'top' | 'bottom';
  count: number;
  by: 'items' | 'percent';
}

/**
 * Pending color filter config (Draft + Apply pattern).
 */
export interface PendingColorFilterConfig {
  filterId: string;
  headerCellId: CellId;
  /** 0-based column index (from FilterButtonMetadata.col) */
  col?: number;
  colorType: 'fill' | 'font';
  color: string;
}

/**
 * Filter dropdown UI state.
 */
export interface FilterDropdownState {
  /** Whether the filter dropdown is open */
  isOpen: boolean;

  /** The filter ID being edited (from Filters domain) */
  filterId: string | null;

  /**
   * CellId of the header cell (NOT column index!).
   * This is the key identifier that Layer 0's filter operations expect.
   */
  headerCellId: CellId | null;

  /** Screen position for dropdown (fixed positioning) */
  position: { x: number; y: number } | null;

  /** Whether Top 10 dialog is open */
  isTop10DialogOpen: boolean;

  // ===== Pending configs for Draft + Apply pattern =====

  /** Pending number/text filter config (set before APPLY_NUMBER_FILTER/APPLY_TEXT_FILTER dispatch) */
  pendingFilterConfig: PendingFilterConfig | null;

  /** Pending Top 10 filter config (set before APPLY_TOP10_FILTER dispatch) */
  pendingTop10Config: PendingTop10Config | null;

  /** Pending color filter config (set before APPLY_COLOR_FILTER dispatch) */
  pendingColorFilter: PendingColorFilterConfig | null;
}

export interface FilterDropdownSlice {
  /** Filter dropdown state (nested to avoid conflicts with other slices) */
  filterDropdown: FilterDropdownState;

  /**
   * Open filter dropdown for a specific header cell.
   *
   * @param filterId - The filter state ID
   * @param headerCellId - CellId of the header cell (not column index!)
   * @param position - Screen coordinates for dropdown positioning
   */
  openFilterDropdown: (
    filterId: string,
    headerCellId: CellId,
    position: { x: number; y: number },
  ) => void;

  /** Close the filter dropdown */
  closeFilterDropdown: () => void;

  /** Open Top 10 dialog */
  openTop10Dialog: () => void;

  /** Close Top 10 dialog */
  closeTop10Dialog: () => void;

  // ===== Pending config setters (Draft + Apply pattern) =====

  /** Set pending filter config (called before dispatch) */
  setPendingFilterConfig: (config: PendingFilterConfig | null) => void;

  /** Set pending Top 10 config (called before dispatch) */
  setPendingTop10Config: (config: PendingTop10Config | null) => void;

  /** Set pending color filter config (called before dispatch) */
  setPendingColorFilter: (config: PendingColorFilterConfig | null) => void;

  /** Clear pending filter config (called by handler after applying) */
  clearPendingFilterConfig: () => void;

  /** Clear pending Top 10 config (called by handler after applying) */
  clearPendingTop10Config: () => void;

  /** Clear pending color filter config (called by handler after applying) */
  clearPendingColorFilter: () => void;
}

const INITIAL_FILTER_DROPDOWN_STATE: FilterDropdownState = {
  isOpen: false,
  filterId: null,
  headerCellId: null,
  position: null,
  isTop10DialogOpen: false,
  pendingFilterConfig: null,
  pendingTop10Config: null,
  pendingColorFilter: null,
};

export const createFilterDropdownSlice: StateCreator<
  FilterDropdownSlice,
  [],
  [],
  FilterDropdownSlice
> = (set) => ({
  // Nested state (like contextMenu)
  filterDropdown: INITIAL_FILTER_DROPDOWN_STATE,

  // Actions
  openFilterDropdown: (filterId, headerCellId, position) => {
    set({
      filterDropdown: {
        ...INITIAL_FILTER_DROPDOWN_STATE,
        isOpen: true,
        filterId,
        headerCellId,
        position,
      },
    });
  },

  closeFilterDropdown: () => {
    set({ filterDropdown: INITIAL_FILTER_DROPDOWN_STATE });
  },

  openTop10Dialog: () => {
    set((state) => ({
      filterDropdown: {
        ...state.filterDropdown,
        isTop10DialogOpen: true,
      },
    }));
  },

  closeTop10Dialog: () => {
    set((state) => ({
      filterDropdown: {
        ...state.filterDropdown,
        isTop10DialogOpen: false,
        pendingTop10Config: null,
      },
    }));
  },

  // Pending config setters
  setPendingFilterConfig: (config) => {
    set((state) => ({
      filterDropdown: {
        ...state.filterDropdown,
        pendingFilterConfig: config,
      },
    }));
  },

  setPendingTop10Config: (config) => {
    set((state) => ({
      filterDropdown: {
        ...state.filterDropdown,
        pendingTop10Config: config,
      },
    }));
  },

  setPendingColorFilter: (config) => {
    set((state) => ({
      filterDropdown: {
        ...state.filterDropdown,
        pendingColorFilter: config,
      },
    }));
  },

  // Clear pending configs (called by action handlers after applying)
  clearPendingFilterConfig: () => {
    set((state) => ({
      filterDropdown: {
        ...state.filterDropdown,
        pendingFilterConfig: null,
      },
    }));
  },

  clearPendingTop10Config: () => {
    set((state) => ({
      filterDropdown: {
        ...state.filterDropdown,
        pendingTop10Config: null,
      },
    }));
  },

  clearPendingColorFilter: () => {
    set((state) => ({
      filterDropdown: {
        ...state.filterDropdown,
        pendingColorFilter: null,
      },
    }));
  },
});
