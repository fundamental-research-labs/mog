/**
 * Dialogs Slice
 *
 * Manages state for shell-level dialogs that are shared across all views:
 * - Command palette (Cmd+K)
 * - Settings dialog
 *
 * View-specific dialogs (e.g., Grid Format Cells) live in view-specific stores.
 */

import type { StateCreator } from 'zustand';

/**
 * Dialogs state
 */
export interface DialogsState {
  /** Whether the command palette is open (Cmd+K) */
  commandPaletteOpen: boolean;
  /** Whether the settings dialog is open */
  settingsDialogOpen: boolean;
}

export interface DialogsSlice extends DialogsState {
  /** Open the command palette */
  openCommandPalette: () => void;
  /** Close the command palette */
  closeCommandPalette: () => void;
  /** Toggle the command palette */
  toggleCommandPalette: () => void;

  /** Open the settings dialog */
  openSettingsDialog: () => void;
  /** Close the settings dialog */
  closeSettingsDialog: () => void;
  /** Toggle the settings dialog */
  toggleSettingsDialog: () => void;
}

const initialState: DialogsState = {
  commandPaletteOpen: false,
  settingsDialogOpen: false,
};

export const createDialogsSlice: StateCreator<DialogsSlice, [], [], DialogsSlice> = (set) => ({
  ...initialState,

  openCommandPalette: () => {
    set({ commandPaletteOpen: true });
  },

  closeCommandPalette: () => {
    set({ commandPaletteOpen: false });
  },

  toggleCommandPalette: () => {
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen }));
  },

  openSettingsDialog: () => {
    set({ settingsDialogOpen: true });
  },

  closeSettingsDialog: () => {
    set({ settingsDialogOpen: false });
  },

  toggleSettingsDialog: () => {
    set((s) => ({ settingsDialogOpen: !s.settingsDialogOpen }));
  },
});
