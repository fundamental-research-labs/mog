/**
 * Comment Hover Coordination Module
 *
 * Coordinates hover-based comment popover triggering for cells with comments.
 * Handles the timer-based show/hide logic for displaying comment popovers
 * when the mouse hovers over comment indicator triangles.
 *
 * ARCHITECTURE:
 * - Receives mouse move events via callback
 * - Hit-tests for comment indicators using ISheetViewHitTest.atViewportPoint()
 * - Manages timers for show delay (300ms) and hide delay (300ms)
 * - Sends HOVER_CELL/LEAVE_CELL events to the comment state machine
 * - Subscribes to scroll changes for immediate popover dismissal
 * - Tracks popover mouse state to prevent hiding when mouse is in popover
 *
 * FLOW:
 * 1. Mouse enters comment indicator area
 * 2. Start showTimer (300ms)
 * 3. Timer fires → send HOVER_CELL to comment actor
 * 4. Mouse leaves indicator (and not in popover)
 * 5. Start hideTimer (300ms)
 * 6. Timer fires → send LEAVE_CELL to comment actor
 *
 * SPECIAL CASES:
 * - Scroll event → immediate LEAVE_CELL (no delay)
 * - Mouse enters popover → cancel hideTimer
 * - Mouse leaves popover → start hideTimer
 *
 * @see engine/src/state/coordinator/features/comment/comment-selection-coordination.ts
 */

import type { Worksheet } from '@mog-sdk/contracts/api';
import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ISheetViewHitTest } from '@mog-sdk/sheet-view';

import { CommentEvents } from '../../machines/comment-machine';

import type { InputCoordinator } from '../../../input/coordination/input-coordination';
import type { CommentActor } from '../../../shared/actor-types';

// =============================================================================
// Constants
// =============================================================================

/** Delay before showing comment popover after hover (ms) */
const SHOW_DELAY = 300;

/** Delay before hiding comment popover after mouse leaves (ms) */
const HIDE_DELAY = 300;

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for comment hover coordination.
 */
export interface CommentHoverCoordinationConfig {
  /** Comment actor to send events to */
  commentActor: CommentActor;
  /** Input coordinator for scroll change subscription */
  inputCoordinator?: InputCoordinator;
  /** Hit test capability for comment indicator detection */
  hitTest?: ISheetViewHitTest;
  /** Dynamic hit-test resolver for sheet-aware React wiring. */
  getHitTest?: () => ISheetViewHitTest | null;
  /** Worksheet for viewport reads (comment indicators, cell data) */
  ws?: Worksheet;
  /** Dynamic worksheet resolver for sheet-aware React wiring. */
  getWorksheet?: () => Worksheet | null;
  /** Get the currently active sheet ID */
  getActiveSheetId: () => SheetId;
}

/**
 * Mouse position information passed from the grid.
 */
export interface MouseMoveInfo {
  /** X position relative to grid container */
  x: number;
  /** Y position relative to grid container */
  y: number;
}

/**
 * Result from setting up comment hover coordination.
 */
export interface CommentHoverCoordinationResult {
  /** Cleanup function to dispose subscriptions and cancel timers */
  cleanup: () => void;
  /** Called when mouse enters the comment popover element */
  notifyPopoverMouseEnter: () => void;
  /** Called when mouse leaves the comment popover element */
  notifyPopoverMouseLeave: () => void;
  /** Called when mouse enters a DOM overlay for a comment indicator. */
  handleIndicatorMouseEnter: (info: HoveredCellCandidate) => void;
  /** Called when mouse leaves a DOM overlay for a comment indicator. */
  handleIndicatorMouseLeave: (info: HoveredCellCandidate) => void;
  /** Handle mouse move events from the grid - call from onMouseMove handler */
  handleMouseMove: (info: MouseMoveInfo) => void;
  /** Handle mouse leave events from the grid container */
  handleMouseLeave: () => void;
}

/**
 * Internal state for tracking the hovered cell.
 */
interface HoveredCellCandidate {
  sheetId: SheetId;
  row: number;
  col: number;
}

