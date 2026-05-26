/**
 * Active Ribbon Tab UI Store Slice (visible-tabs ownership — visible-tabs ownership)
 *
 * Owns three closely-related fields:
 * - `activeRibbonTab`: the currently-selected ribbon tab.
 * - `visibleBaseTabs`: the gates-filtered base tab id set (pushed in
 * from `FeatureGatesProvider` via `setRibbonGates`).
 * - `contextualTabIds`: the selection-driven contextual tab id set
 * (pushed in from `useContextualTabs` via `setContextualTabIds`).
 *
 * Together they let `setActiveRibbonTab` validate writes against the
 * union `[...visibleBaseTabs, ...contextualTabIds]` at write time, so
 * the slice rejects gated/non-existent ids instead of letting React
 * patch them up afterward.
 *
 * previous background: the slice was a passive store of a single
 * `activeRibbonTab` field; gating data lived in React (`TabbedToolbar`
 * merged `BASE_TABS` + gates + contextual configs) so the action
 * handler `SWITCH_RIBBON_TAB` could not validate and a fallback
 * `useEffect` snapped invalid writes back to home. That cascade is
 * 04-ribbon-tab-visibility-architecture.md`.
 */

import type { RibbonTabId } from '@mog-sdk/contracts/actions';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import type { StateCreator } from 'zustand';

// =============================================================================
// Base tabs (data-only; moved here from TabbedToolbar.tsx as part of
// so the slice — not the component — owns the membership).
// =============================================================================

/**
 * The base ribbon tabs in render order. Each entry's `gateKey` matches
 * a key on `FeatureGates.tabs`; an entry is hidden when its gate is
 * explicitly `false` (default `true` ⇒ shown).
 *
 * The File affordance is rendered as a standalone backstage-trigger
 * button in TabBar (ribbon-collapse control) — it is not in this list, and
 * `'file'` is not a `RibbonTabId`.
 */
export const RIBBON_BASE_TABS: ReadonlyArray<{
  id: RibbonTabId;
  label: string;
  gateKey?: string;
}> = [
  { id: 'home', label: 'Home', gateKey: 'home' },
  { id: 'insert', label: 'Insert', gateKey: 'insert' },
  // Draw/ink is not supported in the ribbon product surface yet. Keep the
  // contract gate for legacy host policies, but do not register a visible tab.
  { id: 'page', label: 'Page Layout' },
  { id: 'formulas', label: 'Formulas', gateKey: 'formulas' },
  { id: 'data', label: 'Data', gateKey: 'data' },
  { id: 'review', label: 'Review', gateKey: 'review' },
  { id: 'view', label: 'View', gateKey: 'view' },
];

/**
 * Compute the gates-filtered subset of `RIBBON_BASE_TABS` ids. Default
 * for any unset gate is `true` (shown).
 */
function filterBaseTabsByGates(gates: FeatureGates['tabs'] | undefined): RibbonTabId[] {
  const tabsGates = (gates ?? {}) as Record<string, boolean | undefined>;
  const out: RibbonTabId[] = [];
  for (const tab of RIBBON_BASE_TABS) {
    const gated = tab.gateKey ? tabsGates[tab.gateKey] : undefined;
    if (gated === false) continue;
    out.push(tab.id);
  }
  return out;
}

// =============================================================================
// Slice
// =============================================================================

export interface ActiveRibbonTabSlice {
  /**
   * Currently active ribbon tab. Defaults to `'home'`. Updated by the
   * `SWITCH_RIBBON_TAB` action handler or by direct UI clicks routed
   * through `setActiveRibbonTab`.
   */
  activeRibbonTab: RibbonTabId;
  /**
   * Gates-filtered base tab ids in render order. Pushed in by
   * `FeatureGatesProvider` via `setRibbonGates`.
   */
  visibleBaseTabs: RibbonTabId[];
  /**
   * Selection-driven contextual tab ids. Pushed in by
   * `useContextualTabs` via `setContextualTabIds`.
   */
  contextualTabIds: RibbonTabId[];
  /**
   * Validating setter. Rejects (no-ops) any tabId not currently in
   * `[...visibleBaseTabs, ...contextualTabIds]`. On rejection emits a
   * devtools breadcrumb so the silent path is observable in the
   * diagnoser instead of being misclassified as a noop handler.
   */
  setActiveRibbonTab: (tabId: RibbonTabId) => void;
  /**
   * Replace the gates-filtered base tab list. Called by
   * `FeatureGatesProvider` when `gates.tabs` changes. If the change
   * leaves `activeRibbonTab` outside the new visible set, this is NOT
   * the place to patch it — that's a React-layer concern (TabbedToolbar
   * mounts after gates are applied, and any fallback policy belongs
   * with the consumer). The validating setter owns the only write path
   * that can introduce an invalid active tab, so simply replacing the
   * list is safe.
   */
  setRibbonGates: (gates: FeatureGates['tabs'] | undefined) => void;
  /**
   * Replace the contextual tab id list. Performs an **atomic two-field
   * transition** in a single `set()` call: writes the new id list and
   * — if the current active tab is now outside `[...visibleBaseTabs,
   * ...ids]` — resets `activeRibbonTab` to `'home'` in the same update.
   *
   * This is intentionally NOT implemented as a slice subscription that
   * watches `contextualTabIds` and writes `activeRibbonTab` on change.
   * A subscription would re-introduce the cascade pattern, just wearing a
   * Zustand hat. One transition, one render.
   */
  setContextualTabIds: (ids: RibbonTabId[]) => void;
}

