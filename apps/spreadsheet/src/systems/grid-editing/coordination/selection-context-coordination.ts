/**
 * Selection Context Coordination (Cross-Machine Communication)
 *
 * Enforces selection exclusivity across cell selection and object selection.
 * Only ONE selection context can be active at a time - selecting one clears the other.
 *
 * This is THE pattern for cross-machine communication:
 * - Machines NEVER import each other (per docs/renderer/README.md)
 * - Coordinator detects TRANSITIONS (not just current state) to prevent infinite loops
 * - Subscription order is defined to prevent race conditions
 *
 * Selection Contexts (mutually exclusive):
 * 1. `cells` - Cell/range selection via selection-machine
 * 2. `objects` - Floating object selection via object-interaction-machine (includes charts)
 *
 * Note: Charts are now handled via objectInteractionActor. The objectInteractionActor
 * owns selection for ALL floating objects including charts (single owner principle).
 *
 */

import type {
  ObjectInteractionActor,
  ObjectInteractionState_,
  SelectionActor,
  SelectionState,
} from '../../shared/actor-types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Selection context type - which type of selection is active.
 * Note: 'chart' context removed - charts are now part of 'objects' context.
 */
export type SelectionContextType = 'cells' | 'objects';

/**
 * Configuration for selection context coordination.
 * Charts are deselected via objectInteractionActor (single owner principle).
 * Chart state sync happens separately via SYNC_SELECTION.
 */
export interface SelectionContextCoordinationConfig {
  selectionActor: SelectionActor;
  objectInteractionActor: ObjectInteractionActor;
}

/**
 * Result returned by setupSelectionContextCoordination.
 */
export interface SelectionContextCoordinationResult {
  /** Cleanup function to unsubscribe from all actors */
  cleanup: () => void;
  /** Get the currently active selection context (for debugging/observability) */
  getActiveContext: () => SelectionContextType | null;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if selection machine has an active selection.
 * Note: idle state WITH ranges counts as "has selection" for exclusivity purposes.
 * We want to clear objects/charts when user clicks a cell (enters selecting state).
 */
function hasActiveSelection(state: SelectionState): boolean {
  // Selection is "active" when the user is actively interacting with cells
  // Protected states (draggingFillHandle, draggingCells) should NOT trigger
  // external deselection - the machine handlers ignore EXTERNAL_SELECTION_ACTIVE
  // in those states anyway, but we optimize by not sending the event.
  return (
    state.matches('selecting') ||
    state.matches('extending') ||
    state.matches('multiSelecting') ||
    state.matches('selectingColumn') ||
    state.matches('selectingRow')
  );
}

/**
 * Check if objects are selected.
 * Returns true when objects are in a selection state (not idle).
 * Note: This now includes charts since charts are selected via objectInteractionActor.
 */
function hasObjectSelection(state: ObjectInteractionState_): boolean {
  return (
    state.matches('selected') || state.matches('multiSelected') || state.matches('editingText')
    // Note: dragging, resizing, rotating are protected - machine ignores event
  );
}

// =============================================================================
// SETUP FUNCTION
// =============================================================================

/**
 * Set up selection context coordination.
 *
 * This function:
 * 1. Subscribes to selection and object interaction actors
 * 2. Tracks previous states to detect TRANSITIONS
 * 3. Sends EXTERNAL_SELECTION_ACTIVE when context changes
 *
 * Key Pattern: We detect TRANSITIONS (was false, now true) to prevent infinite loops.
 * If we just checked current state, the event from A would cause B to deselect,
 * which might cause another subscription to fire, creating a loop.
 *
 * Note: Charts are now handled via objectInteractionActor. Chart state sync
 * happens separately via chart-coordination.
 *
 * @param config - Configuration with actors
 * @returns Result with cleanup function
 */
export function setupSelectionContextCoordination(
  config: SelectionContextCoordinationConfig,
): SelectionContextCoordinationResult {
  const { selectionActor, objectInteractionActor } = config;

  // Track previous states to detect TRANSITIONS (not just current state)
  // This prevents infinite loops
  let prevSelectionActive = false;
  let prevObjectsSelected = false;

  // Track currently active context (for debugging/observability)
  let activeContext: SelectionContextType | null = null;

  // ==========================================================================
  // SUBSCRIPTION ORDER MATTERS - process in consistent order to prevent races
  // ==========================================================================

  // 1. Selection machine subscription
  const unsubSelection = selectionActor.subscribe((state: SelectionState) => {
    const isActive = hasActiveSelection(state);

    // Detect transition TO active (was not active, now is active)
    if (isActive && !prevSelectionActive) {
      // Cell selection became active - clear objects (which includes charts)
      activeContext = 'cells';

      objectInteractionActor.send({
        type: 'EXTERNAL_SELECTION_ACTIVE',
        context: 'cells',
      });
    }

    prevSelectionActive = isActive;
  });

  // 2. User selection emit subscription. SET_SELECTION can replace the current
  // cell range while the selection machine stays idle, so state-transition
  // checks above do not see a new active-selection transition.
  const unsubUserSelection = selectionActor.on('userSelectionChanged', () => {
    if (!hasObjectSelection(objectInteractionActor.getSnapshot())) return;

    activeContext = 'cells';
    objectInteractionActor.send({
      type: 'EXTERNAL_SELECTION_ACTIVE',
      context: 'cells',
    });
  });

  // 3. Object interaction machine subscription (handles all floating objects including charts)
  const unsubObjects = objectInteractionActor.subscribe((state: ObjectInteractionState_) => {
    const isSelected = hasObjectSelection(state);

    // Detect transition TO selected (was not selected, now is selected)
    if (isSelected && !prevObjectsSelected) {
      // Object selection became active (could be a chart or any other floating object)
      // Clear cell selection
      activeContext = 'objects';

      selectionActor.send({
        type: 'EXTERNAL_SELECTION_ACTIVE',
        context: 'objects',
      });
      // Note: Chart coordination handles notifying chartActor of chart-specific
      // selection changes separately.
    }

    prevObjectsSelected = isSelected;
  });

  // ==========================================================================
  // RETURN RESULT
  // ==========================================================================

  return {
    cleanup: () => {
      unsubSelection.unsubscribe();
      unsubUserSelection.unsubscribe();
      unsubObjects.unsubscribe();
    },
    getActiveContext: () => activeContext,
  };
}
