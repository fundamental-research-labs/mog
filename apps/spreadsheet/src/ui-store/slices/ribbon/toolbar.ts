/**
 * Toolbar Slice
 *
 * Stores toolbar format state for granular subscriptions.
 * This replaces the ToolbarContext's selectionFormat with Zustand state
 * that supports selectors, eliminating re-render cascades.
 *
 * State is populated by toolbar-format-coordination.ts which subscribes to:
 * 1. cell:format-changed EventBus event
 * 2. UIStore.activeSheetId (Zustand subscription)
 * 3. SelectionActor (XState subscription)
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 9 (UIStore), Section 14 (Render Isolation)
 */

import type { StateCreator } from 'zustand';

import type { CellFormat, CellRange } from '@mog-sdk/contracts/core';

export interface ToolbarSlice {
  // ===========================================================================
  // State
  // ===========================================================================

  /**
   * Format state for the active cell.
   * Updated by toolbar-format-coordination when:
   * - Active cell changes (selection)
   * - Cell format changes (EventBus)
   * - Sheet switches (UIStore subscription)
   */
  activeCellFormat: CellFormat | null;

  /**
   * Selection ranges for toolbar operations.
   * Updated by toolbar-format-coordination when selection changes.
   * Normalized (startRow <= endRow, startCol <= endCol).
   */
  toolbarRanges: CellRange[];

  // ===========================================================================
  // Setters (called by coordinator, not React components)
  // ===========================================================================

  /** Set the active cell format. Called by toolbar-format-coordination. */
  setActiveCellFormat: (format: CellFormat | null) => void;

  /** Set the toolbar ranges. Called by toolbar-format-coordination. */
  setToolbarRanges: (ranges: CellRange[]) => void;
}

export const createToolbarSlice: StateCreator<ToolbarSlice, [], [], ToolbarSlice> = (set) => ({
  // Initial state
  activeCellFormat: null,
  toolbarRanges: [],

  // Setters
  setActiveCellFormat: (format) => set({ activeCellFormat: format }),
  setToolbarRanges: (ranges) => set({ toolbarRanges: ranges }),
});
