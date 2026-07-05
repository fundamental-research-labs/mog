import { createStore } from 'zustand/vanilla';

import {
  createRibbonDropdownsSlice,
  RIBBON_DROPDOWN_COLLAPSED_GROUPS,
  type RibbonDropdownsSlice,
} from './ribbon-dropdowns';

function createRibbonDropdownStore() {
  return createStore<RibbonDropdownsSlice>()(createRibbonDropdownsSlice);
}

describe('ribbon dropdown collapsed group routing', () => {
  test('documents owning groups for keytip-openable dropdowns', () => {
    expect(RIBBON_DROPDOWN_COLLAPSED_GROUPS['home.conditional-formatting']).toBe('styles');
    expect(RIBBON_DROPDOWN_COLLAPSED_GROUPS['home.format-as-table']).toBe('styles');
    expect(RIBBON_DROPDOWN_COLLAPSED_GROUPS['insert.shapes']).toBe('illustrations');
    expect(RIBBON_DROPDOWN_COLLAPSED_GROUPS['data.get-data']).toBe('importData');
    expect(RIBBON_DROPDOWN_COLLAPSED_GROUPS['table-design.style-gallery']).toBe('tableStyles');
  });

  test('opens the owning collapsed group when a child dropdown opens', () => {
    const store = createRibbonDropdownStore();

    store.getState().openRibbonDropdown('home.conditional-formatting');

    expect(store.getState().ribbonDropdowns['home.conditional-formatting']).toBe(true);
    expect(store.getState().ribbonCollapsedGroups.styles).toBe(true);
  });

  test('closing the last child dropdown closes its collapsed group', () => {
    const store = createRibbonDropdownStore();

    store.getState().openRibbonDropdown('home.conditional-formatting');
    store.getState().closeRibbonDropdown('home.conditional-formatting');

    expect(store.getState().ribbonDropdowns['home.conditional-formatting']).toBe(false);
    expect(store.getState().ribbonCollapsedGroups.styles).toBe(false);
  });

  test('closing one child dropdown keeps the group open while a sibling is open', () => {
    const store = createRibbonDropdownStore();

    store.getState().openRibbonDropdown('home.conditional-formatting');
    store.getState().openRibbonDropdown('home.format-as-table');
    store.getState().closeRibbonDropdown('home.conditional-formatting');

    expect(store.getState().ribbonDropdowns['home.conditional-formatting']).toBe(false);
    expect(store.getState().ribbonDropdowns['home.format-as-table']).toBe(true);
    expect(store.getState().ribbonCollapsedGroups.styles).toBe(true);
  });

  test('closing a collapsed group closes its child dropdowns only', () => {
    const store = createRibbonDropdownStore();

    store.getState().openRibbonDropdown('home.conditional-formatting');
    store.getState().openRibbonDropdown('home.format-as-table');
    store.getState().openRibbonDropdown('home.merge');
    store.getState().setRibbonCollapsedGroupOpen('styles', false);

    expect(store.getState().ribbonCollapsedGroups.styles).toBe(false);
    expect(store.getState().ribbonDropdowns['home.conditional-formatting']).toBe(false);
    expect(store.getState().ribbonDropdowns['home.format-as-table']).toBe(false);
    expect(store.getState().ribbonDropdowns['home.merge']).toBe(true);
    expect(store.getState().ribbonCollapsedGroups.alignment).toBe(true);
  });
});
