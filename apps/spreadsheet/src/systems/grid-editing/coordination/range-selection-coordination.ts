/**
 * Range Selection Coordination
 *
 * Coordinates range selection mode with the selection machine and UI store.
 * This implements the "collapse button" pattern where dialogs minimize to
 * allow users to select ranges directly from the sheet.
 *
 * Responsibilities:
 * - Subscribe to range selection mode state changes
 * - Send selection machine events when entering/exiting range mode
 * - Update UI store with live range updates from selection
 * - Handle dialog minimize/restore callbacks
 *
 * Architecture Pattern:
 * Uses the transition detection pattern (compare previous vs current state)
 * to trigger side effects at state boundaries.
 *
 * @see state/coordinator/features/selection/cross-coordination.ts - Similar pattern
 */

import { selectionSelectors } from '../../../selectors';
import type { GridEditingUIStore, GridEditingUIStoreApi } from '../types';
import type { SelectionActor } from './cross-coordination';
import { formatRangeSelectionRange } from './range-selection-format';

// =============================================================================
// Types
// =============================================================================

export interface RangeSelectionCoordinationConfig {
  /** UI store for range selection mode state */
  uiStore: GridEditingUIStoreApi;
  /** Selection machine actor */
  selectionActor: SelectionActor;
  /** Callback to minimize the dialog when entering range selection mode */
  onDialogMinimize: () => void;
  /** Callback to restore the dialog when exiting range selection mode */
  onDialogRestore: () => void;
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Set up range selection mode coordination.
 *
 * This function establishes bidirectional communication:
 * - UI Store → Selection Machine: Enter/exit range selection mode
 * - Selection Machine → UI Store: Live range updates during selection
 *
 * Transition Detection Pattern:
 * - Compare previousState vs currentState to detect mode changes
 * - Trigger callbacks at boundaries (entering/exiting mode)
 * - Update live range as selection changes
 *
 * @param config - Coordination configuration
 * @returns Cleanup function to unsubscribe
 */
export function setupRangeSelectionCoordination(config: RangeSelectionCoordinationConfig): {
  cleanup: () => void;
} {
  const { uiStore, selectionActor, onDialogMinimize, onDialogRestore } = config;

  let previousSelectionState = selectionActor.getSnapshot();

  // =============================================================================
  // UI Store → Selection Machine: Mode Changes
  // =============================================================================

  /**
   * Subscribe to range selection mode state in UI store.
   * When mode activates/deactivates, notify selection machine and trigger callbacks.
   *
   * PERFORMANCE: Use selector-based subscription via subscribeWithSelector middleware.
   * This ensures the callback only fires when rangeSelectionMode.active changes,
   * not on every UIStore update (which was causing 89 commits for simple cell interactions).
   * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15 (Render Isolation)
   */
  // subscribeWithSelector middleware enables 2-arg subscribe (selector, callback)
  // Cast to allow selector-based subscription from subscribeWithSelector middleware
  type SelectorSubscribe = <U>(
    selector: (state: GridEditingUIStore) => U,
    listener: (curr: U, prev: U) => void,
  ) => () => void;
  const uiStoreUnsubscribe = (uiStore.subscribe as SelectorSubscribe)(
    (state) => state.rangeSelectionMode.active,
    (isActive, wasActive) => {
      // Mode activated - minimize dialog and prepare selection machine
      if (!wasActive && isActive) {
        onDialogMinimize();

        // Send event to selection machine to enter range selection mode
        // This could enable special selection behaviors like:
        // - Showing live range overlay
        // - Restricting to single-cell or range selection
        // - Highlighting selection in a special color
        selectionActor.send({
          type: 'ENTER_RANGE_SELECTION_MODE',
        });
      }

      // Mode deactivated - restore dialog
      if (wasActive && !isActive) {
        onDialogRestore();

        // Exit range selection mode in selection machine
        selectionActor.send({
          type: 'EXIT_RANGE_SELECTION_MODE',
        });
      }
    },
  );

  // =============================================================================
  // Selection Machine → UI Store: Live Range Updates
  // =============================================================================

  /**
   * Subscribe to selection changes.
   * When in range selection mode, convert selection to A1 notation and update UI store.
   */
  const selectionUnsubscribe = selectionActor.subscribe((state) => {
    const currentGridEditingUIStore = uiStore.getState();

    // Only update if we're in range selection mode
    if (!currentGridEditingUIStore.rangeSelectionMode.active) {
      previousSelectionState = state;
      return;
    }

    // Check if selection actually changed
    const prevRanges = selectionSelectors.ranges(previousSelectionState);
    const currRanges = selectionSelectors.ranges(state);

    const selectionChanged =
      prevRanges.length !== currRanges.length ||
      prevRanges.some((r, i) => {
        const curr = currRanges[i];
        return (
          !curr ||
          r.startRow !== curr.startRow ||
          r.startCol !== curr.startCol ||
          r.endRow !== curr.endRow ||
          r.endCol !== curr.endCol
        );
      });

    if (selectionChanged) {
      const rangeStrings = currRanges.map(formatRangeSelectionRange);

      // Join multiple ranges with commas if allowed
      const rangeString = rangeStrings.join(',');

      // Update UI store with new range
      uiStore.getState().updateRangeSelection(rangeString);
    }

    previousSelectionState = state;
  });

  // =============================================================================
  // Cleanup
  // =============================================================================

  return {
    cleanup: () => {
      uiStoreUnsubscribe();
      selectionUnsubscribe.unsubscribe();
    },
  };
}
