/**
 * Table Click Selection Slice
 *
 * Manages state for progressive table selection via clicks:
 * - Header click: First click selects column data, second includes header
 * - Corner click: First click selects table data, second includes headers/totals
 *
 * This enables Excel's "click-again-to-expand" behavior for table selections.
 *
 */

import type { StateCreator } from 'zustand';

/**
 * Click selection stages for table header clicks.
 * - 0: Column data only (no header, no total)
 * - 1: Column data + header
 * - 2: Full column (data + header + total if present)
 */
export type HeaderClickStage = 0 | 1 | 2;

/**
 * Click selection stages for table corner clicks.
 * - 0: Table data only (no header, no total row)
 * - 1: Full table (includes header and total row)
 */
export type CornerClickStage = 0 | 1;

/**
 * Table click selection state.
 */
export interface TableClickSelectionState {
  /**
   * Current header click stage.
   * null when not in header click selection mode.
   */
  headerClickStage: HeaderClickStage | null;

  /**
   * Table ID for the current header click selection.
   */
  headerClickTableId: string | null;

  /**
   * Column index for the current header click selection.
   */
  headerClickColumnIndex: number | null;

  /**
   * Timestamp of last header click (for double-click detection).
   */
  headerClickTimestamp: number | null;

  /**
   * Current corner click stage.
   * null when not in corner click selection mode.
   */
  cornerClickStage: CornerClickStage | null;

  /**
   * Table ID for the current corner click selection.
   */
  cornerClickTableId: string | null;

  /**
   * Timestamp of last corner click.
   */
  cornerClickTimestamp: number | null;
}

/**
 * Table click selection slice interface.
 */
export interface TableClickSelectionSlice extends TableClickSelectionState {
  /**
   * Handle header cell click.
   * Returns the new stage for selection expansion.
   *
   * @param tableId - Table ID
   * @param columnIndex - Column index (absolute)
   * @returns The stage to use for selection (0, 1, or 2)
   */
  handleHeaderClick: (tableId: string, columnIndex: number) => HeaderClickStage;

  /**
   * Handle corner click.
   * Returns the new stage for selection expansion.
   *
   * @param tableId - Table ID
   * @returns The stage to use for selection (0 or 1)
   */
  handleCornerClick: (tableId: string) => CornerClickStage;

  /**
   * Reset header click state.
   * Called when selection changes via other means.
   */
  resetHeaderClickState: () => void;

  /**
   * Reset corner click state.
   */
  resetCornerClickState: () => void;

  /**
   * Reset all table click selection state.
   */
  resetTableClickSelection: () => void;
}

/**
 * Initial state for table click selection.
 */
const initialState: TableClickSelectionState = {
  headerClickStage: null,
  headerClickTableId: null,
  headerClickColumnIndex: null,
  headerClickTimestamp: null,
  cornerClickStage: null,
  cornerClickTableId: null,
  cornerClickTimestamp: null,
};

/**
 * Time window for considering clicks as "same click" (ms).
 * If clicked again within this window, advance stage.
 */
const CLICK_WINDOW_MS = 1000;

/**
 * Create the table click selection slice.
 */
export const createTableClickSelectionSlice: StateCreator<
  TableClickSelectionSlice,
  [],
  [],
  TableClickSelectionSlice
> = (set, get) => ({
  // Initial state
  ...initialState,

  /**
   * Handle header cell click.
   * If clicking same column within window, advance stage.
   * Otherwise, start at stage 0.
   */
  handleHeaderClick: (tableId: string, columnIndex: number): HeaderClickStage => {
    const state = get();
    const now = Date.now();

    // Check if this is a repeat click on same column
    const isSameColumn =
      state.headerClickTableId === tableId && state.headerClickColumnIndex === columnIndex;

    const isWithinWindow =
      state.headerClickTimestamp !== null && now - state.headerClickTimestamp < CLICK_WINDOW_MS;

    let newStage: HeaderClickStage;

    if (isSameColumn && isWithinWindow && state.headerClickStage !== null) {
      // Advance to next stage (cycle: 0 -> 1 -> 2 -> 0)
      newStage = ((state.headerClickStage + 1) % 3) as HeaderClickStage;
    } else {
      // Start at stage 0
      newStage = 0;
    }

    set({
      headerClickStage: newStage,
      headerClickTableId: tableId,
      headerClickColumnIndex: columnIndex,
      headerClickTimestamp: now,
    });

    return newStage;
  },

  /**
   * Handle corner click.
   * If clicking same table corner within window, advance stage.
   * Otherwise, start at stage 0.
   */
  handleCornerClick: (tableId: string): CornerClickStage => {
    const state = get();
    const now = Date.now();

    // Check if this is a repeat click on same table corner
    const isSameTable = state.cornerClickTableId === tableId;

    const isWithinWindow =
      state.cornerClickTimestamp !== null && now - state.cornerClickTimestamp < CLICK_WINDOW_MS;

    let newStage: CornerClickStage;

    if (isSameTable && isWithinWindow && state.cornerClickStage !== null) {
      // Toggle between stages (0 -> 1 -> 0)
      newStage = state.cornerClickStage === 0 ? 1 : 0;
    } else {
      // Start at stage 0
      newStage = 0;
    }

    set({
      cornerClickStage: newStage,
      cornerClickTableId: tableId,
      cornerClickTimestamp: now,
    });

    return newStage;
  },

  /**
   * Reset header click state.
   */
  resetHeaderClickState: () => {
    set({
      headerClickStage: null,
      headerClickTableId: null,
      headerClickColumnIndex: null,
      headerClickTimestamp: null,
    });
  },

  /**
   * Reset corner click state.
   */
  resetCornerClickState: () => {
    set({
      cornerClickStage: null,
      cornerClickTableId: null,
      cornerClickTimestamp: null,
    });
  },

  /**
   * Reset all table click selection state.
   */
  resetTableClickSelection: () => {
    set(initialState);
  },
});
