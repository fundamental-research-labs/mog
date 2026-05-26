/**
 * Fill Color Picker UI Store Slice (Unified Keytip Router)
 *
 * Lifts the Home/Font fill (background) color picker open-state from
 * React-local `useState` (FontGroup.tsx) into the uiStore so the
 * keyboard system can fire `OPEN_FILL_COLOR_PICKER` directly.
 *
 * Excel keytip: `Alt+H,KeyH` (Home → Highlight). Wire the consuming
 * Radix popover as a controlled component (see `borders-picker.ts` for
 * the canonical wiring pattern).
 */

import type { StateCreator } from 'zustand';

export interface FillColorPickerSlice {
  /** Fill color picker dropdown state. */
  fillColorPicker: { open: boolean };
  /**
   * Last color the user picked from the dropdown this session.
   * `null` = no prior selection (main-click falls back to a fixed
   * Excel-parity default). Session-scoped, not persisted to localStorage —
   * Excel resets last-used on workbook close.
   */
  lastUsedFillColor: string | null;
  /** Open the fill color picker dropdown. */
  openFillColorPicker: () => void;
  /** Close the fill color picker dropdown. */
  closeFillColorPicker: () => void;
  /** Record a color picked from the dropdown as the last-used. */
  setLastUsedFillColor: (color: string) => void;
}

export const createFillColorPickerSlice: StateCreator<
  FillColorPickerSlice,
  [],
  [],
  FillColorPickerSlice
> = (set) => ({
  fillColorPicker: { open: false },
  lastUsedFillColor: null,

  openFillColorPicker: () => {
    set({ fillColorPicker: { open: true } });
  },

  closeFillColorPicker: () => {
    set({ fillColorPicker: { open: false } });
  },

  setLastUsedFillColor: (color) => {
    set({ lastUsedFillColor: color });
  },
});
