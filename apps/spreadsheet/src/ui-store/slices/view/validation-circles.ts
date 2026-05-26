/**
 * Validation Circles Slice
 *
 * Manages validation circles visibility state.
 * Used to toggle the display of red dashed ovals around cells with invalid data.
 *
 * F1: Circle Invalid Data (Excel parity quickwin)
 *
 * This is ephemeral UI state (not persisted) - circles disappear when the user
 * closes the spreadsheet or hides them.
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Slice State Interface
// =============================================================================

/**
 * Represents a cell position for validation circle tracking.
 * Used for auto-clearing circles when cells become valid.
 */
export interface ValidationCircleCell {
  row: number;
  col: number;
}

export interface ValidationCirclesSliceState {
  /**
   * Whether validation circles are currently displayed.
   * When true, cells with validation errors show a red dashed oval.
   */
  validationCirclesVisible: boolean;

  /**
   * Set of cells that have validation circles displayed.
   * Key format: "sheetId:row:col" for efficient lookup and removal.
   * Used to track which specific cells have circles so they can be auto-cleared
   * when the cell data becomes valid.
   */
  validationCircleCells: Set<string>;
}

// =============================================================================
// Slice Actions Interface
// =============================================================================

export interface ValidationCirclesSliceActions {
  /**
   * Show validation circles on all cells with invalid data.
   */
  showValidationCircles: () => void;

  /**
   * Hide all validation circles.
   */
  hideValidationCircles: () => void;

  /**
   * Toggle validation circles visibility.
   */
  toggleValidationCircles: () => void;

  /**
   * Add a cell to the validation circles set.
   * Called when a cell fails validation.
   * @param sheetId The sheet containing the cell
   * @param row The row index of the cell
   * @param col The column index of the cell
   */
  addValidationCircle: (sheetId: string, row: number, col: number) => void;

  /**
   * Remove a cell from the validation circles set.
   * Called when a cell becomes valid (passes validation).
   * @param sheetId The sheet containing the cell
   * @param row The row index of the cell
   * @param col The column index of the cell
   */
  removeValidationCircle: (sheetId: string, row: number, col: number) => void;

  /**
   * Add multiple cells to the validation circles set.
   * Batch operation for efficiency when validating multiple cells.
   * @param sheetId The sheet containing the cells
   * @param cells Array of cell coordinates to add
   */
  addValidationCircles: (sheetId: string, cells: ValidationCircleCell[]) => void;

  /**
   * Check if a cell has a validation circle.
   * @param sheetId The sheet containing the cell
   * @param row The row index of the cell
   * @param col The column index of the cell
   * @returns True if the cell has a validation circle displayed
   */
  hasValidationCircle: (sheetId: string, row: number, col: number) => boolean;

  /**
   * Clear all validation circles for a sheet.
   * @param sheetId The sheet to clear circles from
   */
  clearValidationCirclesForSheet: (sheetId: string) => void;

  /**
   * Clear every validation circle across all sheets.
   * Used by the ribbon "Clear Validation Circles" toggle-off path —
   * the visible flag is toggled off AND the cell set must drain so the
   * overlay layer has nothing to draw.
   */
  clearAllValidationCircles: () => void;
}

// =============================================================================
// Combined Slice Type
// =============================================================================

export type ValidationCirclesSlice = ValidationCirclesSliceState & ValidationCirclesSliceActions;

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Helper to create a unique key for a cell.
 */
function makeCellKey(sheetId: string, row: number, col: number): string {
  return `${sheetId}:${row}:${col}`;
}

export const createValidationCirclesSlice: StateCreator<
  ValidationCirclesSlice,
  [],
  [],
  ValidationCirclesSlice
> = (set, get) => ({
  // Initial state - circles are hidden by default
  validationCirclesVisible: false,
  validationCircleCells: new Set<string>(),

  // Show validation circles
  showValidationCircles: () => {
    set({ validationCirclesVisible: true });
  },

  // Hide validation circles
  hideValidationCircles: () => {
    set({ validationCirclesVisible: false });
  },

  // Toggle validation circles
  toggleValidationCircles: () => {
    set((state) => ({ validationCirclesVisible: !state.validationCirclesVisible }));
  },

  // Add a cell to the validation circles set
  addValidationCircle: (sheetId: string, row: number, col: number) => {
    const key = makeCellKey(sheetId, row, col);
    set((state) => {
      const newSet = new Set(state.validationCircleCells);
      newSet.add(key);
      return { validationCircleCells: newSet };
    });
  },

  // Remove a cell from the validation circles set
  removeValidationCircle: (sheetId: string, row: number, col: number) => {
    const key = makeCellKey(sheetId, row, col);
    set((state) => {
      if (!state.validationCircleCells.has(key)) {
        return state; // No change needed
      }
      const newSet = new Set(state.validationCircleCells);
      newSet.delete(key);
      return { validationCircleCells: newSet };
    });
  },

  // Add multiple cells to the validation circles set
  addValidationCircles: (sheetId: string, cells: ValidationCircleCell[]) => {
    if (cells.length === 0) return;
    set((state) => {
      const newSet = new Set(state.validationCircleCells);
      for (const cell of cells) {
        newSet.add(makeCellKey(sheetId, cell.row, cell.col));
      }
      return { validationCircleCells: newSet };
    });
  },

  // Check if a cell has a validation circle
  hasValidationCircle: (sheetId: string, row: number, col: number) => {
    const key = makeCellKey(sheetId, row, col);
    return get().validationCircleCells.has(key);
  },

  // Clear all validation circles for a sheet
  clearValidationCirclesForSheet: (sheetId: string) => {
    set((state) => {
      const prefix = `${sheetId}:`;
      const newSet = new Set<string>();
      for (const key of state.validationCircleCells) {
        if (!key.startsWith(prefix)) {
          newSet.add(key);
        }
      }
      return { validationCircleCells: newSet };
    });
  },

  // Clear every validation circle across all sheets
  clearAllValidationCircles: () => {
    set((state) => {
      if (state.validationCircleCells.size === 0) return state;
      return { validationCircleCells: new Set<string>() };
    });
  },
});

// =============================================================================
// Selectors
// =============================================================================

/**
 * Check if validation circles are visible.
 */
export function selectShowValidationCircles(state: ValidationCirclesSliceState): boolean {
  return state.validationCirclesVisible;
}

/**
 * Get all validation circle cells for a specific sheet.
 * @param state The slice state
 * @param sheetId The sheet ID to filter by
 * @returns Array of cell coordinates that have validation circles
 */
export function selectValidationCircleCellsForSheet(
  state: ValidationCirclesSliceState,
  sheetId: string,
): ValidationCircleCell[] {
  const prefix = `${sheetId}:`;
  const cells: ValidationCircleCell[] = [];

  for (const key of state.validationCircleCells) {
    if (key.startsWith(prefix)) {
      const parts = key.split(':');
      if (parts.length === 3) {
        cells.push({
          row: parseInt(parts[1], 10),
          col: parseInt(parts[2], 10),
        });
      }
    }
  }

  return cells;
}
