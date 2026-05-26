/**
 * Table Dialogs Slice
 *
 * Manages state for table-related dialogs:
 * - Custom Table Style Editor
 * - Resize Table Dialog
 * - Convert to Range Confirmation Dialog
 *
 * Architecture Compliance:
 * - UI Store Patterns: Slices for ephemeral dialog state
 * - Each dialog has open/close actions
 * - State is per-dialog, not shared
 */

import type { StateCreator } from 'zustand';

import type { CellFormat } from '@mog-sdk/contracts/core';

// =============================================================================
// Custom Table Style Types
// =============================================================================

/**
 * Stripe pattern configuration for rows or columns.
 * Excel supports stripe sizes of 1-9 alternating rows/columns.
 */
export interface StripePattern {
  /** Number of rows/columns per stripe (1-9, default 1) */
  stripeSize: number;
  /** Fill color for stripe 1 */
  stripe1Fill?: string;
  /** Fill color for stripe 2 */
  stripe2Fill?: string;
  /** Font formatting for stripe 1 */
  stripe1Font?: Partial<CellFormat>;
  /** Font formatting for stripe 2 */
  stripe2Font?: Partial<CellFormat>;
}

/**
 * Element formatting for table style elements (header, total, first/last column).
 */
export interface TableElementStyle {
  /** Fill (background) color */
  fill?: string;
  /** Font formatting */
  font?: Partial<CellFormat>;
  /** Border style for top */
  borderTop?: string;
  /** Border style for bottom */
  borderBottom?: string;
  /** Border style for left */
  borderLeft?: string;
  /** Border style for right */
  borderRight?: string;
}

/**
 * Complete custom table style definition for the dialog.
 * Used when editing/creating a custom table style.
 */
export interface CustomTableStyleDefinition {
  /** Unique ID (generated on create, present when modifying) */
  id?: string;
  /** User-defined name for the style */
  name: string;
  /** Base style to derive from (for quick setup) */
  baseStyleId?: string;
  /** Header row formatting */
  headerRow: TableElementStyle;
  /** Total row formatting */
  totalRow: TableElementStyle;
  /** First column formatting */
  firstColumn: TableElementStyle;
  /** Last column formatting */
  lastColumn: TableElementStyle;
  /** Row stripe pattern */
  rowStripes: StripePattern;
  /** Column stripe pattern */
  columnStripes: StripePattern;
  /** Whole table default styling */
  wholeTable: TableElementStyle;
}

/**
 * Available tabs in the table style dialog.
 * Maps to Excel's "New Table Style" dialog sections.
 */
export type TableStyleDialogTab =
  | 'name'
  | 'wholeTable'
  | 'headerRow'
  | 'totalRow'
  | 'firstColumn'
  | 'lastColumn'
  | 'rowStripes'
  | 'columnStripes';

/**
 * Dialog mode - creating new, modifying existing, or duplicating.
 */
export type TableStyleDialogMode = 'create' | 'modify' | 'duplicate';

// =============================================================================
// Custom Table Style Dialog State
// =============================================================================

/**
 * Custom table style dialog state.
 * Used for creating/editing/duplicating custom table styles.
 */
export interface CustomTableStyleDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current dialog mode */
  mode: TableStyleDialogMode;
  /** Currently selected tab */
  activeTab: TableStyleDialogTab;
  /** Table ID for context (optional - when opened from Table Design tab) */
  tableId: string | null;
  /** Base style ID to start from (optional - for duplicating styles) */
  baseStyleId: string | null;
  /** Original style ID when modifying existing style */
  originalStyleId: string | null;
  /** Style being edited */
  editingStyle: CustomTableStyleDefinition | null;
  /** Preview enabled in the dialog */
  previewEnabled: boolean;
}

// =============================================================================
// Resize Table Dialog State
// =============================================================================

/**
 * Resize table dialog state.
 * Used for resizing table boundaries.
 */
export interface ResizeTableDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Table ID being resized */
  tableId: string | null;
}

// =============================================================================
// Convert to Range Dialog State
// =============================================================================

/**
 * Convert to range confirmation dialog state.
 * Used to confirm converting a table back to a regular range.
 */
export interface ConvertToRangeDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Table ID to convert */
  tableId: string | null;
}

// =============================================================================
// Slice Definition
// =============================================================================

export interface TableDialogsSlice {
  /** Custom table style dialog state */
  customTableStyleDialog: CustomTableStyleDialogState;

  /** Resize table dialog state */
  resizeTableDialog: ResizeTableDialogState;

  /** Convert to range dialog state */
  convertToRangeDialog: ConvertToRangeDialogState;

  /**
   * Open custom table style dialog for creating a new style.
   *
   * @param tableId - Optional table ID for context
   * @param baseStyleId - Optional base style to start from
   */
  openCustomTableStyleDialog: (tableId?: string, baseStyleId?: string) => void;

  /**
   * Open custom table style dialog for modifying an existing style.
   *
   * @param styleId - The style ID to modify
   * @param styleData - The style data to edit (loaded from tables domain)
   */
  openModifyTableStyleDialog: (styleId: string, styleData?: CustomTableStyleDefinition) => void;

