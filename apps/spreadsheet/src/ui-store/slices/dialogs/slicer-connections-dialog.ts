/**
 * Slicer Connections Dialog Slice
 *
 * Manages state for the Slicer Connections (Report Connections) dialog.
 * This dialog allows users to configure which tables/PivotTables a slicer
 * is connected to, enabling a single slicer to filter multiple data sources.
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Slicer Connections Dialog state
 */
export interface SlicerConnectionsDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** ID of the slicer being configured */
  slicerId: string | null;
  /** Current table IDs the slicer is connected to */
  currentConnections: string[];
  /** The source column name used for filtering */
  sourceColumnName: string;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface SlicerConnectionsDialogSlice {
  /** Slicer Connections Dialog state */
  slicerConnectionsDialog: SlicerConnectionsDialogState;

  /** Open the slicer connections dialog */
  openSlicerConnectionsDialog: (
    slicerId: string,
    currentConnections: string[],
    sourceColumnName: string,
  ) => void;

  /** Close the slicer connections dialog */
  closeSlicerConnectionsDialog: () => void;

  /** Update the slicer connections (applies the changes) */
  updateSlicerConnections: (slicerId: string, connections: string[]) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialSlicerConnectionsDialogState: SlicerConnectionsDialogState = {
  isOpen: false,
  slicerId: null,
  currentConnections: [],
  sourceColumnName: '',
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createSlicerConnectionsDialogSlice: StateCreator<
  SlicerConnectionsDialogSlice,
  [],
  [],
  SlicerConnectionsDialogSlice
> = (set) => ({
  slicerConnectionsDialog: initialSlicerConnectionsDialogState,

  openSlicerConnectionsDialog: (
    slicerId: string,
    currentConnections: string[],
    sourceColumnName: string,
  ) => {
    set({
      slicerConnectionsDialog: {
        isOpen: true,
        slicerId,
        currentConnections,
        sourceColumnName,
      },
    });
  },

  closeSlicerConnectionsDialog: () => {
    set({
      slicerConnectionsDialog: initialSlicerConnectionsDialogState,
    });
  },

  updateSlicerConnections: (_slicerId: string, connections: string[]) => {
    set((state) => ({
      slicerConnectionsDialog: {
        ...state.slicerConnectionsDialog,
        currentConnections: connections,
      },
    }));
  },
});
