/**
 * Formula Edit Auto-Scroll Coordination
 *
 * Coordinator feature that handles auto-scrolling during formula editing:
 * - When clicking off-screen cell references during formula edit, auto-scroll to show them
 * - When drag-selecting during formula edit, auto-scroll at viewport edges
 *
 * ARCHITECTURE:
 * - Subscribes to editor machine for formula mode state
 * - Subscribes to selection machine for range addition events
 * - Uses auto-scroll service for edge-based scrolling during drag
 * - Animation is a SIDE EFFECT - must NOT be in action handlers or state machines
 *
 * @see docs/renderer/README.md - Coordinator Pattern
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 4: State Machine / Coordinator Pattern
 */

import type { CellRange } from '@mog-sdk/contracts/core';
import type { ISheetViewGeometry, ISheetViewViewport } from '@mog-sdk/sheet-view';

import {
  setupAutoScroll,
  type AutoScrollConfig,
  type AutoScrollController,
  type ViewportBounds,
} from '../../input/coordination/auto-scroll-service';
import type { InputCoordinator } from '../../input/coordination/input-coordination';
import type { EditorActor, EditorState } from '../../shared/actor-types';

// =============================================================================
// Types
// =============================================================================

export interface FormulaEditAutoScrollConfig {
  /** The editor XState actor to subscribe to */
  editorActor: EditorActor;
  /** Get viewport capability for scroll position and viewport bounds */
  getViewport: () => ISheetViewViewport | null;
  /** Get geometry capability for cell dimensions */
  getGeometry: () => ISheetViewGeometry | null;
  /** Input coordinator with animateScrollTo method */
  inputCoordinator: InputCoordinator;
  /** Get current mouse position in viewport coordinates */
  getMousePosition: () => { x: number; y: number } | null;
  /** Request render after scroll */
  requestRender?: () => void;
  /** Animation duration for off-screen click scroll (default: 200ms) */
  clickScrollDuration?: number;
  /** Padding around target cell when scrolling (default: 50px) */
  scrollPadding?: number;
}

export interface FormulaEditAutoScrollResult {
  /**
   * Notify that a formula range was added (clicked or drag-selected).
   * Call this when a user clicks a cell during formula editing.
   * Triggers auto-scroll if the cell is off-screen.
   */
  onFormulaRangeAdded: (range: CellRange) => void;

  /**
   * Start auto-scroll during formula range drag.
   * Call this when starting to drag-select a range in formula mode.
   */
  startDragAutoScroll: () => void;

  /**
   * Stop auto-scroll during formula range drag.
   * Call this when drag-selection ends in formula mode.
   */
  stopDragAutoScroll: () => void;

