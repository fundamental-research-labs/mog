/**
 * useRendererSync Effect Hook
 *
 * Handles synchronization between the renderer and external factors:
 * - ResizeObserver for container dimension changes
 * - Visibility change for suspend/resume
 * - Sheet switching
 * - Zoom level sync
 * - Input dependencies (including synchronous setScrollPosition callback)
 * - Keyboard and resize dependencies
 * - Cleanup on unmount
 *
 * @see 09-SPREADSHEET-GRID-DECOMPOSITION.md
 */

import type { RefObject } from 'react';
import { useEffect } from 'react';

import type { SheetCoordinator } from '../../../coordinator/sheet-coordinator';
import { clampZoom } from '../../../infra/utils/zoom-utils';
import { lifecycleDebug } from '../../../systems/renderer/debug/debug-lifecycle';

/**
 * Options for the useRendererSync hook.
 */
export interface UseRendererSyncOptions {
  /** Container ref for ResizeObserver */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Whether renderer is ready */
  isReady: boolean;
  /** Current sheet ID from renderer */
  currentSheetId: string | null;
  /** Active sheet ID from React state */
  activeSheetId: string;
  /** Current zoom level for the active sheet (already resolved from UIStore) */
  currentZoom: number;
  /** Whether the host renders the horizontal custom scrollbar. */
  showHorizontalScrollbar: boolean;
  /** Whether the host renders the vertical custom scrollbar. */
  showVerticalScrollbar: boolean;
  /** The sheet coordinator instance */
  coordinator: SheetCoordinator;
  /** Resize callback from renderer hook */
  resize: (width: number, height: number) => void;
  /** Suspend callback from renderer hook */
  suspend: () => void;
  /** Resume callback from renderer hook */
  resume: () => void;
  /** Switch sheet callback from renderer hook */
  switchSheet: (sheetId: string) => void;
  /** Set zoom callback from renderer hook */
  setZoom: (zoom: number) => void;
  /** Persist zoom for a sheet in the UI store */
  setZoomLevel: (sheetId: string, level: number) => void;
  /** Persist zoom for a sheet in the workbook model */
  persistZoomLevel?: (sheetId: string, level: number) => void;
  /** Unmount callback from renderer hook */
  unmount: () => void;
}

export interface RendererZoomSyncOptions {
  /** Current zoom level for the active sheet */
  currentZoom: number;
  /** The sheet coordinator instance */
  coordinator: SheetCoordinator;
  /** Set zoom callback from renderer hook */
  setZoom: (zoom: number) => void;
}

/**
 * Apply sheet zoom and keep the current active cell visible after the viewport
 * cell span changes.
 */
export function syncRendererZoom(options: RendererZoomSyncOptions): void {
  const { currentZoom, coordinator, setZoom } = options;
  const rendererZoom = coordinator.renderer.getZoom();
  if (Number.isFinite(rendererZoom) && Math.abs(rendererZoom - currentZoom) < 0.0001) {
    return;
  }

  setZoom(currentZoom);

  const activeCell = coordinator.grid.access.accessors.selection.getActiveCell();
  if (activeCell) {
    coordinator.renderer.scrollToActiveCell(activeCell);
  }
}

export interface PersistInputZoomOptions {
  activeSheetId: string;
  zoom: number;
  currentZoom: number;
  setZoomLevel: (sheetId: string, level: number) => void;
  persistZoomLevel?: (sheetId: string, level: number) => void;
}

export function persistInputZoomForSheet(options: PersistInputZoomOptions): void {
  const { activeSheetId, zoom, currentZoom, setZoomLevel, persistZoomLevel } = options;
  if (!Number.isFinite(zoom)) return;

  const clampedZoom = clampZoom(zoom);
  if (Math.abs(clampedZoom - currentZoom) < 0.0001) return;

  setZoomLevel(activeSheetId, clampedZoom);
  persistZoomLevel?.(activeSheetId, clampedZoom);
}

/**
 * Handles renderer synchronization with external factors.
 *
 * This hook sets up multiple effects for:
 * - ResizeObserver to track container size changes
 * - Visibility change listener for suspend/resume
 * - Sheet switching when activeSheetId changes
 * - Zoom level sync from UIStore
 * - Input, keyboard, and resize dependencies
 * - Scroll state sync from InputCoordinator
 * - Cleanup on unmount
 *
 * @param options - Configuration options
 */
