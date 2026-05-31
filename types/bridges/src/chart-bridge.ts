/**
 * Chart Bridge Interface
 *
 * Defines the contract for chart rendering and data resolution.
 * This interface bridges the charts library to the engine's reactive system.
 *
 * Features:
 * - Compiled marks caching (invalidated on data/spec changes)
 * - Event subscriptions for reactive updates
 * - Error state management
 * - Data resolution from CellIdRange to actual values
 *
 * @see engine/src/state/bridges/chart-bridge.ts - Implementation
 */

import type { CellRange, SheetId } from '@mog/types-core';
import type {
  ChartExportOptionsSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog/types-data/data/charts';

// =============================================================================
// Types
// =============================================================================

/**
 * Chart error codes for rendering and data resolution errors.
 */
export type ChartErrorCode =
  | 'DATA_UNAVAILABLE' // CellIdRange references deleted cells
  | 'INVALID_SPEC' // Chart spec validation failed
  | 'CHART_NOT_FOUND' // Chart ID doesn't exist
  | 'RENDER_FAILED' // Canvas rendering error
  | 'COMPILE_FAILED' // Spec to marks compilation error
  | 'EMPTY_DATA'; // Data range resolved to empty

/**
 * Chart error structure.
 */
export interface ChartError {
  /** Error code */
  code: ChartErrorCode;
  /** Human-readable error message */
  message: string;
  /** Chart ID that caused the error */
  chartId: string;
  /** Additional error details */
  details?: unknown;
}

/**
 * A single row of chart data.
 */
export interface ChartDataRow {
  [key: string]: unknown;
}

/**
 * Result of resolving chart data from cell range.
 */
export type ChartDataResult =
  | { success: true; data: ChartDataRow[] }
  | { success: false; error: ChartError };

/**
 * Mark primitives for chart rendering.
 * These are the low-level rendering instructions.
 */
export interface ChartMark {
  /** Mark type */
  type: 'rect' | 'path' | 'arc' | 'text' | 'symbol' | 'line' | 'area';
  /** X position */
  x?: number;
  /** Y position */
  y?: number;
  /** Width (for rect) */
  width?: number;
  /** Height (for rect) */
  height?: number;
  /** Path data (for path) */
  path?: string;
  /** Text content (for text) */
  text?: string;
  /** Fill color */
  fill?: string;
  /** Stroke color */
  stroke?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Opacity (0-1) */
  opacity?: number;
  /** Associated data */
  data?: unknown;
}

/**
 * Bounding box for chart rendering.
 */
export interface ChartBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChartRenderSnapshot {
  marks: ChartMark[];
  resolvedChartSpec: ResolvedChartSpecSnapshot;
}

// =============================================================================
// Chart Layout Types
// =============================================================================

/** Bounding rectangle in points. Origin is chart top-left. */
export interface ElementBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlotAreaLayout extends ElementBounds {
  insideLeft: number;
  insideTop: number;
  insideWidth: number;
  insideHeight: number;
}

export interface LegendLayout extends ElementBounds {
  entries: LegendEntryLayout[];
}

export interface LegendEntryLayout extends ElementBounds {
  index: number;
}

export type TitleLayout = ElementBounds;

export interface AxisLayout extends ElementBounds {
  channel: string;
}

export interface DataLabelLayout extends ElementBounds {
  seriesIndex: number;
  pointIndex: number;
}

export interface ChartLayout {
  chart: ElementBounds;
  plotArea: PlotAreaLayout;
  legend?: LegendLayout;
  title?: TitleLayout;
  dataTable?: ElementBounds;
  axes: AxisLayout[];
  dataLabels: DataLabelLayout[];
}

/**
 * Normalized rect used by the kernel chart bridge's cached layout snapshots.
 * All coordinates are in normalized (0-1) space relative to the chart's
 * total dimensions. This is a coarser subset of {@link ChartLayout} — it
 * does not include axes or per-element bounds, only the top-level regions
 * the bridge caches post-compile.
 */
export interface ChartLayoutRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Layout snapshot cached by {@link IChartBridge.getLayout}.
 *
 * This is intentionally narrower than {@link ChartLayout}:
 * - coordinates are normalized (0-1), not in points
 * - only the top-level regions (plotArea, legend, title, dataLabels) are cached
 * - no per-axis breakdown — that comes from the charts library's extractChartLayout
 *   (returning the richer {@link ChartLayout}) when the full detail is needed
 */
export interface ChartLayoutSnapshot {
  plotArea: ChartLayoutRect;
  legend?: ChartLayoutRect;
  title?: ChartLayoutRect;
  dataTable?: ChartLayoutRect;
  dataLabels?: ChartLayoutRect;
}

// =============================================================================
// Chart Bridge Interface
// =============================================================================

/**
 * Bridge interface for chart rendering.
 *
 * This interface provides methods for resolving chart data, compiling marks,
 * and rendering charts to canvas.
 */
export interface IChartBridge {
  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the chart bridge - subscribe to events for reactive updates.
   *
   * @returns Cleanup function to stop the bridge
   */
  start(): () => void;

  /**
   * Stop the chart bridge and clean up subscriptions.
   */
  stop(): void;

  /**
   * Destroy the bridge - alias for stop().
   */
  destroy(): void;

  // ===========================================================================
  // Data Resolution
  // ===========================================================================

  /**
   * Resolve chart data from CellIdRange to actual values.
   *
   * @param sheetId - Sheet containing the chart
   * @param chartId - Chart ID
   * @returns Resolved data or error
   */
  resolveChartData(sheetId: SheetId, chartId: string): Promise<ChartDataResult>;

  // ===========================================================================
  // Mark Compilation
  // ===========================================================================

  /**
   * Get compiled marks for a chart.
   * Returns cached marks if available, otherwise compiles the chart spec.
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @returns Compiled marks or error
   */
  getMarks(sheetId: SheetId, chartId: string): Promise<ChartMark[] | ChartError>;

  /**
   * Compile marks for a chart at specific pixel dimensions.
   *
   * Unlike getMarks(), this does NOT use or update the marks/layout cache.
   * It performs a one-off compilation at the requested dimensions, which is
   * needed for image export (marks are dimension-dependent).
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @param width - Target width in pixels
   * @param height - Target height in pixels
   * @returns Compiled marks or error
   */
  getMarksAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
  ): Promise<ChartMark[] | ChartError>;

  /**
   * Compile marks and capture the resolved chart spec used by diagnostics.
   * Image exporters should keep using getMarksAtSize when they need pixels
   * only; workbook diagnostics call this sibling to persist the semantic
   * snapshot from the same production compile path.
   */
  getRenderSnapshotAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
    exportOptions: ChartExportOptionsSnapshot,
  ): Promise<ChartRenderSnapshot | ChartError>;

  // ===========================================================================
  // Rendering
  // ===========================================================================

  /**
   * Synchronous render from cache. Paints `chartId` into `bounds` on `ctx`.
   *
   * - Marks cached and not dirty: paints immediately.
   * - Marks absent: paints a placeholder (light-grey rect with "Chart loading…")
   *   and triggers a background recompile via `ensureCompiled(chartId)`. When the
   *   compile resolves, `onCacheUpdate(chartId)` fires so the renderer can
   *   re-dirty the drawing layer and re-paint on the next frame with real marks.
   * - Marks present but dirty: paints the stale marks AND triggers a background
   *   recompile (mirrors `getMarks`'s pendingCompilations stale-return path).
   * - Chart in an error state: paints the error rect synchronously, no retry.
   *
   * MUST NOT `await`, return a Promise, or otherwise yield. Called from inside
   * the synchronous canvas dispatch loop — any async work breaks the engine's
   * `(viewport.x, viewport.y)` translate frame and the chart paints in the
   * wrong canvas frame entirely.
   *
   * @param chartId - Chart ID
   * @param ctx - Canvas 2D rendering context
   * @param bounds - Bounding box for the chart
   * @param sheetId - Optional owner sheet ID for duplicate imported chart IDs
   */
  renderCached(
    chartId: string,
    ctx: CanvasRenderingContext2D,
    bounds: ChartBounds,
    sheetId?: SheetId,
  ): void;

  /**
   * Subscribe to cache-update notifications.
   *
   * Fires when a previously-uncached or dirty chart's marks have been compiled
   * and committed to the cache (or when an error outcome has been committed).
   * The renderer wires this to a "redraw the drawing layer" signal.
   *
   * The callback receives a chartId, OR the sentinel `'*'` indicating that
   * every cached chart has been invalidated (emitted from `clearAllCaches()`).
   * Most renderer wirings ignore the chartId and just dirty the whole layer.
   *
   * @param listener - Notified on real cache commit or `'*'` for "all charts"
   * @returns Unsubscribe function
   */
  onCacheUpdate(listener: (chartId: string) => void): () => void;

  /**
   * Trigger compilation if dirty or absent. Idempotent and de-duplicating —
   * concurrent calls share the in-flight compile via the bridge's
   * `pendingCompilations` set. Resolves when marks are in cache.
   *
   * Callers on the paint path should treat this as fire-and-forget — the side
   * effect (cache populated + listener fired) is what they need.
   *
   * @param chartId - Chart ID
   * @param sheetId - Optional owner sheet ID for duplicate imported chart IDs
   */
  ensureCompiled(chartId: string, sheetId?: SheetId): Promise<void>;

  // ===========================================================================
  // Cache Invalidation
  // ===========================================================================

  /**
   * Invalidate a chart's compiled marks cache.
   *
   * @param chartId - Chart ID
   */
  invalidateChart(chartId: string): void;

  /**
   * Check if a chart is dirty (needs recompilation).
   *
   * @param chartId - Chart ID
   * @returns True if chart needs recompilation
   */
  isChartDirty(chartId: string): boolean;

  /**
   * Clear the dirty flag for a chart after rendering.
   *
   * @param chartId - Chart ID
   */
  clearDirtyFlag(chartId: string): void;

  /**
   * Clear all caches. Useful for testing or full refresh.
   */
  clearAllCaches(): void;

  // ===========================================================================
  // Layout
  // ===========================================================================

  /**
   * Get the cached layout snapshot for a chart.
   *
   * Returns a narrow layout snapshot ({@link ChartLayoutSnapshot}) with
   * normalized (0-1) coordinates for the top-level regions. For the full
   * per-axis / per-element layout in points, use the charts library's
   * `extractChartLayout()` directly against a {@link CompileResult} — that
   * returns the richer {@link ChartLayout}.
   *
   * Keeping this bridge method narrow prevents conflating two layout
   * coordinate systems (normalized vs. points) and two levels of detail.
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @returns Layout snapshot or null if chart not found / not compilable
   */
  getLayout(sheetId: SheetId, chartId: string): Promise<ChartLayoutSnapshot | null>;

  // ===========================================================================
  // Range Queries
  // ===========================================================================

  /**
   * Get charts that are affected by changes in a specific cell range.
   *
   * @param sheetId - Sheet ID
   * @param range - Cell range
   * @returns Array of chart IDs
   */
  getChartsAffectedByRange(sheetId: SheetId, range: CellRange): Promise<string[]>;

  /**
   * Get all dirty charts that need re-rendering.
   *
   * @returns Array of chart IDs
   */
  getDirtyCharts(): string[];
}
