/**
 * Chart Bridge
 *
 * Bridges the standalone charts library (@mog/charts) to the engine.
 * This bridge handles:
 * - Compiled marks caching (invalidated on data/spec changes)
 * - EventBus subscriptions for reactive updates
 * - Error state management
 * - Data resolution from CellIdRange to actual values
 *
 * Paint is synchronous — see `renderCached` / `onCacheUpdate` /
 * `ensureCompiled`. Mark compilation is async (data fetch + extract +
 * compile, all real work) but never executes on the paint path; the cache
 * breaks the coupling. The shape mirrors `ImageCache.getImage` / `onLoad`
 * for pictures: async producer, sync consumer, listener-driven repaint.
 *
 * Do NOT re-async `renderCached`: the canvas dispatch loop is sync and
 * applies a `(viewport.x, viewport.y)` translate around every floating
 * object's paint. An async paint method's `await` chain resolves after the
 * engine has restored that translate, and the chart paints in the wrong
 * canvas frame. The async chart paint canvas-state invariant depends on
 * this remaining synchronous.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md (sections 7, 8)
 */

import type {
  ChartBounds,
  ChartDataResult,
  ChartError,
  ChartErrorCode,
  ChartLayoutSnapshot,
  ChartMark,
  ChartRenderSnapshot,
  IChartBridge,
} from '@mog-sdk/contracts/bridges';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { ChartExportOptionsSnapshot } from '@mog-sdk/contracts/data/charts';
import { defaultExportOptionsForSize } from './bridge/resolved-spec-snapshot';
import {
  renderChartError,
  renderChartMarks,
  renderChartPlaceholder,
} from './bridge/chart-renderer';
import { ChartRenderCache } from './bridge/chart-render-cache';
import { ChartDataResolver } from './bridge/chart-data-resolver';
import {
  getChartsAffectedByRange as getChartsAffectedByRangeForSubscriptions,
  setupChartBridgeSubscriptions,
} from './bridge/chart-bridge-subscriptions';
import {
  compileChartMarks,
  compileChartRenderSnapshotAtSize as compileResolvedChartRenderSnapshotAtSize,
} from './bridge/chart-compiler';

import type { DocumentContext } from '../../context/types';

export { isPositionOnlyUpdate } from './bridge/position-only-update';
export { initChartWasm } from './bridge/chart-compiler';
export type { ChartWasmExports } from './bridge/chart-compiler';

// =============================================================================
// Chart Layout Types — the narrow ChartLayoutSnapshot used by this
// bridge now lives in contracts so IChartBridge can declare the same return
// type. See contracts/src/bridges/chart-bridge.ts.
// =============================================================================

// =============================================================================
// Re-export types from contracts for backward compatibility
// =============================================================================

// Re-export chart types from contracts
export type { ChartBounds, ChartDataResult, ChartError, ChartErrorCode, ChartMark };

// =============================================================================
// Chart Bridge Class
// =============================================================================

/**
 * Chart Bridge
 *
 * Connects the standalone charts library to the engine's reactive system.
 *
 * Key responsibilities:
 * 1. Cache compiled marks (invalidate on data/spec changes)
 * 2. Subscribe to cell and chart change events
 * 3. Resolve CellIdRange to actual cell data
 * 4. Provide render API for ChartLayer
 */
export class ChartBridge implements IChartBridge {
  private readonly renderCache = new ChartRenderCache();
  private readonly dataResolver: ChartDataResolver;

  /** Cleanup functions for event subscriptions */
  private cleanups: Array<() => void> = [];

  /** Whether the bridge has been started */
  private started = false;

