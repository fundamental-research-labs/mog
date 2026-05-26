/**
 * Editor Scroll Coordination
 *
 * Coordinator feature that handles scrolling when editor state changes:
 * - A.2: When editing starts and cell is partially scrolled, scroll to show cell fully
 *
 * ARCHITECTURE:
 * - Subscribes to editor machine for state transitions
 * - When entering editing state, checks if cell is fully visible
 * - If not fully visible, scrolls to bring entire cell into view
 * - Uses InputCoordinator for smooth animated scroll
 *
 * @see docs/renderer/README.md - Coordinator Pattern
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 4: State Machine / Coordinator Pattern
 */

import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { ISheetViewGeometry, ISheetViewViewport } from '@mog-sdk/sheet-view';

import type { InputCoordinator } from '../../input/coordination/input-coordination';
import type { EditorActor, EditorState, SelectionActor } from '../../shared/actor-types';

// =============================================================================
// Types
// =============================================================================

export interface EditorScrollCoordinationConfig {
  /** The editor XState actor to subscribe to */
  editorActor: EditorActor;
  /** The selection XState actor (for getting editingCell) */
  selectionActor: SelectionActor;
  /** Get viewport capability for scroll position and viewport bounds */
  getViewport: () => ISheetViewViewport | null;
  /** Get geometry capability for cell dimensions */
  getGeometry: () => ISheetViewGeometry | null;
  /** Input coordinator with animateScrollTo method */
  inputCoordinator: InputCoordinator;
  /** Animation duration in milliseconds (default: 100ms - fast for immediate feedback) */
  animationDuration?: number;
  /** Padding around cell when scrolling (default: 20px) */
  scrollPadding?: number;
}

export interface EditorScrollCoordinationResult {
  /** Cleanup function to unsubscribe and dispose */
  cleanup: () => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Default animation duration for editor scroll (fast for immediate feedback) */
const DEFAULT_ANIMATION_DURATION = 100;

/** Default padding around cell */
const DEFAULT_SCROLL_PADDING = 20;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Calculate the scroll position needed to bring a cell fully into view.
 * A.2: Cell should be fully visible when editing starts.
 *
 * @param cell - Target cell to scroll to
 * @param viewport - Viewport capability for scroll position and bounds
 * @param geometry - Geometry capability for cell dimensions
 * @param padding - Padding from viewport edge
 * @returns Target scroll position, or null if cell is already fully visible
 */
function calculateScrollTargetForCellEdit(
  cell: CellCoord,
  viewport: ISheetViewViewport,
  geometry: ISheetViewGeometry,
  padding: number,
): { x: number; y: number } | null {
  // Get current viewport bounds and scroll position
  const viewportBounds = viewport.getViewportBounds();
  const currentScroll = viewport.getScrollPosition();
  const frozenPanes = viewport.getFrozenPanes();
  const positionDimensions = geometry.getPositionDimensions();

  // Calculate cell position in document coordinates
  const cellX = positionDimensions.getColLeft(cell.col);
  const cellY = positionDimensions.getRowTop(cell.row);
  const cellWidth = positionDimensions.getColWidth(cell.col);
  const cellHeight = positionDimensions.getRowHeight(cell.row);

  // Calculate frozen area size
  let frozenWidth = 0;
  let frozenHeight = 0;

  if (frozenPanes) {
    frozenWidth = positionDimensions.getColLeft(frozenPanes.cols);
    frozenHeight = positionDimensions.getRowTop(frozenPanes.rows);
  }

  // Calculate visible area (excluding frozen region)
  // viewportBounds is { x, y, width, height }
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

  // A.2: Check if cell is FULLY visible (not partially scrolled)
  // If any edge is outside visible area, we need to scroll
  if (cellLeft < visibleLeft) {
    // Left edge is clipped - scroll left
    newScrollX = Math.max(0, cellLeft - padding);
    needsScroll = true;
  } else if (cellRight > visibleRight) {
    // Right edge is clipped - scroll right
    newScrollX = cellRight - (viewportWidth - frozenWidth) + padding;
    needsScroll = true;
  }

  if (cellTop < visibleTop) {
    // Top edge is clipped - scroll up
    newScrollY = Math.max(0, cellTop - padding);
    needsScroll = true;
  } else if (cellBottom > visibleBottom) {
    // Bottom edge is clipped - scroll down
    newScrollY = cellBottom - (viewportHeight - frozenHeight) + padding;
    needsScroll = true;
  }

  return needsScroll ? { x: newScrollX, y: newScrollY } : null;
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Set up editor scroll coordination feature.
 *
 * A.2: When editing starts and cell is partially scrolled off-screen,
 * automatically scroll to show the full cell. This ensures the user
 * can see the entire cell they're editing.
 *
 * @param config - Configuration with actors and dependencies
 * @returns Result object with cleanup function
 */
export function setupEditorScrollCoordination(
  config: EditorScrollCoordinationConfig,
): EditorScrollCoordinationResult {
  const {
    editorActor,
    selectionActor,
    getViewport,
    getGeometry,
    inputCoordinator,
    animationDuration = DEFAULT_ANIMATION_DURATION,
    scrollPadding = DEFAULT_SCROLL_PADDING,
  } = config;

  // Track previous state for transition detection
  let previousState: EditorState | null = null;

  // Subscribe to editor machine state changes
  const subscription = editorActor.subscribe((state: EditorState) => {
    // Detect transition to editing state (from inactive)
    const wasInactive = previousState === null || previousState.matches('inactive');
    const isEditing = state.matches('editing') || state.matches('formulaEditing');

    // A.2: When editing starts, scroll cell into full view
    if (wasInactive && isEditing) {
      // Use editingCell from editor context (stable during formula point mode).
      // Falls back to selection.activeCell for backward compatibility.
      const editingCell =
        state.context.editingCell ?? selectionActor.getSnapshot().context.activeCell;
      if (!editingCell) {
        previousState = state;
        return;
      }

      const viewport = getViewport();
      const geometry = getGeometry();

      if (viewport && geometry) {
        // Calculate target scroll position to bring cell fully into view
        const scrollTarget = calculateScrollTargetForCellEdit(
          editingCell,
          viewport,
          geometry,
          scrollPadding,
        );

        if (scrollTarget) {
          // Trigger animated scroll to show full cell
          inputCoordinator.animateScrollTo(scrollTarget.x, scrollTarget.y, animationDuration);
        }
      }
    }

    previousState = state;
  });

  return {
    cleanup: () => subscription.unsubscribe(),
  };
}
