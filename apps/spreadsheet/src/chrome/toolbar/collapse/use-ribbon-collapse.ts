/**
 * useRibbonCollapse Hook
 *
 * The COORDINATOR for ribbon responsive collapse.
 * This is the SINGLE SOURCE OF TRUTH for collapse state.
 *
 * ARCHITECTURE:
 * - Observes ResizeObserver events on a STABLE ancestor (viewport-determined
 *   width). We deliberately do NOT observe the ribbon content panel: its width
 *   changes in response to collapse-level changes, which previously created an
 *   infinite ResizeObserver feedback loop (see ui/ribbon-tab-flicker.spec.ts).
 * - Computes a baseline collapse level from that width (width breakpoints).
 * - Then makes the level CONTENT-AWARE: width breakpoints are only an estimate
 *   of "does it fit". Some tabs (notably Formulas) have more controls than fit
 *   at the baseline level for a given width, so after layout we measure the
 *   panel's actual horizontal overflow and escalate the level until the content
 *   fits. This is what keeps the widest tab from clipping in the dead zone
 *   between two breakpoints.
 *
 * This follows the coordinator pattern from docs/renderer/README.md:
 * "Machine Owns State, Coordinator Owns Execution"
 *
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import type { CollapseLevel, RibbonCollapseState } from '@mog-sdk/contracts/ribbon';

// =============================================================================
// Collapse Level Computation
// =============================================================================

/**
 * Width breakpoints for each collapse level.
 *
 * | Level | Min Width | Description |
 * |-------|-----------|-------------|
 * | 0 | ≥1600px | Full: All groups expanded |
 * | 1 | ≥1200px | Compact: Some labels hidden |
 * | 2 | ≥1000px | Dense: Most buttons icon-only |
 * | 3 | ≥800px | Minimal: Low-priority groups collapsed |
 * | 4 | <800px | Mobile: Most groups collapsed |
 */
const COLLAPSE_BREAKPOINTS: Record<CollapseLevel, number> = {
  0: 1600,
  1: 1200,
  2: 1000,
  3: 800,
  4: 0, // Anything below 800
};

const MAX_COLLAPSE_LEVEL: CollapseLevel = 4;

/**
 * Overflow past the panel's client width (in px) before we treat the ribbon as
 * clipped and escalate the collapse level. Matches the 1px tolerance used by
 * the app-eval density guard so the two agree on what "clipped" means.
 */
const OVERFLOW_TOLERANCE_PX = 1;

/**
 * Margin (px) added on top of a level's measured natural width before we allow
 * de-escalating back to it. This is the hysteresis band: we collapse when the
 * container drops below the content's natural width, but only expand again once
 * the container is comfortably wider, so a container hovering near the boundary
 * does not flip-flop between levels every frame.
 */
const RELEASE_MARGIN_PX = 8;

/**
 * Compute collapse level from container width.
 *
 * This is the SINGLE SOURCE OF TRUTH for the width → level mapping.
 *
 * @param width - Container width in pixels
 * @returns Collapse level (0-4)
 */
function computeCollapseLevel(width: number): CollapseLevel {
  if (width >= COLLAPSE_BREAKPOINTS[0]) return 0;
  if (width >= COLLAPSE_BREAKPOINTS[1]) return 1;
  if (width >= COLLAPSE_BREAKPOINTS[2]) return 2;
  if (width >= COLLAPSE_BREAKPOINTS[3]) return 3;
  return 4;
}

function resolveWidthCollapseLevel(
  width: number,
  widthLevel: CollapseLevel,
  previousLevel: CollapseLevel,
  releaseWidth: number,
): { level: CollapseLevel; releaseWidth: number } {
  if (releaseWidth === Number.POSITIVE_INFINITY || width > releaseWidth) {
    return { level: widthLevel, releaseWidth: Number.POSITIVE_INFINITY };
  }

  return {
    level: Math.max(widthLevel, previousLevel) as CollapseLevel,
    releaseWidth,
  };
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook that observes container width and computes a content-aware collapse
 * level.
 *
 * This is the COORDINATOR for ribbon collapse:
 * - Observes ResizeObserver events on a stable ancestor
 * - Computes a baseline collapse level from width
 * - Escalates the level when the rendered panel actually overflows
 * - Broadcasts via context (components react)
 *
 * @param containerRef - Ref to a STABLE ribbon ancestor (viewport-determined
 *   width). Must NOT be the element whose width changes with the collapse
 *   level, or the ResizeObserver will feed back on itself.
 * @param panelRef - Ref to the ribbon content panel that can clip horizontally
 *   (`data-testid="panel-ribbon"`). Used to measure actual overflow. When
 *   omitted, the hook falls back to pure width-based collapse.
 * @param contentKey - Changes whenever the panel's content changes (e.g. the
 *   active tab). Lets the hook drop a previous tab's escalation and re-measure
 *   for the new content.
 * @returns Collapse state (level + width)
 *
 * @example
 * ```tsx
 * function TabbedToolbar() {
 * const containerRef = useRef<HTMLDivElement>(null);
 * const panelRef = useRef<HTMLDivElement>(null);
 * const collapseState = useRibbonCollapse(containerRef, panelRef, activeTab);
 *
 * return (
 * <RibbonCollapseProvider value={collapseState}>
 * <div ref={containerRef}>
 * <div ref={panelRef} data-testid="panel-ribbon">{/* groups *\/}</div>
 * </div>
 * </RibbonCollapseProvider>
 * );
 * }
 * ```
 */
