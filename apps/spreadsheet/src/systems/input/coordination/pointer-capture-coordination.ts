/**
 * Pointer Capture Coordination
 *
 * Coordinator-owned module for managing pointer capture lifecycle.
 * Follows the architecture pattern: "Machines own state, coordinator owns execution."
 *
 * ARCHITECTURE:
 * - State machines are PURE - no DOM access, no side effects
 * - Coordinator subscribes to machine state transitions
 * - When drag state is entered → coordinator calls onDragStart()
 * - When drag state is exited → coordinator calls onDragEnd()
 * - Component provides DOM element via setContainerElement()
 *
 * This ensures pointer events continue tracking even when cursor exits the window,
 * enabling proper completion of all drag operations (selection, resize, fill handle, etc.)
 *
 * @see docs/renderer/README.md - Coordinator Pattern
 */

import type { PointerCaptureManager } from '@mog-sdk/contracts/rendering';
import type {
  ObjectInteractionActor,
  SelectionActor,
  SelectionState,
} from '../../shared/actor-types';

// =============================================================================
// POINTER CAPTURE MANAGER FACTORY
// =============================================================================

/**
 * Create a PointerCaptureManager instance.
 *
 * The manager handles the low-level DOM operations for pointer capture.
 * It's owned by the coordinator and receives commands based on state transitions.
 */
export function createPointerCaptureManager(): PointerCaptureManager {
  let element: HTMLElement | null = null;
  let capturedPointerId: number | null = null;

  return {
    setContainerElement(el: HTMLElement | null): void {
      // Release any existing capture before changing elements
      if (element && capturedPointerId !== null) {
        try {
          element.releasePointerCapture(capturedPointerId);
        } catch {
          // Pointer may already be released
        }
        capturedPointerId = null;
      }
      element = el;
    },

    onDragStart(pointerId: number): void {
      // Preconditions
      if (!element) {
        console.warn('[PointerCaptureManager] No container element set');
        return;
      }
      if (pointerId === null || pointerId === undefined) {
        console.warn('[PointerCaptureManager] Invalid pointerId:', pointerId);
        return;
      }
      if (capturedPointerId !== null) {
        // Already capturing - this is fine, just log for debugging
        if (capturedPointerId !== pointerId) {
          console.warn(
            '[PointerCaptureManager] Already capturing pointer',
            capturedPointerId,
            'ignoring new capture for',
            pointerId,
          );
        }
        return;
      }

      try {
        element.setPointerCapture(pointerId);
        capturedPointerId = pointerId;
      } catch (e) {
        // Pointer may have been released before capture could be set
        // This can happen in rapid click-release sequences
        console.warn('[PointerCaptureManager] Failed to capture pointer:', e);
      }
    },

    onDragEnd(pointerId: number): void {
      if (!element) return;
      if (capturedPointerId === null) return;
      if (capturedPointerId !== pointerId) {
        // Different pointer - don't release
        return;
      }

      try {
        element.releasePointerCapture(pointerId);
      } catch {
        // Pointer may already be released (e.g., by browser on pointercancel)
      }
      capturedPointerId = null;
    },

    isCapturing(): boolean {
      return capturedPointerId !== null;
    },

    getCapturedPointerId(): number | null {
      return capturedPointerId;
    },
  };
}

// =============================================================================
// DRAG STATE DETECTION HELPERS
// =============================================================================

/**
 * Selection machine states that represent drag operations.
 * When in these states, pointer capture should be active.
 *
 * States:
 * - selecting: Mouse-drag cell selection
 * - extending: Shift+click extend selection
 * - multiSelecting: Ctrl+click multi-selection
 * - selectingRangeForFormula.dragging: Formula range picking
 * - draggingFillHandle: Autofill drag
 * - rightDraggingFillHandle: Right-click autofill drag
 * - draggingCells: Drag-move/copy cells
 * - selectingColumn: Column header drag selection
 * - selectingRow: Row header drag selection
 * - resizingHeader: Column/row resize drag
 */
export function isSelectionDragState(state: SelectionState): boolean {
  return (
    state.matches('selecting') ||
    state.matches('extending') ||
    state.matches('multiSelecting') ||
    state.matches({ selectingRangeForFormula: 'dragging' }) ||
    state.matches('draggingFillHandle') ||
    state.matches('rightDraggingFillHandle') ||
    state.matches('draggingCells') ||
    state.matches('selectingColumn') ||
    state.matches('selectingRow') ||
    state.matches('resizingHeader')
  );
}