  /** Cleanup function to unsubscribe and dispose */
  cleanup: () => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Default animation duration for off-screen click scroll */
const DEFAULT_CLICK_SCROLL_DURATION = 200;

/** Default padding around target cell */
const DEFAULT_SCROLL_PADDING = 50;

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

/**
 * Calculate the scroll position needed to bring a cell range into view.
 *
 * @param range - Target range to scroll to
 * @param viewport - Viewport capability for scroll position and bounds
 * @param geometry - Geometry capability for cell dimensions
 * @param padding - Padding around the range (default 50px)
 * @returns Target scroll position, or null if range is already visible
 */
function calculateScrollTargetForRange(
  range: CellRange,
  viewport: ISheetViewViewport,
  geometry: ISheetViewGeometry,
  padding: number = DEFAULT_SCROLL_PADDING,
): { x: number; y: number } | null {
  // Get current viewport bounds and scroll position
  const viewportBounds = viewport.getViewportBounds();
  const currentScroll = viewport.getScrollPosition();
  const frozenPanes = viewport.getFrozenPanes();
  const positionDimensions = geometry.getPositionDimensions();

  // Calculate range position in document coordinates
  const rangeLeft = positionDimensions.getColLeft(range.startCol);
  const rangeTop = positionDimensions.getRowTop(range.startRow);
  const rangeRight =
    positionDimensions.getColLeft(range.endCol) + positionDimensions.getColWidth(range.endCol);
  const rangeBottom =
    positionDimensions.getRowTop(range.endRow) + positionDimensions.getRowHeight(range.endRow);

  // Calculate frozen area size
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

  // Range bounds in scrollable space (after frozen area)
  const scrollableRangeLeft = rangeLeft - frozenWidth;
  const scrollableRangeTop = rangeTop - frozenHeight;
  const scrollableRangeRight = rangeRight - frozenWidth;
  const scrollableRangeBottom = rangeBottom - frozenHeight;

  let newScrollX = currentScroll.x;
  let newScrollY = currentScroll.y;
  let needsScroll = false;

  // Check horizontal scrolling need
  if (scrollableRangeLeft < visibleLeft) {
    newScrollX = Math.max(0, scrollableRangeLeft - padding);
    needsScroll = true;
  } else if (scrollableRangeRight > visibleRight) {
    newScrollX = scrollableRangeRight - (viewportWidth - frozenWidth) + padding;
    needsScroll = true;
  }

  // Check vertical scrolling need
  if (scrollableRangeTop < visibleTop) {
    newScrollY = Math.max(0, scrollableRangeTop - padding);
    needsScroll = true;
  } else if (scrollableRangeBottom > visibleBottom) {
    newScrollY = scrollableRangeBottom - (viewportHeight - frozenHeight) + padding;
    needsScroll = true;
  }

  return needsScroll ? { x: newScrollX, y: newScrollY } : null;
}

// =============================================================================
// Coordination Setup
// =============================================================================

/**
 * Set up formula edit auto-scroll coordination feature.
 *
 * This feature:
 * 1. Auto-scrolls when clicking off-screen cells during formula editing
 * 2. Auto-scrolls at viewport edges during drag-selection in formula mode
 *
 * @param config - Configuration with actors and dependencies
 * @returns Result object with methods to trigger scrolling and cleanup
 */
export function setupFormulaEditAutoScroll(
  config: FormulaEditAutoScrollConfig,
): FormulaEditAutoScrollResult {
  const {
    editorActor,
    getViewport,
    getGeometry,
    inputCoordinator,
    getMousePosition,
    requestRender,
    clickScrollDuration = DEFAULT_CLICK_SCROLL_DURATION,
    scrollPadding = DEFAULT_SCROLL_PADDING,
  } = config;

  // Track if we're in formula editing mode
  let isFormulaEditing = false;

  // Auto-scroll controller for drag operations
  let dragAutoScroll: AutoScrollController | null = null;

  // Subscribe to editor state to track formula editing mode
  const editorSubscription = editorActor.subscribe((state: EditorState) => {
    // Check if editor state matches 'formulaEditing' using XState matches method
    isFormulaEditing = state.matches('formulaEditing');
  });

  /**
   * Handle formula range addition - auto-scroll if off-screen.
   */
  function onFormulaRangeAdded(range: CellRange): void {
    // Only auto-scroll if in formula editing mode
    if (!isFormulaEditing) return;

    const viewport = getViewport();
    const geometry = getGeometry();

    if (!viewport || !geometry) return;

    // Calculate target scroll position
    const scrollTarget = calculateScrollTargetForRange(range, viewport, geometry, scrollPadding);

    if (scrollTarget) {
      // Trigger animated scroll
      inputCoordinator.animateScrollTo(scrollTarget.x, scrollTarget.y, clickScrollDuration);
    }
  }

  /**
   * Start auto-scroll during drag-selection in formula mode.
   */
  function startDragAutoScroll(): void {
    // Only enable if in formula editing mode
    if (!isFormulaEditing) return;

    // Create auto-scroll controller if not already created
    if (!dragAutoScroll) {
      const autoScrollConfig: AutoScrollConfig = {
        getMousePosition,
        getViewportBounds: (): ViewportBounds => {
          const vp = getViewport();
          if (!vp) {
            return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
          }
          return sheetRectToViewportBounds(vp.getViewportBounds());
        },
        applyScrollDelta: (dx: number, dy: number) => {
          inputCoordinator.scrollBy(dx, dy);
        },
        requestRender,
        // Use slightly smaller threshold for formula edit (more responsive)
        threshold: 40,
        minSpeed: 150,
        maxSpeed: 700,
      };

      dragAutoScroll = setupAutoScroll(autoScrollConfig);
    }

    dragAutoScroll.start();
  }

  /**
   * Stop auto-scroll during drag-selection.
   */
  function stopDragAutoScroll(): void {
    dragAutoScroll?.stop();
  }

  /**
   * Cleanup function.
   */
  function cleanup(): void {
    editorSubscription.unsubscribe();
    dragAutoScroll?.cleanup();
    dragAutoScroll = null;
  }

  return {
    onFormulaRangeAdded,
    startDragAutoScroll,
    stopDragAutoScroll,
    cleanup,
  };
}
