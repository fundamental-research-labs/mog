/**
 * Consolidate Dialog Slice
 *
 * Manages state for the Consolidate dialog, which combines data from
 * multiple ranges into a single destination using aggregation functions.
 *
 * Excel's Consolidate feature supports:
 * - Multiple source ranges
 * - Various aggregation functions (SUM, COUNT, AVERAGE, etc.)
 * - Label matching from top row and/or left column
 * - Creating links to source data
 */

import type { StateCreator } from 'zustand';
import type { ConsolidateFunction } from '../../../domain/data/consolidate';

// =============================================================================
// Types
// =============================================================================

/**
 * Source reference for consolidation
 */
export interface ConsolidateSourceRef {
  /** Unique ID for the reference */
  id: string;
  /** Range reference string (e.g., "Sheet1!A1:D10") */
  reference: string;
}

/**
 * Consolidate dialog state
 */
export interface ConsolidateDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Aggregation function to use */
  func: ConsolidateFunction;
  /** Top-left destination cell for the consolidated output */
  destination: string;
  /** Current reference input (for adding new references) */
  currentReference: string;
  /** List of all source references */
  sourceReferences: ConsolidateSourceRef[];
  /** Use labels in top row for matching */
  useTopRowLabels: boolean;
  /** Use labels in left column for matching */
  useLeftColumnLabels: boolean;
  /** Create links to source data */
  createLinks: boolean;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface ConsolidateDialogSlice {
  /** Consolidate dialog state */
  consolidateDialog: ConsolidateDialogState;

  /** Open the Consolidate dialog */
  openConsolidateDialog: (initial?: { destination?: string }) => void;

  /** Close the Consolidate dialog */
  closeConsolidateDialog: () => void;

  /** Set the consolidation function */
  setConsolidateFunction: (func: ConsolidateFunction) => void;

  /** Set the current reference input */
  setConsolidateCurrentReference: (reference: string) => void;

  /** Set the output destination */
  setConsolidateDestination: (destination: string) => void;

  /** Add a source reference to the list */
  addConsolidateReference: (reference: string) => void;

  /** Remove a source reference from the list */
  removeConsolidateReference: (id: string) => void;

  /** Clear all source references */
  clearConsolidateReferences: () => void;

  /** Toggle use top row labels option */
  toggleConsolidateTopRowLabels: () => void;

  /** Toggle use left column labels option */
  toggleConsolidateLeftColumnLabels: () => void;

  /** Toggle create links option */
  toggleConsolidateCreateLinks: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialConsolidateDialogState: ConsolidateDialogState = {
  isOpen: false,
  func: 'sum',
  destination: '',
  currentReference: '',
  sourceReferences: [],
  useTopRowLabels: false,
  useLeftColumnLabels: false,
  createLinks: false,
};

// =============================================================================
// Slice Creator
// =============================================================================

let nextRefId = 1;

export const createConsolidateDialogSlice: StateCreator<
  ConsolidateDialogSlice,
  [],
  [],
  ConsolidateDialogSlice
> = (set, _get) => ({
  consolidateDialog: initialConsolidateDialogState,

  openConsolidateDialog: (initial) => {
    set({
      consolidateDialog: {
        ...initialConsolidateDialogState,
        destination: initial?.destination ?? '',
        isOpen: true,
      },
    });
  },

  closeConsolidateDialog: () => {
    set({
      consolidateDialog: initialConsolidateDialogState,
    });
  },

  setConsolidateFunction: (func) => {
    set((state) => ({
      consolidateDialog: {
        ...state.consolidateDialog,
        func,
      },
    }));
  },

  setConsolidateCurrentReference: (reference) => {
    set((state) => ({
      consolidateDialog: {
        ...state.consolidateDialog,
        currentReference: reference,
      },
    }));
  },

  setConsolidateDestination: (destination) => {
    set((state) => ({
      consolidateDialog: {
        ...state.consolidateDialog,
        destination,
      },
    }));
  },

  addConsolidateReference: (reference) => {
    if (!reference.trim()) return;

    const id = `ref-${nextRefId++}`;
    set((state) => ({
      consolidateDialog: {
        ...state.consolidateDialog,
        sourceReferences: [
          ...state.consolidateDialog.sourceReferences,
          { id, reference: reference.trim() },
        ],
        currentReference: '',
      },
    }));
  },

  removeConsolidateReference: (id) => {
    set((state) => ({
      consolidateDialog: {
        ...state.consolidateDialog,
        sourceReferences: state.consolidateDialog.sourceReferences.filter((ref) => ref.id !== id),
      },
    }));
  },

  clearConsolidateReferences: () => {
    set((state) => ({
      consolidateDialog: {
        ...state.consolidateDialog,
        sourceReferences: [],
        currentReference: '',
      },
    }));
  },

  toggleConsolidateTopRowLabels: () => {
    set((state) => ({
      consolidateDialog: {
        ...state.consolidateDialog,
        useTopRowLabels: !state.consolidateDialog.useTopRowLabels,
      },
    }));
  },

  toggleConsolidateLeftColumnLabels: () => {
    set((state) => ({
      consolidateDialog: {
        ...state.consolidateDialog,
        useLeftColumnLabels: !state.consolidateDialog.useLeftColumnLabels,
      },
    }));
  },

  toggleConsolidateCreateLinks: () => {
    set((state) => ({
      consolidateDialog: {
        ...state.consolidateDialog,
        createLinks: !state.consolidateDialog.createLinks,
      },
    }));
  },
});
