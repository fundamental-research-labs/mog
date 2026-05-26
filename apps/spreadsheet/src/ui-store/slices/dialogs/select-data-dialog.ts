/**
 * Select Data Dialog Slice
 *
 * Select Data Dialog for charts
 *
 * Manages the state for the Select Data dialog, which allows users to:
 * - Edit chart data range
 * - Add/Edit/Remove series
 * - Move series up/down
 * - Switch row/column orientation
 * - Configure hidden and empty cell options
 *
 * Architecture:
 * - UI Store: Tracks dialog open/close state and chart ID
 * - Chart config is read from/written to Charts domain module
 * - Range selection uses RangeSelectionMode slice for collapsed inputs
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Series item for editing in the dialog.
 * Simplified version of SeriesConfig for UI purposes.
 */
export interface SelectDataSeries {
  /** Unique ID for the series (for tracking in UI) */
  id: string;
  /** Series name */
  name: string;
  /** Range string (e.g., "Sheet1!$A$2:$A$10") */
  range: string;
  /** Category (X-axis) range string (optional, can be shared) */
  categoryRange?: string;
}

/**
 * Hidden and empty cells options.
 */
export interface HiddenEmptyCellsOptions {
  /** How to handle empty cells: 'gaps', 'zero', 'connect' */
  emptyCells: 'gaps' | 'zero' | 'connect';
  /** Whether to show data in hidden rows and columns */
  showHiddenData: boolean;
}

/**
 * Select Data Dialog state.
 */
export interface SelectDataDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Chart ID being edited (null when closed) */
  chartId: string | null;
  /** Active sheet ID for the chart */
  sheetId: string | null;
  /** Current data range (entire chart data) */
  dataRange: string;
  /** List of series for editing */
  series: SelectDataSeries[];
  /** Series orientation: 'rows' or 'columns' */
  orientation: 'rows' | 'columns';
  /** Hidden and empty cells options */
  hiddenEmptyCells: HiddenEmptyCellsOptions;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface SelectDataDialogSlice {
  /** Select Data Dialog state */
  selectDataDialog: SelectDataDialogState;

  /**
   * Open the Select Data Dialog for a chart.
   *
   * @param chartId - ID of the chart to edit
   * @param sheetId - Sheet ID where the chart is located
   * @param config - Initial configuration from chart
   */
  openSelectDataDialog: (
    chartId: string,
    sheetId: string,
    config: {
      dataRange: string;
      series: SelectDataSeries[];
      orientation: 'rows' | 'columns';
      hiddenEmptyCells: HiddenEmptyCellsOptions;
    },
  ) => void;

  /**
   * Close the Select Data Dialog without applying changes.
   */
  closeSelectDataDialog: () => void;

  /**
   * Update the main data range.
   *
   * @param range - New data range string
   */
  setSelectDataRange: (range: string) => void;

  /**
   * Add a new series to the list.
   *
   * @param series - Series to add
   */
  addSelectDataSeries: (series: Omit<SelectDataSeries, 'id'>) => void;

  /**
   * Update an existing series.
   *
   * @param id - Series ID
   * @param updates - Partial updates to apply
   */
  updateSelectDataSeries: (id: string, updates: Partial<SelectDataSeries>) => void;

  /**
   * Remove a series from the list.
   *
   * @param id - Series ID to remove
   */
  removeSelectDataSeries: (id: string) => void;

  /**
   * Move a series up in the list.
   *
   * @param id - Series ID to move
   */
  moveSelectDataSeriesUp: (id: string) => void;

  /**
   * Move a series down in the list.
   *
   * @param id - Series ID to move
   */
  moveSelectDataSeriesDown: (id: string) => void;

  /**
   * Switch between row/column orientation.
   */
  toggleSelectDataOrientation: () => void;

  /**
   * Update hidden and empty cells options.
   *
   * @param options - Partial options to update
   */
  updateSelectDataHiddenEmptyCells: (options: Partial<HiddenEmptyCellsOptions>) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialSelectDataDialogState: SelectDataDialogState = {
  isOpen: false,
  chartId: null,
  sheetId: null,
  dataRange: '',
  series: [],
  orientation: 'columns',
  hiddenEmptyCells: {
    emptyCells: 'gaps',
    showHiddenData: false,
  },
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createSelectDataDialogSlice: StateCreator<
  SelectDataDialogSlice,
  [],
  [],
  SelectDataDialogSlice
> = (set, get) => ({
  selectDataDialog: initialSelectDataDialogState,

  openSelectDataDialog: (chartId, sheetId, config) => {
    set({
      selectDataDialog: {
        isOpen: true,
        chartId,
        sheetId,
        dataRange: config.dataRange,
        series: config.series,
        orientation: config.orientation,
        hiddenEmptyCells: config.hiddenEmptyCells,
      },
    });
  },

  closeSelectDataDialog: () => {
    set({
      selectDataDialog: initialSelectDataDialogState,
    });
  },

  setSelectDataRange: (range: string) => {
    const state = get().selectDataDialog;
    if (!state.isOpen) return;

    set({
      selectDataDialog: {
        ...state,
        dataRange: range,
      },
    });
  },

  addSelectDataSeries: (series) => {
    const state = get().selectDataDialog;
    if (!state.isOpen) return;

    const newSeries: SelectDataSeries = {
      ...series,
      id: `series-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    set({
      selectDataDialog: {
        ...state,
        series: [...state.series, newSeries],
      },
    });
  },

  updateSelectDataSeries: (id, updates) => {
    const state = get().selectDataDialog;
    if (!state.isOpen) return;

    set({
      selectDataDialog: {
        ...state,
        series: state.series.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      },
    });
  },

  removeSelectDataSeries: (id) => {
    const state = get().selectDataDialog;
    if (!state.isOpen) return;

    set({
      selectDataDialog: {
        ...state,
        series: state.series.filter((s) => s.id !== id),
      },
    });
  },

  moveSelectDataSeriesUp: (id) => {
    const state = get().selectDataDialog;
    if (!state.isOpen) return;

    const index = state.series.findIndex((s) => s.id === id);
    if (index <= 0) return; // Already at top or not found

    const newSeries = [...state.series];
    [newSeries[index - 1], newSeries[index]] = [newSeries[index], newSeries[index - 1]];

    set({
      selectDataDialog: {
        ...state,
        series: newSeries,
      },
    });
  },

  moveSelectDataSeriesDown: (id) => {
    const state = get().selectDataDialog;
    if (!state.isOpen) return;

    const index = state.series.findIndex((s) => s.id === id);
    if (index === -1 || index >= state.series.length - 1) return; // Already at bottom or not found

    const newSeries = [...state.series];
    [newSeries[index], newSeries[index + 1]] = [newSeries[index + 1], newSeries[index]];

    set({
      selectDataDialog: {
        ...state,
        series: newSeries,
      },
    });
  },

  toggleSelectDataOrientation: () => {
    const state = get().selectDataDialog;
    if (!state.isOpen) return;

    set({
      selectDataDialog: {
        ...state,
        orientation: state.orientation === 'rows' ? 'columns' : 'rows',
      },
    });
  },

  updateSelectDataHiddenEmptyCells: (options) => {
    const state = get().selectDataDialog;
    if (!state.isOpen) return;

    set({
      selectDataDialog: {
        ...state,
        hiddenEmptyCells: {
          ...state.hiddenEmptyCells,
          ...options,
        },
      },
    });
  },
});
