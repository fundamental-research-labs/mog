import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { create } from 'zustand';

import {
  createActiveRibbonTabSlice,
  type ActiveRibbonTabSlice,
} from '../../../../ui-store/slices/ribbon/active-tab';
import { SWITCH_RIBBON_TAB } from '../keytip-handlers';

function createTestStore() {
  return create<ActiveRibbonTabSlice>()(createActiveRibbonTabSlice);
}

function createDeps(uiStore: ReturnType<typeof createTestStore>): ActionDependencies {
  return {
    uiStore,
    workbook: {} as never,
    accessors: {} as never,
    commands: {} as never,
    platform: {} as never,
    shellService: {} as never,
    getActiveSheetId: () => 'sheet1' as never,
  } as ActionDependencies;
}

describe('SWITCH_RIBBON_TAB', () => {
  it('marks a base-tab keytip selection as user-selected while contextual tabs are visible', () => {
    const store = createTestStore();
    store.getState().setContextualTabIds(['pivot-analyze', 'pivot-design']);
    expect(store.getState().activeRibbonTab).toBe('pivot-analyze');

    const result = SWITCH_RIBBON_TAB(createDeps(store), { tabId: 'home' });

    expect(result.handled).toBe(true);
    expect(store.getState().activeRibbonTab).toBe('home');
    expect(store.getState().activeRibbonTabSelectionSource).toBe('user');
    expect(store.getState().activeRibbonTabUserSelectionContextualKey).toBe(
      'pivot-analyze\u001fpivot-design',
    );

    store.getState().setContextualTabIds(['pivot-analyze', 'pivot-design']);
    expect(store.getState().activeRibbonTab).toBe('home');
  });

  it('marks an optimistic contextual keytip selection as user-selected', () => {
    const store = createTestStore();

    const result = SWITCH_RIBBON_TAB(createDeps(store), { tabId: 'pivot-design' });

    expect(result.handled).toBe(true);
    expect(store.getState().contextualTabIds).toEqual(['pivot-design']);
    expect(store.getState().activeRibbonTab).toBe('pivot-design');
    expect(store.getState().activeRibbonTabSelectionSource).toBe('user');
  });
});