/**
 * Selector: `[...visibleBaseTabs, ...contextualTabIds]`. Use as
 * `useStore(uiStore, selectVisibleRibbonTabs)` from React, and
 * `selectVisibleRibbonTabs(uiStore.getState())` from invariants /
 * imperative call sites.
 */
export function selectVisibleRibbonTabs(state: ActiveRibbonTabSlice): RibbonTabId[] {
  return [...state.visibleBaseTabs, ...state.contextualTabIds];
}

export const createActiveRibbonTabSlice: StateCreator<
  ActiveRibbonTabSlice,
  [],
  [],
  ActiveRibbonTabSlice
> = (set, get) => ({
  activeRibbonTab: 'home',
  // Default: all base tabs visible (no gates applied yet). The
  // `FeatureGatesProvider` pushes the real gated set on mount.
  visibleBaseTabs: filterBaseTabsByGates(undefined),
  contextualTabIds: [],

  setActiveRibbonTab: (tabId) => {
    const state = get();
    const visible = selectVisibleRibbonTabs(state);
    if (!visible.includes(tabId)) {
      // Silent swallow is exactly the failure mode `doctor` cannot see and the
      // diagnoser misclassifies. Emit a structured breadcrumb so the rejection
      // is observable in devtools timelines / diagnose output.
      const reason = state.visibleBaseTabs.includes(tabId) ? 'unknown' : 'gated-or-unknown';
      const payload = { tabId, reason };
      try {
        const w = (typeof window !== 'undefined' ? window : undefined) as
          | { __dt?: { breadcrumb?: (event: string, payload?: unknown) => void } }
          | undefined;
        const breadcrumb = w?.__dt?.breadcrumb;
        if (typeof breadcrumb === 'function') {
          breadcrumb('ribbon.setActiveTab.rejected', payload);
        } else {
          // `__dt.breadcrumb` is not part of the current devtools
          // surface (`@mog/devtools` exposes
          // `captureError`, `getActionLog`, etc., but no breadcrumb
          // method). Fall back to `console.debug` with the same shape
          // — same observability contract, no silent path.
          // eslint-disable-next-line no-console
          console.debug('ribbon.setActiveTab.rejected', payload);
        }
      } catch {
        // Defensive: never let the breadcrumb path throw and break a
        // user-driven tab click.
      }
      return;
    }
    set({ activeRibbonTab: tabId });
  },

  setRibbonGates: (gates) => {
    const next = filterBaseTabsByGates(gates);
    const prev = get().visibleBaseTabs;
    // Skip the set() if the gated subset is identical to what's
    // already stored. The React-side bridge (`RibbonGatesBridge`)
    // re-runs whenever `gates.tabs` changes by reference, but a
    // parent re-render that recomputes the same shallow object would
    // produce a new `gates.tabs` reference with identical contents —
    // calling `set()` then would force a needless render cascade in
    // every `useStore(uiStore, ...)` consumer.
    if (arrayShallowEqual(prev, next)) return;
    set({ visibleBaseTabs: next });
  },

  setContextualTabIds: (ids) => {
    // Atomic two-field transition. Compute the post-update visible set
    // from the NEW ids (not from `get()` mid-flight) so the comparison
    // is on the value we're about to write.
    set((state) => {
      // Skip when the id set is unchanged (shallow contents equal).
      // Without this guard, `useContextualTabs`'s effect re-runs on
      // every selection-state churn and writes the same ids back to
      // the slice, which (a) wakes every `selectVisibleRibbonTabs`
      // consumer and (b) re-renders TabbedToolbar in a loop.
      if (arrayShallowEqual(state.contextualTabIds, ids)) {
        return state;
      }
      const nextVisible = new Set<RibbonTabId>([...state.visibleBaseTabs, ...ids]);
      if (nextVisible.has(state.activeRibbonTab)) {
        // Active tab still valid; only contextualTabIds changes.
        return { contextualTabIds: ids };
      }
      // Active tab is no longer in the visible set — reset to 'home'
      // in the SAME `set()` so subscribers see one transition, not two.
      return { contextualTabIds: ids, activeRibbonTab: 'home' };
    });
  },
});

// Internal: shallow array equality (length + index-by-index).
function arrayShallowEqual<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
