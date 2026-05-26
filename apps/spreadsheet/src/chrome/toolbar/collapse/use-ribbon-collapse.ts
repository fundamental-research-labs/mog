/**
 * useRibbonCollapse Hook
 *
 * The COORDINATOR for ribbon responsive collapse.
 * This is the SINGLE SOURCE OF TRUTH for collapse state.
 *
 * ARCHITECTURE:
 * - Observes ResizeObserver events on the container
 * - Computes collapse level based on width
 * - Returns state for RibbonCollapseContext
 *
 * This follows the coordinator pattern from docs/renderer/README.md:
 * "Machine Owns State, Coordinator Owns Execution"
 *
 */

import { useEffect, useState, type RefObject } from 'react';

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

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook that observes container width and computes collapse level.
 *
 * This is the COORDINATOR for ribbon collapse:
 * - Observes ResizeObserver events
 * - Computes collapse level (single calculation)
 * - Broadcasts via context (components react)
 *
 * @param containerRef - Ref to the ribbon container element
 * @returns Collapse state (level + width)
 *
 * @example
 * ```tsx
 * function TabbedToolbar() {
 * const containerRef = useRef<HTMLDivElement>(null);
 * const collapseState = useRibbonCollapse(containerRef);
 *
 * return (
 * <RibbonCollapseProvider value={collapseState}>
 * <div ref={containerRef}>
 * {/* Ribbon content *\/}
 * </div>
 * </RibbonCollapseProvider>
 * );
 * }
 * ```
 */
export function useRibbonCollapse(
  containerRef: RefObject<HTMLElement | null>,
): RibbonCollapseState {
  const [state, setState] = useState<RibbonCollapseState>({
    level: 0,
    containerWidth: 1920,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 1920;
      const level = computeCollapseLevel(width);

      setState((prev) => {
        if (prev.level === level && prev.containerWidth === width) {
          return prev;
        }
        return { level, containerWidth: width };
      });
    });

    observer.observe(container);

    // Initial measurement (ResizeObserver may not fire immediately)
    const initialWidth = container.getBoundingClientRect().width;
    setState({
      level: computeCollapseLevel(initialWidth),
      containerWidth: initialWidth,
    });

    return () => {
      observer.disconnect();
    };
  }, [containerRef]);

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
  COLLAPSE_BREAKPOINTS,
};
