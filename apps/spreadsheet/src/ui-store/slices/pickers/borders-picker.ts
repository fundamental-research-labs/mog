/**
 * Borders Picker UI Store Slice (Unified Keytip Router)
 *
 * Lifts the Home/Font borders dropdown open-state from React-local
 * `useState` (FontGroup.tsx) into the uiStore so the keyboard system
 * can fire `OPEN_BORDERS_PICKER` directly.
 *
 * Wire the consuming Radix `Popover` as a controlled component:
 * ```tsx
 * <Popover
 * open={bordersPicker.open}
 * onOpenChange={(open) =>
 * open ? dispatch('OPEN_BORDERS_PICKER', deps) : closeBordersPicker
 * }
 * >
 * ```
 * Click-outside / ESC fires `onOpenChange(false)` → must clear the slice;
 * otherwise Radix's internal close diverges from slice state and the
 * picker won't reopen.
 */

import type { BorderPresetMode, CellBorders } from '@mog-sdk/contracts/core';
import type { StateCreator } from 'zustand';

/**
 * Last-used border selection — `borders` and `preset` together describe
 * the user's full pick. The preset is part of the selection because
 * compound presets (Outside, Inside, Thick Box) cannot be replayed
 * correctly from the four-edge `CellBorders` shape alone.
 */
export interface LastUsedBorderFormat {
  borders: CellBorders;
  preset: BorderPresetMode;
}

export interface BordersPickerSlice {
  /** Borders picker dropdown state. */
  bordersPicker: { open: boolean };
  /**
   * Last border selection from the dropdown this session.
   * `null` = no prior selection (main-click falls back to a fixed
   * Excel-parity default). Session-scoped, not persisted.
   */
  lastUsedBorderFormat: LastUsedBorderFormat | null;
  /** Open the borders picker dropdown. */
  openBordersPicker: () => void;
  /** Close the borders picker dropdown. */
  closeBordersPicker: () => void;
  /** Record a border selection from the dropdown as the last-used. */
  setLastUsedBorderFormat: (format: LastUsedBorderFormat) => void;
}

export const createBordersPickerSlice: StateCreator<
  BordersPickerSlice,
  [],
  [],
  BordersPickerSlice
> = (set) => ({
  bordersPicker: { open: false },
  lastUsedBorderFormat: null,

  openBordersPicker: () => {
    set({ bordersPicker: { open: true } });
  },

  closeBordersPicker: () => {
    set({ bordersPicker: { open: false } });
  },

  setLastUsedBorderFormat: (format) => {
    set({ lastUsedBorderFormat: format });
  },
});
