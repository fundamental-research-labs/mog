/**
 * CellMetadataCache — Viewport-scoped cache for projection and validation metadata.
 *
 * Solves the async-in-sync-render-loop bug: SpreadsheetGrid previously passed
 * async callbacks into the synchronous canvas render loop.
 *
 * Architecture:
 * 1. evaluateViewport() batch-fetches projection + validation data async
 * 2. Sync read methods serve cached data per-cell per-frame (hot path)
 * 3. onChange listeners trigger re-renders when cache is populated
 * 4. patchProjectionChanges() / patchValidation() for incremental updates
 *
 * Data fetching goes through the Workbook/Worksheet API (unified API boundary).
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import type { ProjectionChange } from '../compute/compute-types.gen';

// =============================================================================
// Types
// =============================================================================

/** Spill information for a single cell. */
export interface SpillInfo {
  /** True if this cell is a spill phantom (receives a spilled value, not the anchor). */
  isPhantom: boolean;
  /** Row of the spill anchor (only set for phantoms). */
  anchorRow?: number;
  /** Column of the spill anchor (only set for phantoms). */
  anchorCol?: number;
  /** The full spill range (set for both anchors and phantoms). */
  range?: CellRange;
}

// =============================================================================
// CellMetadataCache Class
// =============================================================================

/**
 * CellMetadataCache provides synchronous reads for spill and validation data.
 *
 * Lifecycle:
 * 1. Created when a document is opened
 * 2. evaluateViewport() called on viewport change / sheet switch
 * 3. Sync reads called per-cell per-frame during canvas rendering
 * 4. patchProjectionChanges() called from RecalcResult for incremental updates
 * 5. dispose() cleans up listeners and caches
 *
 * If cache has no data for a cell, sync reads return safe defaults (false, undefined).
 * The cache will be populated shortly after via evaluateViewport() and trigger
 * a re-render via onChange.
 */
export class CellMetadataCache {
  /** Spill info keyed by "row,col". */
  private spillCache: Map<string, SpillInfo> = new Map();

  /** Validation error presence keyed by "row,col". */
  private validationCache: Map<string, boolean> = new Map();

  /** Guard against overlapping evaluateViewport() calls. */
  private evaluating = false;

  /** Whether a re-evaluation was requested during in-flight evaluation. */
  private pendingReeval = false;

