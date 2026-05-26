/**
 * Page Break Coordination
 *
 * Coordinates page break drag interactions in Page Break Preview mode.
 * Subscribes to the PageBreakMachine state and executes side effects
 * when the user finishes dragging a page break line.
 *
 * Architecture:
 * - PageBreakMachine owns state (isDragging, pageBreak info, positions)
 * - Coordinator owns execution (hit detection, store updates)
 *
 * Flow:
 * 1. User clicks on page break line -> coordinator detects hit
 * 2. Coordinator sends START_DRAG to machine with page break info
 * 3. User drags -> coordinator sends DRAG events with updated position
 * 4. User releases -> coordinator sends END_DRAG, detects transition
 * 5. Coordinator updates page breaks via Sheets domain module
 *
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type {
  PageBreakActor,
  PageBreakInfo,
  PageBreakOrientation,
  PageBreakState,
  PageBreakType,
} from '../../machines/page-break-machine';

// =============================================================================
// Types
// =============================================================================

/**
 * Hit detection result for page break lines.
 */
export interface PageBreakHitResult {
  /** Whether a page break line was hit */
  hit: boolean;
  /** Type of page break (manual or automatic) */
  type?: PageBreakType;
  /** Orientation of the page break line */
  orientation?: PageBreakOrientation;
  /** Position of the page break (row for horizontal, col for vertical) */
  position?: number;
}

/**
 * Page break line position information for rendering.
 */
export interface PageBreakLinePosition {
  /** Type of page break */
  type: PageBreakType;
  /** Orientation of the line */
  orientation: PageBreakOrientation;
  /** Position (row or column index) */
  position: number;
  /** Pixel position (y for horizontal, x for vertical) */
  pixelPosition: number;
}

/**
 * Dependencies needed by PageBreakCoordinator.
 * Injected from SheetCoordinator.
 */
export interface PageBreakCoordinatorDependencies {
  /** Page break machine actor */
  pageBreakActor: PageBreakActor;
  /** Workbook for unified API access */
  workbook?: Workbook;
  /** Active sheet ID getter */
  getActiveSheetId: () => SheetId;
  /** Get row position in pixels (0-indexed) */
  getRowPosition: (row: number) => number;
  /** Get column position in pixels (0-indexed) */
  getColPosition: (col: number) => number;
  /** Get row index from pixel position */
  getRowFromPosition: (y: number) => number;
  /** Get column index from pixel position */
  getColFromPosition: (x: number) => number;
  /** Callback when page breaks change (for renderer invalidation) */
  onPageBreaksChanged?: (sheetId: SheetId) => void;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Hit detection tolerance in pixels for page break lines.
 */
const HIT_TOLERANCE = 5;

// =============================================================================
// Page Break Coordinator
// =============================================================================

/**
 * PageBreakCoordinator - Coordinates Page Break Drag Interactions
 *
 * Follows the coordinator pattern:
 * - PageBreakMachine owns state
 * - Coordinator owns execution
 *
 * Usage:
 * ```typescript
 * const pageBreakCoordinator = new PageBreakCoordinator();
 * pageBreakCoordinator.setDependencies({ pageBreakActor, workbook, ... });
 *
 * // Hit detection
 * const hit = pageBreakCoordinator.hitTest(mouseX, mouseY);
 * if (hit.hit) {
 * pageBreakCoordinator.startDrag(hit, mouseX, mouseY);
 * }
 *
 * // During drag
 * pageBreakCoordinator.updateDrag(mouseX, mouseY);
 *
 * // On release
 * pageBreakCoordinator.endDrag();
 *
 * // Clean up
 * pageBreakCoordinator.dispose();
 * ```
 */
export class PageBreakCoordinator {
  /** Dependencies (injected) */
  private deps: PageBreakCoordinatorDependencies | null = null;

  /** Subscription object for cleanup */
  private subscription: { unsubscribe: () => void } | null = null;

  /** Previous state to detect transitions */
  private previousState: PageBreakState | null = null;

