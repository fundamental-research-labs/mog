/**
 * Feature Gates Context
 *
 * Provides React context for FeatureGates config.
 * Components self-gate via hooks — callers don't need to know which features are gated.
 *
 * visible-tabs ownership: a sibling component, `RibbonGatesBridge`, pushes
 * `gates.tabs` into the per-document `uiStore` so
 * `setActiveRibbonTab` can validate writes at the slice layer
 * (instead of letting React patch invalid writes via a fallback
 * `useEffect`). The bridge is a separate component rather than an
 * effect inside `FeatureGatesProvider` because the provider has
 * standalone test consumers that render it WITHOUT a
 * `DocumentContext.Provider`; co-locating the bridge here would force
 * those tests to wrap with a document context (and pull every
 * document-context dep into Jest's transform graph). The bridge is
 * mounted from `apps/spreadsheet/src/index.tsx` where both contexts
 * are already in scope.
 *
 * @see mog/contracts/src/feature-gates.ts for the FeatureGates type
 */

import { createContext, useContext, useEffect } from 'react';
import type { FeatureGates } from '@mog-sdk/contracts/feature-gates';
import type { StoreApi } from 'zustand';
import type { ActiveRibbonTabSlice } from '../../ui-store/slices/ribbon';

// =============================================================================
// Context
// =============================================================================

const FeatureGatesContext = createContext<FeatureGates>({});

// =============================================================================
// Provider
// =============================================================================

export function FeatureGatesProvider({
  gates,
  children,
}: {
  gates: FeatureGates;
  children: React.ReactNode;
}) {
  return <FeatureGatesContext.Provider value={gates}>{children}</FeatureGatesContext.Provider>;
}

// =============================================================================
// Ribbon Gates Bridge (visible-tabs ownership)
// =============================================================================

/**
 * Push `gates.tabs` into the ribbon slice's `setRibbonGates`.
 *
 * Mounted from `apps/spreadsheet/src/index.tsx` where both the gates
 * config and the per-document `uiStore` are already in scope. This is
 * a separate component (rather than a `useEffect` inside
 * `FeatureGatesProvider`) so the gates provider's standalone tests do
 * NOT pull the document-context dependency graph into Jest's
 * transform path.
 *
 * Renders nothing. The directionality is one-way (gates → store);
 * never the other direction.
 */
export function RibbonGatesBridge({
  gates,
  uiStore,
}: {
  gates: FeatureGates;
  uiStore: StoreApi<ActiveRibbonTabSlice>;
}): null {
  useEffect(() => {
    uiStore.getState().setRibbonGates(gates.tabs, gates.ribbonVisibility);
  }, [gates.ribbonVisibility, gates.tabs, uiStore]);
  return null;
}

// =============================================================================
// Hooks
// =============================================================================

/** Returns true if a top-level mode is enabled (default: true) */
export function useFeatureMode(mode: 'ribbon' | 'editing'): boolean {
  const gates = useContext(FeatureGatesContext);
  return gates[mode] ?? true;
}

/** Returns true if the feature is enabled (default: true) */
export function useFeatureGate(category: 'tabs' | 'groups' | 'capabilities', key: string): boolean {
  const gates = useContext(FeatureGatesContext);
  const categoryGates = gates[category] as Record<string, boolean | undefined> | undefined;
  return categoryGates?.[key] ?? true;
}

/** Returns the full gates object (for batch checks) */
export function useFeatureGates(): FeatureGates {
  return useContext(FeatureGatesContext);
}
