/**
 * Active Ribbon Tab Slice Tests (visible-tabs ownership)
 *
 * Core contracts:
 * 1. `setActiveRibbonTab(tabId)` is a no-op when `tabId`'s gate is
 * false (and emits a `__dt` breadcrumb on rejection); a normal
 * write when ungated.
 * 2. contextual tabs auto-promote only on initial contextual entry
 * from Home or active-tab invalid repair.
 * 3. `setContextualTabIds([])` while `activeRibbonTab` is a
 * contextual id atomically repairs `activeRibbonTab` to `'home'`.
 */

import { jest } from '@jest/globals';
import { PUBLIC_RIBBON_VISIBILITY_CONFIG } from '@mog-sdk/contracts/ribbon';
import { create } from 'zustand';

import {
  createActiveRibbonTabSlice,
  RIBBON_BASE_TABS,
  type ActiveRibbonTabSlice,
} from '../ribbon/active-tab';

function createTestStore() {
  return create<ActiveRibbonTabSlice>()(createActiveRibbonTabSlice);
}

describe('ActiveRibbonTabSlice', () => {
  describe('setActiveRibbonTab — validating setter', () => {
    it("is a no-op when the target tab's gate is false (draw gated)", () => {
      const store = createTestStore();
      // Gate draw: false ⇒ visibleBaseTabs excludes 'draw'.
      store.getState().setRibbonGates({ draw: false });
      expect(store.getState().visibleBaseTabs).not.toContain('draw');
      // Capture breadcrumb emission. The slice's preferred path is
      // `window.__dt.breadcrumb(...)`; the documented fallback is
      // `console.debug(...)` when `__dt.breadcrumb` is absent. The
      // test environment has neither, so install a fake `__dt` to
      // observe the call.
      type Breadcrumb = (event: string, payload?: unknown) => void;
      const breadcrumb = jest.fn<void, Parameters<Breadcrumb>>();
      const w = globalThis as unknown as { __dt?: { breadcrumb?: Breadcrumb } };
      const prev = w.__dt;
      w.__dt = { breadcrumb };
      try {
        const before = store.getState().activeRibbonTab;
        store.getState().setActiveRibbonTab('draw');
        const after = store.getState().activeRibbonTab;
        expect(after).toBe(before);
        expect(breadcrumb).toHaveBeenCalledTimes(1);
        expect(breadcrumb).toHaveBeenCalledWith('ribbon.setActiveTab.rejected', {
          tabId: 'draw',
          reason: 'gated-or-unknown',
        });
      } finally {
        w.__dt = prev;
      }
    });

    it('writes activeRibbonTab when the target tab is ungated (page default ⇒ shown)', () => {
      const store = createTestStore();
      // Default gates (no overrides) ⇒ all base tabs visible.
      expect(store.getState().visibleBaseTabs).toContain('page');
      store.getState().setActiveRibbonTab('page', { source: 'user' });
      expect(store.getState().activeRibbonTab).toBe('page');
      expect(store.getState().activeRibbonTabSelectionSource).toBe('user');
    });

    it('accepts a contextual tab id when it is in contextualTabIds', () => {
      const store = createTestStore();
      store.getState().setContextualTabIds(['table-design']);
      // Validating setter must allow contextual ids in the visible set.
      store.getState().setActiveRibbonTab('table-design');
      expect(store.getState().activeRibbonTab).toBe('table-design');
    });

    it('rejects a contextual tab id when it is NOT in contextualTabIds', () => {
      const store = createTestStore();
      // No contextual tabs registered; chart-design should be rejected.
      const before = store.getState().activeRibbonTab;
      store.getState().setActiveRibbonTab('chart-design');
      expect(store.getState().activeRibbonTab).toBe(before);
    });
  });

  describe('setContextualTabIds — atomic two-field transition', () => {
    it('auto-promotes from Home on initial pivot contextual entry', () => {
      const store = createTestStore();

      store.getState().setContextualTabIds(['pivot-analyze', 'pivot-design']);

      expect(store.getState().contextualTabIds).toEqual(['pivot-analyze', 'pivot-design']);
      expect(store.getState().activeRibbonTab).toBe('pivot-analyze');
      expect(store.getState().activeRibbonTabSelectionSource).toBe('system');
    });

    it('does not auto-promote on initial contextual entry when a non-Home base tab is active', () => {
      const store = createTestStore();
      store.getState().setActiveRibbonTab('insert', { source: 'user' });

      store.getState().setContextualTabIds(['pivot-analyze', 'pivot-design']);

      expect(store.getState().activeRibbonTab).toBe('insert');
      expect(store.getState().activeRibbonTabSelectionSource).toBe('user');
    });

    it('keeps user-selected Home while the pivot contextual set remains stable', () => {
      const store = createTestStore();
      store.getState().setContextualTabIds(['pivot-analyze', 'pivot-design']);
      expect(store.getState().activeRibbonTab).toBe('pivot-analyze');

      store.getState().setActiveRibbonTab('home', { source: 'user' });
      store.getState().setContextualTabIds(['pivot-analyze', 'pivot-design']);

      expect(store.getState().activeRibbonTab).toBe('home');
      expect(store.getState().activeRibbonTabSelectionSource).toBe('user');
      expect(store.getState().activeRibbonTabUserSelectionContextualKey).toBe(
        'pivot-analyze\u001fpivot-design',
      );
    });

    it('expires a user-selected Home override when the contextual set changes', () => {
      const store = createTestStore();
      store.getState().setContextualTabIds(['pivot-analyze', 'pivot-design']);
      store.getState().setActiveRibbonTab('home', { source: 'user' });

      store.getState().setContextualTabIds(['table-design']);

      expect(store.getState().activeRibbonTab).toBe('table-design');
      expect(store.getState().activeRibbonTabSelectionSource).toBe('system');
      expect(store.getState().activeRibbonTabUserSelectionContextualKey).toBeNull();
    });

    it('repairs an invalid active tab to the first contextual tab when another contextual class replaces it', () => {
      const store = createTestStore();
      store.getState().setContextualTabIds(['table-design']);
      store.getState().setActiveRibbonTab('table-design', { source: 'user' });

      store.getState().setContextualTabIds(['pivot-analyze', 'pivot-design']);

      expect(store.getState().activeRibbonTab).toBe('pivot-analyze');
      expect(store.getState().activeRibbonTabSelectionSource).toBe('system');
    });

    it('resets activeRibbonTab to "home" in a SINGLE emission when the active pivot contextual tab disappears', () => {
      const store = createTestStore();
      // Make 'pivot-design' the active tab via the validating path.
      store.getState().setContextualTabIds(['pivot-analyze', 'pivot-design']);
      store.getState().setActiveRibbonTab('pivot-design', { source: 'user' });
      expect(store.getState().activeRibbonTab).toBe('pivot-design');

      // Subscribe AFTER activation so the test only counts emissions
      // produced by the next call. Zustand's plain `subscribe` fires
      // on every `set()` that is shallow-different from the previous
      // state; an atomic transition therefore produces exactly one
      // emission, while a two-step (contextual ids first, then a
      // separate `set()` for activeRibbonTab) would produce two.
      const emissions: Array<{
        activeRibbonTab: string;
        contextualTabIds: string[];
      }> = [];
      const unsub = store.subscribe((s) => {
        emissions.push({
          activeRibbonTab: s.activeRibbonTab,
          contextualTabIds: [...s.contextualTabIds],
        });
      });
      try {
        store.getState().setContextualTabIds([]);
      } finally {
        unsub();
      }

      expect(emissions).toHaveLength(1);
      expect(emissions[0].activeRibbonTab).toBe('home');
      expect(emissions[0].contextualTabIds).toEqual([]);
    });

    it('applies the same initial-entry policy to non-pivot contextual tabs', () => {
      const store = createTestStore();
      store.getState().setContextualTabIds(['table-design']);

      expect(store.getState().activeRibbonTab).toBe('table-design');
      expect(store.getState().activeRibbonTabSelectionSource).toBe('system');
    });

    it('does not emit when called with the SAME ids (shallow-equal guard)', () => {
      const store = createTestStore();
      store.getState().setContextualTabIds(['table-design']);
      const emissions: Array<unknown> = [];
      const unsub = store.subscribe(() => emissions.push(null));
      try {
        // Same contents, new array reference.
        store.getState().setContextualTabIds(['table-design']);
      } finally {
        unsub();
      }
      // No emission — without this guard, useContextualTabs would loop
      // because every selection-state churn re-runs its effect with a
      // new (but identical) ids array.
      expect(emissions).toHaveLength(0);
    });
  });

  describe('setRibbonGates', () => {
    it('replaces visibleBaseTabs with the gated subset', () => {
      const store = createTestStore();
      store.getState().setRibbonGates({ draw: false, view: false });
      const visible = store.getState().visibleBaseTabs;
      expect(visible).not.toContain('draw');
      expect(visible).not.toContain('view');
      expect(visible).toContain('home');
      expect(visible).toContain('page');
    });

    it('filters base tabs with ribbonVisibility', () => {
      const store = createTestStore();
      store.getState().setRibbonGates(undefined, { pageLayout: false });
      const visible = store.getState().visibleBaseTabs;
      expect(visible).not.toContain('page');
      expect(visible).toContain('home');
    });

    it('filters public-profile hidden tabs from the base tab list', () => {
      const store = createTestStore();
      store.getState().setRibbonGates(undefined, PUBLIC_RIBBON_VISIBILITY_CONFIG);
      const visible = store.getState().visibleBaseTabs;
      expect(visible).toContain('home');
      expect(visible).toContain('insert');
      expect(visible).toContain('formulas');
      expect(visible).toContain('data');
      expect(visible).not.toContain('page');
      expect(visible).not.toContain('help');
      expect(visible).toContain('review');
      expect(visible).toContain('view');
    });

    it('accepts pageLayout as a legacy gate alias for the Page Layout tab', () => {
      const store = createTestStore();
      store.getState().setRibbonGates({ pageLayout: false });
      expect(store.getState().visibleBaseTabs).not.toContain('page');
    });

    it('treats undefined gates as visible for supported base tabs only', () => {
      const store = createTestStore();
      store.getState().setRibbonGates(undefined);
      const visible = store.getState().visibleBaseTabs;
      expect(visible).toContain('home');
      expect(visible).not.toContain('draw');
      expect(visible).not.toContain('automate');
      expect(visible).not.toContain('experimental');
      expect(visible).toContain('help');
      expect(visible).toContain('view');
    });

    it('does not register removed Automate or Experimental base tabs', () => {
      const ids = RIBBON_BASE_TABS.map((tab) => tab.id);
      expect(ids).not.toContain('automate');
      expect(ids).not.toContain('experimental');
      expect(ids).toContain('help');
    });
  });
});
