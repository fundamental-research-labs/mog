/**
 * Context Menu Slice
 *
 * Manages state for the context menu (right-click menu).
 */

import type { StateCreator } from 'zustand';

import type { ContextMenuState, ContextMenuTarget } from '@mog-sdk/contracts/context-menu';
import { INITIAL_CONTEXT_MENU_STATE } from '@mog-sdk/contracts/context-menu';

export interface ContextMenuSlice {
  contextMenu: ContextMenuState;
  openContextMenu: (state: {
    x: number;
    y: number;
    target: ContextMenuTarget;
    targetRow?: number;
    targetCol?: number;
    /** Pivot table ID if clicking on a pivot (for pivot targets) */
    pivotId?: string;
    /** Pivot header key if clicking on a pivot row/column header */
    pivotHeaderKey?: string;
    /** Pivot field ID if clicking on a specific field in the pivot */
    pivotFieldId?: string;
  }) => void;
  closeContextMenu: () => void;
}

export const createContextMenuSlice: StateCreator<ContextMenuSlice, [], [], ContextMenuSlice> = (
  set,
) => ({
  contextMenu: INITIAL_CONTEXT_MENU_STATE,

  openContextMenu: (state) => {
    set((prev) => ({
      contextMenu: {
        isOpen: true,
        x: state.x,
        y: state.y,
        target: state.target,
        targetRow: state.targetRow,
        targetCol: state.targetCol,
        pivotId: state.pivotId,
        pivotHeaderKey: state.pivotHeaderKey,
        pivotFieldId: state.pivotFieldId,
        instanceId: prev.contextMenu.instanceId + 1,
      },
    }));
  },

  closeContextMenu: () => {
    set({ contextMenu: INITIAL_CONTEXT_MENU_STATE });
  },
});
