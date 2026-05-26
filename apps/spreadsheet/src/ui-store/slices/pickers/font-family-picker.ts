/**
 * Font Family Picker UI Store Slice (Unified Keytip Router)
 *
 * Lifts the Home/Font font family picker open-state from React-local
 * `useState` (FontGroup.tsx) into the uiStore so the keyboard system
 * can fire `OPEN_FONT_FAMILY_PICKER` directly.
 *
 * Excel keytip: `Alt+H,KeyF,KeyF` (three-key chord; Home → Font →
 * font-family selector). Note `Alt+H,KeyF,KeyS` focuses the size input
 * via `FOCUS_FONT_SIZE_INPUT` (no slice; actor-access focus seam).
 */

import type { StateCreator } from 'zustand';

export interface FontFamilyPickerSlice {
  /** Font family picker dropdown state. */
  fontFamilyPicker: { open: boolean };
  /** Open the font family picker dropdown. */
  openFontFamilyPicker: () => void;
  /** Close the font family picker dropdown. */
  closeFontFamilyPicker: () => void;
}

export const createFontFamilyPickerSlice: StateCreator<
  FontFamilyPickerSlice,
  [],
  [],
  FontFamilyPickerSlice
> = (set) => ({
  fontFamilyPicker: { open: false },

  openFontFamilyPicker: () => {
    set({ fontFamilyPicker: { open: true } });
  },

  closeFontFamilyPicker: () => {
    set({ fontFamilyPicker: { open: false } });
  },
});
