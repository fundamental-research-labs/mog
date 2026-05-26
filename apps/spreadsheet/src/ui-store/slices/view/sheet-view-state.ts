/**
 * Sheet View State Slice
 *
 * Manages per-sheet selection and scroll state for view persistence.
 * This enables Excel-like behavior where switching sheets preserves selection
 * and scroll position per sheet.
 *
 * ARCHITECTURE NOTES:
 * - Selection is EPHEMERAL UI state (session-local), NOT collaborative
 * - Stored in UI Store (Zustand), NOT Yjs
 * - Lost on page refresh (intentional - matches Excel behavior)
 * - NOT exported/imported with files
 * - Each user has their own selection state
 */

import type { StateCreator } from 'zustand';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Types
// =============================================================================

/**
 * Per-sheet view state that persists across sheet switches.
 *
 * Only includes PERSISTENT fields from SelectionContext:
 * - ranges: The selected ranges
 * - activeCell: The active cell within selection
 * - anchor: The anchor point for extending
 * - anchorCol: For column selection feature
 * - anchorRow: For row selection feature
 *
 * Does NOT include temporary fields like:
 * - formulaRangeColor (temporary during formula editing)
 * - fillHandleStart/End/sourceRange (temporary during fill)
 * - dragSourceRange/targetCell/Mode (temporary during drag)
 */
export interface SheetViewState {
  // Selection state (from SelectionContext persistent fields)
  ranges: CellRange[];
  activeCell: CellCoord;
  anchor: CellCoord | null;
  anchorCol: number | null;
  anchorRow: number | null;

  // Scroll position
  scrollTop: number;
  scrollLeft: number;
}

/**
 * Default view state for first visit to a sheet.
 */
export const DEFAULT_SHEET_VIEW_STATE: SheetViewState = {
  ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
  activeCell: { row: 0, col: 0 },
  anchor: null,
  anchorCol: null,
  anchorRow: null,
  scrollTop: 0,
  scrollLeft: 0,
};

// =============================================================================
// Slice Interface
// =============================================================================

export interface SheetViewStateSlice {
  /** Per-sheet view states, keyed by SheetId */
  sheetViewStates: Map<SheetId, SheetViewState>;

  /**
   * Save view state for a sheet.
   * Called before switching away from a sheet.
   */
  saveSheetViewState: (sheetId: SheetId, state: SheetViewState) => void;

  /**
   * Get view state for a sheet.
   * Returns undefined if sheet has never been visited.
   */
  getSheetViewState: (sheetId: SheetId) => SheetViewState | undefined;

  /**
   * Delete view state for a sheet.
   * Called when a sheet is deleted.
   */
  deleteSheetViewState: (sheetId: SheetId) => void;
}

// =============================================================================
// Slice Implementation
// =============================================================================

export const createSheetViewStateSlice: StateCreator<
  SheetViewStateSlice,
  [],
  [],
  SheetViewStateSlice
> = (set, get) => ({
  // Per-sheet view states
  sheetViewStates: new Map(),

  // Save view state for a sheet
  saveSheetViewState: (sheetId: SheetId, state: SheetViewState) => {
    set((s) => {
      const newMap = new Map(s.sheetViewStates);
      newMap.set(sheetId, state);
      return { sheetViewStates: newMap };
    });
  },

  // Get view state for a sheet
  getSheetViewState: (sheetId: SheetId) => {
    return get().sheetViewStates.get(sheetId);
  },

  // Delete view state for a sheet
  deleteSheetViewState: (sheetId: SheetId) => {
    set((s) => {
      const newMap = new Map(s.sheetViewStates);
      newMap.delete(sheetId);
      return { sheetViewStates: newMap };
    });
  },
});
