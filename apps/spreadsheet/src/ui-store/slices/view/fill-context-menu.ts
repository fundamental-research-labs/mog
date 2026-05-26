/**
 * Fill Context Menu Slice
 *
 * Right-Click Drag Fill Context Menu
 *
 * Manages state for the fill context menu shown when user right-click drags the fill handle.
 * When user releases right-click after dragging the fill handle, a context menu appears
 * with fill options like:
 * - Copy Cells
 * - Fill Series
 * - Fill Formatting Only
 * - Fill Without Formatting
 * - Fill Days (if date detected)
 * - Fill Weekdays (if date detected)
 * - Fill Months (if date detected)
 * - Fill Years (if date detected)
 * - Linear Trend (for numeric data)
 * - Growth Trend (for numeric data)
 *
 */

import type { StateCreator } from 'zustand';

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import type { CellRange } from '@mog-sdk/contracts/core';

import type { FillDirection } from '@mog-sdk/contracts/fill';

// =============================================================================
// Types
// =============================================================================

/**
 * Fill option type for the context menu.
 * Maps to EXECUTE_FILL_* action types.
 */
export type FillOptionType =
  | 'copy_cells'
  | 'fill_series'
  | 'formatting_only'
  | 'without_formatting'
  | 'fill_days'
  | 'fill_weekdays'
  | 'fill_months'
  | 'fill_years'
  | 'linear_trend'
  | 'growth_trend';

/**
 * Fill context menu state
 */
export interface FillContextMenuState {
  /** Whether the menu is open */
  isOpen: boolean;
  /** Menu position (screen coordinates) */
  position: { x: number; y: number } | null;
  /** Source range for the fill (captured at drag start) */
  sourceRange: CellRange | null;
  /** Target range corners using stable CellIds */
  targetCorners: { topLeft: CellId; bottomRight: CellId } | null;
  /** Fill direction determined from drag */
  direction: FillDirection | null;
  /** Whether the source contains date values (shows date-specific options) */
  hasDateValues: boolean;
  /** Monotonically increasing counter to force React remount on each open */
  instanceId: number;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface FillContextMenuSlice {
  /** Fill context menu state */
  fillContextMenu: FillContextMenuState;

  /**
   * Show the fill context menu at a specific position.
   * Called by coordinator after right-drag fill handle release.
   */
  showFillContextMenu: (params: {
    position: { x: number; y: number };
    sourceRange: CellRange;
    targetCorners: { topLeft: CellId; bottomRight: CellId };
    direction: FillDirection;
    hasDateValues: boolean;
  }) => void;

  /** Hide/close the fill context menu */
  hideFillContextMenu: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialFillContextMenuState: FillContextMenuState = {
  isOpen: false,
  position: null,
  sourceRange: null,
  targetCorners: null,
  direction: null,
  hasDateValues: false,
  instanceId: 0,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createFillContextMenuSlice: StateCreator<
  FillContextMenuSlice,
  [],
  [],
  FillContextMenuSlice
> = (set) => ({
  fillContextMenu: initialFillContextMenuState,

  showFillContextMenu: ({ position, sourceRange, targetCorners, direction, hasDateValues }) => {
    set((prev) => ({
      fillContextMenu: {
        isOpen: true,
        position,
        sourceRange,
        targetCorners,
        direction,
        hasDateValues,
        instanceId: prev.fillContextMenu.instanceId + 1,
      },
    }));
  },

  hideFillContextMenu: () => {
    set({
      fillContextMenu: initialFillContextMenuState,
    });
  },
});
