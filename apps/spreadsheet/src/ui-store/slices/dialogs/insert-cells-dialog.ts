/**
 * Insert Cells Dialog Slice
 *
 * Manages state for the Insert Cells dialog.
 * Excel shows this dialog when inserting cells (not entire rows/cols)
 * to ask whether to shift existing cells right or down.
 *
 * This is also used for Delete Cells (shift left/up).
 */

import type { StateCreator } from 'zustand';

import type { CellRange } from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Direction to shift existing cells when inserting/deleting.
 */
export type ShiftDirection = 'right' | 'down' | 'left' | 'up';

/**
 * Dialog mode: insert or delete cells.
 */
export type InsertDeleteMode = 'insert' | 'delete';

/**
 * Insert/Delete Cells dialog state.
 */
export interface InsertCellsDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Mode: insert or delete cells */
  mode: InsertDeleteMode;
  /** The range of cells to insert/delete at */
  range: CellRange | null;
  /** Selected shift direction */
  direction: ShiftDirection;
  /** Session memory - last used insert direction */
  lastInsertDirection: 'right' | 'down';
  /** Session memory - last used delete direction */
  lastDeleteDirection: 'left' | 'up';
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface InsertCellsDialogSlice {
  /** Insert/Delete Cells dialog state */
  insertCellsDialog: InsertCellsDialogState;

  /**
   * Open the insert cells dialog.
   * @param range - The range where cells will be inserted
   * @param defaultDirection - Default shift direction (defaults to 'down')
   */
  openInsertCellsDialog: (range: CellRange, defaultDirection?: ShiftDirection) => void;

  /**
   * Open the delete cells dialog.
   * @param range - The range to delete
   * @param defaultDirection - Default shift direction (defaults to 'up')
   */
  openDeleteCellsDialog: (range: CellRange, defaultDirection?: ShiftDirection) => void;

  /** Close the dialog */
  closeInsertCellsDialog: () => void;

  /** Update the selected shift direction */
  setInsertCellsDirection: (direction: ShiftDirection) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialInsertCellsDialogState: InsertCellsDialogState = {
  isOpen: false,
  mode: 'insert',
  range: null,
  direction: 'down',
  // Session memory defaults
  lastInsertDirection: 'down',
  lastDeleteDirection: 'up',
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createInsertCellsDialogSlice: StateCreator<
  InsertCellsDialogSlice,
  [],
  [],
  InsertCellsDialogSlice
> = (set, get) => ({
  insertCellsDialog: initialInsertCellsDialogState,

  openInsertCellsDialog: (range: CellRange, defaultDirection?: ShiftDirection) => {
    // Use session memory - remember last used insert direction
    const currentState = get().insertCellsDialog;
    const direction = defaultDirection ?? currentState.lastInsertDirection;
    set({
      insertCellsDialog: {
        ...currentState,
        isOpen: true,
        mode: 'insert',
        range,
        direction,
      },
    });
  },

  openDeleteCellsDialog: (range: CellRange, defaultDirection?: ShiftDirection) => {
    // Use session memory - remember last used delete direction
    const currentState = get().insertCellsDialog;
    let direction: ShiftDirection;
    if (defaultDirection !== undefined) {
      // Validate that delete direction is left or up
      direction =
        defaultDirection === 'down' || defaultDirection === 'right' ? 'up' : defaultDirection;
    } else {
      direction = currentState.lastDeleteDirection;
    }
    set({
      insertCellsDialog: {
        ...currentState,
        isOpen: true,
        mode: 'delete',
        range,
        direction,
      },
    });
  },

  closeInsertCellsDialog: () => {
    // Preserve the last used directions when closing
    const currentState = get().insertCellsDialog;
    const newState: InsertCellsDialogState = {
      ...initialInsertCellsDialogState,
      lastInsertDirection: currentState.lastInsertDirection,
      lastDeleteDirection: currentState.lastDeleteDirection,
    };

    // Update the last used direction based on what was selected
    if (currentState.mode === 'insert') {
      if (currentState.direction === 'right' || currentState.direction === 'down') {
        newState.lastInsertDirection = currentState.direction;
      }
    } else {
      if (currentState.direction === 'left' || currentState.direction === 'up') {
        newState.lastDeleteDirection = currentState.direction;
      }
    }

    set({ insertCellsDialog: newState });
  },

  setInsertCellsDirection: (direction: ShiftDirection) => {
    set((state) => ({
      insertCellsDialog: {
        ...state.insertCellsDialog,
        direction,
      },
    }));
  },
});
