/**
 * Auto-Scroll Coordination
 *
 * Coordinator feature that wires up the auto-scroll service to selection machine state.
 * Follows the coordinator pattern: "Machines own state, coordinator owns execution."
 *
 * ARCHITECTURE:
 * - Subscribes to selection machine state transitions
 * - Detects drag operations (cell selection, fill handle, header selection)
 * - Starts/stops auto-scroll service based on drag state
 * - Uses transition detection pattern (previousState tracking)
 *
 *
 * @see docs/renderer/README.md - Coordinator Pattern
 * @see engine/src/state/coordinator/features/input/auto-scroll-service.ts
 */

import type { ISheetViewViewport } from '@mog-sdk/sheet-view';
import {
  setupAutoScroll,
  type AutoScrollController,
  type ViewportBounds,
} from '../../../input/coordination/auto-scroll-service';
import {
  isObjectDragState,
  isSelectionDragState,
} from '../../../input/coordination/pointer-capture-coordination';
import type { ObjectInteractionActor, SelectionActor } from '../../../shared/actor-types';

// =============================================================================
// Types
// =============================================================================

export interface AutoScrollCoordinationConfig {
  /** The selection XState actor */
  selectionActor: SelectionActor;
  /** A.1: The object interaction XState actor (for object move/resize) */
  objectInteractionActor: ObjectInteractionActor;
  /** Get viewport capability for viewport bounds */
  getViewport: () => ISheetViewViewport | null;
  /** Get last mouse position for auto-scroll */
  getLastMousePosition: () => { x: number; y: number } | null;
  /** Apply scroll delta for auto-scroll */
  applyScrollDelta: (dx: number, dy: number) => void;
  /** Request render after scroll */
  requestRender?: () => void;
}

export interface AutoScrollCoordinationResult {
  /** Cleanup function to unsubscribe and dispose */
  cleanup: () => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert ISheetViewViewport.getViewportBounds() (SheetRect) to ViewportBounds
 * used by the auto-scroll service.
 */
function sheetRectToViewportBounds(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): ViewportBounds {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Set up auto-scroll coordination feature.
 *
 * Subscribes to selection and object machines and triggers auto-scroll during drag operations:
 * - Cell selection drag (isSelecting)
 * - Column header selection (isSelectingColumn)
 * - Row header selection (isSelectingRow)
 * - Fill handle drag (draggingFillHandle state)
 * - A.1: Object move/resize drag (dragging, resizing states)
 *
 * Uses transition detection pattern to start/stop auto-scroll on state changes.
 *
 * IMPORTANT: This should be called AFTER all actors are started.
 *
 * @param config - Configuration with actors and dependencies
 * @returns Cleanup function to dispose of subscriptions
 */
export function setupAutoScrollFeature(
  config: AutoScrollCoordinationConfig,
): AutoScrollCoordinationResult {
  const {
    selectionActor,
    objectInteractionActor,
    getViewport,
    getLastMousePosition,
    applyScrollDelta,
    requestRender,
  } = config;

  // Create auto-scroll controller
  const autoScroll: AutoScrollController = setupAutoScroll({
    getMousePosition: () => getLastMousePosition(),
    getViewportBounds: () => {
      const viewport = getViewport();
      if (!viewport) {
        // Fallback to default viewport if viewport capability not available
        return { left: 0, top: 0, right: 800, bottom: 600 };
      }
      return sheetRectToViewportBounds(viewport.getViewportBounds());
    },
    applyScrollDelta: (dx, dy) => applyScrollDelta(dx, dy),
    requestRender: () => requestRender?.(),
  });

  // Track previous drag states for transition detection
  let wasSelectionDragging = false;
  let wasObjectDragging = false;

  // Subscribe to selection machine state changes
  const selectionSub = selectionActor.subscribe((state) => {
    const isDragging = isSelectionDragState(state);

    if (isDragging && !wasSelectionDragging) {
      autoScroll.start();
    } else if (!isDragging && wasSelectionDragging) {
      autoScroll.stop();
    }

    wasSelectionDragging = isDragging;
  });

  // A.1: Subscribe to object interaction machine state changes
  const objectSub = objectInteractionActor.subscribe((state) => {
    const isDragging = isObjectDragState(state);

    if (isDragging && !wasObjectDragging) {
      autoScroll.start();
    } else if (!isDragging && wasObjectDragging) {
      autoScroll.stop();
    }

    wasObjectDragging = isDragging;
  });

  return {
    cleanup: () => {
      autoScroll.cleanup();
      selectionSub.unsubscribe();
      objectSub.unsubscribe();
    },
  };
}