interface HoveredCellState extends HoveredCellCandidate {
  cellId: CellId;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Set up comment hover coordination.
 *
 * This function creates the hover detection and timer management logic
 * for showing comment popovers when hovering over comment indicators.
 *
 * @param config - Configuration for the coordination
 * @returns Cleanup function and popover mouse state notifiers
 *
 * @example
 * ```ts
 * const { cleanup, notifyPopoverMouseEnter, notifyPopoverMouseLeave, handleMouseMove } =
 * setupCommentHoverCoordination({
 * commentActor,
 * inputCoordinator,
 * getHitTest,
 * ws,
 * getActiveSheetId
 * });
 *
 * // In grid mouse move handler:
 * handleMouseMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
 *
 * // In CommentPopover component:
 * <div onMouseEnter={notifyPopoverMouseEnter} onMouseLeave={notifyPopoverMouseLeave}>
 * ...
 * </div>
 *
 * // On unmount:
 * cleanup();
 * ```
 */
export function setupCommentHoverCoordination(
  config: CommentHoverCoordinationConfig,
): CommentHoverCoordinationResult {
  const {
    commentActor,
    inputCoordinator,
    hitTest,
    getHitTest,
    ws,
    getWorksheet,
    getActiveSheetId,
  } = config;

  // ==========================================================================
  // State
  // ==========================================================================

  /** Timer for showing the popover after delay */
  let showTimer: ReturnType<typeof setTimeout> | null = null;

  /** Timer for hiding the popover after delay */
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether the mouse is currently inside the popover */
  let isMouseInPopover = false;

  /** Currently hovered cell with comment indicator (null if not hovering) */
  let hoveredCell: HoveredCellCandidate | null = null;

  /** Whether the coordination has been disposed */
  let isDisposed = false;

  // ==========================================================================
  // Timer Management
  // ==========================================================================

  /**
   * Cancel the show timer if active.
   */
  function cancelShowTimer(): void {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    }
  }

