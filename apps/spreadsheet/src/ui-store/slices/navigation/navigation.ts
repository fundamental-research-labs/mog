/**
 * Navigation Slice
 *
 * Manages view navigation and view switcher state.
 * Tracks the currently active view (Grid, Kanban, Calendar, etc.)
 * and whether the view switcher is open.
 *
 * Added activeAppId for app navigation
 */

import type { StateCreator } from 'zustand';

/**
 * Navigation state
 */
export interface NavigationState {
  /** ID of the currently active view */
  activeViewId: string;
  /** Whether the view switcher is open */
  viewSwitcherOpen: boolean;
  /** ID of the currently active app (Apps) */
  activeAppId: string | null;
}

export interface NavigationSlice extends NavigationState {
  /** Set the active view by ID */
  setActiveViewId: (viewId: string) => void;
  /** Open the view switcher */
  openViewSwitcher: () => void;
  /** Close the view switcher */
  closeViewSwitcher: () => void;
  /** Toggle the view switcher */
  toggleViewSwitcher: () => void;
  /** Set the active app by ID (Apps) */
  setActiveAppId: (appId: string | null) => void;
}

const initialState: NavigationState = {
  activeViewId: 'grid', // Default to grid view
  viewSwitcherOpen: false,
  activeAppId: 'spreadsheet', // Default to spreadsheet app so users see the grid
};

export const createNavigationSlice: StateCreator<NavigationSlice, [], [], NavigationSlice> = (
  set,
) => ({
  ...initialState,

  setActiveViewId: (viewId: string) => {
    set({ activeViewId: viewId });
  },

  openViewSwitcher: () => {
    set({ viewSwitcherOpen: true });
  },

  closeViewSwitcher: () => {
    set({ viewSwitcherOpen: false });
  },

  toggleViewSwitcher: () => {
    set((s) => ({ viewSwitcherOpen: !s.viewSwitcherOpen }));
  },

  setActiveAppId: (appId: string | null) => {
    set({ activeAppId: appId });
  },
});
