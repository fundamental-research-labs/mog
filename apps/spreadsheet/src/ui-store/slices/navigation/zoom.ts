/**
 * Zoom Slice
 *
 * Manages per-sheet zoom levels.
 */

import type { StateCreator } from 'zustand';

import type { SheetId } from '@mog-sdk/contracts/core';

export interface ZoomSlice {
  zoomLevels: Record<SheetId, number>;
  setZoomLevel: (sheetId: SheetId, level: number) => void;
}

export const createZoomSlice: StateCreator<ZoomSlice, [], [], ZoomSlice> = (set) => ({
  // Zoom levels per sheet (default to 100%)
  zoomLevels: {},

  // Pure setter - business logic in zoom-utils.ts
  setZoomLevel: (sheetId: SheetId, level: number) => {
    set((s) => ({
      zoomLevels: {
        ...s.zoomLevels,
        [sheetId]: level,
      },
    }));
  },
});
