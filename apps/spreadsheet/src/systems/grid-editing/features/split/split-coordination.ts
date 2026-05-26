/**
 * Split View Coordination
 *
 * Coordinates split view state between the persisted config (Yjs SheetMeta),
 * session-local UI state (UIStore), and the EventBus.
 *
 * ARCHITECTURE:
 * - Split CONFIG (direction, positions) is persisted in SheetMeta (Yjs)
 * - Split UI STATE (scroll positions, focused viewport) is session-local (UIStore)
 * - Coordinator bridges these two sources and responds to EventBus events
 *
 * RESPONSIBILITIES:
 * 1. Initialize split scroll positions when split is created
 * 2. Clean up split state when split is removed
 * 3. Clean up split state when sheet is deleted
 * 4. Update focused viewport on events
 *
 * KEY PATTERNS:
 * - Coordinator owns side effects, UIStore is pure state
 * - Uses transition detection pattern (track previousState)
 * - All EventBus subscriptions are cleaned up on dispose
 *
 */

import { sheetId as toSheetId, type SheetId } from '@mog-sdk/contracts/core';
import type { Point } from '@mog-sdk/contracts/viewport';

import type { Workbook } from '@mog-sdk/contracts/api';

// =============================================================================
// Types
// =============================================================================

/**
 * Narrow interface for the split view methods this coordination needs from UIStore.
 * Avoids importing the full SplitViewSlice from ui-store (DAG violation).
 */
export interface SplitViewOps {
  initializeSplitScrollPositions: (
    sheetId: SheetId,
    viewportIds: string[],
    initialPosition: Point,
  ) => void;
  clearSplitScrollPositions: (sheetId: SheetId) => void;
  cleanupSheetSplitState: (sheetId: SheetId) => void;
  setFocusedViewport: (sheetId: SheetId, viewportId: string) => void;
  getSplitScrollPosition: (sheetId: SheetId, viewportId: string) => Point;
}

/**
 * Dependencies needed by SplitViewCoordination.
 * Injected from SheetCoordinator.
 */
export interface SplitViewCoordinationConfig {
  /** Workbook API for event subscriptions */
  workbook: Workbook;

  /**
   * UIStore methods for managing split view state.
   * Provides access to split scroll positions and focused viewport.
   */
  splitViewSlice: SplitViewOps;

  /**
   * Get the current scroll position for a sheet.
   * Used to initialize split viewports with the current scroll position.
   */
  getScrollPosition: (sheetId: SheetId) => Point;

  /**
   * Optional callback when split state changes.
   * Used to trigger re-renders.
   */
  onSplitStateChanged?: (sheetId: SheetId) => void;
}

/**
 * Result returned by setupSplitViewCoordination.
 */
export interface SplitViewCoordinationResult {
  /** Dispose of subscriptions and cleanup */
  dispose: () => void;

  /**
   * Get viewport IDs for a split direction.
   * Useful for initializing scroll positions or navigation.
   */
  getViewportIdsForDirection: (direction: 'horizontal' | 'vertical' | 'both') => string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the viewport IDs for a given split direction.
 */
function getViewportIdsForDirection(direction: 'horizontal' | 'vertical' | 'both'): string[] {
  switch (direction) {
    case 'horizontal':
      return ['top', 'bottom'];
    case 'vertical':
      return ['left', 'right'];
    case 'both':
      return ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
  }
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Set up split view coordination.
 *
 * This function creates EventBus subscriptions to:
 * - Initialize split scroll positions when split is created
 * - Clean up split state when split is removed
 * - Clean up split state when sheet is deleted
 *
 * CRITICAL: All subscriptions are cleaned up on dispose.
 *
 * @param config - Configuration including EventBus and UIStore methods
 * @returns Coordination result with cleanup function
 */
export function setupSplitViewCoordination(
  config: SplitViewCoordinationConfig,
): SplitViewCoordinationResult {
  const { workbook, splitViewSlice, getScrollPosition, onSplitStateChanged } = config;

  // Track unsubscribe functions for cleanup
  const unsubscribers: Array<() => void> = [];

  // ---------------------------------------------------------------------------
  // Handle split:created - Initialize scroll positions for all viewports
  // ---------------------------------------------------------------------------
  const unsubSplitCreated = workbook.on('split:created', (event) => {
    const sid = toSheetId(event.sheetId);
    const { config: splitConfig } = event;
    const viewportIds = getViewportIdsForDirection(splitConfig.direction);

    // Get current scroll position to initialize all viewports
    const currentScrollPosition = getScrollPosition(sid);

    // Initialize all viewport scroll positions to current position
    splitViewSlice.initializeSplitScrollPositions(sid, viewportIds, currentScrollPosition);

    // Notify listeners of state change
    onSplitStateChanged?.(sid);
  });
  unsubscribers.push(unsubSplitCreated);

  // ---------------------------------------------------------------------------
  // Handle split:removed - Clear scroll positions and reset to main viewport
  // ---------------------------------------------------------------------------
  const unsubSplitRemoved = workbook.on('split:removed', (event) => {
    const sid = toSheetId(event.sheetId);

    // Clear split scroll positions (preserves focused viewport's position for main)
    splitViewSlice.clearSplitScrollPositions(sid);

    // Notify listeners of state change
    onSplitStateChanged?.(sid);
  });
  unsubscribers.push(unsubSplitRemoved);

  // ---------------------------------------------------------------------------
  // Handle split:position-changed - May need to update viewport IDs if direction changed
  // ---------------------------------------------------------------------------
  const unsubSplitPositionChanged = workbook.on('split:position-changed', (event) => {
    const sid = toSheetId(event.sheetId);
    const { config: splitConfig } = event;

    // Direction change means viewport IDs change
    // Re-initialize with new viewport IDs but preserve scroll positions where possible
    const newViewportIds = getViewportIdsForDirection(splitConfig.direction);

    // Get current scroll position from the focused viewport (or default to 0,0)
    const currentScrollPosition =
      splitViewSlice.getSplitScrollPosition(sid, 'main') || getScrollPosition(sid);

    // Re-initialize with new viewport layout
    splitViewSlice.initializeSplitScrollPositions(sid, newViewportIds, currentScrollPosition);

    // Notify listeners of state change
    onSplitStateChanged?.(sid);
  });
  unsubscribers.push(unsubSplitPositionChanged);

  // ---------------------------------------------------------------------------
  // Handle sheet:deleted - Clean up ALL split state for the sheet
  // CRITICAL: This prevents memory leaks when sheets are deleted
  // ---------------------------------------------------------------------------
  const unsubSheetDeleted = workbook.on('sheet:deleted', (event) => {
    const sid = toSheetId(event.sheetId);

    // Clean up all split state for the deleted sheet
    splitViewSlice.cleanupSheetSplitState(sid);
  });
  unsubscribers.push(unsubSheetDeleted);

  // ---------------------------------------------------------------------------
  // Return coordination result with cleanup
  // ---------------------------------------------------------------------------
  return {
    dispose: () => {
      // Unsubscribe from all events
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;
    },

    getViewportIdsForDirection,
  };
}
