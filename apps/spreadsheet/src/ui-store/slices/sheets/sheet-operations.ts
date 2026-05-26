/**
 * Sheet Operations UI Store Slice
 *
 * Manages pending sheet operation data for:
 * - Move Sheet: stores sourceSheetId and beforeSheetId before dispatch
 * - Copy Sheet: stores sourceSheetId, beforeSheetId, and newName before dispatch
 * - Protect Sheet: stores pending sheetId before opening protection dialog
 *
 * This pattern ensures action handlers can read operation data from UIStore
 * instead of receiving it via payload parameters (which the Unified Action System doesn't support).
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

export interface SheetOperationsSlice {
  // Move Sheet pending operation
  pendingMoveSheet: { sourceSheetId: string; beforeSheetId: string | null } | null;
  setPendingMoveSheet: (data: { sourceSheetId: string; beforeSheetId: string | null }) => void;
  clearPendingMoveSheet: () => void;

  // Copy Sheet pending operation
  pendingCopySheet: {
    sourceSheetId: string;
    beforeSheetId: string | null;
    newName: string;
  } | null;
  setPendingCopySheet: (data: {
    sourceSheetId: string;
    beforeSheetId: string | null;
    newName: string;
  }) => void;
  clearPendingCopySheet: () => void;

  // Protect Sheet pending sheetId
  pendingProtectSheetId: string | null;
  setPendingProtectSheetId: (sheetId: string) => void;
  clearPendingProtectSheetId: () => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createSheetOperationsSlice: StateCreator<
  SheetOperationsSlice,
  [],
  [],
  SheetOperationsSlice
> = (set) => ({
  // Move Sheet
  pendingMoveSheet: null,

  setPendingMoveSheet: (data) => {
    set({ pendingMoveSheet: data });
  },

  clearPendingMoveSheet: () => {
    set({ pendingMoveSheet: null });
  },

  // Copy Sheet
  pendingCopySheet: null,

  setPendingCopySheet: (data) => {
    set({ pendingCopySheet: data });
  },

  clearPendingCopySheet: () => {
    set({ pendingCopySheet: null });
  },

  // Protect Sheet
  pendingProtectSheetId: null,

  setPendingProtectSheetId: (sheetId) => {
    set({ pendingProtectSheetId: sheetId });
  },

  clearPendingProtectSheetId: () => {
    set({ pendingProtectSheetId: null });
  },
});