  /**
   * Open custom table style dialog for duplicating an existing style.
   *
   * @param styleId - The style ID to duplicate
   * @param styleData - The style data to duplicate (loaded from tables domain)
   */
  openDuplicateTableStyleDialog: (styleId: string, styleData?: CustomTableStyleDefinition) => void;

  /** Close custom table style dialog */
  closeCustomTableStyleDialog: () => void;

  /** Set the active tab in the custom table style dialog */
  setTableStyleDialogTab: (tab: TableStyleDialogTab) => void;

  /** Update the style being edited */
  updateEditingStyle: (updates: Partial<CustomTableStyleDefinition>) => void;

  /** Update header row style */
  updateHeaderRowStyle: (style: Partial<TableElementStyle>) => void;

  /** Update total row style */
  updateTotalRowStyle: (style: Partial<TableElementStyle>) => void;

  /** Update first column style */
  updateFirstColumnStyle: (style: Partial<TableElementStyle>) => void;

  /** Update last column style */
  updateLastColumnStyle: (style: Partial<TableElementStyle>) => void;

  /** Update row stripe pattern */
  updateRowStripes: (stripes: Partial<StripePattern>) => void;

  /** Update column stripe pattern */
  updateColumnStripes: (stripes: Partial<StripePattern>) => void;

  /** Update whole table style */
  updateWholeTableStyle: (style: Partial<TableElementStyle>) => void;

  /** Toggle preview in the dialog */
  toggleTableStylePreview: () => void;

  /**
   * Open resize table dialog.
   *
   * @param tableId - The table to resize
   */
  openResizeTableDialog: (tableId: string) => void;

  /** Close resize table dialog */
  closeResizeTableDialog: () => void;

  /**
   * Open convert to range confirmation dialog.
   *
   * @param tableId - The table to convert
   */
  openConvertToRangeDialog: (tableId: string) => void;

  /** Close convert to range dialog */
  closeConvertToRangeDialog: () => void;
}

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default stripe pattern configuration.
 */
const DEFAULT_STRIPE_PATTERN: StripePattern = {
  stripeSize: 1,
  stripe1Fill: undefined,
  stripe2Fill: undefined,
  stripe1Font: undefined,
  stripe2Font: undefined,
};

/**
 * Default element style.
 */
const DEFAULT_ELEMENT_STYLE: TableElementStyle = {
  fill: undefined,
  font: undefined,
  borderTop: undefined,
  borderBottom: undefined,
  borderLeft: undefined,
  borderRight: undefined,
};

/**
 * Default style definition for new styles.
 */
const DEFAULT_STYLE_DEFINITION: CustomTableStyleDefinition = {
  name: 'Custom Table Style',
  headerRow: { ...DEFAULT_ELEMENT_STYLE },
  totalRow: { ...DEFAULT_ELEMENT_STYLE },
  firstColumn: { ...DEFAULT_ELEMENT_STYLE },
  lastColumn: { ...DEFAULT_ELEMENT_STYLE },
  rowStripes: { ...DEFAULT_STRIPE_PATTERN },
  columnStripes: { ...DEFAULT_STRIPE_PATTERN },
  wholeTable: { ...DEFAULT_ELEMENT_STYLE },
};

// =============================================================================
// Initial States
// =============================================================================

const INITIAL_CUSTOM_TABLE_STYLE_DIALOG_STATE: CustomTableStyleDialogState = {
  isOpen: false,
  mode: 'create',
  activeTab: 'name',
  tableId: null,
  baseStyleId: null,
  originalStyleId: null,
  editingStyle: null,
  previewEnabled: true,
};

const INITIAL_RESIZE_TABLE_DIALOG_STATE: ResizeTableDialogState = {
  isOpen: false,
  tableId: null,
};

const INITIAL_CONVERT_TO_RANGE_DIALOG_STATE: ConvertToRangeDialogState = {
  isOpen: false,
  tableId: null,
};

// =============================================================================
// Slice Factory
// =============================================================================