export function useRendererSync(options: UseRendererSyncOptions): void {
  const {
    containerRef,
    isReady,
    currentSheetId,
    activeSheetId,
    currentZoom,
    showHorizontalScrollbar,
    showVerticalScrollbar,
    coordinator,
    resize,
    suspend,
    resume,
    switchSheet,
    setZoom,
    setZoomLevel,
    persistZoomLevel,
    unmount,
  } = options;

  // ResizeObserver effect
  // Note: Capture resize function at mount to avoid re-creating observer on every render
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Capture resize function at effect setup time
    const resizeFn = resize;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        const MAX_REASONABLE_DIMENSION = 16384;

        // Log ResizeObserver dimensions with integrated lifecycle debug
        lifecycleDebug.resizeObserverFired(width, height, 'contentRect');

        if (width > 0 && height > 0) {
          // Sanity check: don't pass absurd dimensions to the renderer
          if (width > MAX_REASONABLE_DIMENSION || height > MAX_REASONABLE_DIMENSION) {
            lifecycleDebug.dimensionsRejected(
              width,
              height,
              'ResizeObserver contentRect exceeds MAX_REASONABLE_DIMENSION',
            );
            return;
          }
          // Update state machine with new dimensions
          lifecycleDebug.dimensionsAccepted(width, height, 'ResizeObserver');
          // The machine's RESIZE handler will call renderer.resize() via resizeRenderer action
          resizeFn(width, height);
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [containerRef, resize]);

  // Scrollbar visibility change effect
  // When scrollbar visibility changes, trigger a resize so the canvas
  // viewport expands to fill the freed space (or contracts when shown).
  // Issue 7: View Options - Scrollbar Visibility Wiring
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isReady) return;

    // Trigger resize with current container dimensions
    // The renderer will recompute viewport accounting for scrollbar presence
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      resize(rect.width, rect.height);
    }
  }, [showHorizontalScrollbar, showVerticalScrollbar, isReady, resize, containerRef]);

  // Visibility change effect
  // Note: Capture suspend/resume functions at mount to avoid re-attaching listener on every render
  useEffect(() => {
    // Capture functions at effect setup time
    const suspendFn = suspend;
    const resumeFn = resume;

    const handleVisibility = () => {
      if (document.hidden) {
        suspendFn();
      } else {
        resumeFn();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [suspend, resume]);

  // Sheet switching effect
  useEffect(() => {
    // Only switch if we're ready and it's a different sheet
    if (isReady && currentSheetId !== activeSheetId) {
      switchSheet(activeSheetId);
    }
    // Note: Use specific properties instead of entire renderer object to avoid infinite loops
  }, [isReady, currentSheetId, activeSheetId, switchSheet]);

  // Zoom sync effect
  // Syncs zoom level from UIStore to the renderer.
  // - Applies stored zoom when renderer becomes ready
  // - Applies stored zoom when switching sheets
  // - Updates renderer when zoom level changes
  // PERFORMANCE: currentZoom is already resolved from zoomLevels[activeSheetId]
  // by the caller, so this hook only re-runs when the active sheet's zoom changes,
  // not when any sheet's zoom changes.
  useEffect(() => {
    if (!isReady) return;

    syncRendererZoom({ currentZoom, coordinator, setZoom });
  }, [isReady, currentZoom, coordinator, setZoom]);

  useEffect(() => {
    if (!isReady) return;

    return coordinator.input.onZoomChange((zoom) => {
      persistInputZoomForSheet({
        activeSheetId,
        zoom,
        currentZoom,
        setZoomLevel,
        persistZoomLevel,
      });
    });
  }, [isReady, coordinator, activeSheetId, currentZoom, setZoomLevel, persistZoomLevel]);

  // Input dependencies effect
  // Sets up InputCoordinator dependencies when renderer is ready.
  // This enables trackpad scrolling, touch gestures, and pan functionality.
  useEffect(() => {
    if (!isReady) return;

    const sheetView = coordinator.renderer.getSheetView();
    if (!sheetView) return;

    coordinator.input.setInputDependencies({
      hitTest: sheetView.hitTest,
      viewport: sheetView.viewport,
      geometry: sheetView.geometry,
      commands: sheetView.commands,
      forwardToSheet: (_event) => {
        // Route input events (cell clicks, resize starts, fill handle) to grid-editing system.
        // For now, this is a no-op bridge — the grid system handles pointer events through
        // its own React event listeners. Full event forwarding will be wired in a follow-up.
      },
      requestRender: () => coordinator.renderer.invalidate('scroll'),
      requestFrame: () => sheetView.render.requestFrame('scroll'),
      // Wire setScrollPosition directly — replaces the React useEffect scroll bridge.
      // This ensures scroll position changes (wheel, momentum, scrollTo, scrollBy)
      // synchronously propagate to RendererExecution for layout recomputation.
      setScrollPosition: (position) => coordinator.renderer.setScrollPosition(position),
    });
  }, [isReady, coordinator, activeSheetId]);

  // Note: Keyboard is enabled via config.enableKeyboard at coordinator construction time
  // See SheetCoordinatorConfig in engine/src/state/coordinator/types.ts

  // Note: Resize dependencies removed - ResizeCoordinator dependencies can be set at construction time
  // via config when needed. Currently this feature is not actively wired up.

  // Cleanup effect
  // Note: We use renderer.unmount directly without renderer in deps to avoid
  // infinite loops. The unmount function is stable (created with useCallback).
  useEffect(() => {
    // Capture the unmount function at mount time
    const unmountFn = unmount;
    return () => {
      unmountFn();
    };
  }, [unmount]);

  // NOTE: The scroll state sync useEffect that was here has been removed.
  // Scroll position now propagates synchronously via the setScrollPosition callback
  // wired in setInputDependencies above. This eliminates the React effect delay
  // and ensures layout recomputation happens in the same call stack as scroll changes.
  // onScrollChange remains available for non-rendering subscribers (debug, overlays).
}
