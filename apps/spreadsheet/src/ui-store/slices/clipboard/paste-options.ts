/**
 * Paste Options Slice
 *
 * Manages the paste options floating button state.
 * Shows after paste operations with quick access to paste options.
 *
 * Excel Parity Quickwin G3: Paste Options Button
 */

import type { StateCreator } from 'zustand';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { PasteMenuOption } from '@mog-sdk/contracts/actors';

/**
 * Paste option types available in the dropdown.
 * Exported as PasteOption for backwards compatibility.
 */
export type PasteOption = PasteMenuOption;

/**
 * Paste options button state
 */
export interface PasteOptionsState {
  /** Whether the paste options button is visible */
  isVisible: boolean;
  /** The range where paste occurred */
  range: CellRange | null;
  /** Position of the button (bottom-right corner of paste range) */
  position: { row: number; col: number } | null;
  /** Sheet ID where paste occurred */
  sheetId: string | null;
  /**
   * Timestamp of the last paste operation.
   * Used to detect Ctrl key release shortly after paste for showing paste options menu.
   * Keyboard Shortcuts
   */
  lastPasteTimestamp: number | null;
  /**
   * Whether the paste options menu (dropdown) is currently open.
   * Separate from isVisible which controls the button.
   */
  isMenuOpen: boolean;
}

/**
 * Time window (in ms) after paste during which Ctrl keyup shows paste options menu.
 * Keyboard Shortcuts
 */
export const PASTE_OPTIONS_CTRL_WINDOW_MS = 500;

/**
 * Paste Options Slice interface
 */
export interface PasteOptionsSlice {
  pasteOptions: PasteOptionsState;
  showPasteOptionsButton: (range: CellRange, sheetId: string) => void;
  hidePasteOptionsButton: () => void;
  /**
   * Open the paste options dropdown menu.
   * Keyboard Shortcuts
   */
  openPasteOptionsMenu: () => void;
  /**
   * Close the paste options dropdown menu.
   */
  closePasteOptionsMenu: () => void;
  /**
   * Check if Ctrl keyup should show paste options menu.
   * Returns true if paste happened within PASTE_OPTIONS_CTRL_WINDOW_MS.
   * Keyboard Shortcuts
   */
  shouldShowPasteOptionsOnCtrlUp: () => boolean;
}

/**
 * Default paste options state
 */
const DEFAULT_PASTE_OPTIONS: PasteOptionsState = {
  isVisible: false,
  range: null,
  position: null,
  sheetId: null,
  lastPasteTimestamp: null,
  isMenuOpen: false,
};

/**
 * Create the paste options slice
 */
export const createPasteOptionsSlice: StateCreator<PasteOptionsSlice, [], [], PasteOptionsSlice> = (
  set,
  get,
) => ({
  pasteOptions: DEFAULT_PASTE_OPTIONS,

  showPasteOptionsButton: (range: CellRange, sheetId: string) => {
    // Position at bottom-right corner of paste range
    const position = {
      row: Math.max(range.startRow, range.endRow),
      col: Math.max(range.startCol, range.endCol),
    };

    set({
      pasteOptions: {
        isVisible: true,
        range,
        position,
        sheetId,
        // Track paste timestamp
        lastPasteTimestamp: Date.now(),
        isMenuOpen: false,
      },
    });
  },

  hidePasteOptionsButton: () => {
    set({ pasteOptions: DEFAULT_PASTE_OPTIONS });
  },

  /**
   * Open the paste options dropdown menu.
   * Keyboard Shortcuts
   */
  openPasteOptionsMenu: () => {
    set((state) => ({
      pasteOptions: {
        ...state.pasteOptions,
        isMenuOpen: true,
      },
    }));
  },

  /**
   * Close the paste options dropdown menu.
   */
  closePasteOptionsMenu: () => {
    set((state) => ({
      pasteOptions: {
        ...state.pasteOptions,
        isMenuOpen: false,
      },
    }));
  },

  /**
   * Check if Ctrl keyup should show paste options menu.
   * Returns true if paste options button is visible and paste happened within time window.
   * Keyboard Shortcuts
   */
  shouldShowPasteOptionsOnCtrlUp: () => {
    const { pasteOptions } = get();
    if (!pasteOptions.isVisible || !pasteOptions.lastPasteTimestamp) {
      return false;
    }
    const elapsed = Date.now() - pasteOptions.lastPasteTimestamp;
    return elapsed <= PASTE_OPTIONS_CTRL_WINDOW_MS;
  },
});
