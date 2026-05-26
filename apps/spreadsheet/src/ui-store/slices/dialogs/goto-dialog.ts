/**
 * Go To Dialog Slice
 *
 * Manages state for the Go To dialog (F5 / Ctrl+G).
 */

import type { StateCreator } from 'zustand';

/**
 * Recent location item
 */
export interface RecentLocation {
  /** A1 notation reference (e.g., "A1", "Sheet2!B5", "C1:D10") */
  reference: string;
  /** Sheet ID where the location exists (optional) */
  sheetId?: string;
  /** Timestamp when this location was navigated to */
  timestamp: number;
}

/**
 * Go To dialog state
 */
export interface GoToDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Recent navigation locations (max 15, most recent first) */
  recentLocations: RecentLocation[];
  /** Pending reference to navigate to (Draft + Apply pattern) */
  pendingGoToReference: string | null;
}

export interface GoToDialogSlice {
  goToDialog: GoToDialogState;
  openGoToDialog: () => void;
  closeGoToDialog: () => void;
  addRecentLocation: (reference: string, sheetId?: string) => void;
  setPendingGoToReference: (ref: string) => void;
  clearPendingGoToReference: () => void;
}

const MAX_RECENT_LOCATIONS = 15;

const initialState: GoToDialogState = {
  isOpen: false,
  recentLocations: [],
  pendingGoToReference: null,
};

export const createGoToDialogSlice: StateCreator<GoToDialogSlice, [], [], GoToDialogSlice> = (
  set,
  get,
) => ({
  goToDialog: initialState,

  openGoToDialog: () => {
    const currentRecentLocations = get().goToDialog?.recentLocations ?? [];
    set({
      goToDialog: {
        ...initialState,
        isOpen: true,
        recentLocations: currentRecentLocations,
      },
    });
  },

  closeGoToDialog: () => {
    set((state) => ({
      goToDialog: {
        ...state.goToDialog,
        isOpen: false,
        pendingGoToReference: null,
      },
    }));
  },

  addRecentLocation: (reference: string, sheetId?: string) => {
    set((state) => {
      const existing = state.goToDialog.recentLocations;

      // Remove any existing entry with the same reference (we'll add it to the top)
      const filtered = existing.filter((loc) => loc.reference !== reference);

      // Add new entry at the beginning
      const newLocation: RecentLocation = {
        reference,
        sheetId,
        timestamp: Date.now(),
      };

      // Keep only MAX_RECENT_LOCATIONS items
      const updated = [newLocation, ...filtered].slice(0, MAX_RECENT_LOCATIONS);

      return {
        goToDialog: {
          ...state.goToDialog,
          recentLocations: updated,
        },
      };
    });
  },

  setPendingGoToReference: (ref: string) => {
    set((state) => ({
      goToDialog: {
        ...state.goToDialog,
        pendingGoToReference: ref,
      },
    }));
  },

  clearPendingGoToReference: () => {
    set((state) => ({
      goToDialog: {
        ...state.goToDialog,
        pendingGoToReference: null,
      },
    }));
  },
});
