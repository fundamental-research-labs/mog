/**
 * File menu slice
 *
 * Manages state for the File menu.
 * The file menu is a full-screen overlay that shows file operations,
 * document info, and application settings.
 */

import type { StateCreator } from 'zustand';

/**
 * Panel types for file menu navigation
 */
export type BackstagePanelType =
  | 'info'
  | 'new'
  | 'open'
  | 'browse-files'
  | 'recents'
  | 'save'
  | 'save-as'
  | 'print'
  | 'share'
  | 'export';

/**
 * Backstage view state
 */
export interface BackstageState {
  /** Whether the backstage view is open */
  isOpen: boolean;
  /** Currently active panel */
  activePanel: BackstagePanelType;
}

export interface BackstageSlice {
  backstage: BackstageState;
  openBackstage: (panel?: BackstagePanelType) => void;
  closeBackstage: () => void;
  setActivePanel: (panel: BackstagePanelType) => void;
}

const initialState: BackstageState = {
  isOpen: false,
  activePanel: 'info',
};

export const createBackstageSlice: StateCreator<BackstageSlice, [], [], BackstageSlice> = (
  set,
) => ({
  backstage: initialState,

  openBackstage: (panel = 'info') => {
    set({
      backstage: {
        isOpen: true,
        activePanel: panel,
      },
    });
  },

  closeBackstage: () => {
    set({ backstage: initialState });
  },

  setActivePanel: (panel: BackstagePanelType) => {
    set((s) => ({
      backstage: {
        ...s.backstage,
        activePanel: panel,
      },
    }));
  },
});
