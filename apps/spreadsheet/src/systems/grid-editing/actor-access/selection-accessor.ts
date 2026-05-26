/**
 * Selection Actor Access Implementation
 *
 * Implements SelectionAccessor using selectors.
 * THIS IS THE ONLY PLACE that calls actor.getSnapshot() for handlers.
 *
 * @module engine/state/coordinator/actor-access/selection
 */

import { selectionSelectors } from '../../../selectors';
import type { SelectionAccessor, SelectionState } from '@mog-sdk/contracts/actors';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Data Bounds Cache
// =============================================================================

/** Cached data bounds for a sheet. */
interface SheetDataBounds {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
}

/**
 * ComputeBridge subset needed by DataBoundsCache.
 * Avoids importing the full ComputeBridge type from kernel.
 */
interface DataBoundsProvider {
  getAllSheetIds(): Promise<string[]>;
  getDataBounds(
    sheetId: string,
  ): Promise<{ minRow: number; minCol: number; maxRow: number; maxCol: number } | null>;
}

/**
 * Cache for per-sheet data bounds, pre-loaded from ComputeBridge.
 *
 * This enables the sync `getDataBoundedRanges()` method to avoid reading
 * from the dead Yjs stub. The cache is invalidated on cell change events
 * and refreshed lazily.
 *
 * Usage:
 * ```typescript
 * const cache = new DataBoundsCache(provider, eventBus);
 * await cache.preload();
 * // ... pass to createSelectionAccessor
 * cache.dispose(); // cleanup event subscriptions
 * ```
 */
export class DataBoundsCache {
  private cache = new Map<string, SheetDataBounds | null>();
  private provider: DataBoundsProvider;
  private unsubscribes: (() => void)[] = [];

  constructor(provider: DataBoundsProvider, workbook?: Workbook) {
    this.provider = provider;

    // Subscribe to cell change events to invalidate affected sheets
    if (workbook) {
      this.unsubscribes.push(
        workbook.on('cell:changed', (event) => {
          this.invalidateSheet(event.sheetId);
        }),
      );
      this.unsubscribes.push(
        workbook.on('cells:batch-changed', (event) => {
          this.invalidateSheet(event.sheetId);
        }),
      );
    }
  }

  /** Pre-load data bounds for all sheets. */
  async preload(): Promise<void> {
    const sheetIds = await this.provider.getAllSheetIds();
    for (const sid of sheetIds) {
      const bounds = await this.provider.getDataBounds(sid);
      this.cache.set(sid, bounds);
    }
  }

  /** Get cached data bounds for a sheet. Returns undefined if not cached. */
  get(sheetId: string): SheetDataBounds | null | undefined {
    return this.cache.get(sheetId);
  }

  /** Check if bounds are cached for a sheet. */
  has(sheetId: string): boolean {
    return this.cache.has(sheetId);
  }

  /** Invalidate cached bounds for a sheet (will be refreshed on next access). */
  invalidateSheet(sheetId: string): void {
    this.cache.delete(sheetId);
    // Refresh asynchronously so next sync read has fresh data
    void this.refreshSheet(sheetId);
  }

  /** Refresh bounds for a single sheet from ComputeBridge. */
  private async refreshSheet(sheetId: string): Promise<void> {
    try {
      const bounds = await this.provider.getDataBounds(sheetId);
      this.cache.set(sheetId, bounds);
    } catch {
      // If refresh fails, leave cache empty — callers handle missing data gracefully
    }
  }

  /** Cleanup event subscriptions. */
  dispose(): void {
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
    this.cache.clear();
  }
}

// =============================================================================
// Selection Accessor
// =============================================================================

/**
 * Minimal actor interface for selection accessor.
 * Uses getSnapshot() to capture point-in-time state.
 */
type SelectionActor = { getSnapshot(): SelectionState };

/**
 * Creates a SelectionAccessor for point-in-time reads in handlers.
 *
 * Each method delegates to the corresponding selector with a fresh snapshot.
 * This ensures handlers always get current state at the moment of call.
 *
 * @param actor - The XState selection actor
 * @param dataBoundsCache - Optional pre-loaded data bounds cache. When provided,
 * `getDataBoundedRanges` reads from the cache instead of the deprecated Yjs stub.
 * @returns SelectionAccessor interface for handlers
 */
