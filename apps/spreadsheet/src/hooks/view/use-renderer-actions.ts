/**
 * Renderer Actions Hook - Stable Function References
 *
 * This hook provides ONLY stable action functions for renderer lifecycle control.
 * It does NOT subscribe to any state, so it will NEVER cause re-renders.
 *
 * Problem: useRenderer() subscribes to full renderer state via `(s) => s` selector,
 * causing 620+ re-renders per session. Components that only use action functions
 * (mount, unmount, resize, etc.) don't need any state subscription.
 *
 * Solution: Split useRenderer() into granular hooks. This hook returns only
 * stable memoized functions with NO subscriptions.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import { useCallback, useMemo } from 'react';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { GridRenderer, RenderPriority } from '@mog-sdk/contracts/rendering';
import type {
  ISheetViewGeometry,
  ISheetViewHitTest,
  ISheetViewRender,
  ISheetViewObjects,
  ISheetViewInteractiveElements,
  ISheetViewViewport,
} from '@mog-sdk/sheet-view';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseRendererActionsReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Mount the renderer with a container element */
  mount: (container: HTMLElement) => void;

  /** Signal that layout is ready with dimensions */
  layoutReady: (width: number, height: number) => void;

  /** Signal that initialization is complete */
  initialized: (sheetId: string) => void;

  /** Switch to a different sheet */
  switchSheet: (sheetId: string) => void;

  /** Signal that sheet switch is complete */
  sheetSwitched: () => void;

  /** Unmount the renderer */
  unmount: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // VISIBILITY ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Suspend the renderer (tab hidden) */
  suspend: () => void;

  /** Resume the renderer (tab visible) */
  resume: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /** Report an error */
  reportError: (error: Error) => void;

  /** Retry after error */
  retry: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDERING ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Handle container resize */
  resize: (width: number, height: number) => void;

  /** Invalidate regions for re-render */
  invalidate: (priority: RenderPriority, regions?: CellRange[]) => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // ZOOM CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /** Set zoom level (0.1 to 4.0, i.e., 10% to 400%) */
  setZoom: (zoom: number) => void;

  /** Get current zoom level (1.0 = 100%) */
  getZoom: () => number;

  // ═══════════════════════════════════════════════════════════════════════════
  // COORDINATOR-OWNED INSTANCES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the GridRendererImpl instance owned by the coordinator.
   * @deprecated Use capability-based accessors (getGeometry, getRenderCapability, etc.)
   * Returns null if the coordinator hasn't created a renderer yet.
   */
  getRenderer: () => GridRenderer | null;

  /**
   * Get the renderer container element owned by the coordinator.
   * Returns null if the coordinator hasn't created a container yet.
   */
  getCanvas: () => HTMLElement | null;

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPABILITY ACCESSORS (prefer over getRenderer)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Geometry queries — cell rects, page rects, dimensions, merge anchors. */
  getGeometry: () => ISheetViewGeometry | null;

  /** Hit testing — classify viewport/page points against all rendered layers. */
  getHitTest: () => ISheetViewHitTest | null;

  /** Render invalidation and current sheet identity. */
  getRenderCapability: () => ISheetViewRender | null;

  /** Floating object scene — synchronous bounds reads and transient updates. */
  getObjects: () => ISheetViewObjects | null;

  /** Interactive element observation. */
  getInteractiveElements: () => ISheetViewInteractiveElements | null;

  /** Viewport — scroll, frozen panes, split views, layout. */
  getViewport: () => ISheetViewViewport | null;

  // ═══════════════════════════════════════════════════════════════════════════
  // CELL CONTENT QUERIES (UI Polish)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get clipped content for a cell (for overflow tooltip display).
   * Returns null if cell is not clipped (text fits without ellipsis).
   */
  getClippedCellContent: (row: number, col: number) => string | null;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for renderer lifecycle actions.
 *
 * This is a performance-optimized alternative to useRenderer() for components
 * that only need to trigger actions but don't need to read state.
 *
 * Key optimization: Returns only stable memoized functions. No subscriptions,
 * no state, no re-renders.
 *
 * @example
 * ```tsx
 * function RendererMounter({ container }: { container: HTMLElement }) {
 * const { mount, unmount } = useRendererActions;
 *
 * useEffect( => {
 * mount(container);
 * return => unmount;
 * }, [mount, unmount, container]);
 *
 * // This component NEVER re-renders due to renderer state changes
 * return null;
 * }
 * ```
 */