export function useRibbonCollapse(
  containerRef: RefObject<HTMLElement | null>,
  panelRef?: RefObject<HTMLElement | null>,
  contentKey?: unknown,
): RibbonCollapseState {
  const [state, setState] = useState<RibbonCollapseState>({
    level: 0,
    containerWidth: 1920,
  });

  // The container width at/above which the current escalation may be released.
  // Set to the overflowing level's natural content width (+ margin) when we
  // escalate; Infinity means "no escalation pending".
  const releaseWidthRef = useRef<number>(Number.POSITIVE_INFINITY);

  // Tracks the content the escalation was computed for, so a tab switch can
  // re-baseline rather than inherit the previous tab's escalation.
  const contentKeyRef = useRef<unknown>(contentKey);

  // ---------------------------------------------------------------------------
  // 1. Width observer → baseline level (with hysteresis on release)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const applyWidth = (width: number) => {
      const widthLevel = computeCollapseLevel(width);
      setState((prev) => {
        const resolved = resolveWidthCollapseLevel(
          width,
          widthLevel,
          prev.level,
          releaseWidthRef.current,
        );
        releaseWidthRef.current = resolved.releaseWidth;
        const level = resolved.level;
        if (prev.level === level && prev.containerWidth === width) return prev;
        return { level, containerWidth: width };
      });
    };

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 1920;
      applyWidth(width);
    });

    observer.observe(container);

    // Initial measurement (ResizeObserver may not fire immediately)
    applyWidth(container.getBoundingClientRect().width);

    return () => {
      observer.disconnect();
    };
  }, [containerRef]);

  // ---------------------------------------------------------------------------
  // 2. Content-aware escalation → measure actual overflow and step down a level
  //    until the panel fits. Runs in a layout effect (before paint) so the user
  //    never sees a clipped intermediate frame.
  //
  //    Convergence / no-feedback-loop guarantees:
  //    - We do NOT observe the panel; clientWidth is viewport-determined and
  //      stable across collapse levels, only scrollWidth (content) shrinks.
  //    - Escalation is monotonic and bounded by MAX_COLLAPSE_LEVEL, and stops
  //      as soon as the content fits, so it settles in ≤4 passes per change.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    const panel = panelRef?.current;
    const container = containerRef.current;
    if (!panel || !container) return;

    const width = container.getBoundingClientRect().width;
    const widthLevel = computeCollapseLevel(width);
    const contentChanged = contentKeyRef.current !== contentKey;

    // New content (e.g. tab switch): drop the previous content's escalation and
    // re-baseline. We only need an explicit reset when the current level is
    // *more* collapsed than the width baseline (i.e. an escalation is in
    // effect); otherwise we can measure the new content immediately below.
    if (contentChanged) {
      contentKeyRef.current = contentKey;
      if (state.level > widthLevel) {
        releaseWidthRef.current = Number.POSITIVE_INFINITY;
        setState((prev) =>
          prev.level === widthLevel ? prev : { level: widthLevel, containerWidth: width },
        );
        // Re-baselined; the resulting re-render re-runs this effect to measure
        // the new content at the baseline level.
        return;
      }
    }

    const overflowing = panel.scrollWidth > panel.clientWidth + OVERFLOW_TOLERANCE_PX;

    if (overflowing && state.level < MAX_COLLAPSE_LEVEL) {
      // scrollWidth is the natural width of the *current* (overflowing) level —
      // the container must exceed it (plus a hysteresis margin) before we allow
      // de-escalating back to this level.
      releaseWidthRef.current = panel.scrollWidth + RELEASE_MARGIN_PX;
      setState((prev) => ({
        level: Math.min(MAX_COLLAPSE_LEVEL, prev.level + 1) as CollapseLevel,
        containerWidth: width,
      }));
    }
  }, [containerRef, panelRef, contentKey, state.level, state.containerWidth]);

  return state;
}

// =============================================================================
// Exports for Testing
// =============================================================================

/**
 * Exported for testing purposes only.
 * Use useRibbonCollapse hook in production code.
 */
export const __testing__ = {
  computeCollapseLevel,
  resolveWidthCollapseLevel,
  COLLAPSE_BREAKPOINTS,
};
