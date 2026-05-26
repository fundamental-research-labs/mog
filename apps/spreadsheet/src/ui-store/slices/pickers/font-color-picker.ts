/**
 * Font Color Picker UI Store Slice (Unified Keytip Router)
 *
 * Lifts the Home/Font font color picker open-state from React-local
 * `useState` (FontGroup.tsx) into the uiStore so the keyboard system
 * can fire `OPEN_FONT_COLOR_PICKER` directly.
 *
 * Excel keytip: `Alt+H,KeyF,KeyC` (three-key chord; Home → Font → Color).
 */

import type { StateCreator } from 'zustand';

export interface FontColorPickerSlice {
  /** Font color picker dropdown state. */
  fontColorPicker: { open: boolean };
  /**
   * Last color the user picked from the dropdown this session.
   * `null` = no prior selection (main-click falls back to a fixed
   * Excel-parity default). Session-scoped, not persisted to localStorage —
   * Excel resets last-used on workbook close.
   */
  lastUsedFontColor: string | null;
  /** Open the font color picker dropdown. */
  openFontColorPicker: () => void;
  /** Close the font color picker dropdown. */
  closeFontColorPicker: () => void;
  /** Record a color picked from the dropdown as the last-used. */
  setLastUsedFontColor: (color: string) => void;
}

export const createFontColorPickerSlice: StateCreator<
  FontColorPickerSlice,
  [],
  [],
  FontColorPickerSlice
> = (set) => ({
  fontColorPicker: { open: false },
  lastUsedFontColor: null,

  openFontColorPicker: () => {
    set({ fontColorPicker: { open: true } });
  },

  closeFontColorPicker: () => {
    set({ fontColorPicker: { open: false } });
  },

  setLastUsedFontColor: (color) => {
    set({ lastUsedFontColor: color });
  },
});
