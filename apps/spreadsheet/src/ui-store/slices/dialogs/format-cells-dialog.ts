/**
 * Format Cells Dialog UI Store Slice
 *
 * Manages pending format changes for the Format Cells dialog.
 * The dialog accumulates user edits in local state, then stores them here
 * before dispatching actions to apply the changes via the Mutations layer.
 *
 * This pattern ensures:
 * - All changes are applied atomically on Apply/OK
 * - No partial updates during user interaction
 * - Single source of truth for pending changes
 *
 */

import type { BorderPresetMode, CellBorders, CellFormat } from '@mog-sdk/contracts/core';
import type { StateCreator } from 'zustand';

// Re-export for existing import paths.
export type { BorderPresetMode };

export interface FormatCellsDialogSlice {
  // Pending format changes for Number tab (set by dialog, read by handler)
  pendingNumberFormat: string | null;
  setPendingNumberFormat: (format: string) => void;
  clearPendingNumberFormat: () => void;

  // Pending format changes for Alignment tab (set by dialog, read by handler)
  pendingAlignmentFormat: Partial<CellFormat> | null;
  setPendingAlignmentFormat: (format: Partial<CellFormat>) => void;
  clearPendingAlignmentFormat: () => void;

  // Pending format changes for Border tab (set by dialog, read by handler)
  pendingBorderFormat: CellBorders | null;
  setPendingBorderFormat: (borders: CellBorders | null) => void;
  clearPendingBorderFormat: () => void;

  // Border preset mode (for 'inside' preset which requires positional logic)
  pendingBorderPreset: BorderPresetMode;
  setPendingBorderPreset: (preset: BorderPresetMode) => void;
  clearPendingBorderPreset: () => void;

  // Pending format changes for Fill tab (set by dialog, read by handler)
  pendingFillFormat: Partial<CellFormat> | null;
  setPendingFillFormat: (format: Partial<CellFormat>) => void;
  clearPendingFillFormat: () => void;

  // Pending format changes for Font tab (set by dialog, read by handler)
  pendingFontFormat: Partial<CellFormat> | null;
  setPendingFontFormat: (format: Partial<CellFormat>) => void;
  clearPendingFontFormat: () => void;

  // Pending format changes for Protection tab (set by dialog, read by handler)
  pendingProtectionFormat: Partial<CellFormat> | null;
  setPendingProtectionFormat: (format: Partial<CellFormat>) => void;
  clearPendingProtectionFormat: () => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createFormatCellsDialogSlice: StateCreator<
  FormatCellsDialogSlice,
  [],
  [],
  FormatCellsDialogSlice
> = (set) => ({
  // Number tab pending format
  pendingNumberFormat: null,

  setPendingNumberFormat: (format) => {
    set({ pendingNumberFormat: format });
  },

  clearPendingNumberFormat: () => {
    set({ pendingNumberFormat: null });
  },

  // Alignment tab pending format
  pendingAlignmentFormat: null,

  setPendingAlignmentFormat: (format) => {
    set({ pendingAlignmentFormat: format });
  },

  clearPendingAlignmentFormat: () => {
    set({ pendingAlignmentFormat: null });
  },

  // Border tab pending format
  pendingBorderFormat: null,

  setPendingBorderFormat: (borders) => {
    set({ pendingBorderFormat: borders });
  },

  clearPendingBorderFormat: () => {
    set({ pendingBorderFormat: null });
  },

  // Border preset mode (for 'inside' preset which requires positional logic)
  pendingBorderPreset: null,

  setPendingBorderPreset: (preset) => {
    set({ pendingBorderPreset: preset });
  },

  clearPendingBorderPreset: () => {
    set({ pendingBorderPreset: null });
  },

  // Fill tab pending format
  pendingFillFormat: null,

  setPendingFillFormat: (format) => {
    set({ pendingFillFormat: format });
  },

  clearPendingFillFormat: () => {
    set({ pendingFillFormat: null });
  },

  // Font tab pending format
  pendingFontFormat: null,

  setPendingFontFormat: (format) => {
    set({ pendingFontFormat: format });
  },

  clearPendingFontFormat: () => {
    set({ pendingFontFormat: null });
  },

  // Protection tab pending format
  pendingProtectionFormat: null,

  setPendingProtectionFormat: (format) => {
    set({ pendingProtectionFormat: format });
  },

  clearPendingProtectionFormat: () => {
    set({ pendingProtectionFormat: null });
  },
});
