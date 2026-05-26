/**
 * Table Progressive Selection Slice (Tables - Item 10.3)
 *
 * Manages progressive table column selection state for Ctrl+Space behavior:
 * - Stage 0: Select column data only (excludes header and total)
 * - Stage 1: Select column data + header
 * - Stage 2: Select full column (data + header + total)
 *
 * Each press of Ctrl+Space cycles to the next stage.
 * Releasing and pressing again continues the cycle.
 *
 */

import type { StateCreator } from 'zustand';

/**
 * Progressive selection stages for table columns.
 * Matches Excel behavior for Ctrl+Space in table context.
 */
export type ProgressiveSelectionStage = 0 | 1 | 2;

/**
 * Table progressive selection state.
 */
export interface TableProgressiveSelectionState {
  /**
   * Current selection stage (0, 1, or 2).
   * null when not in progressive selection mode.
   */
  stage: ProgressiveSelectionStage | null;

  /**
   * Table ID for the current progressive selection.
   * null when not in progressive selection mode.
   */
  tableId: string | null;

  /**
   * Column index (absolute) for the current progressive selection.
   * null when not in progressive selection mode.
   */
  columnIndex: number | null;
}

/**
 * Table progressive selection slice interface.
 */
export interface TableProgressiveSelectionSlice extends TableProgressiveSelectionState {
  /**
   * Start progressive selection for a table column.
   * Called when Ctrl+Space is pressed in a table cell.
   *
   * @param tableId - Table ID
   * @param columnIndex - Absolute column index
   */
  startProgressiveSelection: (tableId: string, columnIndex: number) => void;

  /**
   * Advance to the next progressive selection stage.
   * Called when Ctrl+Space is pressed again.
   * Cycles: 0 -> 1 -> 2 -> 0
   */
  advanceProgressiveSelection: () => void;

  /**
   * Reset progressive selection state.
   * Called when selection changes or Escape is pressed.
   */
  resetProgressiveSelection: () => void;
}

/**
 * Initial state for table progressive selection.
 */
const initialState: TableProgressiveSelectionState = {
  stage: null,
  tableId: null,
  columnIndex: null,
};

/**
 * Create the table progressive selection slice.
 */
export const createTableProgressiveSelectionSlice: StateCreator<
  TableProgressiveSelectionSlice,
  [],
  [],
  TableProgressiveSelectionSlice
> = (set) => ({
  // Initial state
  ...initialState,

  // Start progressive selection
  startProgressiveSelection: (tableId: string, columnIndex: number) => {
    set({
      stage: 0, // Always start at stage 0 (column data only)
      tableId,
      columnIndex,
    });
  },

  // Advance to next stage
  advanceProgressiveSelection: () => {
    set((state) => {
      if (state.stage === null) return state;

      // Cycle through stages: 0 -> 1 -> 2 -> 0
      const nextStage = ((state.stage + 1) % 3) as ProgressiveSelectionStage;
      return {
        ...state,
        stage: nextStage,
      };
    });
  },

  // Reset progressive selection
  resetProgressiveSelection: () => {
    set(initialState);
  },
});

/**
 * Selector: Check if progressive selection is active.
 */
export function selectIsProgressiveSelectionActive(state: TableProgressiveSelectionSlice): boolean {
  return state.stage !== null;
}

/**
 * Selector: Get current progressive selection info.
 */
export function selectProgressiveSelectionInfo(
  state: TableProgressiveSelectionSlice,
): { stage: ProgressiveSelectionStage; tableId: string; columnIndex: number } | null {
  if (state.stage === null || state.tableId === null || state.columnIndex === null) {
    return null;
  }
  return {
    stage: state.stage,
    tableId: state.tableId,
    columnIndex: state.columnIndex,
  };
}