export function useRendererActions(): UseRendererActionsReturn {
  const coordinator = useCoordinator();
  const rendererSystem = coordinator.renderer;
  // Create commands using Actor Access Layer pattern
  const commands = useMemo(() => rendererSystem.access.commands.renderer!, [rendererSystem]);

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const mount = useCallback(
    (container: HTMLElement) => {
      commands.mount(container);
    },
    [commands],
  );

  const layoutReady = useCallback(
    (width: number, height: number) => {
      commands.layoutReady(width, height);
    },
    [commands],
  );

  const initialized = useCallback(
    (sheetId: string) => {
      commands.initialized(sheetId);
    },
    [commands],
  );

  const switchSheet = useCallback(
    (sheetId: string) => {
      commands.switchSheet(sheetId);
    },
    [commands],
  );

  const sheetSwitched = useCallback(() => {
    commands.sheetSwitched();
  }, [commands]);

  const unmount = useCallback(() => {
    commands.unmount();
  }, [commands]);

  // ═══════════════════════════════════════════════════════════════════════════
  // VISIBILITY ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const suspend = useCallback(() => {
    commands.suspend();
  }, [commands]);

  const resume = useCallback(() => {
    commands.resume();
  }, [commands]);

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  const reportError = useCallback(
    (error: Error) => {
      commands.reportError(error);
    },
    [commands],
  );

  const retry = useCallback(() => {
    commands.retry();
  }, [commands]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDERING ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const resize = useCallback(
    (width: number, height: number) => {
      // Call renderer.resize() which actually resizes the canvas.
      // commands.resize() only sends RESIZE event to the state machine, which
      // updates context dimensions but doesn't call renderer.resize().
      rendererSystem.resize(width, height);
    },
    [rendererSystem],
  );

  const invalidate = useCallback(
    (priority: RenderPriority, regions?: CellRange[]) => {
      commands.invalidate(priority, regions);
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ZOOM CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  const setZoom = useCallback(
    (zoom: number) => {
      rendererSystem.setZoom(zoom);
    },
    [rendererSystem],
  );

  const getZoom = useCallback((): number => {
    return rendererSystem.getZoom();
  }, [rendererSystem]);

  // ═══════════════════════════════════════════════════════════════════════════
  // COORDINATOR-OWNED INSTANCE ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  const getRenderer = useCallback((): GridRenderer | null => {
    return coordinator.renderer.getRenderer();
  }, [coordinator]);

  const getCanvas = useCallback((): HTMLElement | null => {
    return coordinator.renderer.getContainer();
  }, [coordinator]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CAPABILITY ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  const getGeometry = useCallback((): ISheetViewGeometry | null => {
    return coordinator.renderer.getGeometry();
  }, [coordinator]);

  const getHitTest = useCallback((): ISheetViewHitTest | null => {
    return coordinator.renderer.getHitTest();
  }, [coordinator]);

  const getRenderCapability = useCallback((): ISheetViewRender | null => {
    return coordinator.renderer.getRenderCapability();
  }, [coordinator]);

  const getObjects = useCallback((): ISheetViewObjects | null => {
    return coordinator.renderer.getObjects();
  }, [coordinator]);

  const getInteractiveElements = useCallback((): ISheetViewInteractiveElements | null => {
    return coordinator.renderer.getInteractiveElements();
  }, [coordinator]);

  const getViewport = useCallback((): ISheetViewViewport | null => {
    return coordinator.renderer.getViewport();
  }, [coordinator]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CELL CONTENT QUERIES (UI Polish)
  // ═══════════════════════════════════════════════════════════════════════════

  const getClippedCellContent = useCallback(
    (row: number, col: number): string | null => {
      const geometry = coordinator.renderer.getGeometry();
      if (!geometry) return null;

      return geometry.getClippedCellContent(row, col);
    },
    [coordinator],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  // Return stable object - all functions are memoized
  return useMemo(
    () => ({
      // Lifecycle actions
      mount,
      layoutReady,
      initialized,
      switchSheet,
      sheetSwitched,
      unmount,

      // Visibility actions
      suspend,
      resume,

      // Error handling
      reportError,
      retry,

      // Rendering actions
      resize,
      invalidate,

      // Zoom control
      setZoom,
      getZoom,

      // Coordinator-owned instance accessors (deprecated — use capability accessors)
      getRenderer,
      getCanvas,

      // Capability accessors (prefer these)
      getGeometry,
      getHitTest,
      getRenderCapability,
      getObjects,
      getInteractiveElements,
      getViewport,

      // Cell content queries
      getClippedCellContent,
    }),
    [
      mount,
      layoutReady,
      initialized,
      switchSheet,
      sheetSwitched,
      unmount,
      suspend,
      resume,
      reportError,
      retry,
      resize,
      invalidate,
      setZoom,
      getZoom,
      getRenderer,
      getCanvas,
      getGeometry,
      getHitTest,
      getRenderCapability,
      getObjects,
      getInteractiveElements,
      getViewport,
      getClippedCellContent,
    ],
  );
}
