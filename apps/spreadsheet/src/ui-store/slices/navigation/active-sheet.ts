/**
 * Active Sheet Slice
 *
 * Manages which sheet is currently active/visible.
 */

import type { StateCreator } from 'zustand';

import type { SheetId } from '@mog-sdk/contracts/core';

export interface ActiveSheetSlice {
  activeSheetId: SheetId;
  setActiveSheet: (sheetId: SheetId) => void;
}

export const createActiveSheetSlice =
  (initialSheetId: SheetId): StateCreator<ActiveSheetSlice, [], [], ActiveSheetSlice> =>
  (set) => ({
    activeSheetId: initialSheetId,

    setActiveSheet: (sheetId: SheetId) => {
      // NOTE: Editor cancellation and renderer sheet switch are handled by
      // SheetCoordinator via setupSheetSwitchCoordination. The coordinator
      // subscribes to activeSheetId changes and:
      // 1. Cancels editor if editing on a different sheet
      // 2. Sends SWITCH_SHEET to renderer machine
      // 3. Resets selection via selection machine
      // See: cross-coordination.ts, CoordinatorProvider.tsx
      set({ activeSheetId: sheetId });
    },
  });