  constructor(private ctx: DocumentContext) {
    this.dataResolver = new ChartDataResolver(ctx);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the chart bridge - subscribe to events for reactive updates.
   *
   * @returns Cleanup function to stop the bridge
   */
  start(): () => void {
    if (this.started) {
      return () => this.stop();
    }
    this.started = true;
    this.renderCache.start();

    this.setupSubscriptions();

    return () => this.stop();
  }

  /**
   * Stop the chart bridge and clean up subscriptions.
   */
  stop(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.renderCache.stop();
    this.dataResolver.clearCaches();
    this.started = false;
  }

  /**
   * Destroy the bridge - alias for stop().
   */
  destroy(): void {
    this.stop();
  }

  // ===========================================================================
  // Event Subscriptions
  // ===========================================================================

  /**
   * Set up EventBus subscriptions for reactive chart updates.
   */
  private setupSubscriptions(): void {
    this.cleanups.push(
      setupChartBridgeSubscriptions({
        ctx: this.ctx,
        renderCache: this.renderCache,
        isLive: () => this.started,
        invalidateChart: (chartId, sheetId) => this.invalidateChart(chartId, sheetId),
        clearAllCaches: () => this.clearAllCaches(),
      }),
    );
  }

  /**
   * Invalidate a chart's compiled marks cache.
   * Note: layoutCache also follows the same stale pattern — we keep stale layouts
   * available during async recompilation, and getMarks() replaces both caches.
   */
  invalidateChart(chartId: string, sheetId?: SheetId): void {
    this.renderCache.invalidateChart(chartId, sheetId);
  }

  /**
   * Check if a chart is dirty (needs recompilation).
   */
  isChartDirty(chartId: string, sheetId?: SheetId): boolean {
    return this.renderCache.isChartDirty(chartId, sheetId);
  }

  /**
   * Clear the dirty flag for a chart after rendering.
   */
  clearDirtyFlag(chartId: string, sheetId?: SheetId): void {
    this.renderCache.clearDirtyFlag(chartId, sheetId);
  }

  // ===========================================================================
  // Data Resolution
  // ===========================================================================

  /**
   * Resolve chart data from CellIdRange to actual values.
   *
   * This converts the CRDT-safe CellIdRange references to actual cell data
   * that can be passed to the charts library for rendering.
   *
   * @param sheetId - Sheet containing the chart
   * @param chartId - Chart ID
   * @returns Resolved data or error
   */
  async resolveChartData(sheetId: SheetId, chartId: string): Promise<ChartDataResult> {
    return this.dataResolver.resolveChartData(sheetId, chartId);
  }

  // ===========================================================================
  // Mark Compilation
  // ===========================================================================

  /**
   * Get compiled marks for a chart.
   *
   * Returns cached marks if available, otherwise compiles the chart spec.
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @returns Compiled marks or error
   */
  async getMarks(sheetId: SheetId, chartId: string): Promise<ChartMark[] | ChartError> {
    const cacheState = this.renderCache.getCompileState(chartId, sheetId);
    // Started-gate at function entry: a caller landing here after stop()
    // (e.g. an in-flight ensureCompiled racing a bridge teardown) must NOT
    // mutate caches or add to pendingCompilations. Without this, the
    // pending-check short-circuit at the top of subsequent calls would
    // perpetually return stale, since pendingCompilations would never clear.
    if (!this.started) {
      if (cacheState.marks) return cacheState.marks;
      return {
        code: 'CHART_NOT_FOUND',
        message: 'Chart bridge is stopped',
        chartId,
      };
    }

    // Check error cache first
    if (cacheState.error) {
      return cacheState.error;
    }

    // Check marks cache
    if (cacheState.marks && !cacheState.isDirty) {
      return cacheState.marks;
    }

    // If a recompilation is already in flight, return stale marks to avoid blank frames.
    // The in-flight compilation will update the cache when it resolves.
    // NOTE: this short-circuit deliberately does NOT fire onCacheUpdate
    // listeners — only the in-flight compile's real cache-commit fires them.
    // Firing here would loop: renderCached → ensureCompiled → getMarks →
    // pending short-circuit → listener → markDirty('drawing') → next frame
    // → renderCached again → loop until the original compile resolves.
    if (cacheState.marks && cacheState.isCompilePending) {
      return cacheState.marks;
    }

    this.renderCache.beginCompilation(chartId, sheetId);

    const chartRenderDataOrError = await this.dataResolver.resolveForRendering(sheetId, chartId);
    if ('code' in chartRenderDataOrError) {
      this.commitError(chartId, chartRenderDataOrError, sheetId);
      return chartRenderDataOrError;
    }
    const { config, data: chartData } = chartRenderDataOrError;

    if (chartData.series.length === 0) {
      const error: ChartError = {
        code: 'EMPTY_DATA',
        message: 'Chart data range is empty',
        chartId,
      };
      this.commitError(chartId, error, sheetId);
      return error;
    }

    const { marks, layout } = compileChartMarks({ config, chartData });

    // Real cache commit — fires listeners so the renderer dirties the
    // drawing layer and the next frame paints from cache instead of the
    // placeholder. commitMarks bails if stop() ran mid-compile.
    this.commitMarks(chartId, marks, sheetId, layout);

    return marks;
  }

  /**
   * Commit a marks outcome to the cache and notify cache-update listeners.
   *
   * Gated on `started`: if stop() ran mid-compile, the caches were cleared
   * and we must not re-pollute them. The pendingCompilations cleanup is
   * mirrored by stop() so the bridge is fully reset on teardown.
   */
  private commitMarks(
    chartId: string,
    marks: ChartMark[],
    sheetId?: SheetId,
    layout?: ChartLayoutSnapshot | null,
  ): void {
    this.renderCache.commitMarks(chartId, marks, { sheetId, layout });
  }

  /**
   * Commit an error outcome to the cache and notify listeners.
   *
   * Without firing listeners on errors, a chart whose first compile fails
   * (CHART_NOT_FOUND or EMPTY_DATA) would paint "Chart loading…" forever:
   * renderCached → ensureCompiled → errorCache populated → no signal → the
   * placeholder freezes until something else dirties the drawing layer.
   */
  private commitError(chartId: string, error: ChartError, sheetId?: SheetId): void {
    this.renderCache.commitError(chartId, error, sheetId);
  }

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
  async getMarksAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
  ): Promise<ChartMark[] | ChartError> {
    const snapshot = await this.compileChartRenderSnapshotAtSize(
      sheetId,
      chartId,
      width,
      height,
      defaultExportOptionsForSize(width, height),
    );
    if ('code' in snapshot) return snapshot;
    return snapshot.marks;
  }

