/**
 * Slicer Report Connections Dialog Slice
 *
 * Manages state for the Slicer Report Connections dialog.
 * This dialog shows which PivotTables/tables a slicer reports to.
 *
 * Distinct from SlicerConnectionsDialog which manages table connections.
 * This dialog is opened from the slicer context menu "Report Connections".
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Slicer Report Connections Dialog state
 */
export interface SlicerReportConnectionsDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** ID of the slicer being inspected */
  slicerId: string | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface SlicerReportConnectionsDialogSlice {
  /** Slicer Report Connections Dialog state */
  slicerReportConnectionsDialog: SlicerReportConnectionsDialogState;

  /** Open the slicer report connections dialog */
  openSlicerReportConnections: (slicerId: string) => void;

  /** Close the slicer report connections dialog */
  closeSlicerReportConnections: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialSlicerReportConnectionsDialogState: SlicerReportConnectionsDialogState = {
  isOpen: false,
  slicerId: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createSlicerReportConnectionsDialogSlice: StateCreator<
  SlicerReportConnectionsDialogSlice,
  [],
  [],
  SlicerReportConnectionsDialogSlice
> = (set) => ({
  slicerReportConnectionsDialog: initialSlicerReportConnectionsDialogState,

  openSlicerReportConnections: (slicerId: string) => {
    set({
      slicerReportConnectionsDialog: {
        isOpen: true,
        slicerId,
      },
    });
  },

  closeSlicerReportConnections: () => {
    set({
      slicerReportConnectionsDialog: initialSlicerReportConnectionsDialogState,
    });
  },
});