  /**
   * Set dependencies and start subscriptions.
   * Called by SheetCoordinator when refs are available.
   */
  setDependencies(deps: PageBreakCoordinatorDependencies): void {
    this.deps = deps;
    this.setupSubscription();
  }

  /**
   * Subscribe to page break machine state changes.
   * Detects END_DRAG transitions and executes page break updates.
   */
  private setupSubscription(): void {
    if (!this.deps) return;

    const { pageBreakActor } = this.deps;

    // Subscribe to state changes
    this.subscription = pageBreakActor.subscribe((state: PageBreakState) => {
      this.handleStateChange(state);
    });

    // Initialize previous state
    this.previousState = pageBreakActor.getSnapshot();
  }

  /**
   * Handle page break machine state changes.
   * Detect transition OUT of dragging state -> execute page break update.
   */
  private handleStateChange(currentState: PageBreakState): void {
    if (!this.deps || !this.previousState) {
      this.previousState = currentState;
      return;
    }

    const wasDragging = this.previousState.matches('dragging');
    const isDragging = currentState.matches('dragging');

    // Detect transition: dragging -> NOT dragging (END_DRAG, not CANCEL)
    if (wasDragging && !isDragging) {
      // Read drag state from PREVIOUS state (before transition)
      const { pageBreak, targetPosition } = this.previousState.context;

      // Only execute if we have valid drag state and position changed
      if (
        pageBreak !== null &&
        targetPosition !== null &&
        targetPosition !== pageBreak.originalPosition
      ) {
        this.executePageBreakMove(pageBreak, targetPosition);
      }
    }

    this.previousState = currentState;
  }

  /**
   * Execute the page break move.
   * Removes the old page break and adds it at the new position.
   */
  private executePageBreakMove(pageBreak: PageBreakInfo, newPosition: number): void {
    if (!this.deps) return;

    const { onPageBreaksChanged, workbook } = this.deps;
    const sheetId = pageBreak.sheetId;

    if (!workbook) return;

    const ws = workbook.getSheetById(toSheetId(sheetId));

    // Remove old page break and add new one via Worksheet API
    if (pageBreak.orientation === 'horizontal') {
      void ws.print.removePageBreak('horizontal', pageBreak.originalPosition);
      void ws.print.addPageBreak('horizontal', newPosition);
    } else {
      void ws.print.removePageBreak('vertical', pageBreak.originalPosition);
      void ws.print.addPageBreak('vertical', newPosition);
    }

    // Notify renderer to invalidate
    onPageBreaksChanged?.(toSheetId(sheetId));
  }

  /**
   * Perform hit detection for page break lines.
   * Checks if the given pixel position is near a page break line.
   *
   * @param x - Mouse X position in pixels
   * @param y - Mouse Y position in pixels
   * @returns Hit detection result
   */
  async hitTest(x: number, y: number): Promise<PageBreakHitResult> {
    if (!this.deps) {
      return { hit: false };
    }

    const { getActiveSheetId, getRowPosition, getColPosition, workbook } = this.deps;
    const sheetId = getActiveSheetId();

    if (!workbook) return { hit: false };

    // Get current page breaks via Worksheet API
    const ws = workbook.getSheetById(sheetId);
    const breaks = await ws.print.getPageBreaks();

    // Check horizontal page breaks (row boundaries)
    for (const entry of breaks.rowBreaks) {
      const rowPixelY = getRowPosition(entry.id);
      if (Math.abs(y - rowPixelY) <= HIT_TOLERANCE) {
        return {
          hit: true,
          type: 'manual', // Manual breaks are the ones we can drag
          orientation: 'horizontal',
          position: entry.id,
        };
      }
    }

    // Check vertical page breaks (column boundaries)
    for (const entry of breaks.colBreaks) {
      const colPixelX = getColPosition(entry.id);
      if (Math.abs(x - colPixelX) <= HIT_TOLERANCE) {
        return {
          hit: true,
          type: 'manual',
          orientation: 'vertical',
          position: entry.id,
        };
      }
    }

    return { hit: false };
  }

