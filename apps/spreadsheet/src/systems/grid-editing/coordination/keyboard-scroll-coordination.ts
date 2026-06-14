/**
 * Keyboard Scroll Coordination
 *
 * Coordinator feature that adds smooth scroll animation for keyboard navigation.
 * Follows the coordinator pattern: "Machines own state, coordinator owns execution."
 *
 * ARCHITECTURE:
 * - Subscribes to selection machine and detects activeCell transitions
 * - When activeCell changes by more than 1 cell (Page Up/Down, Ctrl+Arrow, etc.),
 * triggers animated scroll to the new position
 * - Uses transition detection pattern (previousState tracking)
 * - Animation is a SIDE EFFECT - must NOT be in action handlers or state machines
 * - Emits EventBus scroll events for decoupled reactivity
 *
 *
 * @see docs/renderer/README.md - Coordinator Pattern
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 4: State Machine / Coordinator Pattern
 */

import { selectionSelectors } from '../../../selectors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { IEventBus } from '@mog-sdk/contracts/events';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { ISheetViewGeometry, ISheetViewViewport } from '@mog-sdk/sheet-view';

import type { InputCoordinator } from '../../input/coordination/input-coordination';
import type { SelectionActor, SelectionState } from '../../shared/actor-types';
import { getSelectionViewportFollowCell } from '../../shared/types';

// =============================================================================
// Types
// =============================================================================

export interface KeyboardScrollCoordinationConfig {
  /** The selection XState actor to subscribe to */
  selectionActor: SelectionActor;
  /** Get viewport capability for scroll position and viewport bounds */
  getViewport: () => ISheetViewViewport | null;
  /** Get geometry capability for cell dimensions */
  getGeometry: () => ISheetViewGeometry | null;
  /** Input coordinator with animateScrollTo method */
  inputCoordinator: InputCoordinator;
  /** Get the active sheet ID for EventBus emission */
  getActiveSheetId: () => string;
  /** Per-document event bus for coordination events */
  eventBus: IEventBus;
  /** Animation duration in milliseconds (default: 150ms) */
  animationDuration?: number;
  /** Minimum cell movement to trigger animation (default: 1) */
  minCellDelta?: number;
}

export interface KeyboardScrollCoordinationResult {
  /** Cleanup function to unsubscribe and dispose */
  cleanup: () => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Default animation duration for keyboard scroll (fast for responsiveness) */
const DEFAULT_ANIMATION_DURATION = 150;

/** Minimum cell movement to trigger animation (1 = any movement > 1 cell) */
const DEFAULT_MIN_CELL_DELTA = 1;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if active cell changed by more than the minimum delta.
 * Used to detect "large" movements that warrant animation.
 */
function didActiveCellJump(
  previousCell: CellCoord,
  currentCell: CellCoord,
  minDelta: number,
): boolean {
  const rowDelta = Math.abs(currentCell.row - previousCell.row);
  const colDelta = Math.abs(currentCell.col - previousCell.col);
  return rowDelta > minDelta || colDelta > minDelta;
}

/**
 * Check if two cell ranges are equal (or both undefined).
 * Used to detect when the selection range changed without activeCell changing,
 * which indicates a Shift+extend operation that needs scroll tracking.
 */
function cellRangesEqual(a: CellRange | undefined, b: CellRange | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.startRow === b.startRow &&
    a.startCol === b.startCol &&
    a.endRow === b.endRow &&
    a.endCol === b.endCol
  );
}

/**
 * Calculate the scroll position needed to bring a cell into view.
 *
 * @param cell - Target cell to scroll to
 * @param viewport - Viewport capability for scroll position and bounds
 * @param geometry - Geometry capability for cell dimensions
 * @returns Target scroll position, or null if cell is already visible
 */