export const createTableDialogsSlice: StateCreator<TableDialogsSlice, [], [], TableDialogsSlice> = (
  set,
) => ({
  // Initial states
  customTableStyleDialog: INITIAL_CUSTOM_TABLE_STYLE_DIALOG_STATE,
  resizeTableDialog: INITIAL_RESIZE_TABLE_DIALOG_STATE,
  convertToRangeDialog: INITIAL_CONVERT_TO_RANGE_DIALOG_STATE,

  // ==========================================================================
  // Custom Table Style Dialog Actions
  // ==========================================================================

  openCustomTableStyleDialog: (tableId?: string, baseStyleId?: string) => {
    set({
      customTableStyleDialog: {
        isOpen: true,
        mode: 'create',
        activeTab: 'name',
        tableId: tableId ?? null,
        baseStyleId: baseStyleId ?? null,
        originalStyleId: null,
        editingStyle: {
          ...DEFAULT_STYLE_DEFINITION,
          baseStyleId,
        },
        previewEnabled: true,
      },
    });
  },

  openModifyTableStyleDialog: (styleId: string, styleData?: CustomTableStyleDefinition) => {
    set({
      customTableStyleDialog: {
        isOpen: true,
        mode: 'modify',
        activeTab: 'name',
        tableId: null,
        baseStyleId: null,
        originalStyleId: styleId,
        editingStyle: styleData ?? { ...DEFAULT_STYLE_DEFINITION, id: styleId },
        previewEnabled: true,
      },
    });
  },

  openDuplicateTableStyleDialog: (styleId: string, styleData?: CustomTableStyleDefinition) => {
    const baseName = styleData?.name ?? 'Custom Table Style';
    set({
      customTableStyleDialog: {
        isOpen: true,
        mode: 'duplicate',
        activeTab: 'name',
        tableId: null,
        baseStyleId: styleId,
        originalStyleId: null,
        editingStyle: styleData
          ? { ...styleData, id: undefined, name: `Copy of ${baseName}` }
          : { ...DEFAULT_STYLE_DEFINITION, name: `Copy of ${baseName}` },
        previewEnabled: true,
      },
    });
  },

  closeCustomTableStyleDialog: () => {
    set({ customTableStyleDialog: INITIAL_CUSTOM_TABLE_STYLE_DIALOG_STATE });
  },

  setTableStyleDialogTab: (tab: TableStyleDialogTab) => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        activeTab: tab,
      },
    }));
  },

  updateEditingStyle: (updates: Partial<CustomTableStyleDefinition>) => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        editingStyle: state.customTableStyleDialog.editingStyle
          ? { ...state.customTableStyleDialog.editingStyle, ...updates }
          : null,
      },
    }));
  },

  updateHeaderRowStyle: (style: Partial<TableElementStyle>) => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        editingStyle: state.customTableStyleDialog.editingStyle
          ? {
              ...state.customTableStyleDialog.editingStyle,
              headerRow: { ...state.customTableStyleDialog.editingStyle.headerRow, ...style },
            }
          : null,
      },
    }));
  },

  updateTotalRowStyle: (style: Partial<TableElementStyle>) => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        editingStyle: state.customTableStyleDialog.editingStyle
          ? {
              ...state.customTableStyleDialog.editingStyle,
              totalRow: { ...state.customTableStyleDialog.editingStyle.totalRow, ...style },
            }
          : null,
      },
    }));
  },

  updateFirstColumnStyle: (style: Partial<TableElementStyle>) => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        editingStyle: state.customTableStyleDialog.editingStyle
          ? {
              ...state.customTableStyleDialog.editingStyle,
              firstColumn: { ...state.customTableStyleDialog.editingStyle.firstColumn, ...style },
            }
          : null,
      },
    }));
  },

  updateLastColumnStyle: (style: Partial<TableElementStyle>) => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        editingStyle: state.customTableStyleDialog.editingStyle
          ? {
              ...state.customTableStyleDialog.editingStyle,
              lastColumn: { ...state.customTableStyleDialog.editingStyle.lastColumn, ...style },
            }
          : null,
      },
    }));
  },

  updateRowStripes: (stripes: Partial<StripePattern>) => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        editingStyle: state.customTableStyleDialog.editingStyle
          ? {
              ...state.customTableStyleDialog.editingStyle,
              rowStripes: { ...state.customTableStyleDialog.editingStyle.rowStripes, ...stripes },
            }
          : null,
      },
    }));
  },

  updateColumnStripes: (stripes: Partial<StripePattern>) => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        editingStyle: state.customTableStyleDialog.editingStyle
          ? {
              ...state.customTableStyleDialog.editingStyle,
              columnStripes: {
                ...state.customTableStyleDialog.editingStyle.columnStripes,
                ...stripes,
              },
            }
          : null,
      },
    }));
  },

  updateWholeTableStyle: (style: Partial<TableElementStyle>) => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        editingStyle: state.customTableStyleDialog.editingStyle
          ? {
              ...state.customTableStyleDialog.editingStyle,
              wholeTable: { ...state.customTableStyleDialog.editingStyle.wholeTable, ...style },
            }
          : null,
      },
    }));
  },

  toggleTableStylePreview: () => {
    set((state) => ({
      customTableStyleDialog: {
        ...state.customTableStyleDialog,
        previewEnabled: !state.customTableStyleDialog.previewEnabled,
      },
    }));
  },

  // ==========================================================================
  // Resize Table Dialog Actions
  // ==========================================================================

  openResizeTableDialog: (tableId: string) => {
    set({
      resizeTableDialog: {
        isOpen: true,
        tableId,
      },
    });
  },

  closeResizeTableDialog: () => {
    set({ resizeTableDialog: INITIAL_RESIZE_TABLE_DIALOG_STATE });
  },

  // ==========================================================================
  // Convert to Range Dialog Actions
  // ==========================================================================

  openConvertToRangeDialog: (tableId: string) => {
    set({
      convertToRangeDialog: {
        isOpen: true,
        tableId,
      },
    });
  },

  closeConvertToRangeDialog: () => {
    set({ convertToRangeDialog: INITIAL_CONVERT_TO_RANGE_DIALOG_STATE });
  },
});
