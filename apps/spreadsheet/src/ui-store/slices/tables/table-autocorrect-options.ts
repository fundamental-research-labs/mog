/**
 * Table AutoCorrect Options Slice
 *
 * Manages the AutoCorrect Options floating button state for:
 * 1. Calculated Column Auto-Fill
 * 2. Table Auto-Expansion
 *
 * Excel shows a lightning bolt AutoCorrect Options button after:
 * - A calculated column formula is auto-filled to other rows
 * - A table auto-expands to include adjacent data
 *
 * The button provides options like "Undo", "Stop Auto-Expanding", "Overwrite All Cells", etc.
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Type of AutoCorrect operation that triggered the button
 */
export type TableAutoCorrectType =
  | 'calculated-column' // Calculated column formula was auto-filled
  | 'table-expansion'; // Table auto-expanded to include adjacent data

/**
 * Option types for calculated column AutoCorrect
 */
export type CalculatedColumnOption =
  | 'undo' // Undo the auto-fill
  | 'stop-auto-creating' // Stop automatically creating calculated columns
  | 'overwrite-all'; // Overwrite all cells in the column (when mixed content detected)

/**
 * Option types for table auto-expansion AutoCorrect
 */
export type TableExpansionOption =
  | 'undo' // Undo the auto-expansion
  | 'stop-auto-expanding'; // Stop auto-expanding tables

/**
 * Information about the last calculated column auto-fill
 */
export interface CalculatedColumnInfo {
  /** Table ID */
  tableId: string;
  /** Table name (for display) */
  tableName: string;
  /** Column index within table */
  columnIndex: number;
  /** Column name (for display) */
  columnName: string;
  /** The formula that was auto-filled */
  formula: string;
  /** Number of cells that were filled */
  cellsFilled: number;
  /** Sheet ID where the operation occurred */
  sheetId: string;
  /** Whether mixed content was detected (enables "Overwrite All" option) */
  hasMixedContent: boolean;
  /** Row where the formula was originally entered */
  sourceRow: number;
  /** Column where the formula was originally entered */
  sourceCol: number;
}

/**
 * Information about the last table auto-expansion
 */
export interface TableExpansionInfo {
  /** Table ID */
  tableId: string;
  /** Table name (for display) */
  tableName: string;
  /** Direction of expansion */
  direction: 'bottom' | 'right';
  /** Sheet ID where the operation occurred */
  sheetId: string;
  /** The cell that triggered the expansion */
  triggerCell: { row: number; col: number };
}

/**
 * Position for the AutoCorrect button
 */
export interface AutoCorrectButtonPosition {
  /** Row index (cell coordinates) */
  row: number;
  /** Column index (cell coordinates) */
  col: number;
}

/**
 * Table AutoCorrect Options state
 */
export interface TableAutoCorrectOptionsState {
  /** Whether the button is visible */
  isVisible: boolean;
  /** Type of operation */
  type: TableAutoCorrectType | null;
  /** Position of the button (cell coordinates) */
  position: AutoCorrectButtonPosition | null;
  /** Sheet ID where the operation occurred */
  sheetId: string | null;
  /** Calculated column info (when type is 'calculated-column') */
  calculatedColumnInfo: CalculatedColumnInfo | null;
  /** Table expansion info (when type is 'table-expansion') */
  tableExpansionInfo: TableExpansionInfo | null;
  /** Whether the dropdown menu is open */
  isMenuOpen: boolean;
}

/**
 * Table AutoCorrect Options Slice interface
 */
export interface TableAutoCorrectOptionsSlice {
  tableAutoCorrectOptions: TableAutoCorrectOptionsState;

  /**
   * Show the AutoCorrect Options button for calculated column auto-fill.
   * Called after a calculated column formula is auto-filled.
   */
  showCalculatedColumnAutoCorrect: (info: CalculatedColumnInfo) => void;

  /**
   * Show the AutoCorrect Options button for table auto-expansion.
   * Called after a table auto-expands.
   */
  showTableExpansionAutoCorrect: (info: TableExpansionInfo) => void;

  /**
   * Hide the AutoCorrect Options button.
   */
  hideTableAutoCorrectOptions: () => void;

  /**
   * Open the dropdown menu.
   */
  openTableAutoCorrectMenu: () => void;

  /**
   * Close the dropdown menu.
   */
  closeTableAutoCorrectMenu: () => void;
}

// =============================================================================
// Default State
// =============================================================================

/**
 * Default state
 */
const DEFAULT_TABLE_AUTOCORRECT_OPTIONS: TableAutoCorrectOptionsState = {
  isVisible: false,
  type: null,
  position: null,
  sheetId: null,
  calculatedColumnInfo: null,
  tableExpansionInfo: null,
  isMenuOpen: false,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the table AutoCorrect options slice
 */
export const createTableAutoCorrectOptionsSlice: StateCreator<
  TableAutoCorrectOptionsSlice,
  [],
  [],
  TableAutoCorrectOptionsSlice
> = (set) => ({
  tableAutoCorrectOptions: DEFAULT_TABLE_AUTOCORRECT_OPTIONS,

  showCalculatedColumnAutoCorrect: (info: CalculatedColumnInfo) => {
    // Position at the source cell where formula was entered
    const position: AutoCorrectButtonPosition = {
      row: info.sourceRow,
      col: info.sourceCol,
    };

    set({
      tableAutoCorrectOptions: {
        isVisible: true,
        type: 'calculated-column',
        position,
        sheetId: info.sheetId,
        calculatedColumnInfo: info,
        tableExpansionInfo: null,
        isMenuOpen: false,
      },
    });
  },

  showTableExpansionAutoCorrect: (info: TableExpansionInfo) => {
    // Position at the trigger cell
    const position: AutoCorrectButtonPosition = {
      row: info.triggerCell.row,
      col: info.triggerCell.col,
    };

    set({
      tableAutoCorrectOptions: {
        isVisible: true,
        type: 'table-expansion',
        position,
        sheetId: info.sheetId,
        calculatedColumnInfo: null,
        tableExpansionInfo: info,
        isMenuOpen: false,
      },
    });
  },

  hideTableAutoCorrectOptions: () => {
    set({ tableAutoCorrectOptions: DEFAULT_TABLE_AUTOCORRECT_OPTIONS });
  },

  openTableAutoCorrectMenu: () => {
    set((state) => ({
      tableAutoCorrectOptions: {
        ...state.tableAutoCorrectOptions,
        isMenuOpen: true,
      },
    }));
  },

  closeTableAutoCorrectMenu: () => {
    set((state) => ({
      tableAutoCorrectOptions: {
        ...state.tableAutoCorrectOptions,
        isMenuOpen: false,
      },
    }));
  },
});
