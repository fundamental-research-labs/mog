/**
 * Watch Window Slice
 *
 * Manages state for the Watch Window, which allows users to monitor
 * specific cells as they work on other parts of the workbook.
 *
 * Features:
 * - Add/remove cell watches
 * - Display cell reference, value, and formula
 * - Auto-update values when cells change
 * - Modeless operation (can be open while editing)
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * A watched cell entry
 */
export interface WatchEntry {
  /** Unique ID for the watch entry */
  id: string;
  /** Sheet ID where the cell is located */
  sheetId: string;
  /** Sheet name for display */
  sheetName: string;
  /** Cell reference string (e.g., "A1") */
  cellRef: string;
  /** Cell row */
  row: number;
  /** Cell column */
  col: number;
  /** Current value of the cell */
  value: unknown;
  /** Formula if cell contains one (null if value only) */
  formula: string | null;
}

/**
 * Watch Window state
 */
export interface WatchWindowState {
  /** Whether the Watch Window is open */
  isOpen: boolean;
  /** List of watched cells */
  watches: WatchEntry[];
  /** Selected watch entry IDs (for multi-select delete) */
  selectedWatchIds: Set<string>;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface WatchWindowSlice {
  /** Watch Window state */
  watchWindow: WatchWindowState;

  /** Open the Watch Window */
  openWatchWindow: () => void;

  /** Close the Watch Window */
  closeWatchWindow: () => void;

  /** Toggle the Watch Window visibility */
  toggleWatchWindow: () => void;

  /** Add a watch for a cell */
  addWatch: (entry: Omit<WatchEntry, 'id'>) => void;

  /** Remove a watch by ID */
  removeWatch: (id: string) => void;

  /** Remove multiple watches by IDs */
  removeWatches: (ids: string[]) => void;

  /** Remove all watches */
  clearAllWatches: () => void;

  /** Update a watch entry's value and formula */
  updateWatch: (id: string, updates: { value: unknown; formula: string | null }) => void;

  /** Update all watches for a specific sheet (batch update) */
  updateWatchesForSheet: (
    sheetId: string,
    updates: Map<string, { value: unknown; formula: string | null }>,
  ) => void;

  /** Select a watch entry */
  selectWatch: (id: string, addToSelection?: boolean) => void;

  /** Deselect all watch entries */
  deselectAllWatches: () => void;

  /** Toggle selection of a watch entry */
  toggleWatchSelection: (id: string) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialWatchWindowState: WatchWindowState = {
  isOpen: false,
  watches: [],
  selectedWatchIds: new Set(),
};

// =============================================================================
// Slice Creator
// =============================================================================

let nextWatchId = 1;

export const createWatchWindowSlice: StateCreator<WatchWindowSlice, [], [], WatchWindowSlice> = (
  set,
  get,
) => ({
  watchWindow: initialWatchWindowState,

  openWatchWindow: () => {
    set((state) => ({
      watchWindow: {
        ...state.watchWindow,
        isOpen: true,
      },
    }));
  },

  closeWatchWindow: () => {
    set((state) => ({
      watchWindow: {
        ...state.watchWindow,
        isOpen: false,
        selectedWatchIds: new Set(),
      },
    }));
  },

  toggleWatchWindow: () => {
    const isCurrentlyOpen = get().watchWindow.isOpen;
    if (isCurrentlyOpen) {
      get().closeWatchWindow();
    } else {
      get().openWatchWindow();
    }
  },

  addWatch: (entry) => {
    const id = `watch-${nextWatchId++}`;

    // Check for duplicate (same sheet and cell)
    const existing = get().watchWindow.watches.find(
      (w) => w.sheetId === entry.sheetId && w.row === entry.row && w.col === entry.col,
    );

    if (existing) {
      // Don't add duplicate, just return
      return;
    }

    set((state) => ({
      watchWindow: {
        ...state.watchWindow,
        watches: [...state.watchWindow.watches, { ...entry, id }],
      },
    }));
  },

  removeWatch: (id) => {
    set((state) => {
      const newSelectedIds = new Set(state.watchWindow.selectedWatchIds);
      newSelectedIds.delete(id);

      return {
        watchWindow: {
          ...state.watchWindow,
          watches: state.watchWindow.watches.filter((w) => w.id !== id),
          selectedWatchIds: newSelectedIds,
        },
      };
    });
  },

  removeWatches: (ids) => {
    const idsSet = new Set(ids);
    set((state) => {
      const newSelectedIds = new Set(
        [...state.watchWindow.selectedWatchIds].filter((id) => !idsSet.has(id)),
      );

      return {
        watchWindow: {
          ...state.watchWindow,
          watches: state.watchWindow.watches.filter((w) => !idsSet.has(w.id)),
          selectedWatchIds: newSelectedIds,
        },
      };
    });
  },

  clearAllWatches: () => {
    set((state) => ({
      watchWindow: {
        ...state.watchWindow,
        watches: [],
        selectedWatchIds: new Set(),
      },
    }));
  },

  updateWatch: (id, updates) => {
    set((state) => ({
      watchWindow: {
        ...state.watchWindow,
        watches: state.watchWindow.watches.map((w) => (w.id === id ? { ...w, ...updates } : w)),
      },
    }));
  },

  updateWatchesForSheet: (sheetId, updates) => {
    set((state) => ({
      watchWindow: {
        ...state.watchWindow,
        watches: state.watchWindow.watches.map((w) => {
          if (w.sheetId !== sheetId) return w;

          const key = `${w.row},${w.col}`;
          const update = updates.get(key);
          return update ? { ...w, ...update } : w;
        }),
      },
    }));
  },

  selectWatch: (id, addToSelection = false) => {
    set((state) => {
      const newSelectedIds = addToSelection
        ? new Set([...state.watchWindow.selectedWatchIds, id])
        : new Set([id]);

      return {
        watchWindow: {
          ...state.watchWindow,
          selectedWatchIds: newSelectedIds,
        },
      };
    });
  },

  deselectAllWatches: () => {
    set((state) => ({
      watchWindow: {
        ...state.watchWindow,
        selectedWatchIds: new Set(),
      },
    }));
  },

  toggleWatchSelection: (id) => {
    set((state) => {
      const newSelectedIds = new Set(state.watchWindow.selectedWatchIds);
      if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
      } else {
        newSelectedIds.add(id);
      }

      return {
        watchWindow: {
          ...state.watchWindow,
          selectedWatchIds: newSelectedIds,
        },
      };
    });
  },
});
