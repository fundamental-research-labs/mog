/**
 * Slicer Size & Properties Dialog Slice
 *
 * Manages state for the Slicer Size and Properties panel.
 * This panel is opened from the slicer context menu "Size and Properties".
 *
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

/**
 * Slicer Size & Properties Dialog state
 */
export interface SlicerSizePropertiesDialogState {
  /** Whether the panel is open */
  isOpen: boolean;
  /** ID of the slicer being configured */
  slicerId: string | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface SlicerSizePropertiesDialogSlice {
  /** Slicer Size & Properties Dialog state */
  slicerSizePropertiesDialog: SlicerSizePropertiesDialogState;

  /** Open the slicer size and properties panel */
  openSlicerSizeProperties: (slicerId: string) => void;

  /** Close the slicer size and properties panel */
  closeSlicerSizeProperties: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialSlicerSizePropertiesDialogState: SlicerSizePropertiesDialogState = {
  isOpen: false,
  slicerId: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

export const createSlicerSizePropertiesDialogSlice: StateCreator<
  SlicerSizePropertiesDialogSlice,
  [],
  [],
  SlicerSizePropertiesDialogSlice
> = (set) => ({
  slicerSizePropertiesDialog: initialSlicerSizePropertiesDialogState,

  openSlicerSizeProperties: (slicerId: string) => {
    set({
      slicerSizePropertiesDialog: {
        isOpen: true,
        slicerId,
      },
    });
  },

  closeSlicerSizeProperties: () => {
    set({
      slicerSizePropertiesDialog: initialSlicerSizePropertiesDialogState,
    });
  },
});
