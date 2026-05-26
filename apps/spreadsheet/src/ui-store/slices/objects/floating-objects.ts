/**
 * Floating Objects Slice
 *
 * Manages state for floating objects UI
 * Includes insert picture dialog, insert shape menu, and object context menu.
 */

import type { StateCreator } from 'zustand';

/**
 * Insert Picture dialog state
 */
export interface InsertPictureDialogState {
  /** Whether the dialog is open */
  isOpen: boolean;
}

/**
 * Insert Shape menu state
 */
export interface InsertShapeMenuState {
  /** Whether the shape menu is open */
  isOpen: boolean;
  /** Anchor element position for dropdown positioning */
  anchorX: number;
  anchorY: number;
}

/**
 * Object context menu state
 */
export interface ObjectContextMenuState {
  /** Whether the context menu is open */
  isOpen: boolean;
  /** Position X */
  x: number;
  /** Position Y */
  y: number;
  /** Target object ID */
  targetObjectId: string | null;
  /** Monotonically increasing counter to force React remount on each open */
  instanceId: number;
}

export interface FloatingObjectsSlice {
  insertPictureDialog: InsertPictureDialogState;
  insertShapeMenu: InsertShapeMenuState;
  objectContextMenu: ObjectContextMenuState;
  openInsertPictureDialog: () => void;
  closeInsertPictureDialog: () => void;
  openInsertShapeMenu: (anchorX: number, anchorY: number) => void;
  closeInsertShapeMenu: () => void;
  openObjectContextMenu: (x: number, y: number, objectId: string) => void;
  closeObjectContextMenu: () => void;
}

const initialInsertPicture: InsertPictureDialogState = {
  isOpen: false,
};

const initialInsertShape: InsertShapeMenuState = {
  isOpen: false,
  anchorX: 0,
  anchorY: 0,
};

const initialObjectContextMenu: ObjectContextMenuState = {
  isOpen: false,
  x: 0,
  y: 0,
  targetObjectId: null,
  instanceId: 0,
};

export const createFloatingObjectsSlice: StateCreator<
  FloatingObjectsSlice,
  [],
  [],
  FloatingObjectsSlice
> = (set) => ({
  insertPictureDialog: initialInsertPicture,
  insertShapeMenu: initialInsertShape,
  objectContextMenu: initialObjectContextMenu,

  openInsertPictureDialog: () => {
    set({ insertPictureDialog: { isOpen: true } });
  },

  closeInsertPictureDialog: () => {
    set({ insertPictureDialog: initialInsertPicture });
  },

  openInsertShapeMenu: (anchorX: number, anchorY: number) => {
    set({
      insertShapeMenu: {
        isOpen: true,
        anchorX,
        anchorY,
      },
    });
  },

  closeInsertShapeMenu: () => {
    set({ insertShapeMenu: initialInsertShape });
  },

  openObjectContextMenu: (x: number, y: number, objectId: string) => {
    set((prev) => ({
      objectContextMenu: {
        isOpen: true,
        x,
        y,
        targetObjectId: objectId,
        instanceId: prev.objectContextMenu.instanceId + 1,
      },
    }));
  },

  closeObjectContextMenu: () => {
    set({ objectContextMenu: initialObjectContextMenu });
  },
});
