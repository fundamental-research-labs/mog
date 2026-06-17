/**
 * Resize Coordinator
 *
 * Wires the header resize operation to the dimension setters.
 * This coordinator subscribes to selection machine state transitions and
 * executes dimension changes when the resize drag ends.
 *
 * Architecture:
 * - Selection machine owns state (resizeType, resizeIndex, resizeCurrentSize)
 * - Coordinator executes side effects (calls setColumnWidth/setRowHeight)
 *
 * Flow:
 * 1. User drags resize handle → selection machine tracks resize state
 * 2. User releases → END_RESIZE → transition to idle
 * 3. Coordinator detects transition, reads resize state
 * 4. Coordinator calls setColumnWidth() or setRowHeight()
 * 5. Coordinator sends CLEAR_RESIZE to clean up machine state
 *
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { SelectionActor, SelectionState } from '../../../shared/actor-types';

const RESIZE_NOOP_EPSILON_PX = 0.5;

function isNoopResize(startSize: number, nextSize: number): boolean {
  return Math.abs(nextSize - startSize) <= RESIZE_NOOP_EPSILON_PX;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Dependencies needed by ResizeCoordinator.
 * Injected from SheetCoordinator.
 */
export interface ResizeCoordinatorDependencies {
  /** Selection machine actor */
  selectionActor: SelectionActor;
  /** Workbook for unified API access */
  workbook: Workbook;
  /** Active sheet ID getter */
  getActiveSheetId: () => SheetId;
  /** Callback when dimensions change (for renderer invalidation) */
  onDimensionsChanged?: (sheetId: SheetId) => void;
}

// =============================================================================
// Resize Coordinator
// =============================================================================

/**
 * ResizeCoordinator - Wires Header Resize to Dimension Setters
 *
 * Follows the coordinator pattern:
 * - Selection machine owns state
 * - Coordinator owns execution
 *
 * Usage:
 * ```typescript
 * const resizeCoordinator = new ResizeCoordinator();
 * resizeCoordinator.setDependencies({ selectionActor, workbook, ... });
 *
 * // Coordinator auto-subscribes and executes resizes
 *
 * // Clean up
 * resizeCoordinator.dispose();
 * ```
 */
export class ResizeCoordinator {
  /** Dependencies (injected) */
  private deps: ResizeCoordinatorDependencies | null = null;

  /** Subscription object for cleanup */
  private subscription: { unsubscribe: () => void } | null = null;

  /** Previous state to detect transitions */
  private previousState: SelectionState | null = null;

  private clearResize(selectionActor: SelectionActor): void {
    if (selectionActor.getSnapshot().status === 'active') {
      selectionActor.send({ type: 'CLEAR_RESIZE' });
    }
  }

  /**
   * Set dependencies and start subscriptions.
   * Called by SheetCoordinator when Yjs refs are available.
   */
  setDependencies(deps: ResizeCoordinatorDependencies): void {
    this.deps = deps;
    this.setupSubscription();
  }

  /**
   * Subscribe to selection machine state changes.
   * Detects END_RESIZE transitions and executes dimension changes.
   */
  private setupSubscription(): void {
    if (!this.deps) return;

    const { selectionActor } = this.deps;

    // Subscribe to state changes
    this.subscription = selectionActor.subscribe((state) => {
      this.handleStateChange(state);
    });

    // Initialize previous state
    this.previousState = selectionActor.getSnapshot();
  }

