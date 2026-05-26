/**
 * Shared Grid Renderer Initialization
 *
 * Single source of truth for grid initialization.
 * Used by both:
 * - SpreadsheetGrid.tsx (via useRendererDependencies hook)
 * - GridViewAdapter (imperative path)
 *
 * This ensures both React and imperative paths use identical initialization logic.
 *
 * NOTE (Coordinator Decomposition):
 * The old setRendererDependencies() call has been removed. The RenderSystem is
 * constructor-complete: viewport, rendererFactory, getCellValue, getCellFormat,
 * and sheetStateProvider are all provided at construction time via the coordinator config.
 * This function now only handles:
 * - ResizeObserver setup for container size changes
 * - layoutReady() signaling for initial dimensions
 *
 * Removed SpreadsheetDimensionProvider creation. The renderer execution
 * now creates ViewportPositionIndex + ViewportMergeIndex from the ViewportReader.
 *
 * @see GRID-RENDERING-IN-APPS.md - Option C2 implementation
 */

import type { GridCoordinator } from '../coordinator/grid-coordinator';

/**
 * Options for setting up the grid renderer.
 */
export interface SetupGridRendererOptions {
  /** The GridCoordinator instance */
  coordinator: GridCoordinator;
  /** Initial sheet ID */
  sheetId: string;
  /** Container element for resize observation */
  container: HTMLElement;
}

/**
 * Result of grid renderer setup.
 */
export interface GridRendererSetup {
  /** Resize observer watching the container */
  resizeObserver: ResizeObserver;
  /** Cleanup function - call on unmount/dispose */
  cleanup: () => void;
}

/**
 * Sets up a GridCoordinator with all required dependencies for rendering.
 *
 * This is the single source of truth for grid initialization. It:
 * 1. Sets up ResizeObserver for container size changes
 * 2. Calls coordinator.renderer.layoutReady() with initial dimensions
 *
 * The renderer execution creates ViewportPositionIndex + ViewportMergeIndex
 * from the ViewportReader provided via RendererDependencies.viewport.
 *
 * @param options - Setup options
 * @returns Setup result with cleanup function
 */
export function setupGridRenderer(options: SetupGridRendererOptions): GridRendererSetup {
  const { coordinator, container } = options;

  // Track cleanup state for async callbacks (React Strict Mode compatibility)
  let isCleanedUp = false;

  // 1. Create resize observer
  // Guard against calls after cleanup (React Strict Mode)
  const resizeObserver = new ResizeObserver((entries) => {
    if (isCleanedUp || !coordinator.isActive()) return;
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        coordinator.renderer.resize(width, height);
      }
    }
  });
  resizeObserver.observe(container);

  // 2. Signal layout ready with initial dimensions
  // Call synchronously - the state machine needs this to transition to 'initializing'
  // If dimensions aren't available yet, ResizeObserver will fire when they become available
  const rect = container.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    coordinator.renderer.layoutReady(rect.width, rect.height);
  }

  // 3. Return cleanup function
  return {
    resizeObserver,
    cleanup: () => {
      isCleanedUp = true;
      resizeObserver.disconnect();
    },
  };
}
