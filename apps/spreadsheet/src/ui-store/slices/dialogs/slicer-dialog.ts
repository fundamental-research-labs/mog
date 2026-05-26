/**
 * Slicer Dialog Slice
 *
 * Slicers Implementation
 *
 * Manages state for:
 * - Insert Slicer dialog (ES.12)
 * - Slicer Settings panel (ES.13)
 *
 */

import type { StateCreator } from 'zustand';

import type { SlicerStylePreset } from '@mog-sdk/contracts/slicers';

// =============================================================================
// Types
// =============================================================================

/**
 * Column option for the Insert Slicer dialog.
 * Each option represents a table column that can have a slicer.
 */
export interface SlicerColumnOption {
  /** Column header cell ID */
  columnCellId: string;
  /** Column name (header text) */
  columnName: string;
  /** Whether a slicer already exists for this column */
  hasExistingSlicer: boolean;
}

/**
 * Insert Slicer dialog state.
 */
export interface InsertSlicerDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Source type: table or pivot */
  sourceType: 'table' | 'pivot';
  /** Table ID (when sourceType is 'table') */
  tableId: string | null;
  /** Pivot ID (when sourceType is 'pivot') */
  pivotId: string | null;
  /** Available columns/fields to create slicers for */
  columns: SlicerColumnOption[];
  /** Selected column cell IDs to create slicers for */
  selectedColumns: string[];
}

/**
 * Pivot field option for the Insert Slicer dialog.
 */
export interface SlicerPivotFieldOption {
  /** Field name */
  fieldName: string;
  /** Field area in the pivot (row, column, filter) */
  fieldArea: 'row' | 'column' | 'filter';
  /** Whether a slicer already exists for this field */
  hasExistingSlicer: boolean;
}

/**
 * Slicer Settings panel state.
 */
export interface SlicerSettingsPanelState {
  /** Whether the panel is open */
  isOpen: boolean;
  /** ID of the slicer being edited */
  slicerId: string | null;
  /** Current slicer caption */
  caption: string;
  /** Current style preset */
  stylePreset: SlicerStylePreset;
  /** Number of columns in item grid */
  columnCount: number;
  /** Button height in pixels */
  buttonHeight: number;
  /** Show header */
  showHeader: boolean;
  /** Show selection indicators */
  showSelectionIndicator: boolean;
  /** Cross-filter mode */
  crossFilter: 'none' | 'showItemsWithDataAtTop' | 'showItemsWithNoData';
  /** Sort order */
  sortOrder: 'ascending' | 'descending' | 'dataSourceOrder';
}

// =============================================================================
// Slice
// =============================================================================

export interface SlicerDialogSlice {
  /** Insert Slicer dialog state */
  insertSlicerDialog: InsertSlicerDialogState;
  /** Slicer Settings panel state */
  slicerSettingsPanel: SlicerSettingsPanelState;

  // Insert Slicer Dialog actions
  openInsertSlicerDialog: (
    sourceType: 'table' | 'pivot',
    sourceId: string,
    columns: SlicerColumnOption[],
  ) => void;
  closeInsertSlicerDialog: () => void;
  toggleSlicerColumn: (columnCellId: string) => void;
  selectAllSlicerColumns: () => void;
  deselectAllSlicerColumns: () => void;

  // Slicer Settings Panel actions
  openSlicerSettingsPanel: (
    slicerId: string,
    settings: Omit<SlicerSettingsPanelState, 'isOpen' | 'slicerId'>,
  ) => void;
  closeSlicerSettingsPanel: () => void;
  updateSlicerSettings: (
    updates: Partial<Omit<SlicerSettingsPanelState, 'isOpen' | 'slicerId'>>,
  ) => void;
}

const initialInsertSlicerDialog: InsertSlicerDialogState = {
  isOpen: false,
  sourceType: 'table',
  tableId: null,
  pivotId: null,
  columns: [],
  selectedColumns: [],
};

const initialSlicerSettingsPanel: SlicerSettingsPanelState = {
  isOpen: false,
  slicerId: null,
  caption: '',
  stylePreset: 'light1',
  columnCount: 1,
  buttonHeight: 24,
  showHeader: true,
  showSelectionIndicator: true,
  crossFilter: 'showItemsWithDataAtTop',
  sortOrder: 'ascending',
};

export const createSlicerDialogSlice: StateCreator<SlicerDialogSlice, [], [], SlicerDialogSlice> = (
  set,
) => ({
  insertSlicerDialog: initialInsertSlicerDialog,
  slicerSettingsPanel: initialSlicerSettingsPanel,

  // Insert Slicer Dialog actions
  openInsertSlicerDialog: (sourceType, sourceId, columns) => {
    set({
      insertSlicerDialog: {
        isOpen: true,
        sourceType,
        tableId: sourceType === 'table' ? sourceId : null,
        pivotId: sourceType === 'pivot' ? sourceId : null,
        columns,
        // Pre-select columns that don't have existing slicers
        selectedColumns: columns
          .filter((col) => !col.hasExistingSlicer)
          .map((col) => col.columnCellId),
      },
    });
  },

  closeInsertSlicerDialog: () => {
    set({ insertSlicerDialog: initialInsertSlicerDialog });
  },

  toggleSlicerColumn: (columnCellId) => {
    set((state) => {
      const { selectedColumns } = state.insertSlicerDialog;
      const isSelected = selectedColumns.includes(columnCellId);

      return {
        insertSlicerDialog: {
          ...state.insertSlicerDialog,
          selectedColumns: isSelected
            ? selectedColumns.filter((id) => id !== columnCellId)
            : [...selectedColumns, columnCellId],
        },
      };
    });
  },

  selectAllSlicerColumns: () => {
    set((state) => ({
      insertSlicerDialog: {
        ...state.insertSlicerDialog,
        selectedColumns: state.insertSlicerDialog.columns.map((col) => col.columnCellId),
      },
    }));
  },

  deselectAllSlicerColumns: () => {
    set((state) => ({
      insertSlicerDialog: {
        ...state.insertSlicerDialog,
        selectedColumns: [],
      },
    }));
  },

  // Slicer Settings Panel actions
  openSlicerSettingsPanel: (slicerId, settings) => {
    set({
      slicerSettingsPanel: {
        isOpen: true,
        slicerId,
        ...settings,
      },
    });
  },

  closeSlicerSettingsPanel: () => {
    set({ slicerSettingsPanel: initialSlicerSettingsPanel });
  },

  updateSlicerSettings: (updates) => {
    set((state) => ({
      slicerSettingsPanel: {
        ...state.slicerSettingsPanel,
        ...updates,
      },
    }));
  },
});
