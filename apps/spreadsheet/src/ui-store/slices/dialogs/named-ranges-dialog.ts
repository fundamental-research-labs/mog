/**
 * Named Ranges Dialog Slice
 *
 * Named Ranges
 *
 * Manages UI state for:
 * - Define Name dialog (create/edit a single name)
 * - Name Manager dialog (CRUD for all names)
 *
 * This is a Zustand slice (simple UI toggles), NOT an XState machine,
 * because these dialogs have simple open/closed state without complex
 * state transitions or cross-machine coordination.
 *
 */

import type { StateCreator } from 'zustand';

import type { SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Types
// =============================================================================

/**
 * State for the Define Name dialog.
 * Used for both creating new names and editing existing ones.
 */
export interface DefineNameDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Mode: create new or edit existing */
  mode: 'create' | 'edit';
  /** ID of name being edited (edit mode only) */
  editingNameId: string | null;
  /** Pre-filled name (e.g., when creating from selection) */
  initialName: string;
  /** Pre-filled refersTo (e.g., current selection) */
  initialRefersTo: string;
  /** Pre-filled scope */
  initialScope: SheetId | undefined;
  /** ID of parent dialog (for dialog stack management) */
  parentDialogId: string | null;
}

/**
 * Filter options for Name Manager.
 */
export type NameManagerFilter =
  | 'all'
  | 'workbook' // Workbook-scoped names
  | 'sheet' // Sheet-scoped names
  | 'withErrors' // Names with #REF! errors
  | 'tables'; // Table names (read-only in Name Manager)

/**
 * State for the Name Manager dialog.
 */
export interface NameManagerDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Current filter */
  filter: NameManagerFilter;
  /** Search text */
  searchText: string;
  /** Currently selected name ID (for edit/delete) */
  selectedNameId: string | null;
}

// =============================================================================
// Slice
// =============================================================================

export interface NamedRangesDialogSlice {
  // Define Name Dialog
  defineNameDialog: DefineNameDialogState;
  openDefineNameDialog: (options?: {
    mode?: 'create' | 'edit';
    editingNameId?: string;
    initialName?: string;
    initialRefersTo?: string;
    initialScope?: SheetId;
    parentDialogId?: string;
  }) => void;
  closeDefineNameDialog: () => void;

  // Name Manager Dialog
  nameManagerDialog: NameManagerDialogState;
  openNameManagerDialog: () => void;
  closeNameManagerDialog: () => void;
  setNameManagerFilter: (filter: NameManagerFilter) => void;
  setNameManagerSearchText: (text: string) => void;
  setNameManagerSelectedName: (nameId: string | null) => void;
}

const initialDefineNameDialogState: DefineNameDialogState = {
  isOpen: false,
  mode: 'create',
  editingNameId: null,
  initialName: '',
  initialRefersTo: '',
  initialScope: undefined,
  parentDialogId: null,
};

const initialNameManagerDialogState: NameManagerDialogState = {
  isOpen: false,
  filter: 'all',
  searchText: '',
  selectedNameId: null,
};

export const createNamedRangesDialogSlice: StateCreator<
  NamedRangesDialogSlice,
  [],
  [],
  NamedRangesDialogSlice
> = (set) => ({
  // Define Name Dialog
  defineNameDialog: initialDefineNameDialogState,

  openDefineNameDialog: (options) => {
    set({
      defineNameDialog: {
        isOpen: true,
        mode: options?.mode ?? 'create',
        editingNameId: options?.editingNameId ?? null,
        initialName: options?.initialName ?? '',
        initialRefersTo: options?.initialRefersTo ?? '',
        initialScope: options?.initialScope,
        parentDialogId: options?.parentDialogId ?? null,
      },
    });
  },

  closeDefineNameDialog: () => {
    set({ defineNameDialog: initialDefineNameDialogState });
  },

  // Name Manager Dialog
  nameManagerDialog: initialNameManagerDialogState,

  openNameManagerDialog: () => {
    set({
      nameManagerDialog: {
        ...initialNameManagerDialogState,
        isOpen: true,
      },
    });
  },

  closeNameManagerDialog: () => {
    set({ nameManagerDialog: initialNameManagerDialogState });
  },

  setNameManagerFilter: (filter) => {
    set((state) => ({
      nameManagerDialog: {
        ...state.nameManagerDialog,
        filter,
      },
    }));
  },

  setNameManagerSearchText: (text) => {
    set((state) => ({
      nameManagerDialog: {
        ...state.nameManagerDialog,
        searchText: text,
      },
    }));
  },

  setNameManagerSelectedName: (nameId) => {
    set((state) => ({
      nameManagerDialog: {
        ...state.nameManagerDialog,
        selectedNameId: nameId,
      },
    }));
  },
});