  async getRenderSnapshotAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
    exportOptions: ChartExportOptionsSnapshot,
  ): Promise<ChartRenderSnapshot | ChartError> {
    return this.compileChartRenderSnapshotAtSize(sheetId, chartId, width, height, exportOptions);
  }

  private async compileChartRenderSnapshotAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
    exportOptions: ChartExportOptionsSnapshot,
  ): Promise<ChartRenderSnapshot | ChartError> {
    const chartRenderDataOrError = await this.dataResolver.resolveForRendering(sheetId, chartId);
    if ('code' in chartRenderDataOrError) {
      return chartRenderDataOrError;
    }
    const { chart, resolvedRanges, config, data: chartData } = chartRenderDataOrError;

    if (chartData.series.length === 0) {
      return {
        code: 'EMPTY_DATA',
        message: 'Chart data range is empty',
        chartId,
      };
    }

    return compileResolvedChartRenderSnapshotAtSize({
      chart,
      sheetId,
      chartId,
      config,
      chartData,
      resolvedRanges,
      exportOptions,
      width,
      height,
    });
  }

  // ===========================================================================
  // Render API
  // ===========================================================================
  //
  // Paint is synchronous and reads from cache only. Mark compilation is async
  // (data fetch + extract + compile) but lives off the paint path; the cache
  // breaks the coupling. See ImageCache.getImage / onLoad for the pattern
  // template — async producer, sync consumer, listener-driven repaint.
  //
  // The previous async `render()` returned a Promise that the canvas dispatch
  // loop discarded. By the time the await chain resolved, the engine had
  // already restored its `(viewport.x, viewport.y)` translate, so the chart's
  // own `ctx.translate(bounds.x, bounds.y)` landed in canvas-pixel space
  // without the viewport offset and the chart painted in the wrong frame.
  // `withRenderContext`'s rotation/flip were also dropped because they were
  // restored before the chart painted. The sync contract restores both.

  /**
   * Synchronous render from cache. See {@link IChartBridge.renderCached}.
   */
  renderCached(
    chartId: string,
    ctx: CanvasRenderingContext2D,
    bounds: ChartBounds,
    sheetId?: SheetId,
  ): void {
    const paintState = this.renderCache.getPaintState(chartId, sheetId);
    if (paintState.importRenderStatus) {
      renderChartError(ctx, bounds, {
        code: 'RENDER_FAILED',
        message: paintState.importRenderStatus.message,
        chartId,
        details: { importStatus: paintState.importRenderStatus.raw },
      });
      return;
    }

    if (!paintState.resolvedSheetId) {
      // First-paint case: floatingObject:created hasn't been delivered yet,
      // OR the chart was already deleted. Either way paint a placeholder; the
      // recovery path is the existing floating-object-pipeline call into
      // sheet-coordinator.ts which dirties the drawing layer once the event
      // lands. ensureCompiled would no-op anyway without a sheetId.
      renderChartPlaceholder(ctx, bounds, 'Chart loading…');
      return;
    }

    if (paintState.error) {
      // Error precedence over loading: a known error state must not retry on
      // every frame. invalidateChart() clears errorCache when the upstream
      // fix lands (data range edited, etc.) and recovery happens normally.
      renderChartError(ctx, bounds, paintState.error);
      return;
    }

    if (!paintState.marks) {
      // Cold-cache path: placeholder + background recompile. The compile
      // commit fires onCacheUpdate, the renderer dirties the drawing layer,
      // the next frame paints real marks from cache.
      renderChartPlaceholder(ctx, bounds, 'Chart loading…');
      if (!paintState.isCompilePending) {
        void this.ensureCompiled(chartId, paintState.resolvedSheetId);
      }
      return;
    }

    if (paintState.isDirty && !paintState.isCompilePending) {
      // Stale-but-show: paint stale marks this frame, kick a background
      // recompile. Mirrors getMarks's pendingCompilations stale-return at
      // the top of getMarks() and avoids a placeholder flash on every cell
      // edit affecting a chart's data range.
      void this.ensureCompiled(chartId, paintState.resolvedSheetId);
    }

    renderChartMarks(ctx, paintState.marks, bounds);
  }

  /**
   * Subscribe to cache-update notifications. See {@link IChartBridge.onCacheUpdate}.
   */
  onCacheUpdate(listener: (chartId: string) => void): () => void {
    return this.renderCache.onCacheUpdate(listener);
  }

  /**
   * Trigger compilation if dirty or absent. See {@link IChartBridge.ensureCompiled}.
   */
  async ensureCompiled(chartId: string, sheetId?: SheetId): Promise<void> {
    const resolvedSheetId = this.renderCache.resolveSheetId(chartId, sheetId);
    if (!resolvedSheetId) return;
    await this.getMarks(resolvedSheetId, chartId);
  }

  // ===========================================================================
  // Layout Retrieval
  // ===========================================================================

  /**
   * Get the layout snapshot for a chart.
   *
   * Returns a cached layout if available. If the chart is dirty (needs recompilation),
   * triggers getMarks() first to recompile and populate the layout cache.
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @returns Layout snapshot or null if chart not found / has no layout
   */
  async getLayout(sheetId: SheetId, chartId: string): Promise<ChartLayoutSnapshot | null> {
    // If layout is cached and chart is not dirty, return it directly
    const cached = this.renderCache.getFreshLayout(chartId, sheetId);
    if (cached) {
      return cached;
    }

    // Trigger recompilation which will populate the layout cache
    const marksOrError = await this.getMarks(sheetId, chartId);
    if ('code' in marksOrError) {
      return null;
    }

    return this.renderCache.getCachedLayout(chartId, sheetId) ?? null;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Get charts that are affected by changes in a specific cell range.
   *
   * Useful for determining which charts need re-rendering after a batch update.
   */
  async getChartsAffectedByRange(sheetId: SheetId, range: CellRange): Promise<string[]> {
    return getChartsAffectedByRangeForSubscriptions(this.ctx, sheetId, range);
  }

  /**
   * Get all dirty charts that need re-rendering.
   */
  getDirtyCharts(): string[] {
    return this.renderCache.getDirtyChartKeys();
  }

  /**
   * Clear all caches. Useful for testing or full refresh.
   *
   * Fires onCacheUpdate listeners with the sentinel chartId `'*'` so the
   * renderer dirties the drawing layer. Without this signal, on-screen marks
   * would freeze (we have no marks in cache, but the renderer wouldn't know
   * to re-paint until something else dirtied it).
   */
  clearAllCaches(): void {
    this.dataResolver.clearCaches();
    this.renderCache.clearAllCaches();
  }

  // ===========================================================================
  // Headless Image Export
  // ===========================================================================

  // TODO(06-CONSUMERS): Headless chart image export is not yet implemented.
  // The `exportChartImage` operation in chart-operations.ts currently returns
  // a "not implemented" error because it requires a canvas context
  // (OffscreenCanvas or DOM canvas) which is not available in headless/kernel
  // mode. To support server-side chart image export:
  //   1. Use OffscreenCanvas (available in Web Workers and Node 18+)
  //   2. Call getMarks() to compile the chart, then renderChartMarks() to an
  //      OffscreenCanvas, then canvas.toDataURL() / canvas.toBlob()
  //   3. Wire this through chart-operations.ts exportChartImage()
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new ChartBridge instance.
 *
 * @param ctx - Store context
 * @returns ChartBridge instance (not started)
 */
export function createChartBridge(ctx: DocumentContext): ChartBridge {
  return new ChartBridge(ctx);
}
