/**
 * Merged Cell Coordinator
 *
 * Automatically expands selection to include full merged regions when
 * a selection touches any part of a merge.
 *
 * Architecture (D.6):
 * - Subscribes to selection machine state transitions
 * - Detects when ranges change
 * - Checks if any cell in selection overlaps a merge
 * - Expands selection to include full merge boundaries
 * - Sends SET_SELECTION to update selection machine
 *
 * This matches Excel behavior: when you select any cell in a merge,
 * the entire merged region is automatically selected.
 *
 */

import { selectionSelectors } from '../../../selectors';
import type { Worksheet } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { SelectionActor, SelectionState } from '../machines/grid-selection-machine';

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies needed by MergedCellCoordinator.
 * Injected from SheetCoordinator.
 */
export interface MergedCellCoordinatorDependencies {
  /** Selection machine actor */
  selectionActor: SelectionActor;
  /** Worksheet for viewport merge lookups */
  ws: Worksheet;
  /** Active sheet ID getter */
  getActiveSheetId: () => SheetId;
}

// =============================================================================
// Merged Cell Coordinator
// =============================================================================

/**
 * MergedCellCoordinator - Auto-expands selection to include merged regions
 *
 * Follows the coordinator pattern:
 * - Selection machine owns state
 * - Coordinator owns expansion logic
 *
 * Usage:
 * ```typescript
 * const mergedCellCoordinator = new MergedCellCoordinator();
 * mergedCellCoordinator.setDependencies({ selectionActor, ws, ... });
 *
 * // Coordinator auto-subscribes and expands selections
 *
 * // Clean up
 * mergedCellCoordinator.dispose();
 * ```
 */
export class MergedCellCoordinator {
  /** Dependencies (injected) */
  private deps: MergedCellCoordinatorDependencies | null = null;

  /** Subscription object for cleanup */
  private subscription: { unsubscribe: () => void } | null = null;

  /** Previous ranges to detect changes */
  private previousRanges: CellRange[] = [];

  /**
   * Set dependencies and start subscriptions.
   * Called by SheetCoordinator when dependencies are available.
   */
  setDependencies(deps: MergedCellCoordinatorDependencies): void {
    this.dispose();
    this.deps = deps;
    this.previousRanges = selectionSelectors.ranges(deps.selectionActor.getSnapshot());
    this.setupSubscription();
  }

  /**
   * Subscribe to selection machine state changes.
   * Detects range changes and expands for merges.
   */
  private setupSubscription(): void {
    if (!this.deps) return;

    const { selectionActor } = this.deps;

    // Subscribe to state changes
    this.subscription = selectionActor.subscribe((state) => {
      this.handleStateChange(state);
    });
  }

  /**
   * Handle selection machine state changes.
   * Detect range changes and expand to include merged regions.
   */
  private handleStateChange(currentState: SelectionState): void {
    if (!this.deps) return;

    const currentRanges = selectionSelectors.ranges(currentState);

    // Only check if ranges actually changed (transition detection!)
    if (this.rangesEqual(this.previousRanges, currentRanges)) {
      this.previousRanges = currentRanges;
      return;
    }

    // Check if any cell in selection overlaps a merge
    const sheetId = this.deps.getActiveSheetId();
    const expandedRanges = currentRanges.map((range) => this.expandRangeForMerges(range, sheetId));

    // If expansion happened, update selection
    if (!this.rangesEqual(currentRanges, expandedRanges)) {
      this.deps.selectionActor.send({
        type: 'SET_SELECTION',
        ranges: expandedRanges,
        activeCell: currentState.context.activeCell,
      });
    }

    this.previousRanges = currentRanges;
  }

  /**
   * Expand a range to include any merged regions it touches.
   *
   * Algorithm:
   * 1. Filter viewport merges for overlapping ones in O(M) time
   * 2. Expand range to include all found merges
   * 3. Repeat until no more expansion (merges can be adjacent)
   *
   * PERFORMANCE: This is O(M * iterations) where M is the number of viewport merges,
   * NOT O(MAX_ROWS) or O(MAX_COLS). Critical for full column/row selection
   * where MAX_ROWS = 1,000,000.
   *
   * NOTE: Uses ws.viewport.getMerges() which only contains merges in the visible area.
   * Merges outside the viewport will not be detected for expansion. This is acceptable
   * because users interact with visible cells, and off-viewport merge expansion is rare.
   *
   * @param range - The range to expand
   * @param _sheetId - Sheet ID (unused, viewport merges are already sheet-scoped)
   * @returns Expanded range that includes all touched merges
   */
  private expandRangeForMerges(range: CellRange, _sheetId: SheetId): CellRange {
    if (!this.deps) return range;

    const { ws } = this.deps;
    // Use ws.viewport for sync merge reads
    const allViewportMerges = ws.viewport.getMerges();
    let expanded = { ...range };
    let didExpand = true;

    // Iteratively expand until stable (handles adjacent merges)
    while (didExpand) {
      didExpand = false;

      // Filter viewport merges for those overlapping the current range - O(M)
      const overlappingMerges = allViewportMerges.filter(
        (m) =>
          m.start_row <= expanded.endRow &&
          m.end_row >= expanded.startRow &&
          m.start_col <= expanded.endCol &&
          m.end_col >= expanded.startCol,
      );

      // Expand to include all overlapping merges
      for (const resolved of overlappingMerges) {
        const newExpanded = {
          startRow: Math.min(expanded.startRow, resolved.start_row),
          startCol: Math.min(expanded.startCol, resolved.start_col),
          endRow: Math.max(expanded.endRow, resolved.end_row),
          endCol: Math.max(expanded.endCol, resolved.end_col),
          // Preserve flags if present
          ...(expanded.isFullRow !== undefined && { isFullRow: expanded.isFullRow }),
          ...(expanded.isFullColumn !== undefined && { isFullColumn: expanded.isFullColumn }),
        };

        if (!this.rangesEqual([expanded], [newExpanded])) {
          expanded = newExpanded;
          didExpand = true;
          // Don't break - continue expanding with remaining merges in this batch
        }
      }
    }

    return expanded;
  }

  /**
   * Compare two range arrays for equality.
   * Used to detect if selection has changed.
   */
  private rangesEqual(a: CellRange[], b: CellRange[]): boolean {
    if (a.length !== b.length) return false;

    for (let i = 0; i < a.length; i++) {
      const ra = a[i];
      const rb = b[i];

      if (
        ra.startRow !== rb.startRow ||
        ra.startCol !== rb.startCol ||
        ra.endRow !== rb.endRow ||
        ra.endCol !== rb.endCol
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Clean up subscriptions.
   */
  dispose(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.previousRanges = [];
    this.deps = null;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new MergedCellCoordinator instance.
 */
export function createMergedCellCoordinator(): MergedCellCoordinator {
  return new MergedCellCoordinator();
}
