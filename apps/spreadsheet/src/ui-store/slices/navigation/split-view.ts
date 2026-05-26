/**
 * Split View Slice
 *
 * Manages session-local split view state including:
 * - Per-viewport scroll positions (each split pane can scroll independently)
 * - Focused viewport tracking (which pane has keyboard/scroll focus)
 *
 * IMPORTANT: Split configuration (direction, positions) is stored in SheetMeta (Yjs)
 * and is collaborative. This slice only manages session-local state that is NOT
 * shared between collaborators.
 *
 */

import type { StateCreator } from 'zustand';

import type { SheetId } from '@mog-sdk/contracts/core';
import type { Point } from '@mog-sdk/contracts/viewport';

/**
 * Viewport ID for split view panes.
 * - 'main' for single viewport
 * - 'top', 'bottom' for horizontal split
 * - 'left', 'right' for vertical split
 * - 'topLeft', 'topRight', 'bottomLeft', 'bottomRight' for both
 */
export type SplitViewportId =
  | 'main'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

/**
 * Split view state slice.
 *
 * Session-local state (not collaborative):
 * - splitScrollPositions: Independent scroll positions for each viewport
 * - focusedViewportId: Which viewport currently has focus (per-sheet)
 */
export interface SplitViewSlice {
  /**
   * Per-sheet, per-viewport scroll positions.
   * Structure: Record<SheetId, Record<ViewportId, Point>>
   *
   * Example:
   * {
   * 'sheet1': {
   * 'topLeft': { x: 0, y: 0 },
   * 'topRight': { x: 100, y: 0 },
   * 'bottomLeft': { x: 0, y: 200 },
   * 'bottomRight': { x: 100, y: 200 }
   * }
   * }
   */
  splitScrollPositions: Record<SheetId, Record<string, Point>>;

  /**
   * Focused viewport ID per sheet.
   * Defaults to 'main' for single viewport, or the first split viewport.
   */
  focusedViewportId: Record<SheetId, string>;

  /**
   * Set the scroll position for a specific viewport in a specific sheet.
   */
  setSplitScrollPosition: (sheetId: SheetId, viewportId: string, position: Point) => void;

  /**
   * Get the scroll position for a specific viewport.
   * Returns { x: 0, y: 0 } if not found.
   */
  getSplitScrollPosition: (sheetId: SheetId, viewportId: string) => Point;

  /**
   * Set the focused viewport for a sheet.
   */
  setFocusedViewport: (sheetId: SheetId, viewportId: string) => void;

  /**
   * Get the focused viewport for a sheet.
   * Returns 'main' if not found.
   */
  getFocusedViewport: (sheetId: SheetId) => string;

  /**
   * Initialize scroll positions for all viewports when split is created.
   * All viewports start at the same position (usually the current scroll position).
   */
  initializeSplitScrollPositions: (
    sheetId: SheetId,
    viewportIds: string[],
    initialPosition: Point,
  ) => void;

  /**
   * Clear scroll positions for a sheet when split is removed.
   * Optionally preserves the focused viewport's position for the main viewport.
   */
  clearSplitScrollPositions: (sheetId: SheetId) => void;

  /**
   * Clean up all split state for a sheet when the sheet is deleted.
   */
  cleanupSheetSplitState: (sheetId: SheetId) => void;
}

/**
 * Create the split view slice for UIStore.
 */
export const createSplitViewSlice: StateCreator<SplitViewSlice, [], [], SplitViewSlice> = (
  set,
  get,
) => ({
  splitScrollPositions: {},
  focusedViewportId: {},

  setSplitScrollPosition: (sheetId: SheetId, viewportId: string, position: Point) => {
    set((state) => ({
      splitScrollPositions: {
        ...state.splitScrollPositions,
        [sheetId]: {
          ...state.splitScrollPositions[sheetId],
          [viewportId]: position,
        },
      },
    }));
  },

  getSplitScrollPosition: (sheetId: SheetId, viewportId: string): Point => {
    const sheetPositions = get().splitScrollPositions[sheetId];
    if (!sheetPositions) {
      return { x: 0, y: 0 };
    }
    return sheetPositions[viewportId] ?? { x: 0, y: 0 };
  },

  setFocusedViewport: (sheetId: SheetId, viewportId: string) => {
    set((state) => ({
      focusedViewportId: {
        ...state.focusedViewportId,
        [sheetId]: viewportId,
      },
    }));
  },

  getFocusedViewport: (sheetId: SheetId): string => {
    return get().focusedViewportId[sheetId] ?? 'main';
  },

  initializeSplitScrollPositions: (
    sheetId: SheetId,
    viewportIds: string[],
    initialPosition: Point,
  ) => {
    set((state) => {
      const newPositions: Record<string, Point> = {};
      for (const id of viewportIds) {
        newPositions[id] = { ...initialPosition };
      }
      return {
        splitScrollPositions: {
          ...state.splitScrollPositions,
          [sheetId]: newPositions,
        },
        // Set focus to first viewport
        focusedViewportId: {
          ...state.focusedViewportId,
          [sheetId]: viewportIds[0] ?? 'main',
        },
      };
    });
  },

  clearSplitScrollPositions: (sheetId: SheetId) => {
    const state = get();
    const focusedId = state.focusedViewportId[sheetId];
    const sheetPositions = state.splitScrollPositions[sheetId];

    // Preserve the focused viewport's position for 'main'
    const preservedPosition = sheetPositions?.[focusedId] ?? { x: 0, y: 0 };

    set((s) => {
      const newSplitScrollPositions = { ...s.splitScrollPositions };
      // Set only 'main' viewport position
      newSplitScrollPositions[sheetId] = { main: preservedPosition };

      const newFocusedViewportId = { ...s.focusedViewportId };
      newFocusedViewportId[sheetId] = 'main';

      return {
        splitScrollPositions: newSplitScrollPositions,
        focusedViewportId: newFocusedViewportId,
      };
    });
  },

  cleanupSheetSplitState: (sheetId: SheetId) => {
    set((state) => {
      const newSplitScrollPositions = { ...state.splitScrollPositions };
      delete newSplitScrollPositions[sheetId];

      const newFocusedViewportId = { ...state.focusedViewportId };
      delete newFocusedViewportId[sheetId];

      return {
        splitScrollPositions: newSplitScrollPositions,
        focusedViewportId: newFocusedViewportId,
      };
    });
  },
});