/**
 * Object interaction machine states that represent drag operations.
 * When in these states, pointer capture should be active.
 *
 * States:
 * - operating: Unified state for drag/resize/rotate operations
 *
 * NOTE: 'editingText' is NOT a drag state - it's text editing mode.
 */
export function isObjectDragState(
  state: ReturnType<ObjectInteractionActor['getSnapshot']>,
): boolean {
  return state.matches('operating');
}

// =============================================================================
// COORDINATION SETUP
// =============================================================================

export interface PointerCaptureCoordinationConfig {
  /** The pointer capture manager instance (owned by coordinator) */
  pointerCaptureManager: PointerCaptureManager;
  /** The selection XState actor */
  selectionActor: SelectionActor;
  /** The object interaction XState actor */
  objectInteractionActor: ObjectInteractionActor;
  /** Getter for the currently active pointer ID */
  getActivePointerId: () => number | null;
}

export interface PointerCaptureCoordinationResult {
  /** Cleanup function to unsubscribe from actors */
  cleanup: () => void;
}

/**
 * Set up pointer capture coordination.
 *
 * Subscribes to selection and object interaction machines, detecting
 * transitions into/out of drag states and triggering pointer capture accordingly.
 *
 * Also handles window blur events to cancel drag operations when the window
 * loses focus.
 *
 * NOTE: Auto-scroll is handled by a separate coordinator feature (setupAutoScrollFeature).
 * This separation follows the coordinator pattern for better modularity.
 *
 * IMPORTANT: This should be called AFTER the actors are started.
 */
export function setupPointerCaptureCoordination(
  config: PointerCaptureCoordinationConfig,
): PointerCaptureCoordinationResult {
  const { pointerCaptureManager, selectionActor, objectInteractionActor, getActivePointerId } =
    config;

  // Track previous drag states to detect transitions
  let wasSelectionDragging = false;
  let wasObjectDragging = false;

  // Subscribe to selection machine state changes
  const selectionSub = selectionActor.subscribe((state) => {
    const isDragging = isSelectionDragState(state);

    if (isDragging && !wasSelectionDragging) {
      // Entered drag state
      const pointerId = getActivePointerId();
      if (pointerId !== null) {
        pointerCaptureManager.onDragStart(pointerId);
      }
    } else if (!isDragging && wasSelectionDragging) {
      // Exited drag state
      const capturedId = pointerCaptureManager.getCapturedPointerId();
      if (capturedId !== null) {
        pointerCaptureManager.onDragEnd(capturedId);
      }
    }

    wasSelectionDragging = isDragging;
  });

  // Subscribe to object interaction machine state changes
  const objectSub = objectInteractionActor.subscribe((state) => {
    const isDragging = isObjectDragState(state);

    if (isDragging && !wasObjectDragging) {
      // Entered drag state
      const pointerId = getActivePointerId();
      if (pointerId !== null) {
        pointerCaptureManager.onDragStart(pointerId);
      }
    } else if (!isDragging && wasObjectDragging) {
      // Exited drag state
      const capturedId = pointerCaptureManager.getCapturedPointerId();
      if (capturedId !== null) {
        pointerCaptureManager.onDragEnd(capturedId);
      }
    }

    wasObjectDragging = isDragging;
  });

  // ==========================================================================
  // WINDOW BLUR HANDLING
  // When the window loses focus during a captured drag, cancel the operation.
  // This ensures clean state when user Alt+Tabs away during a drag.
  // ==========================================================================

  const handleWindowBlur = () => {
    if (!pointerCaptureManager.isCapturing()) {
      return; // Not capturing, nothing to do
    }

    // Send RESET to the appropriate machine based on current drag state
    // The machine transition will trigger our subscription, which releases capture
    // This is the correct pattern: state change drives side effects

    if (wasSelectionDragging) {
      // Selection machine is in a drag state - send RESET to cancel
      // This handles: selecting, extending, multiSelecting, draggingFillHandle,
      // draggingCells, selectingColumn, selectingRow, resizingHeader
      selectionActor.send({ type: 'RESET' });
    }

    if (wasObjectDragging) {
      // Object interaction machine is in a drag state - send RESET to cancel
      // This handles: dragging, resizing, rotating
      objectInteractionActor.send({ type: 'RESET' });
    }
  };

  // Attach window blur listener
  // Note: We use 'blur' on window, not 'visibilitychange', because blur fires
  // when the window loses focus (e.g., Alt+Tab) even if the tab is still visible
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', handleWindowBlur);
  }

  return {
    cleanup: () => {
      selectionSub.unsubscribe();
      objectSub.unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', handleWindowBlur);
      }
    },
  };
}
