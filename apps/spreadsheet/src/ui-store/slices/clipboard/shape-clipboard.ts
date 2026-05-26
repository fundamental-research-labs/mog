/**
 * Shape Clipboard Slice
 *
 * Manages ephemeral clipboard state for shape copy/cut/paste operations.
 * Architecture:
 * - UIStore holds ephemeral clipboard state (not synced to Yjs)
 * - Copied shape data is serialized for paste
 * - Cut operation stores source shape IDs for deletion after paste
 * - Supports multiple shapes (multi-select copy/paste)
 *
 */

import type { StateCreator } from 'zustand';

import type { ShapeObject } from '@mog-sdk/contracts/floating-objects';

/**
 * Serialized shape data for clipboard operations.
 * Contains all data needed to recreate the shape on paste.
 */
export interface ShapeClipboardData {
  /** Serialized shape configuration (without ID - new ID generated on paste) */
  config: Omit<ShapeObject, 'id'>;
  /** Original shape ID (for reference) */
  originalId: string;
}

/**
 * Shape clipboard state
 */
export interface ShapeClipboardState {
  /** Copied shapes data (empty array if clipboard empty) */
  copiedShapes: ShapeClipboardData[];
  /** Source sheet ID for cross-sheet paste */
  sourceSheetId: string | null;
  /** Source shape IDs if this was a cut operation (for deletion after paste) */
  cutShapeIds: string[];
  /** Whether the clipboard contains cut shapes (vs copy) */
  isCut: boolean;
  /** Timestamp when copied */
  copiedAt: number | null;
}

export interface ShapeClipboardSlice {
  /** Shape clipboard state */
  shapeClipboard: ShapeClipboardState;

  /**
   * Copy shapes to clipboard.
   * Does not modify the source shapes.
   * @param shapes Array of shapes to copy
   * @param sourceSheetId Sheet containing the source shapes
   */
  copyShapesToClipboard: (shapes: ShapeObject[], sourceSheetId: string) => void;

  /**
   * Cut shapes to clipboard.
   * Marks the shapes for deletion after paste.
   * @param shapes Array of shapes to cut
   * @param sourceSheetId Sheet containing the source shapes
   */
  cutShapesToClipboard: (shapes: ShapeObject[], sourceSheetId: string) => void;

  /**
   * Clear the shape clipboard.
   * Called after paste (for cut) or when clipboard is cleared.
   */
  clearShapeClipboard: () => void;

  /**
   * Check if shape clipboard has content.
   */
  hasShapesInClipboard: () => boolean;

  /**
   * Get the number of shapes in clipboard.
   */
  getShapeClipboardCount: () => number;
}

const initialShapeClipboard: ShapeClipboardState = {
  copiedShapes: [],
  sourceSheetId: null,
  cutShapeIds: [],
  isCut: false,
  copiedAt: null,
};

export const createShapeClipboardSlice: StateCreator<
  ShapeClipboardSlice,
  [],
  [],
  ShapeClipboardSlice
> = (set, get) => ({
  shapeClipboard: initialShapeClipboard,

  copyShapesToClipboard: (shapes: ShapeObject[], sourceSheetId: string) => {
    const copiedShapes: ShapeClipboardData[] = shapes.map((shape) => {
      const { id, ...configWithoutId } = shape;
      return {
        config: configWithoutId,
        originalId: id,
      };
    });

    set({
      shapeClipboard: {
        copiedShapes,
        sourceSheetId,
        cutShapeIds: [],
        isCut: false,
        copiedAt: Date.now(),
      },
    });
  },

  cutShapesToClipboard: (shapes: ShapeObject[], sourceSheetId: string) => {
    const copiedShapes: ShapeClipboardData[] = shapes.map((shape) => {
      const { id, ...configWithoutId } = shape;
      return {
        config: configWithoutId,
        originalId: id,
      };
    });

    set({
      shapeClipboard: {
        copiedShapes,
        sourceSheetId,
        cutShapeIds: shapes.map((s) => s.id),
        isCut: true,
        copiedAt: Date.now(),
      },
    });
  },

  clearShapeClipboard: () => {
    set({ shapeClipboard: initialShapeClipboard });
  },

  hasShapesInClipboard: () => {
    return get().shapeClipboard.copiedShapes.length > 0;
  },

  getShapeClipboardCount: () => {
    return get().shapeClipboard.copiedShapes.length;
  },
});
