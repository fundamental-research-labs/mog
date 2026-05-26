/**
 * MRU Functions Slice
 *
 * Tracks Most Recently Used functions for the Insert Function dialog.
 * Persists to localStorage for cross-session retention.
 *
 * Excel parity quickwin 14.4: MRU category shows functions user has recently inserted.
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Constants
// =============================================================================

const MAX_MRU_FUNCTIONS = 10;
const MRU_STORAGE_KEY = 'spreadsheet-mru-functions';

// =============================================================================
// Types
// =============================================================================

export interface MRUFunctionsState {
  /** List of recently used function names (most recent first) */
  mruFunctions: string[];
}

export interface MRUFunctionsSlice extends MRUFunctionsState {
  /**
   * Track a function as recently used.
   * Adds to the front of the list, removes duplicates, and caps at MAX_MRU_FUNCTIONS.
   */
  trackMRUFunction: (functionName: string) => void;

  /**
   * Load MRU functions from localStorage.
   * Called on app initialization.
   */
  loadMRUFromStorage: () => void;

  /**
   * Clear all MRU functions.
   */
  clearMRUFunctions: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialState: MRUFunctionsState = {
  mruFunctions: [],
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createMRUFunctionsSlice: StateCreator<MRUFunctionsSlice, [], [], MRUFunctionsSlice> = (
  set,
) => ({
  ...initialState,

  trackMRUFunction: (functionName: string) => {
    const normalizedName = functionName.toUpperCase();

    set((state) => {
      // Remove any existing entry (we'll add it to the front)
      const filtered = state.mruFunctions.filter((f) => f !== normalizedName);

      // Add to front and cap at max
      const updated = [normalizedName, ...filtered].slice(0, MAX_MRU_FUNCTIONS);

      // Persist to localStorage
      try {
        localStorage.setItem(MRU_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // localStorage not available or quota exceeded, continue without persistence
      }

      return { mruFunctions: updated };
    });
  },

  loadMRUFromStorage: () => {
    try {
      const stored = localStorage.getItem(MRU_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          set({ mruFunctions: parsed.slice(0, MAX_MRU_FUNCTIONS) });
        }
      }
    } catch {
      // Ignore storage errors - start with empty MRU
    }
  },

  clearMRUFunctions: () => {
    try {
      localStorage.removeItem(MRU_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    set({ mruFunctions: [] });
  },
});
