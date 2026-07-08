/**
 * useRibbonCollapse Hook
 *
 * The COORDINATOR for ribbon responsive collapse.
 *
 * PROGRESSIVE, PER-GROUP COLLAPSE
 * -------------------------------
 * The ribbon does NOT move through discrete global levels in lock-step. Instead
 * each group collapses INDEPENDENTLY, one rung at a time, in priority order:
 *
 *   - When the panel overflows, the LEAST-important group that still has a
 *     tighter rung available is collapsed by ONE rung (full → compact → icons →
 *     dropdown). We re-measure and repeat. So a group steps all the way down its
 *     ladder before the next-least-important group starts collapsing, and
 *     important groups (e.g. Tables) only collapse once everything below them
 *     is exhausted.
 *   - Hiding a group is a LAST RESORT: only after every group is already at its
 *     most-compact non-hidden rung and the ribbon STILL overflows do we hide
 *     groups (again least-important first). So a group never disappears merely
 *     because the window is narrow — only when it is physically impossible to
 *     fit every group even as a single dropdown button.
 *   - When there is room (the window widened, or the tab changed), we rebase to
 *     "everything expanded" and re-collapse from scratch, so freed space is
 *     always reclaimed by the most-important groups first.
 *
 * The per-group metadata (priority + rungs) is read from data attributes each
 * group stamps on its DOM element (see collapse-ladder.ts), so the coordinator
 * stays DOM-driven and needs no React registration handshake.
 *
 * NO FEEDBACK LOOP
 * ----------------
 * We observe a STABLE ancestor (viewport-determined width) with a
 * ResizeObserver — never the content panel, whose width changes with the
 * collapse decisions and previously caused an infinite observer loop (see
 * ui/ribbon-tab-flicker.spec.ts). Convergence runs in a layout effect (before
 * paint) so the user never sees a clipped or mis-collapsed intermediate frame.
 *
 * This follows the coordinator pattern from docs/renderer/README.md:
 * "Machine Owns State, Coordinator Owns Execution"
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import type { GroupRenderMode } from '@mog-sdk/contracts/ribbon';
import type { RibbonCollapseContextState } from './context';
import { LADDER_DATA_ATTRS } from './collapse-ladder';

// =============================================================================
// Tuning constants
// =============================================================================

/**
 * Overflow past the panel's client width (px) before the ribbon counts as
 * clipped and we collapse another rung. Matches the 1px tolerance used by the
 * app-eval density guard so the two agree on what "clipped" means.
 */
const OVERFLOW_TOLERANCE_PX = 1;

/**
 * Width change (px) below which a ResizeObserver tick is treated as jitter and
 * does not re-open the collapse search. A real resize (> this) rebases so a
 * now-wider container expands the most-important groups back.
 */
const WIDTH_EPSILON_PX = 1;

// =============================================================================
// Progressive collapse decision (pure, DOM-driven)
// =============================================================================

interface GroupSnapshot {
  key: string;
  priority: number;
  rungs: GroupRenderMode[];
  canHide: boolean;
  current: GroupRenderMode;
  domIndex: number;
}

/**
 * Read the visible groups' collapse metadata + current assignment from the DOM.
 * Groups that are currently `hidden` render no element and are simply absent —
 * they stay hidden (via `assignments`) until the next rebase.
 */
function snapshotGroups(
  panel: HTMLElement,
  assignments: Record<string, GroupRenderMode>,
): GroupSnapshot[] {
  const els = Array.from(
    panel.querySelectorAll<HTMLElement>(`[${LADDER_DATA_ATTRS.key}]`),
  );
  return els.map((el, domIndex) => {
    const key = el.getAttribute(LADDER_DATA_ATTRS.key) ?? '';
    const priority = Number(el.getAttribute(LADDER_DATA_ATTRS.priority) ?? '0');
    const rungsRaw = el.getAttribute(LADDER_DATA_ATTRS.rungs) ?? 'full';
    const rungs = rungsRaw.split(',') as GroupRenderMode[];
    const canHide = el.getAttribute(LADDER_DATA_ATTRS.canHide) === '1';
    const current = assignments[key] ?? rungs[0] ?? 'full';
    return { key, priority, rungs, canHide, current, domIndex };
  });
}

/**
 * Order groups for collapsing: least-important first (higher priority number),
 * and within equal priority the right-most group first (larger DOM index), so
 * groups collapse from the trailing edge inward.
 */
function leastImportantFirst(a: GroupSnapshot, b: GroupSnapshot): number {
  return b.priority - a.priority || b.domIndex - a.domIndex;
}

/**
 * Pick the single next collapse step, or null when nothing can collapse further
 * (the ribbon is at its most-compact possible layout and simply cannot fit).
 */
