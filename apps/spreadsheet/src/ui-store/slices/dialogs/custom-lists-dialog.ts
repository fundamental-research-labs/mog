/**
 * Custom Lists Dialog Slice
 *
 * Manages state for the Custom Lists management dialog.
 * Allows users to view, add, edit, and delete custom fill lists
 * like "High, Medium, Low" or "North, South, East, West".
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Custom lists dialog state
 */
export interface CustomListsDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Currently selected list ID for editing */
  selectedListId: string | null;
  /** Edit mode: 'view' shows read-only, 'edit' allows modification, 'add' for new list */
  editMode: 'view' | 'edit' | 'add';
  /** Pending new list values (for add mode) */
  pendingNewList: {
    name: string;
    values: string[];
  } | null;
  /** Pending edit values (for edit mode) */
  pendingEditValues: string[] | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface CustomListsDialogSlice {
  /** Custom lists dialog state */
  customListsDialog: CustomListsDialogState;

  /** Open the custom lists dialog */
  openCustomListsDialog: () => void;

  /** Close the custom lists dialog */
  closeCustomListsDialog: () => void;

  /** Select a list for viewing/editing */
  selectCustomList: (listId: string | null) => void;

  /** Enter edit mode for the selected list */
  startEditingCustomList: () => void;

  /** Enter add mode for creating a new list */
  startAddingCustomList: () => void;

  /** Update pending new list values */
  setPendingNewList: (name: string, values: string[]) => void;

  /** Update pending edit values */
  setPendingEditValues: (values: string[]) => void;

  /** Cancel editing and return to view mode */
  cancelEditingCustomList: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialCustomListsDialogState: CustomListsDialogState = {
  isOpen: false,
  selectedListId: null,
  editMode: 'view',
  pendingNewList: null,
  pendingEditValues: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createCustomListsDialogSlice: StateCreator<
  CustomListsDialogSlice,
  [],
  [],
  CustomListsDialogSlice
> = (set, get) => ({
  customListsDialog: initialCustomListsDialogState,

  openCustomListsDialog: () => {
    set({
      customListsDialog: {
        ...initialCustomListsDialogState,
        isOpen: true,
      },
    });
  },

  closeCustomListsDialog: () => {
    set({
      customListsDialog: initialCustomListsDialogState,
    });
  },

  selectCustomList: (listId) => {
    const current = get().customListsDialog;
    set({
      customListsDialog: {
        ...current,
        selectedListId: listId,
        editMode: 'view',
        pendingEditValues: null,
      },
    });
  },

  startEditingCustomList: () => {
    const current = get().customListsDialog;
    if (!current.selectedListId) return;

    set({
      customListsDialog: {
        ...current,
        editMode: 'edit',
        pendingEditValues: null, // Will be populated from the actual list
      },
    });
  },

  startAddingCustomList: () => {
    const current = get().customListsDialog;
    set({
      customListsDialog: {
        ...current,
        selectedListId: null,
        editMode: 'add',
        pendingNewList: { name: '', values: [] },
      },
    });
  },

  setPendingNewList: (name, values) => {
    const current = get().customListsDialog;
    set({
      customListsDialog: {
        ...current,
        pendingNewList: { name, values },
      },
    });
  },

  setPendingEditValues: (values) => {
    const current = get().customListsDialog;
    set({
      customListsDialog: {
        ...current,
        pendingEditValues: values,
      },
    });
  },

  cancelEditingCustomList: () => {
    const current = get().customListsDialog;
    set({
      customListsDialog: {
        ...current,
        editMode: 'view',
        pendingNewList: null,
        pendingEditValues: null,
      },
    });
  },
});
