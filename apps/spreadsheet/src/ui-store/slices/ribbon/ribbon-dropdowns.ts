/**
 * Ribbon Dropdowns UI Store Slice (Unified Keytip Router)
 *
 * Holds the open-state of every named ribbon group/tab dropdown that
 * needs to be openable from a typed keyboard chord (Excel `Alt+keytip`
 * flow). One slice serves all dropdowns — each consuming component
 * reads/writes its slot via a stable `dropdownId`.
 *
 * This consolidates what would otherwise be ~25 individual picker
 * slices (one per dropdown) into a single, dropdown-id-agnostic slot
 * map. Adding a new dropdown only requires extending the
 * `RibbonDropdownId` union in
 * `types/editor/src/actions/action-types.ts` and wiring the
 * component as a controlled `<RibbonDropdown open onOpenChange>`.
 *
 * The keyboard system fires `OPEN_RIBBON_DROPDOWN` / `CLOSE_RIBBON_DROPDOWN`
 * with `actionArg: { dropdownId }`; the handlers below mutate this slice.
 *
 * Wire each consumer as a controlled component:
 * ```tsx
 * const open = useUIStore(s => s.ribbonDropdowns['home.merge']);
 * const openDropdown = useUIStore(s => s.openRibbonDropdown);
 * const closeDropdown = useUIStore(s => s.closeRibbonDropdown);
 * <RibbonDropdown
 * open={!!open}
 * onOpenChange={(o) => o ? openDropdown('home.merge') : closeDropdown('home.merge')}
 * />
 * ```
 *
 */

import type { RibbonDropdownId } from '@mog-sdk/contracts/actions';
import type { StateCreator } from 'zustand';

/** Open-state map keyed by dropdown id. Absent / `false` ⇒ closed. */
export type RibbonDropdownOpenMap = Partial<Record<RibbonDropdownId, boolean>>;

export interface RibbonDropdownsSlice {
  /** Open-state of every named ribbon dropdown. */
  ribbonDropdowns: RibbonDropdownOpenMap;
  /** Open a specific named dropdown. */
  openRibbonDropdown: (dropdownId: RibbonDropdownId) => void;
  /** Close a specific named dropdown. */
  closeRibbonDropdown: (dropdownId: RibbonDropdownId) => void;
}

export const createRibbonDropdownsSlice: StateCreator<
  RibbonDropdownsSlice,
  [],
  [],
  RibbonDropdownsSlice
> = (set) => ({
  ribbonDropdowns: {},

  openRibbonDropdown: (dropdownId) => {
    set((state) => ({
      ribbonDropdowns: { ...state.ribbonDropdowns, [dropdownId]: true },
    }));
  },

  closeRibbonDropdown: (dropdownId) => {
    set((state) => ({
      ribbonDropdowns: { ...state.ribbonDropdowns, [dropdownId]: false },
    }));
  },
});
