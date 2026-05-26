/**
 * Number Format Dropdown UI Store Slice (Unified Keytip Router)
 *
 * Lifts the Home/Number number-format dropdown open-state from
 * React-local `useState` (NumberGroup.tsx) into the uiStore so the
 * keyboard system can fire `OPEN_NUMBER_FORMAT_DROPDOWN` directly.
 *
 * Excel keytip: `Alt+H,KeyN,KeyF` (Home → Number → Format dropdown).
 */

import type { StateCreator } from 'zustand';

export interface NumberFormatDropdownSlice {
  /** Number format dropdown state. */
  numberFormatDropdown: { open: boolean };
  /** Open the number format dropdown. */
  openNumberFormatDropdown: () => void;
  /** Close the number format dropdown. */
  closeNumberFormatDropdown: () => void;
}

export const createNumberFormatDropdownSlice: StateCreator<
  NumberFormatDropdownSlice,
  [],
  [],
  NumberFormatDropdownSlice
> = (set) => ({
  numberFormatDropdown: { open: false },

  openNumberFormatDropdown: () => {
    set({ numberFormatDropdown: { open: true } });
  },

  closeNumberFormatDropdown: () => {
    set({ numberFormatDropdown: { open: false } });
  },
});
