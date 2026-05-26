/**
 * Missing Fonts Dialog Slice
 *
 * Manages state for the dialog shown after XLSX import when fonts
 * used in the file are not available on the user's system.
 *
 */

import type { StateCreator } from 'zustand';

import type { MissingFontInfo as ContractMissingFontInfo } from '@mog-sdk/contracts/styles';

export type MissingFontInfo = ContractMissingFontInfo;

// =============================================================================
// Types
// =============================================================================

/**
 * State for the Missing Fonts Dialog
 */
export interface MissingFontsDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** List of fonts that are missing and their substitutes */
  missingFonts: MissingFontInfo[];
  /** Whether to suppress future warnings for this session */
  dontShowAgain: boolean;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface MissingFontsDialogSlice {
  /** Missing fonts dialog state */
  missingFontsDialog: MissingFontsDialogState;

  /**
   * Show the missing fonts dialog with a list of unavailable fonts.
   * Called after XLSX import when fonts are detected as missing.
   */
  showMissingFontsDialog: (fonts: MissingFontInfo[]) => void;

  /**
   * Close the missing fonts dialog.
   * @param dontShowAgain If true, suppress future warnings for this session
   */
  closeMissingFontsDialog: (dontShowAgain?: boolean) => void;

  /**
   * Clear the missing fonts list without changing dialog open state.
   * Called when starting a new import.
   */
  clearMissingFonts: () => void;

  /**
   * Check if warnings should be suppressed for this session.
   */
  shouldSuppressFontWarnings: () => boolean;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createMissingFontsDialogSlice: StateCreator<
  MissingFontsDialogSlice,
  [],
  [],
  MissingFontsDialogSlice
> = (set, get) => ({
  missingFontsDialog: {
    isOpen: false,
    missingFonts: [],
    dontShowAgain: false,
  },

  showMissingFontsDialog: (fonts: MissingFontInfo[]) => {
    // Don't show if user has opted out
    if (get().missingFontsDialog.dontShowAgain) {
      return;
    }

    // Don't show empty dialog
    if (fonts.length === 0) {
      return;
    }

    set({
      missingFontsDialog: {
        isOpen: true,
        missingFonts: fonts,
        dontShowAgain: get().missingFontsDialog.dontShowAgain,
      },
    });
  },

  closeMissingFontsDialog: (dontShowAgain = false) => {
    set({
      missingFontsDialog: {
        isOpen: false,
        missingFonts: [],
        dontShowAgain: dontShowAgain || get().missingFontsDialog.dontShowAgain,
      },
    });
  },

  clearMissingFonts: () => {
    set({
      missingFontsDialog: {
        ...get().missingFontsDialog,
        missingFonts: [],
      },
    });
  },

  shouldSuppressFontWarnings: () => {
    return get().missingFontsDialog.dontShowAgain;
  },
});
