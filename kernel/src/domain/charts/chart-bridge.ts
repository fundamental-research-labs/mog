// Stable public bridge facade for @mog/charts integration.
//
// Paint is synchronous: renderCached reads only committed cache state and
// schedules async compilation off the paint path. Do not re-async it; the canvas
// dispatch loop restores viewport/rotation/flip state immediately after calling
// each floating-object painter.

import type {
  ChartBounds,
  ChartDataResult,
  ChartError,
  ChartErrorCode,
  ChartLayoutSnapshot,
  ChartMark,
  ChartRenderFrame,
  ChartRenderSnapshot,
  IChartBridge,
} from '@mog-sdk/contracts/bridges';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { ChartExportOptionsSnapshot } from '@mog-sdk/contracts/data/charts';
import {
  renderChartError,
  renderChartMarks,
  renderChartPlaceholder,
} from './bridge/chart-renderer';
import { ChartRenderCache } from './bridge/chart-render-cache';
import { ChartDataResolver } from './bridge/chart-data-resolver';
import { ChartRenderOrchestrator } from './bridge/chart-render-orchestrator';
import {
  getChartsAffectedByRange as getChartsAffectedByRangeForSubscriptions,
  setupChartBridgeSubscriptions,
} from './bridge/chart-bridge-subscriptions';
import { normalizeChartRenderFrame } from './bridge/chart-render-frame';

import type { DocumentContext } from '../../context/types';

export type {
  ChartBounds,
  ChartDataResult,
  ChartError,
  ChartErrorCode,
  ChartMark,
  ChartRenderFrame,
};
export { initChartWasm } from './bridge/chart-compiler';
export type { ChartWasmExports } from './bridge/chart-compiler';
export { isPositionOnlyUpdate } from './bridge/position-only-update';

export class ChartBridge implements IChartBridge {
  private readonly renderCache = new ChartRenderCache();
  private readonly dataResolver: ChartDataResolver;
  private readonly renderOrchestrator: ChartRenderOrchestrator;

  private cleanups: Array<() => void> = [];
  private started = false;

  constructor(private ctx: DocumentContext) {
    this.dataResolver = new ChartDataResolver(ctx);
    this.renderOrchestrator = new ChartRenderOrchestrator({
      renderCache: this.renderCache,
      dataResolver: this.dataResolver,
      isLive: () => this.started,
    });
  }

  start(): () => void {
    if (this.started) {
      return () => this.stop();
    }
    this.started = true;
    this.renderCache.start();

    this.setupSubscriptions();

    return () => this.stop();
  }

  stop(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.renderCache.stop();
    this.dataResolver.clearCaches();
    this.started = false;
  }

  destroy(): void {
    this.stop();
  }

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

  invalidateChart(chartId: string, sheetId?: SheetId): void {
    this.renderCache.invalidateChart(chartId, sheetId);
  }

  isChartDirty(chartId: string, sheetId?: SheetId): boolean {
    return this.renderCache.isChartDirty(chartId, sheetId);
  }

  clearDirtyFlag(chartId: string, sheetId?: SheetId): void {
    this.renderCache.clearDirtyFlag(chartId, sheetId);
  }

  async resolveChartData(sheetId: SheetId, chartId: string): Promise<ChartDataResult> {
    return this.dataResolver.resolveChartData(sheetId, chartId);
  }

  async getMarks(sheetId: SheetId, chartId: string): Promise<ChartMark[] | ChartError> {
    return this.renderOrchestrator.getMarks(sheetId, chartId);
  }

  async getMarksAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
  ): Promise<ChartMark[] | ChartError> {
    return this.renderOrchestrator.getMarksAtSize(sheetId, chartId, width, height);
  }

  async getRenderSnapshotAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
    exportOptions: ChartExportOptionsSnapshot,
  ): Promise<ChartRenderSnapshot | ChartError> {
    return this.renderOrchestrator.getRenderSnapshotAtSize(
      sheetId,
      chartId,
      width,
      height,
      exportOptions,
    );
  }

  renderCached(
    chartId: string,
    ctx: CanvasRenderingContext2D,
    bounds: ChartBounds,
    sheetId?: SheetId,
    renderFrame?: Partial<ChartRenderFrame>,
  ): void {
    const normalizedFrame = normalizeChartRenderFrame(bounds, renderFrame);
    const paintState = this.renderCache.getPaintState(chartId, sheetId, normalizedFrame);
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
      renderChartPlaceholder(ctx, bounds, 'Chart loading…');
      return;
    }

    if (paintState.error) {
      renderChartError(ctx, bounds, paintState.error);
      return;
    }

    if (!paintState.marks) {
      renderChartPlaceholder(ctx, bounds, 'Chart loading…');
      if (!paintState.isCompilePending) {
        void this.ensureCompiled(chartId, paintState.resolvedSheetId, normalizedFrame);
      }
      return;
    }

    if (paintState.isDirty && !paintState.isCompilePending) {
      void this.ensureCompiled(chartId, paintState.resolvedSheetId, normalizedFrame);
    }

    renderChartMarks(ctx, paintState.marks, bounds);
  }

  onCacheUpdate(listener: (chartId: string) => void): () => void {
    return this.renderCache.onCacheUpdate(listener);
  }

  async ensureCompiled(
    chartId: string,
    sheetId?: SheetId,
    renderFrame?: Partial<ChartRenderFrame>,
  ): Promise<void> {
    const normalizedFrame =
      renderFrame?.width !== undefined && renderFrame.height !== undefined
        ? normalizeChartRenderFrame(
            { width: renderFrame.width, height: renderFrame.height },
            renderFrame,
          )
        : undefined;
    await this.renderOrchestrator.ensureCompiled(chartId, sheetId, normalizedFrame);
  }

  async getLayout(sheetId: SheetId, chartId: string): Promise<ChartLayoutSnapshot | null> {
    return this.renderOrchestrator.getLayout(sheetId, chartId);
  }

  async getChartsAffectedByRange(sheetId: SheetId, range: CellRange): Promise<string[]> {
    return getChartsAffectedByRangeForSubscriptions(this.ctx, sheetId, range);
  }

  getDirtyCharts(): string[] {
    return this.renderCache.getDirtyChartKeys();
  }

  clearAllCaches(): void {
    this.dataResolver.clearCaches();
    this.renderCache.clearAllCaches();
  }
}

export function createChartBridge(ctx: DocumentContext): ChartBridge {
  return new ChartBridge(ctx);
}