  /** Pending evaluation arguments for re-evaluation after current completes. */
  private pendingArgs: {
    sheetId: SheetId;
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null = null;

  /** Listeners notified when cache data changes (for renderer invalidation). */
  private listeners: Set<() => void> = new Set();

  /** Reference to Workbook for async data fetching via Worksheet API. */
  private workbook: Workbook | null;

  /** Whether the cache has been disposed. */
  private disposed = false;

  /** Bumped on dispose/clear to invalidate in-flight async population. */
  private generation = 0;

  constructor(workbook: Workbook | null) {
    this.workbook = workbook;
  }

  // ===========================================================================
  // Public API — Synchronous Cache Reads (HOT PATH)
  // ===========================================================================

  /**
   * Check if a cell is a projected position (receives value from dynamic array).
   * Synchronous cache read — called per-cell per-frame.
   *
   * Returns false if cache has no data (safe default — no projection indicator shown).
   */
  isProjectedPosition(row: number, col: number): boolean {
    const info = this.spillCache.get(`${row},${col}`);
    return info?.isPhantom ?? false;
  }

  /**
   * Get the projection source position for a projected cell.
   * Synchronous cache read — called per-cell per-frame.
   *
   * Returns undefined if not a projected position or cache has no data.
   */
  getProjectionSourcePosition(row: number, col: number): { row: number; col: number } | undefined {
    const info = this.spillCache.get(`${row},${col}`);
    if (!info?.isPhantom || info.anchorRow === undefined || info.anchorCol === undefined) {
      return undefined;
    }
    return { row: info.anchorRow, col: info.anchorCol };
  }

  /**
   * Get the projection range for a cell (works for both sources and projected positions).
   * Synchronous cache read — called per-cell per-frame.
   *
   * Returns undefined if cache has no data.
   */
  getProjectionRange(row: number, col: number): CellRange | undefined {
    const info = this.spillCache.get(`${row},${col}`);
    return info?.range;
  }

  /**
   * Check if a cell has validation errors.
   * Synchronous cache read — called per-cell per-frame.
   *
   * Returns false if cache has no data (safe default — no red circle shown).
   */
  hasValidationErrors(row: number, col: number): boolean {
    return this.validationCache.get(`${row},${col}`) ?? false;
  }

  // ===========================================================================
  // Public API — Async Population
  // ===========================================================================

  /**
   * Batch-fetch spill and validation data for the visible viewport.
   *
   * Call this on:
   * - Viewport scroll (new rows/cols visible)
   * - Sheet switch
   * - After recalculation (if not using patchProjectionChanges)
   *
   * Guards against overlapping calls. If called while already evaluating,
   * the new request is queued and executed after the current one completes.
   *
   * @param sheetId - Sheet to evaluate
   * @param startRow - Viewport start row (0-based)
   * @param startCol - Viewport start column (0-based)
   * @param endRow - Viewport end row (0-based, inclusive)
   * @param endCol - Viewport end column (0-based, inclusive)
   */
  async evaluateViewport(
    sheetId: SheetId,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<void> {
    if (this.disposed) return;
    const generation = this.generation;

    // Workbook not available yet; will evaluate on next trigger
    if (!this.workbook) return;

    // If an evaluation is already in-flight, queue for re-evaluation after completion
    if (this.evaluating) {
      this.pendingReeval = true;
      this.pendingArgs = { sheetId, startRow, startCol, endRow, endCol };
      return;
    }
    this.evaluating = true;

    try {
      // Clear previous caches to avoid stale data from previous viewport positions
      this.spillCache.clear();
      this.validationCache.clear();

      // Get worksheet for the target sheet
      let ws;
      try {
        ws = this.workbook.getSheetById(sheetId);
      } catch {
        // Sheet not found (e.g., deleted) — leave caches empty
        return;
      }

      // Fetch spill and validation data in parallel
      const validationAdapter = {
        getValidationErrorsInRange: (startR: number, startC: number, endR: number, endC: number) =>
          ws.validations.getErrorsInRange(startR, startC, endR, endC),
      };
      await Promise.all([
        this.populateSpillCache(ws, generation, startRow, startCol, endRow, endCol),
        this.populateValidationCache(
          validationAdapter,
          generation,
          startRow,
          startCol,
          endRow,
          endCol,
        ),
      ]);

      if (this.disposed || this.generation !== generation) return;

      // Notify listeners that cache data has changed
      this.notifyListeners();
    } catch (err) {
      console.error('[CellMetadataCache] evaluateViewport failed:', err);
    } finally {
      this.evaluating = false;

      // Check if re-evaluation was requested while we were evaluating
      if (!this.disposed && this.pendingReeval && this.pendingArgs) {
        this.pendingReeval = false;
        const args = this.pendingArgs;
        this.pendingArgs = null;
        void this.evaluateViewport(
          args.sheetId,
          args.startRow,
          args.startCol,
          args.endRow,
          args.endCol,
        );
      }
    }
  }

  // ===========================================================================
  // Public API — Reactive Patching
  // ===========================================================================

  /**
   * Patch spill cache from RecalcResult spill changes.
   * Call this after recalculation to incrementally update without a full viewport re-fetch.
   *
   * @param spills - ProjectionChange array from RecalcResult
   */
  patchProjectionChanges(spills: ProjectionChange[]): void {
    if (this.disposed) return;

    for (const spill of spills) {
      // Each ProjectionChange has a source_cell_id and projection_cells array.
      // The projection_cells contain the phantom cells that receive spilled values.
      // We need to figure out the anchor position from the first spill cell
      // or from the source cell.
      if (spill.projectionCells.length === 0) continue;

      // Determine anchor position: the source cell is the anchor.
      // We can infer the anchor row/col from the projection_cells — the anchor
      // is typically at the min row/col of the spill range.
      let minRow = Infinity;
      let minCol = Infinity;
      let maxRow = -Infinity;
      let maxCol = -Infinity;

      for (const cell of spill.projectionCells) {
        if (cell.row < minRow) minRow = cell.row;
        if (cell.col < minCol) minCol = cell.col;
        if (cell.row > maxRow) maxRow = cell.row;
        if (cell.col > maxCol) maxCol = cell.col;
      }

      const range: CellRange = {
        startRow: minRow,
        startCol: minCol,
        endRow: maxRow,
        endCol: maxCol,
      };

      // Mark all spill cells as phantoms (except the anchor at minRow, minCol)
      for (const cell of spill.projectionCells) {
        const isAnchor = cell.row === minRow && cell.col === minCol;
        const key = `${cell.row},${cell.col}`;

        if (isAnchor) {
          // Anchor cell: not a phantom, but has a spill range
          this.spillCache.set(key, {
            isPhantom: false,
            range,
          });
        } else {
          // Phantom cell: receives a spilled value
          this.spillCache.set(key, {
            isPhantom: true,
            anchorRow: minRow,
            anchorCol: minCol,
            range,
          });
        }
      }
    }

    if (spills.length > 0) {
      this.notifyListeners();
    }
  }

  /**
   * Point update for validation cache.
   * Call this when a single cell's validation status changes.
   *
   * @param row - Row index
   * @param col - Column index
   * @param hasErrors - Whether the cell has validation errors
   */
  patchValidation(row: number, col: number, hasErrors: boolean): void {
    if (this.disposed) return;

    const key = `${row},${col}`;
    const current = this.validationCache.get(key);

    if (current !== hasErrors) {
      this.validationCache.set(key, hasErrors);
      this.notifyListeners();
    }
  }

  // ===========================================================================
  // Public API — Subscriptions
  // ===========================================================================

  /**
   * Subscribe to cache changes for renderer invalidation.
   *
   * @param cb - Called when cache data changes and rendering may be stale
   * @returns Unsubscribe function
   */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Clear all cached data (e.g., on sheet switch before re-evaluation). */
  clear(): void {
    this.generation++;
    this.spillCache.clear();
    this.validationCache.clear();
  }

  /** Dispose of the cache: clean up listeners and caches. */
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.listeners.clear();
    this.spillCache.clear();
    this.validationCache.clear();
    this.evaluating = false;
    this.pendingReeval = false;
    this.pendingArgs = null;
  }

  // ===========================================================================
  // Private — Cache Population
  // ===========================================================================

  /**
   * Populate spill cache for the viewport via batch Worksheet API.
   *
   * Uses a single batch query (getViewportProjectionData) instead of per-cell
   * IPC calls. Previously this created 10K+ individual Promises for a 200x50
   * viewport, starving the main thread with microtasks.
   */
  private async populateSpillCache(
    ws: {
      bindings: {
        getViewportProjectionData(
          startRow: number,
          startCol: number,
          endRow: number,
          endCol: number,
        ): Promise<Array<{ originRow: number; originCol: number; rows: number; cols: number }>>;
      };
    },
    generation: number,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<void> {
    try {
      // Single batch call replaces 10K+ per-cell IPC calls
      const projections = await ws.bindings.getViewportProjectionData(
        startRow,
        startCol,
        endRow,
        endCol,
      );
      if (this.disposed || this.generation !== generation) return;

      for (const proj of projections) {
        if (this.disposed || this.generation !== generation) return;
        const range: CellRange = {
          startRow: proj.originRow,
          startCol: proj.originCol,
          endRow: proj.originRow + proj.rows - 1,
          endCol: proj.originCol + proj.cols - 1,
        };

        // Clamp iteration to viewport bounds to avoid filling cache with off-screen entries
        const rowStart = Math.max(proj.originRow, startRow);
        const rowEnd = Math.min(proj.originRow + proj.rows - 1, endRow);
        const colStart = Math.max(proj.originCol, startCol);
        const colEnd = Math.min(proj.originCol + proj.cols - 1, endCol);

        for (let row = rowStart; row <= rowEnd; row++) {
          for (let col = colStart; col <= colEnd; col++) {
            if (this.disposed || this.generation !== generation) return;
            const isAnchor = row === proj.originRow && col === proj.originCol;
            const key = `${row},${col}`;

            if (isAnchor) {
              this.spillCache.set(key, {
                isPhantom: false,
                range,
              });
            } else {
              this.spillCache.set(key, {
                isPhantom: true,
                anchorRow: proj.originRow,
                anchorCol: proj.originCol,
                range,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[CellMetadataCache] populateSpillCache failed:', err);
    }
  }

  /**
   * Populate validation cache for the viewport via Worksheet API.
   */
  private async populateValidationCache(
    ws: {
      getValidationErrorsInRange(
        startRow: number,
        startCol: number,
        endRow: number,
        endCol: number,
      ): Promise<Array<{ row: number; col: number }>>;
    },
    generation: number,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<void> {
    try {
      const errorCells = await ws.getValidationErrorsInRange(startRow, startCol, endRow, endCol);
      if (this.disposed || this.generation !== generation) return;

      for (const cell of errorCells) {
        if (this.disposed || this.generation !== generation) return;
        this.validationCache.set(`${cell.row},${cell.col}`, true);
      }
    } catch (err) {
      console.error('[CellMetadataCache] populateValidationCache failed:', err);
    }
  }

  // ===========================================================================
  // Private — Notification
  // ===========================================================================

  /** Notify all listeners that cache data has changed. */
  private notifyListeners(): void {
    if (this.disposed) return;
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (err) {
        console.error('[CellMetadataCache] onChange callback error:', err);
      }
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a CellMetadataCache.
 *
 * @param workbook - Workbook instance (null during async initialization)
 * @returns CellMetadataCache instance
 */
export function createCellMetadataCache(workbook: Workbook | null): CellMetadataCache {
  return new CellMetadataCache(workbook);
}
