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
 * map. Adding a new dropdown requires extending the `RibbonDropdownId`
 * union in `types/editor/src/actions/action-types.ts`, adding its owning
 * group to `RIBBON_DROPDOWN_COLLAPSED_GROUPS`, and wiring the component as
 * a controlled `<RibbonDropdown open onOpenChange>`.
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

/** Open-state map keyed by normalized ribbon group visibility key. */
export type RibbonCollapsedGroupOpenMap = Partial<Record<string, boolean>>;

/**
 * Owning collapsed group for every keytip-openable ribbon dropdown.
 *
 * When a group collapses into a single popover button, a keytip must open both
 * the child dropdown and its parent group popover. Values intentionally use the
 * same normalized keys as `RibbonVisibilityGroup`.
 */
export const RIBBON_DROPDOWN_COLLAPSED_GROUPS = {
  'home.merge': 'alignment',
  'home.orientation': 'alignment',
  'home.autosum': 'editing',
  'home.fill': 'editing',
  'home.clear': 'editing',
  'home.sort-filter': 'editing',
  'home.find-select': 'editing',
  'home.insert': 'cells',
  'home.delete': 'cells',
  'home.format': 'cells',
  'home.format-as-table': 'styles',
  'home.cell-styles': 'styles',
  'home.conditional-formatting': 'styles',
  'insert.sparkline': 'sparklines',
  'insert.shapes': 'illustrations',
  'formulas.financial': 'functionLibrary',
  'formulas.logical': 'functionLibrary',
  'formulas.text': 'functionLibrary',
  'formulas.date-time': 'functionLibrary',
  'formulas.math-trig': 'functionLibrary',
  'data.get-data': 'importData',
  'page.margins': 'pageSetup',
  'page.orientation': 'pageSetup',
  'page.size': 'pageSetup',
  'page.print-area': 'pageSetup',
  'page.breaks': 'pageSetup',
  'view.freeze-panes': 'window',
  'view.appearance-mode': 'settings',
  'table-design.style-gallery': 'tableStyles',
} satisfies Record<RibbonDropdownId, string>;

const RIBBON_DROPDOWNS_BY_COLLAPSED_GROUP = Object.freeze(
  (Object.keys(RIBBON_DROPDOWN_COLLAPSED_GROUPS) as RibbonDropdownId[]).reduce<
    Partial<Record<string, RibbonDropdownId[]>>
  >((acc, dropdownId) => {
    const groupKey = RIBBON_DROPDOWN_COLLAPSED_GROUPS[dropdownId];
    (acc[groupKey] ??= []).push(dropdownId);
    return acc;
  }, {}),
);

export interface RibbonDropdownsSlice {
  /** Open-state of every named ribbon dropdown. */
  ribbonDropdowns: RibbonDropdownOpenMap;
  /** Open-state of collapsed ribbon group popovers. */
  ribbonCollapsedGroups: RibbonCollapsedGroupOpenMap;
  /** Open a specific named dropdown. */
  openRibbonDropdown: (dropdownId: RibbonDropdownId) => void;
  /** Close a specific named dropdown. */
  closeRibbonDropdown: (dropdownId: RibbonDropdownId) => void;
  /** Open or close a collapsed ribbon group popover. */
  setRibbonCollapsedGroupOpen: (groupKey: string, open: boolean) => void;
}

export const createRibbonDropdownsSlice: StateCreator<
  RibbonDropdownsSlice,
  [],
  [],
  RibbonDropdownsSlice
> = (set) => ({
  ribbonDropdowns: {},
  ribbonCollapsedGroups: {},

  openRibbonDropdown: (dropdownId) => {
    set((state) => {
      const groupKey = RIBBON_DROPDOWN_COLLAPSED_GROUPS[dropdownId];
      return {
        ribbonDropdowns: { ...state.ribbonDropdowns, [dropdownId]: true },
        ribbonCollapsedGroups: {
          ...state.ribbonCollapsedGroups,
          [groupKey]: true,
        },
      };
    });
  },

  closeRibbonDropdown: (dropdownId) => {
    set((state) => {
      const groupKey = RIBBON_DROPDOWN_COLLAPSED_GROUPS[dropdownId];
      const ribbonDropdowns = { ...state.ribbonDropdowns, [dropdownId]: false };
      if (hasOpenDropdownInCollapsedGroup(ribbonDropdowns, groupKey)) {
        return { ribbonDropdowns };
      }

      return {
        ribbonDropdowns,
        ribbonCollapsedGroups: {
          ...state.ribbonCollapsedGroups,
          [groupKey]: false,
        },
      };
    });
  },

  setRibbonCollapsedGroupOpen: (groupKey, open) => {
    set((state) => {
      if (open) {
        return {
          ribbonCollapsedGroups: {
            ...state.ribbonCollapsedGroups,
            [groupKey]: true,
          },
        };
      }

      return {
        ribbonCollapsedGroups: {
          ...state.ribbonCollapsedGroups,
          [groupKey]: false,
        },
        ribbonDropdowns: closeDropdownsForCollapsedGroup(state.ribbonDropdowns, groupKey),
      };
    });
  },
});

function closeDropdownsForCollapsedGroup(
  ribbonDropdowns: RibbonDropdownOpenMap,
  groupKey: string,
): RibbonDropdownOpenMap {
  const dropdownIds = RIBBON_DROPDOWNS_BY_COLLAPSED_GROUP[groupKey];
  if (!dropdownIds?.length) return ribbonDropdowns;

  let next: RibbonDropdownOpenMap | null = null;
  for (const dropdownId of dropdownIds) {
    if (ribbonDropdowns[dropdownId]) {
      next ??= { ...ribbonDropdowns };
      next[dropdownId] = false;
    }
  }

  return next ?? ribbonDropdowns;
}

function hasOpenDropdownInCollapsedGroup(
  ribbonDropdowns: RibbonDropdownOpenMap,
  groupKey: string,
): boolean {
  return (
    RIBBON_DROPDOWNS_BY_COLLAPSED_GROUP[groupKey]?.some(
      (dropdownId) => ribbonDropdowns[dropdownId],
    ) ?? false
  );
}
