/**
 * Scenario Manager Dialog Slice
 *
 * Scenarios: Scenario Manager
 *
 * Manages state for the Scenario Manager dialog, which allows users to:
 * - Create, edit, and delete scenarios
 * - Apply scenarios to see what-if values
 * - Restore original values
 *
 * The dialog uses CellId internally for stable references, but displays
 * A1 notation to users (converted at the component level).
 *
 */

import type { StateCreator } from 'zustand';

import type { Scenario } from '@mog-sdk/contracts/api';
import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { CellValue, SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Mode for the scenario editor within the dialog.
 */
export type ScenarioEditorMode = 'view' | 'add' | 'edit';

/**
 * A changing cell entry for the scenario editor.
 * Used during editing to track cells and their values.
 */
export interface EditingChangingCell {
  /** Cell ID (stable reference) */
  cellId: CellId;
  /** Sheet ID containing the cell */
  sheetId: SheetId;
  /** Display reference (A1 notation) for user */
  displayRef: string;
  /** Value for this scenario */
  value: CellValue;
}

/**
 * Original value entry saved before applying a scenario.
 */
export interface OriginalValueEntry {
  sheetId: SheetId;
  cellId: CellId;
  value: CellValue;
  /** Original formula, if the cell had one (preserved for restore). */
  formula?: string;
}

/**
 * Scenario Manager dialog state.
 */
export interface ScenarioManagerDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;

  /** Currently selected scenario ID (for viewing/editing) */
  selectedScenarioId: string | null;

  /** Current mode of the dialog */
  mode: ScenarioEditorMode;

  // -------------------------------------------------------------------------
  // Editing state (for add/edit mode)
  // -------------------------------------------------------------------------

  /** Name being edited */
  editingName: string;

  /** Comment being edited */
  editingComment: string;

  /** Changing cells being edited */
  editingChangingCells: EditingChangingCell[];

  /** Reference to the scenario being edited (null for new) */
  editingScenarioId: string | null;

  // -------------------------------------------------------------------------
  // Active scenario tracking
  // -------------------------------------------------------------------------

  /**
   * Original values before a scenario was applied.
   * These are preserved for the "Restore" action.
   * Using Map<string, OriginalValueEntry> where key is `${sheetId}:${cellId}`.
   */
  originalValuesBeforeScenario: Map<string, OriginalValueEntry>;

  /**
   * ID of the currently shown scenario (values applied to sheet).
   * null means showing original values.
   */
  activelyShownScenarioId: string | null;

  // -------------------------------------------------------------------------
  // Validation state
  // -------------------------------------------------------------------------

  /** Validation error messages, keyed by field */
  validationErrors: Map<string, string>;

  /** Whether the dialog is currently processing an operation */
  isProcessing: boolean;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface ScenarioManagerDialogSlice {
  /** Scenario Manager dialog state */
  scenarioManagerDialog: ScenarioManagerDialogState;

  // -------------------------------------------------------------------------
  // Dialog open/close
  // -------------------------------------------------------------------------

  /** Open the Scenario Manager dialog */
  openScenarioManagerDialog: () => void;

  /** Close the Scenario Manager dialog */
  closeScenarioManagerDialog: () => void;

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /** Select a scenario in the list */
  selectScenario: (scenarioId: string | null) => void;

  // -------------------------------------------------------------------------
  // Mode switching
  // -------------------------------------------------------------------------

  /** Enter add mode to create a new scenario */
  startAddingScenario: () => void;

  /** Enter edit mode for the selected scenario */
  startEditingScenario: (scenario: Scenario) => void;

  /** Cancel add/edit and return to view mode */
  cancelEditingScenario: () => void;

  // -------------------------------------------------------------------------
  // Editing actions
  // -------------------------------------------------------------------------

  /** Update the name being edited */
  setEditingName: (name: string) => void;

  /** Update the comment being edited */
  setEditingComment: (comment: string) => void;

  /** Add a changing cell to the editor */
  addEditingChangingCell: (cell: EditingChangingCell) => void;

  /** Remove a changing cell from the editor by index */
  removeEditingChangingCell: (index: number) => void;

  /** Update a changing cell's value */
  updateEditingChangingCellValue: (index: number, value: CellValue) => void;

  /** Set all changing cells at once (for bulk operations) */
  setEditingChangingCells: (cells: EditingChangingCell[]) => void;

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /** Set a validation error */
  setValidationError: (field: string, message: string) => void;

  /** Clear a validation error */
  clearValidationError: (field: string) => void;

  /** Clear all validation errors */
  clearAllValidationErrors: () => void;

  // -------------------------------------------------------------------------
  // Active scenario tracking
  // -------------------------------------------------------------------------

  /** Store original values before applying a scenario */
  storeOriginalValues: (values: Map<string, OriginalValueEntry>) => void;

  /** Set the actively shown scenario ID */
  setActivelyShownScenarioId: (scenarioId: string | null) => void;

  /** Clear stored original values (after restore) */
  clearOriginalValues: () => void;

  // -------------------------------------------------------------------------
  // Processing state
  // -------------------------------------------------------------------------

  /** Set processing state */
  setProcessing: (isProcessing: boolean) => void;

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  /** Reset the entire dialog state (for cleanup) */
  resetScenarioManagerDialog: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialScenarioManagerDialogState: ScenarioManagerDialogState = {
  isOpen: false,
  selectedScenarioId: null,
  mode: 'view',
  editingName: '',
  editingComment: '',
  editingChangingCells: [],
  editingScenarioId: null,
  originalValuesBeforeScenario: new Map(),
  activelyShownScenarioId: null,
  validationErrors: new Map(),
  isProcessing: false,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createScenarioManagerDialogSlice: StateCreator<
  ScenarioManagerDialogSlice,
  [],
  [],
  ScenarioManagerDialogSlice
> = (set, _get) => ({
  scenarioManagerDialog: initialScenarioManagerDialogState,

  // -------------------------------------------------------------------------
  // Dialog open/close
  // -------------------------------------------------------------------------

  openScenarioManagerDialog: () => {
    set({
      scenarioManagerDialog: {
        ...initialScenarioManagerDialogState,
        isOpen: true,
      },
    });
  },

  closeScenarioManagerDialog: () => {
    set((state) => ({
      scenarioManagerDialog: {
        ...initialScenarioManagerDialogState,
        // Preserve original values and active scenario (don't lose applied state)
        originalValuesBeforeScenario: state.scenarioManagerDialog.originalValuesBeforeScenario,
        activelyShownScenarioId: state.scenarioManagerDialog.activelyShownScenarioId,
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  selectScenario: (scenarioId) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        selectedScenarioId: scenarioId,
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Mode switching
  // -------------------------------------------------------------------------

  startAddingScenario: () => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        mode: 'add',
        editingName: '',
        editingComment: '',
        editingChangingCells: [],
        editingScenarioId: null,
        validationErrors: new Map(),
      },
    }));
  },

  startEditingScenario: (scenario) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        mode: 'edit',
        editingName: scenario.name,
        editingComment: scenario.comment ?? '',
        // Note: changingCells need to be converted to EditingChangingCell by the component
        editingChangingCells: [],
        editingScenarioId: scenario.id,
        validationErrors: new Map(),
      },
    }));
  },

  cancelEditingScenario: () => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        mode: 'view',
        editingName: '',
        editingComment: '',
        editingChangingCells: [],
        editingScenarioId: null,
        validationErrors: new Map(),
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Editing actions
  // -------------------------------------------------------------------------

  setEditingName: (name) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        editingName: name,
      },
    }));
  },

  setEditingComment: (comment) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        editingComment: comment,
      },
    }));
  },

  addEditingChangingCell: (cell) => {
    set((state) => {
      // Check if cell already exists
      const exists = state.scenarioManagerDialog.editingChangingCells.some(
        (c) => c.cellId === cell.cellId,
      );
      if (exists) {
        return state; // Don't add duplicates
      }

      return {
        scenarioManagerDialog: {
          ...state.scenarioManagerDialog,
          editingChangingCells: [...state.scenarioManagerDialog.editingChangingCells, cell],
        },
      };
    });
  },

  removeEditingChangingCell: (index) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        editingChangingCells: state.scenarioManagerDialog.editingChangingCells.filter(
          (_, i) => i !== index,
        ),
      },
    }));
  },

  updateEditingChangingCellValue: (index, value) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        editingChangingCells: state.scenarioManagerDialog.editingChangingCells.map((cell, i) =>
          i === index ? { ...cell, value } : cell,
        ),
      },
    }));
  },

  setEditingChangingCells: (cells) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        editingChangingCells: cells,
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  setValidationError: (field, message) => {
    set((state) => {
      const newErrors = new Map(state.scenarioManagerDialog.validationErrors);
      newErrors.set(field, message);
      return {
        scenarioManagerDialog: {
          ...state.scenarioManagerDialog,
          validationErrors: newErrors,
        },
      };
    });
  },

  clearValidationError: (field) => {
    set((state) => {
      const newErrors = new Map(state.scenarioManagerDialog.validationErrors);
      newErrors.delete(field);
      return {
        scenarioManagerDialog: {
          ...state.scenarioManagerDialog,
          validationErrors: newErrors,
        },
      };
    });
  },

  clearAllValidationErrors: () => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        validationErrors: new Map(),
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Active scenario tracking
  // -------------------------------------------------------------------------

  storeOriginalValues: (values) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        originalValuesBeforeScenario: values,
      },
    }));
  },

  setActivelyShownScenarioId: (scenarioId) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        activelyShownScenarioId: scenarioId,
      },
    }));
  },

  clearOriginalValues: () => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        originalValuesBeforeScenario: new Map(),
        activelyShownScenarioId: null,
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Processing state
  // -------------------------------------------------------------------------

  setProcessing: (isProcessing) => {
    set((state) => ({
      scenarioManagerDialog: {
        ...state.scenarioManagerDialog,
        isProcessing,
      },
    }));
  },

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  resetScenarioManagerDialog: () => {
    set({
      scenarioManagerDialog: initialScenarioManagerDialogState,
    });
  },
});
