/**
 * Drag-Drop Overwrite Warning Dialog Slice
 *
 * Manages the drag-drop overwrite warning dialog state.
 * Shown when drag-dropping cells onto a target range that contains data.
 *
 * Architecture:
 * - Coordinator detects overwrite and stores pending drop operation
 * - UIStore shows dialog
 * - User confirms → coordinator executes drop
 * - User cancels → coordinator cancels drop
 *
 * D.2: Overwrite Warning on Drag-Drop
 */

import type { StateCreator } from 'zustand';

import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

/**
 * Pending drag-drop data stored while dialog is open
 */
export interface PendingDragDropData {
  /** Source range being dragged */
  sourceRange: CellRange;
  /** Target cell where drop will occur */
  targetCell: { row: number; col: number };
  /** Drop mode (move or copy) */
  mode: 'move' | 'copy';
  /** Sheet ID where drop will occur */
  sheetId: SheetId;
}

/**
 * Drag-drop overwrite warning dialog state
 */
export interface DragDropOverwriteDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Pending drag-drop data to execute if user confirms */
  pendingDropData: PendingDragDropData | null;
  /** Whether to skip showing the overwrite warning dialog ("Don't ask again" checkbox) */
  dontAskAgain: boolean;
}

// =============================================================================
// Slice Interface
// =============================================================================

/**
 * Drag-Drop Overwrite Warning Dialog Slice interface
 */
export interface DragDropOverwriteDialogSlice {
  dragDropOverwriteDialog: DragDropOverwriteDialogState;
  /** Open the drag-drop overwrite warning dialog */
  openDragDropOverwriteDialog: (pendingData: PendingDragDropData) => void;
  /** Close the drag-drop overwrite warning dialog */
  closeDragDropOverwriteDialog: () => void;
  /** Set the "Don't ask again" preference */
  setDragDropDontAskAgain: (dontAskAgain: boolean) => void;
  /** Check if dialog should be shown (respects "Don't ask again" preference) */
  shouldShowDragDropOverwriteDialog: () => boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** LocalStorage key for persisting "Don't ask again" preference */
const DONT_ASK_AGAIN_STORAGE_KEY = 'shortcut:dragDropOverwrite:dontAskAgain';

// =============================================================================
// Default State
// =============================================================================

/**
 * Load the "Don't ask again" preference from localStorage.
 * Returns false if not set or if localStorage is unavailable.
 */
function loadDontAskAgainPreference(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const value = localStorage.getItem(DONT_ASK_AGAIN_STORAGE_KEY);
      return value === 'true';
    }
  } catch {
    // localStorage may be unavailable in some contexts
  }
  return false;
}

/**
 * Save the "Don't ask again" preference to localStorage.
 */
function saveDontAskAgainPreference(dontAskAgain: boolean): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (dontAskAgain) {
        localStorage.setItem(DONT_ASK_AGAIN_STORAGE_KEY, 'true');
      } else {
        localStorage.removeItem(DONT_ASK_AGAIN_STORAGE_KEY);
      }
    }
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

const DEFAULT_DRAG_DROP_OVERWRITE_DIALOG: DragDropOverwriteDialogState = {
  isOpen: false,
  pendingDropData: null,
  dontAskAgain: loadDontAskAgainPreference(),
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the drag-drop overwrite warning dialog slice
 */
export const createDragDropOverwriteDialogSlice: StateCreator<
  DragDropOverwriteDialogSlice,
  [],
  [],
  DragDropOverwriteDialogSlice
> = (set, get) => ({
  dragDropOverwriteDialog: DEFAULT_DRAG_DROP_OVERWRITE_DIALOG,

  openDragDropOverwriteDialog: (pendingData: PendingDragDropData) => {
    set((state) => ({
      dragDropOverwriteDialog: {
        ...state.dragDropOverwriteDialog,
        isOpen: true,
        pendingDropData: pendingData,
      },
    }));
  },

  closeDragDropOverwriteDialog: () => {
    set((state) => ({
      dragDropOverwriteDialog: {
        ...DEFAULT_DRAG_DROP_OVERWRITE_DIALOG,
        // Preserve the dontAskAgain preference when closing
        dontAskAgain: state.dragDropOverwriteDialog.dontAskAgain,
      },
    }));
  },

  setDragDropDontAskAgain: (dontAskAgain: boolean) => {
    // Persist to localStorage
    saveDontAskAgainPreference(dontAskAgain);
    set((state) => ({
      dragDropOverwriteDialog: {
        ...state.dragDropOverwriteDialog,
        dontAskAgain,
      },
    }));
  },

  shouldShowDragDropOverwriteDialog: () => {
    return !get().dragDropOverwriteDialog.dontAskAgain;
  },
});
