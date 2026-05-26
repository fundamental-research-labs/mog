/**
 * KeyTip Overlay
 *
 * Renders KeyTip badges on ribbon elements. Display-only after
 * the coordinator owns the chord state machine, this component is
 * a passive subscriber to {@link useChordModeSnapshot}.
 *
 * Architecture:
 * - Reads the coordinator's chord snapshot via `useChordModeSnapshot`.
 * - Reads `activeRibbonTab` from the uiStore for the command-level
 * keytip set.
 * - Queries the (display-only) `keyTipRegistry` for badge data.
 * - Positions badges relative to their target DOM elements.
 *
 * @see apps/spreadsheet/src/systems/input/keyboard/use-chord-mode-snapshot.ts
 */

import type React from 'react';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { useUIStoreApi } from '../../../infra/context';
import { useChordModeSnapshot } from '../../../systems/input/keyboard';
import { keyTipRegistry } from './keytip-registry';
import type { KeyTipBadgePosition, KeyTipEntry } from './types';

/**
 * KeyTip Badge Component
 *
 * Renders a single keytip badge at the specified position.
 */
function KeyTipBadge({ entry, x, y }: KeyTipBadgePosition): React.JSX.Element {
  const label = entry.label || entry.key;

  return (
    <div
      className="z-ss-tooltip pointer-events-none"
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
      }}
      // Observability: the `data-keytip-key` / `data-keytip-tab-id`
      // pair lets app-eval scenarios distinguish tab-level keytips
      // (no `tabId`) from command-level keytips for a specific
      // ribbon tab. Without this, the overlay's render set is only
      // observable by counting children of `[data-testid=
      // "overlay-alt-hints"]`, which is brittle (counts shift as the
      // ribbon evolves) and can't tell tab- vs command-level apart.
      // `data-keytip-element-id` lets scenarios verify badge-to-button
      // proximity: the test reads this to resolve the target element
      // and measure the distance between badge and button.
      // `position: fixed` anchors coords to the viewport so that
      // `getBoundingClientRect()`-derived left/top values land exactly
      // on the target button regardless of any intermediate positioned
      // ancestors in the toolbar tree.
      data-keytip-key={entry.key}
      data-keytip-tab-id={entry.tabId}
      data-keytip-element-id={entry.elementId}
    >
      <div className="px-1 py-0.5 bg-ss-surface border border-ss-border rounded shadow-ss-md text-ribbon-compact font-semibold text-ss-text min-w-[18px] text-center">
        {label}
      </div>
    </div>
  );
}

/**
 * KeyTip Overlay Component
 *
 * Renders all visible keytip badges based on the coordinator's chord
 * state. Filtering rules:
 * - `active === false`: render nothing.
 * - `active && depth === 0`: render tab-level keytips (post Alt-tap,
 * no follow-on yet).
 * - `active && depth >= 1`: render command-level keytips for the
 * current `activeRibbonTab` (the chord buffer has advanced past
 * the leading Alt+letter).
 *
 * The coordinator's chord matcher buffers candidate shortcuts directly,
 * so the pre- `'awaiting'` state (multi-key sequence partway-typed
 * inside the tab-level set) collapses into the same command-level
 * filter — the matcher does the per-key candidate filtering at
 * dispatch time rather than the overlay re-deriving it from a
 * sequence string.
 */
export function KeyTipOverlay(): React.JSX.Element | null {
  const snapshot = useChordModeSnapshot();
  const uiStoreApi = useUIStoreApi();
  const activeRibbonTab = useStore(uiStoreApi, (s) => s.activeRibbonTab);
  const [positions, setPositions] = useState<KeyTipBadgePosition[]>([]);

  /**
   * Compute badge positions from registry entries.
   * Finds the DOM element for each keytip and calculates position.
   */
  const updatePositions = () => {
    if (!snapshot.active) {
      setPositions([]);
      return;
    }

    let entries: KeyTipEntry[];

    if (snapshot.depth === 0) {
      // Post Alt-tap, no follow-on yet — show tab-level keytips.
      entries = keyTipRegistry.getTabKeys();
    } else {
      // Chord buffer has advanced past the leading Alt+letter — show
      // command-level keytips for the active ribbon tab.
      entries = keyTipRegistry.getCommandKeys(activeRibbonTab);
    }

    // Compute positions for each entry
    const newPositions: KeyTipBadgePosition[] = [];

    for (const entry of entries) {
      const element = document.getElementById(entry.elementId);
      if (!element) continue;

      const rect = element.getBoundingClientRect();

      // Position badge at bottom-left of element
      // Add small offset to avoid overlapping the element
      const x = rect.left + 4;
      const y = rect.bottom - 20;

      newPositions.push({
        entry,
        x,
        y,
      });
    }

    setPositions(newPositions);
  };

  // Update positions when chord state or active tab changes
  useEffect(() => {
    updatePositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.active, snapshot.depth, activeRibbonTab]);

  // Update positions on window resize
  useEffect(() => {
    window.addEventListener('resize', updatePositions);
    return () => window.removeEventListener('resize', updatePositions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.active, snapshot.depth, activeRibbonTab]);

  // Update positions on scroll (in case ribbon scrolls)
  useEffect(() => {
    window.addEventListener('scroll', updatePositions, true);
    return () => window.removeEventListener('scroll', updatePositions, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.active, snapshot.depth, activeRibbonTab]);

  if (!snapshot.active || positions.length === 0) {
    return null;
  }

  // Wrap badges in a stable
  // testid container so `__dt.getOverlayBounds('alt-hints')` resolves
  // (without this, three observability scenarios — alt-tap-shows-hints,
  // alt-hints-not-clipped, alt-then-click-cancels — return null bounds
  // and silently 3/4-pass).
  //
  // The wrapper uses `display: contents` so it does NOT introduce a new
  // positioning context: each child KeyTipBadge is `position: absolute`
  // with viewport-derived `left`/`top` from `getBoundingClientRect()`,
  // and a real (block/relative/absolute) wrapper would either re-anchor
  // those coords to the wrapper's box or nudge the layout. `contents`
  // keeps the children laid out exactly as they were in the bare-fragment
  // version, so badge positions are visually unchanged.
  //
  // `__dt.getOverlayBounds` reads `el.children` to compute
  // `allChildrenVisible`; HTMLCollection on a `display: contents` element
  // still returns the rendered children, so the clipping walk and
  // intersection math run unchanged. The wrapper's own bounding rect is
  // 0×0 in this mode — the spec only asserts non-null and
  // `allChildrenVisible: true`, neither of which depends on the wrapper
  // rect being non-empty.
  return (
    <div data-testid="overlay-alt-hints" style={{ display: 'contents' }}>
      {positions.map((pos, i) => (
        <KeyTipBadge key={`${pos.entry.key}-${pos.entry.tabId || 'tab'}-${i}`} {...pos} />
      ))}
    </div>
  );
}