  /**
   * Handle selection machine state changes.
   * Detect transition OUT of resizingHeader state → execute dimension change.
   */
  private handleStateChange(currentState: SelectionState): void {
    if (!this.deps || !this.previousState) {
      this.previousState = currentState;
      return;
    }

    const { selectionActor } = this.deps;
    const wasResizing = this.previousState.matches('resizingHeader');
    const isResizing = currentState.matches('resizingHeader');

    // Detect transition: resizingHeader → NOT resizingHeader
    // This happens on END_RESIZE (not CANCEL_RESIZE which clears state)
    if (wasResizing && !isResizing) {
      // Read resize state from PREVIOUS state (before transition)
      const {
        resizeType,
        resizeIndex,
        resizeIndexes,
        resizeStartPosition,
        resizeStartSize,
        resizeStartSizes,
        resizeCurrentSize,
      } = this.previousState.context;

      // Only execute if we have valid resize state
      // CANCEL_RESIZE clears state before transition, so this check handles it
      if (
        resizeType !== null &&
        resizeStartPosition !== null &&
        resizeCurrentSize !== null &&
        resizeIndexes.length > 0 &&
        resizeStartSizes.size > 0
      ) {
        // C.2: Calculate delta from start position to current size
        // The updateResize action already calculated the new size by applying delta to startSize
        // So we need to extract the delta: delta = resizeCurrentSize - resizeStartSize
        // Get the first index's start size to calculate delta
        const firstIndex = resizeIndexes[0];
        const firstStartSize = resizeStartSizes.get(firstIndex) ?? 0;
        const delta = resizeCurrentSize - firstStartSize;
        if (isNoopResize(firstStartSize, resizeCurrentSize)) {
          this.clearResize(selectionActor);
        } else {
          void this.executeMultiResize(resizeType, resizeIndexes, resizeStartSizes, delta);
        }
      } else if (
        resizeType !== null &&
        resizeIndex !== null &&
        resizeStartSize !== null &&
        resizeCurrentSize !== null
      ) {
        // Fallback to single resize for backwards compatibility
        if (isNoopResize(resizeStartSize, resizeCurrentSize)) {
          this.clearResize(selectionActor);
        } else {
          void this.executeResize(resizeType, resizeIndex, resizeCurrentSize);
        }
      } else {
      }
    }

    this.previousState = currentState;
  }

  /**
   * Execute the dimension change (single resize).
   */
  private async executeResize(
    resizeType: 'column' | 'row',
    resizeIndex: number,
    newSize: number,
  ): Promise<void> {
    if (!this.deps) return;

    const { workbook, getActiveSheetId, selectionActor, onDimensionsChanged } = this.deps;
    const sheetId = getActiveSheetId();
    const ws = workbook.getSheetById(sheetId);

    try {
      if (resizeType === 'column') {
        await ws.layout.setColumnWidth(resizeIndex, newSize);
      } else {
        await ws.layout.setRowHeight(resizeIndex, newSize);
      }
      onDimensionsChanged?.(sheetId);
    } catch (error) {
      console.error('Header resize failed', error);
    } finally {
      this.clearResize(selectionActor);
    }
  }

  /**
   * Execute multi-select resize (C.2).
   * Applies the same delta to all selected columns/rows.
   *
   * Design: Calculate delta once from mouse position, then apply to all indexes.
   * Each index gets: newSize[i] = startSize[i] + delta
   * This matches Excel's behavior for multi-select resize.
   *
   * @param resizeType - 'column' or 'row'
   * @param indexes - Array of column/row indexes to resize
   * @param startSizes - Map of starting sizes for each index
   * @param delta - Change in size from drag (currentPosition - startPosition)
   */
  private async executeMultiResize(
    resizeType: 'column' | 'row',
    indexes: number[],
    startSizes: Map<number, number>,
    delta: number,
  ): Promise<void> {
    if (!this.deps) return;

    const { workbook, getActiveSheetId, selectionActor, onDimensionsChanged } = this.deps;
    const sheetId = getActiveSheetId();
    const ws = workbook.getSheetById(sheetId);

    const writes: Array<[number, number]> = [];
    const rowWrites: Array<Promise<void>> = [];
    for (const index of indexes) {
      const startSize = startSizes.get(index);
      if (startSize === undefined) continue;

      // Calculate new size: startSize + delta, with minimum of 10px
      const newSize = Math.max(10, startSize + delta);
      if (isNoopResize(startSize, newSize)) continue;

      if (resizeType === 'column') {
        writes.push([index, newSize]);
      } else {
        rowWrites.push(ws.layout.setRowHeight(index, newSize));
      }
    }

    return (async () => {
      try {
        if (writes.length === 0 && rowWrites.length === 0) {
          return;
        }
        if (resizeType === 'column') {
          await ws.layout.setColumnWidths(writes);
        } else {
          await Promise.all(rowWrites);
        }
        onDimensionsChanged?.(sheetId);
      } catch (error) {
        console.error('Header multi-resize failed', error);
      } finally {
        this.clearResize(selectionActor);
      }
    })();
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
 * Create a new ResizeCoordinator instance.
 */
export function createResizeCoordinator(): ResizeCoordinator {
  return new ResizeCoordinator();
}
