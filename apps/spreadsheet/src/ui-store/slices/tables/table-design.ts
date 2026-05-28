/**
 * Table Design Slice
 *
 * Manages state for table design panel and insert table dialog
 *
 * Added tablePreviewRange for range preview in Create Table dialog.
 */

import type { StateCreator } from 'zustand';
import type { TableStylePreset } from '@mog-sdk/contracts/tables';

/**
 * Table Design panel state
 * Tracks the currently selected table for the Table Design ribbon tab.
 */
export interface TableDesignState {
  /** ID of the table the selection is in (null if not in a table) */
  selectedTableId: string | null;
}

/**
 * Preview range for Create Table dialog.
 * This range is highlighted on the sheet while the dialog is open.
 */
export interface TablePreviewRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface TableDesignSlice {
  tableDesign: TableDesignState;
  /** Whether the insert table dialog is open */
  insertTableDialogOpen: boolean;
  /** Range to preview while Create Table dialog is open */
  tablePreviewRange: TablePreviewRange | null;
  /**
   * Range pre-populated by the action handler (Excel current-region expansion).
   * Used by the dialog to seed its rangeInput on open, overriding the
   * selection-derived default. Cleared when the dialog closes.
   */
  insertTableInitialRange: TablePreviewRange | null;
  insertTableInitialHasHeaders: boolean;
  insertTableInitialStylePreset: TableStylePreset | null;
  setSelectedTable: (tableId: string | null) => void;
  /**
   * Open the Insert Table dialog. When `range` is provided (e.g., from the
   * INSERT_TABLE handler after Excel current-region expansion), the dialog
   * seeds its range input from that value and highlights it as the preview.
   */
  openInsertTableDialog: (payload: {
    range: TablePreviewRange;
    hasHeaders: boolean;
    stylePreset?: TableStylePreset;
  }) => void;
  closeInsertTableDialog: () => void;
  /** Update preview range as user edits in dialog */
  setTablePreviewRange: (range: TablePreviewRange | null) => void;
}

const initialTableDesign: TableDesignState = {
  selectedTableId: null,
};

export const createTableDesignSlice: StateCreator<TableDesignSlice, [], [], TableDesignSlice> = (
  set,
) => ({
  tableDesign: initialTableDesign,
  insertTableDialogOpen: false,
  tablePreviewRange: null,
  insertTableInitialRange: null,
  insertTableInitialHasHeaders: false,
  insertTableInitialStylePreset: null,

  setSelectedTable: (tableId: string | null) => {
    set({
      tableDesign: {
        selectedTableId: tableId,
      },
    });
  },

  openInsertTableDialog: (payload) => {
    set({
      insertTableDialogOpen: true,
      insertTableInitialRange: payload.range,
      insertTableInitialHasHeaders: payload.hasHeaders,
      insertTableInitialStylePreset: payload.stylePreset ?? null,
      tablePreviewRange: payload.range,
    });
  },

  closeInsertTableDialog: () => {
    // Clear preview range and any pre-seeded range when dialog closes
    set({
      insertTableDialogOpen: false,
      tablePreviewRange: null,
      insertTableInitialRange: null,
      insertTableInitialHasHeaders: false,
      insertTableInitialStylePreset: null,
    });
  },

  // Update preview range as user edits
  setTablePreviewRange: (range: TablePreviewRange | null) => {
    set({ tablePreviewRange: range });
  },
});
