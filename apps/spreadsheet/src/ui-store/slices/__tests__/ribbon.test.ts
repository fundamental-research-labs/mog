import { create } from 'zustand';

import { createRibbonSlice, type RibbonSlice } from '../ribbon/ribbon';

function createTestStore() {
  return create<RibbonSlice>()((...args) => createRibbonSlice(...args));
}

describe('RibbonSlice', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('clears temporary show when collapsing the ribbon', () => {
    const store = createTestStore();
    store.getState().setDisplayMode('tabs-only');
    store.getState().showTemporarily();

    expect(store.getState().temporaryShow).toBe(true);

    store.getState().toggleRibbon();

    expect(store.getState().ribbonCollapsed).toBe(true);
    expect(store.getState().temporaryShow).toBe(false);
  });

  it('temporarily exposes commands when expanding a tabs-only ribbon', () => {
    const store = createTestStore();
    store.getState().setDisplayMode('tabs-only');
    store.getState().toggleRibbon();

    expect(store.getState().ribbonCollapsed).toBe(true);

    store.getState().toggleRibbon();

    expect(store.getState().ribbonCollapsed).toBe(false);
    expect(store.getState().displayMode).toBe('tabs-only');
    expect(store.getState().temporaryShow).toBe(true);
  });

  it('recovers from a collapsed full ribbon through the tabs-mode shortcut', () => {
    const store = createTestStore();
    store.getState().toggleRibbon();

    expect(store.getState().ribbonCollapsed).toBe(true);

    store.getState().toggleTabsMode();

    expect(store.getState().ribbonCollapsed).toBe(false);
    expect(store.getState().displayMode).toBe('tabs-only');
    expect(store.getState().temporaryShow).toBe(true);
  });

  it('recovers from a collapsed tabs-only ribbon through the tabs-mode shortcut', () => {
    const store = createTestStore();
    store.getState().setDisplayMode('tabs-only');
    store.getState().toggleRibbon();

    expect(store.getState().ribbonCollapsed).toBe(true);

    store.getState().toggleTabsMode();

    expect(store.getState().ribbonCollapsed).toBe(false);
    expect(store.getState().displayMode).toBe('full');
    expect(store.getState().temporaryShow).toBe(false);
  });

  it('leaves auto-hide unchanged when toggling tabs mode', () => {
    const store = createTestStore();
    store.getState().setDisplayMode('auto-hide');
    store.getState().showTemporarily();

    store.getState().toggleTabsMode();

    expect(store.getState().ribbonCollapsed).toBe(false);
    expect(store.getState().displayMode).toBe('auto-hide');
    expect(store.getState().temporaryShow).toBe(true);
  });
});