  /**
   * Start dragging a page break line.
   *
   * @param hitResult - Result from hitTest
   * @param x - Starting mouse X position
   * @param y - Starting mouse Y position
   */
  startDrag(hitResult: PageBreakHitResult, x: number, y: number): void {
    if (!this.deps || !hitResult.hit) return;

    const { pageBreakActor, getActiveSheetId } = this.deps;

    const pageBreakInfo: PageBreakInfo = {
      type: hitResult.type!,
      orientation: hitResult.orientation!,
      originalPosition: hitResult.position!,
      sheetId: getActiveSheetId(),
    };

    pageBreakActor.send({
      type: 'START_DRAG',
      pageBreak: pageBreakInfo,
      startX: x,
      startY: y,
    });
  }

  /**
   * Update drag position.
   *
   * @param x - Current mouse X position
   * @param y - Current mouse Y position
   */
  updateDrag(x: number, y: number): void {
    if (!this.deps) return;

    const { pageBreakActor, getRowFromPosition, getColFromPosition } = this.deps;
    const state = pageBreakActor.getSnapshot();

    // Only update if currently dragging
    if (!state.matches('dragging')) return;

    const { pageBreak } = state.context;
    if (!pageBreak) return;

    // Calculate target position based on orientation
    let targetPosition: number;
    if (pageBreak.orientation === 'horizontal') {
      targetPosition = getRowFromPosition(y);
    } else {
      targetPosition = getColFromPosition(x);
    }

    // Ensure target is at least 1 (can't put break before first row/col)
    targetPosition = Math.max(1, targetPosition);

    pageBreakActor.send({
      type: 'DRAG',
      x,
      y,
      targetPosition,
    });
  }

  /**
   * End the drag operation.
   */
  endDrag(): void {
    if (!this.deps) return;

    const { pageBreakActor } = this.deps;
    pageBreakActor.send({ type: 'END_DRAG' });
  }

  /**
   * Cancel the drag operation.
   */
  cancelDrag(): void {
    if (!this.deps) return;

    const { pageBreakActor } = this.deps;
    pageBreakActor.send({ type: 'CANCEL' });
  }

  /**
   * Get all page break line positions for rendering.
   *
   * @returns Array of page break line positions
   */
  async getPageBreakLines(): Promise<PageBreakLinePosition[]> {
    if (!this.deps) return [];

    const { getActiveSheetId, getRowPosition, getColPosition, workbook } = this.deps;
    const sheetId = getActiveSheetId();

    if (!workbook) return [];

    // Get page breaks via Worksheet API
    const ws = workbook.getSheetById(sheetId);
    const breaks = await ws.print.getPageBreaks();
    const lines: PageBreakLinePosition[] = [];

    // Horizontal breaks (between rows)
    for (const entry of breaks.rowBreaks) {
      lines.push({
        type: 'manual',
        orientation: 'horizontal',
        position: entry.id,
        pixelPosition: getRowPosition(entry.id),
      });
    }

    // Vertical breaks (between columns)
    for (const entry of breaks.colBreaks) {
      lines.push({
        type: 'manual',
        orientation: 'vertical',
        position: entry.id,
        pixelPosition: getColPosition(entry.id),
      });
    }

    return lines;
  }

  /**
   * Check if currently dragging a page break.
   */
  isDragging(): boolean {
    if (!this.deps) return false;
    return this.deps.pageBreakActor.getSnapshot().matches('dragging');
  }

  /**
   * Get current drag state for rendering preview.
   */
  getDragState(): {
    isDragging: boolean;
    pageBreak: PageBreakInfo | null;
    targetPosition: number | null;
  } {
    if (!this.deps) {
      return { isDragging: false, pageBreak: null, targetPosition: null };
    }

    const state = this.deps.pageBreakActor.getSnapshot();
    return {
      isDragging: state.matches('dragging'),
      pageBreak: state.context.pageBreak,
      targetPosition: state.context.targetPosition,
    };
  }

  /**
   * Clean up subscriptions.
   */
  dispose(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.previousState = null;
    this.deps = null;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new PageBreakCoordinator instance.
 */
export function createPageBreakCoordinator(): PageBreakCoordinator {
  return new PageBreakCoordinator();
}