export function createSelectionAccessor(
  actor: SelectionActor,
  dataBoundsCache?: DataBoundsCache,
): SelectionAccessor {
  const snap = () => actor.getSnapshot();

  return {
    // ===========================================================================
    // Value Accessors (match value selectors)
    // ===========================================================================

    getActiveCell: () => selectionSelectors.activeCell(snap()),
    getRanges: () => selectionSelectors.ranges(snap()),
    getDataBoundedRanges: (sheetId: SheetId): CellRange[] => {
      const ranges = selectionSelectors.ranges(snap());
      return ranges
        .map((range) => {
          if (!range.isFullColumn && !range.isFullRow) return range;

          // Use cached data bounds from ComputeBridge
          const bounds = dataBoundsCache?.get(sheetId);
          if (!bounds) return null;

          // Clip the full-column/full-row selection to actual data bounds
          const startRow = Math.max(range.startRow, bounds.minRow);
          const endRow = Math.min(range.endRow, bounds.maxRow);
          const startCol = Math.max(range.startCol, bounds.minCol);
          const endCol = Math.min(range.endCol, bounds.maxCol);

          if (startRow > endRow || startCol > endCol) return null;

          return {
            startRow,
            startCol,
            endRow,
            endCol,
          } as CellRange;
        })
        .filter((r): r is CellRange => r !== null);
    },
    getActiveRange: () => selectionSelectors.activeRange(snap()),
    getAnchor: () => selectionSelectors.anchor(snap()),
    getDirection: () => selectionSelectors.direction(snap()),
    getFormulaRangeColor: () => selectionSelectors.formulaRangeColor(snap()),
    getInRangeSelectionMode: () => selectionSelectors.inRangeSelectionMode(snap()),
    getFillHandleStart: () => selectionSelectors.fillHandleStart(snap()),
    getFillHandleEnd: () => selectionSelectors.fillHandleEnd(snap()),
    getFillSourceRange: () => selectionSelectors.fillSourceRange(snap()),
    getAnchorCol: () => selectionSelectors.anchorCol(snap()),
    getAnchorRow: () => selectionSelectors.anchorRow(snap()),
    getAllowDragFill: () => selectionSelectors.allowDragFill(snap()),
    getDragSourceRange: () => selectionSelectors.dragSourceRange(snap()),
    getDragTargetCell: () => selectionSelectors.dragTargetCell(snap()),
    getDragMode: () => selectionSelectors.dragMode(snap()),
    getResizeType: () => selectionSelectors.resizeType(snap()),
    getResizeIndex: () => selectionSelectors.resizeIndex(snap()),
    getResizeIndexes: () => selectionSelectors.resizeIndexes(snap()),
    getResizeCurrentSize: () => selectionSelectors.resizeCurrentSize(snap()),
    getTableResizeId: () => selectionSelectors.tableResizeId(snap()),
    getTableResizeStartBounds: () => selectionSelectors.tableResizeStartBounds(snap()),
    getTableResizeTargetRow: () => selectionSelectors.tableResizeTargetRow(snap()),
    getTableResizeTargetCol: () => selectionSelectors.tableResizeTargetCol(snap()),

    /**
     * read the selection-mode bundle. Handlers use this for the
     * End-toggle path (read current value, then call `setMode('end', !curr)`).
     */
    getModes: () => selectionSelectors.modes(snap()),

    // ===========================================================================
    // State Matching Accessors (match state selectors)
    // ===========================================================================

    isIdle: () => selectionSelectors.isIdle(snap()),
    isSelecting: () => selectionSelectors.isSelecting(snap()),
    isExtending: () => selectionSelectors.isExtending(snap()),
    isMultiSelecting: () => selectionSelectors.isMultiSelecting(snap()),
    isSelectingRangeForFormula: () => selectionSelectors.isSelectingRangeForFormula(snap()),
    isDraggingFillHandle: () => selectionSelectors.isDraggingFillHandle(snap()),
    isRightDraggingFillHandle: () => selectionSelectors.isRightDraggingFillHandle(snap()),
    isDraggingCells: () => selectionSelectors.isDraggingCells(snap()),
    isSelectingColumn: () => selectionSelectors.isSelectingColumn(snap()),
    isSelectingRow: () => selectionSelectors.isSelectingRow(snap()),
    isResizingHeader: () => selectionSelectors.isResizingHeader(snap()),
    isResizingTable: () => selectionSelectors.isResizingTable(snap()),

    // ===========================================================================
    // Derived Accessors
    // ===========================================================================

    isActivelySelecting: () => selectionSelectors.isActivelySelecting(snap()),
    isInDragOperation: () => selectionSelectors.isInDragOperation(snap()),
    isInFormulaMode: () => selectionSelectors.isInFormulaMode(snap()),
  };
}