  /**
   * Cancel the hide timer if active.
   */
  function cancelHideTimer(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  /**
   * Cancel all timers.
   */
  function cancelAllTimers(): void {
    cancelShowTimer();
    cancelHideTimer();
  }

  // ==========================================================================
  // Event Sending
  // ==========================================================================

  /**
   * Send HOVER_CELL event to the comment actor.
   */
  function sendHoverCell(cell: HoveredCellState): void {
    if (isDisposed) return;

    commentActor.send(
      CommentEvents.hoverCell({
        cellId: cell.cellId,
        sheetId: cell.sheetId,
        row: cell.row,
        col: cell.col,
      }),
    );
  }

  async function resolveAndSendHoverCell(cell: HoveredCellCandidate): Promise<void> {
    const currentWs = getWorksheet?.() ?? ws;
    if (!currentWs || isDisposed) return;

    const comments = await currentWs.comments.getForCell(cell.row, cell.col);
    const cellId = comments[0]?.cellRef;
    if (!cellId || isDisposed) return;

    const stillHovering =
      hoveredCell?.sheetId === cell.sheetId &&
      hoveredCell?.row === cell.row &&
      hoveredCell?.col === cell.col;
    if (!stillHovering) return;

    sendHoverCell({
      ...cell,
      cellId: toCellId(cellId),
    });
  }

  /**
   * Send LEAVE_CELL event to the comment actor.
   */
  function sendLeaveCell(): void {
    if (isDisposed) return;

    // Only send LEAVE_CELL if we're in viewing state (not editing/composing)
    const state = commentActor.getSnapshot();
    if (state.value === 'viewing') {
      commentActor.send(CommentEvents.leaveCell());
    }
  }

  // ==========================================================================
  // Hit Testing
  // ==========================================================================

  /**
   * Check if a mouse position is over a comment indicator for a cell with comments.
   * Returns the cell info if on a comment indicator, null otherwise.
   *
   * Uses the SheetView hit-test pipeline which already performs comment indicator
   * detection (triangle geometry + comment presence) internally.
   */
  function hitTestCommentIndicator(x: number, y: number): HoveredCellCandidate | null {
    const sheetId = getActiveSheetId();
    const currentHitTest = getHitTest?.() ?? hitTest;
    if (!currentHitTest) return null;

    const result = currentHitTest.atViewportPoint({ x, y });
    if (result.type !== 'comment-indicator') return null;

    return {
      sheetId,
      row: result.row,
      col: result.col,
    };
  }

  // ==========================================================================
  // Mouse Event Handling
  // ==========================================================================

  function isSameHoveredCell(cell: HoveredCellCandidate): boolean {
    return (
      hoveredCell?.sheetId === cell.sheetId &&
      hoveredCell?.row === cell.row &&
      hoveredCell?.col === cell.col
    );
  }

  function beginHoverCandidate(cell: HoveredCellCandidate): void {
    if (isDisposed || isSameHoveredCell(cell)) return;

    hoveredCell = cell;
    cancelAllTimers();

    showTimer = setTimeout(() => {
      showTimer = null;
      if (hoveredCell) {
        void resolveAndSendHoverCell(hoveredCell);
      }
    }, SHOW_DELAY);
  }

  function endHoverCandidate(cell: HoveredCellCandidate | null = null): void {
    if (isDisposed) return;
    if (cell && !isSameHoveredCell(cell)) return;
    if (!hoveredCell) return;

    hoveredCell = null;
    cancelShowTimer();

    if (!isMouseInPopover) {
      startHideTimer();
    }
  }

  /**
   * Handle mouse entering a DOM overlay emitted by the canvas interactive
   * element layer. This path uses the overlay's cell metadata directly instead
   * of re-discovering the same indicator through coordinate hit-testing.
   */
  function handleIndicatorMouseEnter(info: HoveredCellCandidate): void {
    beginHoverCandidate(info);
  }

  /**
   * Handle mouse leaving a DOM overlay emitted by the canvas interactive
   * element layer.
   */
  function handleIndicatorMouseLeave(info: HoveredCellCandidate): void {
    endHoverCandidate(info);
  }

  /**
   * Handle mouse move events from the grid.
   * Hit tests for comment indicators and manages show/hide timers.
   */
  function handleMouseMove(info: MouseMoveInfo): void {
    if (isDisposed) return;

    const hit = hitTestCommentIndicator(info.x, info.y);

    if (hit) {
      // Mouse is over a comment indicator
      beginHoverCandidate(hit);
    } else {
      // Mouse is not over a comment indicator
      endHoverCandidate();
    }
  }

  /**
   * Handle mouse leave events from the grid container.
   */
  function handleMouseLeave(): void {
    if (isDisposed) return;

    hoveredCell = null;
    cancelShowTimer();

    // Start hide timer if not in popover
    if (!isMouseInPopover) {
      startHideTimer();
    }
  }

  /**
   * Start the hide timer (used when mouse leaves indicator/grid).
   */
  function startHideTimer(): void {
    if (hideTimer !== null) return; // Already timing

    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (!isMouseInPopover) {
        sendLeaveCell();
      }
    }, HIDE_DELAY);
  }

  // ==========================================================================
  // Popover Mouse State
  // ==========================================================================

  /**
   * Called when mouse enters the comment popover element.
   * Cancels any pending hide timer.
   */
  function notifyPopoverMouseEnter(): void {
    if (isDisposed) return;
    isMouseInPopover = true;
    cancelHideTimer();
  }

  /**
   * Called when mouse leaves the comment popover element.
   * Starts hide timer if not hovering over indicator.
   */
  function notifyPopoverMouseLeave(): void {
    if (isDisposed) return;
    isMouseInPopover = false;

    // If not hovering over an indicator, start hide timer
    if (!hoveredCell) {
      startHideTimer();
    }
  }

  // ==========================================================================
  // Scroll Handling
  // ==========================================================================

  /**
   * Handle scroll events - immediately close popover (no delay).
   */
  function handleScroll(): void {
    if (isDisposed) return;

    // Cancel all timers
    cancelAllTimers();

    // Reset state
    hoveredCell = null;
    isMouseInPopover = false;

    // Immediately send LEAVE_CELL
    sendLeaveCell();
  }

  // Subscribe to scroll changes
  const unsubscribeScroll = inputCoordinator?.onScrollChange(handleScroll) ?? (() => {});

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  function cleanup(): void {
    if (isDisposed) return;
    isDisposed = true;

    // Cancel all timers
    cancelAllTimers();

    // Unsubscribe from scroll changes
    unsubscribeScroll();

    // Reset state
    hoveredCell = null;
    isMouseInPopover = false;
  }

  // ==========================================================================
  // Return Result
  // ==========================================================================

  return {
    cleanup,
    notifyPopoverMouseEnter,
    notifyPopoverMouseLeave,
    handleIndicatorMouseEnter,
    handleIndicatorMouseLeave,
    handleMouseMove,
    handleMouseLeave,
  };
}
