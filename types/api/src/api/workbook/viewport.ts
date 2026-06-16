/**
 * Viewport Management Sub-API
 *
 * Handle-based viewport region lifecycle for the Workbook.
 * Consumers create viewport regions via `wb.viewport.createRegion()`,
 * which returns a `ViewportRegion` handle. Dispose when done.
 *
 */

import type { IDisposable } from '@mog/types-core/disposable';
import type { RenderScheduler } from '@mog/types-rendering/grid-renderer';
import type { ViewportRegionRefreshReceipt } from '../mutation-receipt';

export interface ViewportBounds {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Handle for a registered viewport region.
 *
 * Created by `wb.viewport.createRegion()`. The kernel tracks cell data
 * for this region and delivers incremental updates. Dispose when the
 * region is no longer needed (e.g., component unmount, sheet switch).
 *
 * Supports TC39 Explicit Resource Management:
 *   using region = wb.viewport.createRegion(sheetId, bounds);
 */
export interface ViewportRegion extends IDisposable {
  /** Unique ID for this region (auto-generated). */
  readonly id: string;
  /** Sheet this region is tracking. */
  readonly sheetId: string;
  /**
   * Update the locally-tracked visible bounds (e.g., on scroll or resize).
   *
   * **Important:** This updates local state only. It does NOT push bounds to
   * the Rust compute engine. Rust-side viewport bounds (the prefetch range)
   * are exclusively managed by the fetch manager via {@link refresh}. Pushing
   * visible bounds here would overwrite the wider prefetch range on every
   * scroll, causing off-screen mutations to be silently dropped.
   *
   */
  updateBounds(bounds: ViewportBounds): void;
  /** Request a data refresh for this region. */
  refresh(scrollBehavior?: unknown): Promise<ViewportRegionRefreshReceipt>;
}

/**
 * Events emitted by the viewport coordinator when viewport state changes.
 * Consumers subscribe to these events to react to data changes without polling.
 */
export type ViewportChangeEvent =
  | { type: 'fetch-committed' }
  | { type: 'cells-patched'; cells: { row: number; col: number }[] }
  | { type: 'dimensions-patched'; axis: 'row' | 'col' };

/**
 * Viewport management sub-API on the Workbook.
 *
 * Consumer-scoped: createRegion() returns a handle with per-viewport
 * refresh, prefetch, and lifecycle management.
 */
export interface WorkbookViewport {
  /** Create a tracked viewport region. Returns a handle — dispose when done. */
  createRegion(sheetId: string, bounds: ViewportBounds, viewportId?: string): ViewportRegion;
  /** Reset all regions for a sheet (e.g., on sheet switch). */
  resetSheetRegions(sheetId: string): void;
  /**
   * Inject (or clear) the render scheduler for "Write = Invalidate" integration.
   * When set, mutation patches applied to viewport buffers automatically
   * trigger a render frame via the scheduler.
   */
  setRenderScheduler(scheduler: RenderScheduler | null): void;
  /**
   * Subscribe to viewport state change events from all viewport coordinators.
   * Events are emitted synchronously after each state change.
   * Returns an unsubscribe function.
   */
  subscribe(cb: (event: ViewportChangeEvent) => void): () => void;
  /**
   * Set the show-formulas mode. When true, Rust substitutes formula strings
   * into the display text field of viewport cells that have formulas.
   * Invalidates all prefetch bounds so the next viewport refresh fetches
   * fresh data with the correct display mode.
   */
  setShowFormulas(value: boolean): void;
}