function calculateScrollTargetForCell(
  cell: CellCoord,
  viewport: ISheetViewViewport,
  geometry: ISheetViewGeometry,
): { x: number; y: number } | null {
  // Get current viewport bounds and scroll position
  const viewportBounds = viewport.getViewportBounds();
  const currentScroll = viewport.getScrollPosition();
  const frozenPanes = viewport.getFrozenPanes();
  const positionDimensions = geometry.getPositionDimensions();

  // Calculate cell position in document coordinates using cumulative getters
  const cellX = positionDimensions.getColLeft(cell.col);
  const cellY = positionDimensions.getRowTop(cell.row);
  const cellWidth = positionDimensions.getColWidth(cell.col);
  const cellHeight = positionDimensions.getRowHeight(cell.row);

  // Calculate frozen area size using cumulative getters
  let frozenWidth = 0;
  let frozenHeight = 0;

  if (frozenPanes) {
    frozenWidth = positionDimensions.getColLeft(frozenPanes.cols);
    frozenHeight = positionDimensions.getRowTop(frozenPanes.rows);
  }

  // Calculate visible area (excluding frozen region)
  const viewportWidth = viewportBounds.width;
  const viewportHeight = viewportBounds.height;

  const visibleLeft = currentScroll.x;
  const visibleTop = currentScroll.y;
  const visibleRight = currentScroll.x + viewportWidth - frozenWidth;
  const visibleBottom = currentScroll.y + viewportHeight - frozenHeight;

  // Cell bounds in scrollable space (after frozen area)
  const cellLeft = cellX - frozenWidth;
  const cellTop = cellY - frozenHeight;
  const cellRight = cellLeft + cellWidth;
  const cellBottom = cellTop + cellHeight;

  let newScrollX = currentScroll.x;
  let newScrollY = currentScroll.y;
  let needsScroll = false;
  const padding = 20; // Padding from viewport edge

  // Check horizontal scrolling need
  if (cellLeft < visibleLeft) {
    newScrollX = Math.max(0, cellLeft - padding);
    needsScroll = true;
  } else if (cellRight > visibleRight) {
    newScrollX = cellRight - (viewportWidth - frozenWidth) + padding;
    needsScroll = true;
  }

  // Check vertical scrolling need
  if (cellTop < visibleTop) {
    newScrollY = Math.max(0, cellTop - padding);
    needsScroll = true;
  } else if (cellBottom > visibleBottom) {
    newScrollY = cellBottom - (viewportHeight - frozenHeight) + padding;
    needsScroll = true;
  }

  return needsScroll ? { x: newScrollX, y: newScrollY } : null;
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Set up keyboard scroll coordination feature.
 *
 * Subscribes to the selection machine and triggers animated scroll when:
 * - activeCell changes by more than minCellDelta cells
 * - This includes Page Up/Down, Ctrl+Arrow, Ctrl+Home/End, Go To, etc.
 *
 * Uses transition detection pattern to compare previous and current activeCell.
 *
 * IMPORTANT: This should be called AFTER all actors are started.
 *
 * @param config - Configuration with actors and dependencies
 * @returns Cleanup function to dispose of subscriptions
 */
export function setupKeyboardScrollCoordination(
  config: KeyboardScrollCoordinationConfig,
): KeyboardScrollCoordinationResult {
  const {
    selectionActor,
    getViewport,
    getGeometry,
    inputCoordinator,
    getActiveSheetId,
    eventBus,
    animationDuration = DEFAULT_ANIMATION_DURATION,
    minCellDelta = DEFAULT_MIN_CELL_DELTA,
  } = config;

  // Track previous activeCell and last range for transition detection
  let previousActiveCell: CellCoord = selectionActor.getSnapshot().context.activeCell;
  const initialRanges = selectionSelectors.ranges(selectionActor.getSnapshot());
  let previousLastRange: CellRange | undefined = initialRanges[initialRanges.length - 1];

  // Subscribe to selection machine state changes
  const subscription = selectionActor.subscribe((state: SelectionState) => {
    const currentActiveCell = state.context.activeCell;
    const currentRanges = selectionSelectors.ranges(state);
    const currentLastRange = currentRanges[currentRanges.length - 1];

    // Detect whether activeCell actually changed position
    const activeCellSame =
      currentActiveCell.row === previousActiveCell.row &&
      currentActiveCell.col === previousActiveCell.col;

    // Path 1: "Jump" movement — activeCell moved by more than minCellDelta cells
    // (Page Up/Down, Ctrl+Arrow, Ctrl+Home/End, Go To, etc.)
    if (didActiveCellJump(previousActiveCell, currentActiveCell, minCellDelta)) {
      const viewport = getViewport();
      const geometry = getGeometry();

      if (viewport && geometry) {
        const sheetId = getActiveSheetId();
        // Calculate target scroll position to bring new cell into view
        const scrollTarget = calculateScrollTargetForCell(currentActiveCell, viewport, geometry);

        if (scrollTarget) {
          // Trigger animated scroll (coordinator side-effect, not in machine)
          inputCoordinator.animateScrollTo(scrollTarget.x, scrollTarget.y, animationDuration);

          // Emit EventBus scroll:changed event for decoupled reactivity
          eventBus.emit({
            type: 'scroll:changed',
            sheetId,
            scrollX: scrollTarget.x,
            scrollY: scrollTarget.y,
            source: 'keyboard',
            timestamp: Date.now(),
          });
        }
      }
    }
    // Path 2: range changed without an activeCell move. Ordinary Shift+Arrow
    // keeps activeCell at the anchor, while the selection edge still needs to
    // remain visible.
    //
    // IMPORTANT: Only fire when the selection machine is in 'idle' state.
    // During mouse drag operations (selecting/extending/multiSelecting states),
    // the range also changes with activeCell fixed at the anchor — but those
    // scrolls are handled by normal mouse-based auto-scroll, not animated scroll.
    // Without this guard, Path 2 fires on every MOUSE_MOVE during drag, causing
    // animated scroll conflicts with the mouse-based scrolling.
    else if (
      state.matches('idle') &&
      activeCellSame &&
      currentLastRange &&
      !cellRangesEqual(currentLastRange, previousLastRange)
    ) {
      const viewport = getViewport();
      const geometry = getGeometry();

      if (viewport && geometry) {
        const movingEdge = getSelectionViewportFollowCell(
          currentLastRange,
          currentActiveCell,
          state.context.anchor,
        );
        const sheetId = getActiveSheetId();
        const scrollTarget = calculateScrollTargetForCell(movingEdge, viewport, geometry);

        if (scrollTarget) {
          inputCoordinator.animateScrollTo(scrollTarget.x, scrollTarget.y, animationDuration);

          eventBus.emit({
            type: 'scroll:changed',
            sheetId,
            scrollX: scrollTarget.x,
            scrollY: scrollTarget.y,
            source: 'keyboard',
            timestamp: Date.now(),
          });
        }
      }
    }

    // Update previous state for next comparison
    previousActiveCell = currentActiveCell;
    previousLastRange = currentLastRange;
  });

  return {
    cleanup: () => subscription.unsubscribe(),
  };
}
