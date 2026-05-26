/**
 * useRendererLifecycle Effect Hook
 *
 * Responds to state machine status changes and handles lifecycle transitions.
 * This single effect handles all renderer state transitions including:
 * - Initial mounting and canvas creation
 * - Layout readiness detection
 * - Sheet switching
 * - Suspend/resume for tab visibility
 * - Error handling
 *
 * @see ARCHITECTURE.md - State Machine 1: Renderer Lifecycle
 * @see 09-SPREADSHEET-GRID-DECOMPOSITION.md
 */

import type { RendererStatus } from '@mog-sdk/contracts/machines';
import type { RefObject } from 'react';
import { useEffect } from 'react';

import { lifecycleDebug } from '../../../systems/renderer/debug/debug-lifecycle';

/**
 * Options for the useRendererLifecycle hook.
 */
export interface UseRendererLifecycleOptions {
  /** Renderer status from useRenderer hook */
  status: RendererStatus;
  /** Renderer dimensions */
  dimensions: { width: number; height: number };
  /** Renderer error if any */
  error: Error | null;
  /** The active sheet ID */
  activeSheetId: string;
  /** Container ref for getting dimensions */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Mount callback from renderer hook */
  mount: (container: HTMLElement) => void;
  /** Layout ready callback from renderer hook */
  layoutReady: (width: number, height: number) => void;
}

/**
 * Handles renderer lifecycle state transitions.
 *
 * This hook responds to state machine status changes and triggers
 * appropriate transitions. It follows the lifecycle:
 * unmounted -> MOUNT -> waitingForLayout -> LAYOUT_READY -> initializing -> INITIALIZED -> ready
 *
 * Note: With machine-owned instances, the machine's entry actions handle
 * canvas/renderer creation. This effect just responds to state changes
 * and signals transitions (e.g., LAYOUT_READY, INITIALIZED).
 *
 * @param options - Configuration options
 */
export function useRendererLifecycle(options: UseRendererLifecycleOptions): void {
  const { status, dimensions, error, activeSheetId, containerRef, mount, layoutReady } = options;

  useEffect(() => {
    const container = containerRef.current;

    // Handle each state transition
    // NOTE: With machine-owned instances, the machine's entry actions handle
    // canvas/renderer creation. This effect just responds to state changes
    // and signals transitions (e.g., LAYOUT_READY, INITIALIZED).
    switch (status) {
      case 'unmounted': {
        // Initial state - send MOUNT when container is available
        lifecycleDebug.gridLifecycleCase(
          'unmounted',
          container ? 'sending MOUNT' : 'no container yet',
        );
        if (container) {
          mount(container);
        }
        break;
      }

      case 'waitingForLayout': {
        // Container is mounted, waiting for dimensions
        // Machine's entry action creates the canvas element.
        // We just need to send LAYOUT_READY with dimensions.
        if (container) {
          const rect = container.getBoundingClientRect();

          // Detailed dimension diagnostic - logs container styles, parent chain, and diagnosis
          lifecycleDebug.dimensionDiagnostic(container, 'waitingForLayout (getBoundingClientRect)');

          // Sanity check: dimensions should be reasonable viewport sizes, not virtual scroll content sizes.
          // If we get absurd dimensions (e.g., 1.6M x 33M from scroll children), it indicates CSS layout
          // hasn't constrained the container properly. In this case, wait for ResizeObserver to fire
          // with correct dimensions after CSS layout is computed.
          // See ISSUE-16-REACT-STRICT-MODE-AND-DIMENSIONS.md for details.
          const MAX_REASONABLE_DIMENSION = 16384; // Typical max canvas dimension

          if (rect.width > MAX_REASONABLE_DIMENSION || rect.height > MAX_REASONABLE_DIMENSION) {
            lifecycleDebug.dimensionsRejected(
              rect.width,
              rect.height,
              'exceeds MAX_REASONABLE_DIMENSION (16384px) - likely CSS not ready, measuring virtual scroll content',
            );
            // Don't proceed - ResizeObserver will fire RESIZE event with correct dimensions
            break;
          }

          if (rect.width > 0 && rect.height > 0) {
            lifecycleDebug.dimensionsAccepted(rect.width, rect.height, 'getBoundingClientRect');
            lifecycleDebug.stateEvent('LAYOUT_READY', { width: rect.width, height: rect.height });
            layoutReady(rect.width, rect.height);
          } else {
            lifecycleDebug.dimensionsRejected(rect.width, rect.height, 'zero dimensions');
          }
        } else {
          lifecycleDebug.warn('waitingForLayout: no container ref');
        }
        break;
      }

      case 'initializing': {
        // Coordinator creates the renderer and sends INITIALIZED automatically
        // when machine enters this state (see setupRendererExecution in coordinator).
        // No action needed here - coordinator handles the side effect.
        lifecycleDebug.gridLifecycleCase('initializing', 'coordinator handles renderer creation');
        break;
      }

      case 'ready': {
        // Renderer is ready - context updates are now handled automatically
        // by setupRenderContextCoordination() via coordinator.setRenderContextConfig()
        // The coordinator subscribes to selection/editor/clipboard changes and
        // sends UPDATE_CONTEXT events to the renderer.
        // No manual updateContext() call needed here.
        lifecycleDebug.gridLifecycleCase('ready', 'context updates handled by coordinator');
        break;
      }

      case 'switchingSheet': {
        // Coordinator handles the sheet switch and sends SHEET_SWITCHED automatically
        // (see executeRendererStateTransition in coordinator).
        // The dimension provider is also recreated via useMemo when activeSheetId changes,
        // so cache is automatically cleared.
        lifecycleDebug.gridLifecycleCase('switchingSheet', 'coordinator handles sheet switch');
        break;
      }

      case 'suspended': {
        // Tab is hidden - machine's entry action calls pauseRenderer
        // No action needed here
        lifecycleDebug.gridLifecycleCase('suspended', 'render loop paused');
        break;
      }

      case 'error': {
        // Error occurred - renderer may need retry
        lifecycleDebug.gridLifecycleCase('error', `${error?.message ?? 'unknown error'}`);
        console.error('[SpreadsheetGrid] Renderer error:', error);
        break;
      }

      case 'disposing': {
        // Machine's entry action handles cleanup via disposeRenderer
        // No action needed here
        lifecycleDebug.gridLifecycleCase('disposing', 'cleanup in progress');
        break;
      }
    }
    // Note: We intentionally exclude 'renderer' object from deps to avoid infinite loops.
    // The individual properties (status, dimensions, error) and methods are what we actually need.
    // Context updates (selection, editor, clipboard, etc.) are now handled automatically
    // by setupRenderContextCoordination() - no need to include them here.
  }, [
    status,
    dimensions.width,
    dimensions.height,
    error,
    activeSheetId,
    containerRef,
    mount,
    layoutReady,
  ]);
}
