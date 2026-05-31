import type {
  ChartError,
  ChartLayoutSnapshot,
  ChartMark,
  ChartRenderSnapshot,
} from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { ChartExportOptionsSnapshot } from '@mog-sdk/contracts/data/charts';

import type { ChartDataResolver } from './chart-data-resolver';
import {
  compileChartMarks,
  compileChartRenderSnapshotAtSize as compileResolvedChartRenderSnapshotAtSize,
} from './chart-compiler';
import type { ChartRenderCache } from './chart-render-cache';
import { importedChartRenderStatusToError } from './import-render-status';
import { defaultExportOptionsForSize } from './resolved-spec-snapshot';
import type { NormalizedChartRenderFrame } from './chart-render-frame';

export interface ChartRenderOrchestratorOptions {
  renderCache: ChartRenderCache;
  dataResolver: ChartDataResolver;
  isLive: () => boolean;
}

/**
 * Coordinates cache-backed chart compilation and one-off export/diagnostics
 * compilation. It owns no EventBus wiring and no canvas painting.
 */
export class ChartRenderOrchestrator {
  private readonly renderCache: ChartRenderCache;
  private readonly dataResolver: ChartDataResolver;
  private readonly isLive: () => boolean;

  constructor(options: ChartRenderOrchestratorOptions) {
    this.renderCache = options.renderCache;
    this.dataResolver = options.dataResolver;
    this.isLive = options.isLive;
  }

  /**
   * Get compiled marks for a chart.
   *
   * Returns cached marks if available, otherwise resolves data and compiles
   * through the shared @mog/charts production path at the supplied render
   * frame size.
   */
  async getMarks(
    sheetId: SheetId,
    chartId: string,
    frame?: NormalizedChartRenderFrame,
  ): Promise<ChartMark[] | ChartError> {
    const cacheState = this.renderCache.getCompileState(chartId, sheetId, frame);
    // Started-gate at function entry: a caller landing here after stop()
    // (e.g. an in-flight ensureCompiled racing a bridge teardown) must NOT
    // mutate caches or add to pendingCompilations. Without this, the
    // pending-check short-circuit at the top of subsequent calls would
    // perpetually return stale, since pendingCompilations would never clear.
    if (!this.isLive()) {
      if (cacheState.marks) return cacheState.marks;
      return {
        code: 'CHART_NOT_FOUND',
        message: 'Chart bridge is stopped',
        chartId,
      };
    }

    if (cacheState.error) {
      return cacheState.error;
    }

    if (cacheState.marks && !cacheState.isDirty) {
      return cacheState.marks;
    }

    // If a recompilation is already in flight, return stale marks to avoid
    // blank frames. The in-flight compilation will update the cache when it
    // resolves, and this stale return deliberately does not notify listeners.
    if (cacheState.marks && cacheState.isCompilePending) {
      return cacheState.marks;
    }

    this.renderCache.beginCompilation(chartId, sheetId, frame);

    const chartRenderDataOrError = await this.dataResolver.resolveForRendering(sheetId, chartId);
    if ('code' in chartRenderDataOrError) {
      this.commitError(chartId, chartRenderDataOrError, sheetId, frame);
      return chartRenderDataOrError;
    }
    const { config, data: chartData } = chartRenderDataOrError;

    if (chartData.series.length === 0) {
      const error = emptyDataError(chartId);
      this.commitError(chartId, error, sheetId, frame);
      return error;
    }

    const { marks, layout } = compileChartMarks({
      config,
      chartData,
      size: frame ? { width: frame.width, height: frame.height } : undefined,
    });

    // Real cache commit: fires listeners so the renderer dirties the drawing
    // layer and the next frame paints from cache instead of the placeholder.
    this.commitMarks(chartId, marks, sheetId, layout, frame);

    return marks;
  }

  /**
   * Compile marks for a chart at specific pixel dimensions.
   *
   * Unlike getMarks(), this does not use or update the UI mark/layout cache.
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

  /**
   * Trigger compilation if dirty or absent.
   */
  async ensureCompiled(
    chartId: string,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): Promise<void> {
    const resolvedSheetId = this.renderCache.resolveSheetId(chartId, sheetId);
    if (!resolvedSheetId) return;
    await this.getMarks(resolvedSheetId, chartId, frame);
  }

  /**
   * Return a cached layout, compiling first when the chart is dirty or absent.
   */
  async getLayout(
    sheetId: SheetId,
    chartId: string,
    frame?: NormalizedChartRenderFrame,
  ): Promise<ChartLayoutSnapshot | null> {
    const cached = this.renderCache.getFreshLayout(chartId, sheetId, frame);
    if (cached) {
      return cached;
    }

    const marksOrError = await this.getMarks(sheetId, chartId, frame);
    if ('code' in marksOrError) {
      return null;
    }

    return this.renderCache.getCachedLayout(chartId, sheetId, frame) ?? null;
  }

  private async compileChartRenderSnapshotAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
    exportOptions: ChartExportOptionsSnapshot,
  ): Promise<ChartRenderSnapshot | ChartError> {
    const knownImportStatus = this.renderCache.getImportRenderStatus(chartId, sheetId);
    if (knownImportStatus) {
      return importedChartRenderStatusToError(chartId, knownImportStatus);
    }

    const chartRenderDataOrError = await this.dataResolver.resolveForRendering(sheetId, chartId);
    if ('code' in chartRenderDataOrError) {
      return chartRenderDataOrError;
    }
    const { chart, resolvedRanges, config, data: chartData } = chartRenderDataOrError;

    if (chartData.series.length === 0) {
      return emptyDataError(chartId);
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

  /**
   * Commit a marks outcome to the cache and notify cache-update listeners.
   *
   * The render cache gates commits after stop(), so in-flight async work cannot
   * repopulate cleared mark/layout/error/import-status state.
   */
  private commitMarks(
    chartId: string,
    marks: ChartMark[],
    sheetId?: SheetId,
    layout?: ChartLayoutSnapshot | null,
    frame?: NormalizedChartRenderFrame,
  ): void {
    this.renderCache.commitMarks(chartId, marks, { sheetId, frame, layout });
  }

  /**
   * Commit an error outcome to the cache and notify listeners.
   */
  private commitError(
    chartId: string,
    error: ChartError,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): void {
    this.renderCache.commitError(chartId, error, sheetId, frame);
  }
}

function emptyDataError(chartId: string): ChartError {
  return {
    code: 'EMPTY_DATA',
    message: 'Chart data range is empty',
    chartId,
  };
}
