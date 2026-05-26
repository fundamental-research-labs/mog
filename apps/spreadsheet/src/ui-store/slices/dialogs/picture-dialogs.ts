/**
 * Picture Dialogs Slice
 *
 * Manages state for Format Picture and Edit Alt Text dialogs.
 * These dialogs are opened from the image context menu (right-click on picture).
 *
 * Architecture:
 * - Dialog state is ephemeral (not collaborative)
 * - Picture data access via FloatingObjectManager
 * - Picture mutations via dispatch() to action handlers
 *
 */

import type { StateCreator } from 'zustand';

/**
 * Format Picture dialog state
 */
export interface FormatPictureDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Target picture object ID */
  targetObjectId: string | null;
}

/**
 * Edit Alt Text dialog state
 */
export interface EditAltTextDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Target picture object ID */
  targetObjectId: string | null;
}

export interface PictureDialogsSlice {
  formatPictureDialog: FormatPictureDialogState;
  editAltTextDialog: EditAltTextDialogState;
  openFormatPictureDialog: (objectId: string) => void;
  closeFormatPictureDialog: () => void;
  openEditAltTextDialog: (objectId: string) => void;
  closeEditAltTextDialog: () => void;
}

const initialFormatPictureDialog: FormatPictureDialogState = {
  isOpen: false,
  targetObjectId: null,
};

const initialEditAltTextDialog: EditAltTextDialogState = {
  isOpen: false,
  targetObjectId: null,
};

export const createPictureDialogsSlice: StateCreator<
  PictureDialogsSlice,
  [],
  [],
  PictureDialogsSlice
> = (set) => ({
  formatPictureDialog: initialFormatPictureDialog,
  editAltTextDialog: initialEditAltTextDialog,

  openFormatPictureDialog: (objectId: string) => {
    set({
      formatPictureDialog: {
        isOpen: true,
        targetObjectId: objectId,
      },
    });
  },

  closeFormatPictureDialog: () => {
    set({ formatPictureDialog: initialFormatPictureDialog });
  },

  openEditAltTextDialog: (objectId: string) => {
    set({
      editAltTextDialog: {
        isOpen: true,
        targetObjectId: objectId,
      },
    });
  },

  closeEditAltTextDialog: () => {
    set({ editAltTextDialog: initialEditAltTextDialog });
  },
});
