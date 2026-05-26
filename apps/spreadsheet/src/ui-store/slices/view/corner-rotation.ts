/**
 * Corner Rotation Slice
 *
 * Manages corner rotation state for Ctrl+. (Ctrl+Period) selection corner cycling.
 * This slice tracks which corner of a multi-cell selection is currently active,
 * allowing users to cycle through corners clockwise.
 *
 * Excel Parity 2.5: Ctrl+. corner rotation
 * - Order: topLeft (0) -> topRight (1) -> bottomRight (2) -> bottomLeft (3) -> topLeft (0)
 *
 * of Selection Handlers Refactor
 */

import type { StateCreator } from 'zustand';

/**
 * Corner index type - represents position in clockwise rotation.
 * 0 = topLeft, 1 = topRight, 2 = bottomRight, 3 = bottomLeft
 */
export type CornerIndex = 0 | 1 | 2 | 3;

export interface CornerRotationSlice {
  // State
  /** Current corner index in the rotation cycle (0-3) */
  cornerCurrentIndex: CornerIndex;
  /** Hash of the last selection - used to detect when selection changes */
  cornerLastSelectionHash: string;

  // Actions
  /**
   * Advance to the next corner in the rotation.
   * If the selection hash changed, resets to corner 1 (topRight - first advance from topLeft).
   * If the selection is the same, advances cyclically (0 -> 1 -> 2 -> 3 -> 0).
   */
  advanceCorner: (newSelectionHash: string) => void;

  /**
   * Get the current corner index for a given selection hash.
   * If the selection hash doesn't match, returns 0 (topLeft - starting position).
   */
  getCornerIndex: (selectionHash: string) => CornerIndex;

  /**
   * Reset corner rotation state to initial values.
   */
  resetCornerRotation: () => void;
}

export const createCornerRotationSlice: StateCreator<
  CornerRotationSlice,
  [],
  [],
  CornerRotationSlice
> = (set, get) => ({
  cornerCurrentIndex: 0,
  cornerLastSelectionHash: '',

  advanceCorner: (newSelectionHash: string) => {
    const { cornerCurrentIndex, cornerLastSelectionHash } = get();

    if (newSelectionHash !== cornerLastSelectionHash) {
      // Selection changed - reset to 0, then advance to 1
      // This matches the existing behavior where currentCornerIndex is set to 0
      // before the advance happens in the handler
      set({
        cornerCurrentIndex: 1,
        cornerLastSelectionHash: newSelectionHash,
      });
    } else {
      // Same selection - advance cyclically
      set({
        cornerCurrentIndex: ((cornerCurrentIndex + 1) % 4) as CornerIndex,
      });
    }
  },

  getCornerIndex: (selectionHash: string) => {
    const { cornerCurrentIndex, cornerLastSelectionHash } = get();

    if (selectionHash !== cornerLastSelectionHash) {
      // Selection changed - return 0 (will be reset on next advance)
      return 0;
    }

    return cornerCurrentIndex;
  },

  resetCornerRotation: () => {
    set({
      cornerCurrentIndex: 0,
      cornerLastSelectionHash: '',
    });
  },
});
