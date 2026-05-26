/**
 * Settings Slice
 *
 * Manages state for settings dialogs (Settings & Toggles).
 */

import type { StateCreator } from 'zustand';

export interface SettingsSlice {
  /** Whether the workbook (spread) settings dialog is open */
  spreadSettingsDialogOpen: boolean;
  /** Whether the sheet settings dialog is open */
  sheetSettingsDialogOpen: boolean;
  openSpreadSettingsDialog: () => void;
  closeSpreadSettingsDialog: () => void;
  openSheetSettingsDialog: () => void;
  closeSheetSettingsDialog: () => void;
}

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
  spreadSettingsDialogOpen: false,
  sheetSettingsDialogOpen: false,

  openSpreadSettingsDialog: () => {
    set({ spreadSettingsDialogOpen: true });
  },

  closeSpreadSettingsDialog: () => {
    set({ spreadSettingsDialogOpen: false });
  },

  openSheetSettingsDialog: () => {
    set({ sheetSettingsDialogOpen: true });
  },

  closeSheetSettingsDialog: () => {
    set({ sheetSettingsDialogOpen: false });
  },
});