export function pickCollapseStep(
  groups: GroupSnapshot[],
): { key: string; mode: GroupRenderMode } | null {
  // Phase 1 — shrink a rung (never hidden). Least-important group with a
  // tighter rung remaining.
  const shrinkable = groups
    .filter((g) => {
      const idx = Math.max(0, g.rungs.indexOf(g.current));
      return idx < g.rungs.length - 1;
    })
    .sort(leastImportantFirst);
  if (shrinkable.length > 0) {
    const g = shrinkable[0];
    const idx = Math.max(0, g.rungs.indexOf(g.current));
    return { key: g.key, mode: g.rungs[idx + 1] };
  }

  // Phase 2 — last resort: hide a group. Least-important hideable group.
  const hideable = groups
    .filter((g) => g.canHide && g.current !== 'hidden')
    .sort(leastImportantFirst);
  if (hideable.length > 0) {
    return { key: hideable[0].key, mode: 'hidden' };
  }

  return null;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Coordinator hook for progressive, per-group ribbon collapse.
 *
 * @param containerRef - Ref to a STABLE ribbon ancestor (viewport-determined
 *   width). Must NOT be the element whose width changes with collapse, or the
 *   ResizeObserver will feed back on itself.
 * @param panelRef - Ref to the ribbon content panel that can clip horizontally
 *   (`data-testid="panel-ribbon"`). Used to measure overflow and to read each
 *   group's collapse metadata from its DOM element. When omitted, the hook
 *   never collapses (all groups render expanded).
 * @param contentKey - Changes whenever the panel's content changes (e.g. the
 *   active tab). Rebases the collapse search for the new content.
 * @returns Collapse state (per-group modes + container width).
 */
export function useRibbonCollapse(
  containerRef: RefObject<HTMLElement | null>,
  panelRef?: RefObject<HTMLElement | null>,
  contentKey?: unknown,
): RibbonCollapseContextState {
  const [state, setState] = useState<RibbonCollapseContextState>({
    groupModes: {},
    containerWidth: 0,
  });

  // Width the current collapse assignment was computed for. A change > epsilon
  // re-opens the search: a WIDER container rebases to fully-expanded and
  // re-collapses (reclaiming space for important groups); a NARROWER container
  // keeps the current assignment and just collapses further as needed.
  const lastWidthRef = useRef<number>(0);
  const contentKeyRef = useRef<unknown>(contentKey);

  // ---------------------------------------------------------------------------
  // 1. Width observer → keep containerWidth in sync so the convergence effect
  //    re-runs on resize. Observes the STABLE container only (never the panel).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const applyWidth = (width: number) => {
      setState((prev) =>
        Math.abs(prev.containerWidth - width) < WIDTH_EPSILON_PX
          ? prev
          : { ...prev, containerWidth: width },
      );
    };

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
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
  // 2. Progressive convergence → measure overflow and collapse/expand one group
  //    one rung per pass until the panel fits. Runs in a layout effect (before
  //    paint) so intermediate frames are never shown.
  //
  //    Convergence guarantees:
  //    - Within a width bucket, collapsing is monotonic (we only ever tighten),
  //      bounded by the finite total rungs across groups → it always settles.
  //    - A wider container / new content rebases to expanded exactly once, then
  //      re-collapses monotonically → no oscillation.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    const panel = panelRef?.current;
    const container = containerRef.current;
    if (!panel || !container) return;

    const width = container.getBoundingClientRect().width;
    const contentChanged = contentKeyRef.current !== contentKey;
    const widthGrew = width > lastWidthRef.current + WIDTH_EPSILON_PX;
    const widthShrank = width < lastWidthRef.current - WIDTH_EPSILON_PX;

    // Rebase on new content or a wider container: expand everything, then
    // re-collapse to fit. This is what reclaims freed space for the
    // most-important groups.
    if (contentChanged || widthGrew) {
      contentKeyRef.current = contentKey;
      lastWidthRef.current = width;
      if (Object.keys(state.groupModes).length > 0) {
        // Clear existing collapses; the resulting re-render re-runs this effect
        // to measure from a fully-expanded baseline.
        setState({ groupModes: {}, containerWidth: width });
        return;
      }
      // Already fully expanded — the DOM (e.g. the just-switched-to tab) already
      // reflects that, so fall through and measure it NOW. Returning here would
      // be a no-op setState that never re-runs the effect, leaving a denser new
      // tab clipped until the next resize.
    } else if (widthShrank) {
      // A narrower container keeps the current (already-collapsed) assignment
      // and simply continues collapsing below if it now overflows.
      lastWidthRef.current = width;
    }

    const overflowPx = panel.scrollWidth - panel.clientWidth;
    if (overflowPx > OVERFLOW_TOLERANCE_PX) {
      const step = pickCollapseStep(snapshotGroups(panel, state.groupModes));
      if (step) {
        setState((prev) => ({
          groupModes: { ...prev.groupModes, [step.key]: step.mode },
          containerWidth: width,
        }));
        return;
      }
      // Nothing left to collapse: physically cannot fit. Settle (content clips).
    }

    // Settled. Keep containerWidth in sync without touching assignments.
    if (state.containerWidth !== width) {
      setState((prev) => ({ ...prev, containerWidth: width }));
    }
  }, [containerRef, panelRef, contentKey, state.groupModes, state.containerWidth]);

  return state;
}

// =============================================================================
// Exports for Testing
// =============================================================================

/**
 * Exported for testing purposes only.
 * Use the useRibbonCollapse hook in production code.
 */
export const __testing__ = {
  pickCollapseStep,
  OVERFLOW_TOLERANCE_PX,
  WIDTH_EPSILON_PX,
};
