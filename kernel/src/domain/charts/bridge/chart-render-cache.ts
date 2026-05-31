import type { ChartError, ChartLayoutSnapshot, ChartMark } from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';

import {
  hasImportStatus,
  importStatusToTerminalRenderStatus,
  type ImportedChartRenderStatus,
} from './import-render-status';
import { ChartSheetIndex } from './chart-sheet-index';
import { chartRenderFrameCacheSuffix, type NormalizedChartRenderFrame } from './chart-render-frame';
import {
  ChartRenderCacheListeners,
  type ChartRenderCacheUpdateListener,
} from './chart-render-cache-listeners';
import { ChartRenderCacheState } from './chart-render-cache-state';

type CacheUpdateListener = ChartRenderCacheUpdateListener;

export type ChartRenderCacheCompileState = {
  key: string;
  marks: ChartMark[] | undefined;
  error: ChartError | undefined;
  isDirty: boolean;
  isCompilePending: boolean;
};

export type ChartRenderCachePaintState = {
  resolvedSheetId: SheetId | undefined;
  importRenderStatus: ImportedChartRenderStatus | undefined;
  error: ChartError | undefined;
  marks: ChartMark[] | undefined;
  isDirty: boolean;
  isCompilePending: boolean;
};

export type CommitMarksOptions = {
  sheetId?: SheetId;
  frame?: NormalizedChartRenderFrame;
  layout?: ChartLayoutSnapshot | null;
};

/**
 * Owns renderer-side chart cache state for the synchronous paint path.
 *
 * ChartBridge remains responsible for resolving data, compiling marks, and
 * painting to canvas. This class owns only cache/listener/index lifecycle.
 */
export class ChartRenderCache {
  private readonly cacheState = new ChartRenderCacheState();

  /** Sync paint-path chartId -> owning SheetId index. */
  private readonly chartSheetIndex = new ChartSheetIndex();

  /** Listeners notified when a real cache outcome is committed. */
  private readonly listeners = new ChartRenderCacheListeners();

  private acceptsCommits = false;

  start(): void {
    this.acceptsCommits = true;
  }

  stop(): void {
    this.acceptsCommits = false;
    this.cacheState.clear();
    this.chartSheetIndex.clear();
    this.listeners.clear();
  }

  cacheKey(chartId: string, sheetId?: SheetId, frame?: NormalizedChartRenderFrame): string {
    const baseKey = this.chartSheetIndex.cacheKey(chartId, sheetId);
    const frameSuffix = chartRenderFrameCacheSuffix(frame);
    return frameSuffix ? `${baseKey}::${frameSuffix}` : baseKey;
  }

  resolveSheetId(chartId: string, explicitSheetId?: SheetId): SheetId | undefined {
    return this.chartSheetIndex.resolveSheetId(chartId, explicitSheetId);
  }

  getSheetId(chartId: string): SheetId | undefined {
    return this.chartSheetIndex.get(chartId);
  }

  hasSheetId(chartId: string, sheetId?: SheetId): boolean {
    return this.chartSheetIndex.has(chartId, sheetId);
  }

  setSheetId(chartId: string, sheetId: SheetId): void {
    this.chartSheetIndex.set(chartId, sheetId);
  }

  deleteSheetId(chartId: string, sheetId?: SheetId): boolean {
    return this.chartSheetIndex.delete(chartId, sheetId);
  }

  deleteSheet(sheetId: SheetId): string[] {
    const deletedChartIds = this.chartSheetIndex.deleteSheet(sheetId);
    for (const chartId of deletedChartIds) {
      this.deleteChartCaches(chartId, sheetId);
    }
    return deletedChartIds;
  }

  chartIdsForSheet(sheetId: SheetId): string[] {
    return this.chartSheetIndex.chartIdsForSheet(sheetId);
  }

  deleteChartCaches(chartId: string, sheetId?: SheetId): void {
    const keys = this.matchingCacheKeys(chartId, sheetId);
    this.cacheState.deleteKeys(keys);
  }

  invalidateChart(chartId: string, sheetId?: SheetId): void {
    const keys = this.matchingCacheKeys(chartId, sheetId);
    // Keep stale marks/layouts available during async recompilation; only the
    // known error is cleared so recovery can paint once the compile succeeds.
    this.cacheState.invalidateKeys(keys);
  }

  isChartDirty(chartId: string, sheetId?: SheetId, frame?: NormalizedChartRenderFrame): boolean {
    const key = this.cacheKey(chartId, sheetId, frame);
    return this.cacheState.isDirty(key) || !this.cacheState.hasMarks(key);
  }

  clearDirtyFlag(chartId: string, sheetId?: SheetId, frame?: NormalizedChartRenderFrame): void {
    this.cacheState.clearDirty(this.cacheKey(chartId, sheetId, frame));
  }

  getDirtyChartKeys(): string[] {
    return this.cacheState.getDirtyKeys();
  }

  getCachedMarks(
    chartId: string,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): ChartMark[] | undefined {
    return this.cacheState.getMarks(this.cacheKey(chartId, sheetId, frame));
  }

  getCachedError(
    chartId: string,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): ChartError | undefined {
    return this.cacheState.getError(this.cacheKey(chartId, sheetId, frame));
  }

  getCachedLayout(
    chartId: string,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): ChartLayoutSnapshot | undefined {
    return this.cacheState.getLayout(this.cacheKey(chartId, sheetId, frame));
  }

  getImportRenderStatus(
    chartId: string,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): ImportedChartRenderStatus | undefined {
    const key = this.cacheKey(chartId, sheetId, frame);
    return this.cacheState.getImportRenderStatusByPrecedence(
      key,
      this.cacheKey(chartId, sheetId),
      chartId,
    );
  }

  getFreshLayout(
    chartId: string,
    sheetId: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): ChartLayoutSnapshot | undefined {
    return this.cacheState.getFreshLayout(this.cacheKey(chartId, sheetId, frame));
  }

  getCompileState(
    chartId: string,
    sheetId: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): ChartRenderCacheCompileState {
    const key = this.cacheKey(chartId, sheetId, frame);
    const baseKey = this.cacheKey(chartId, sheetId);
    return {
      key,
      marks: this.cacheState.getMarks(key),
      error: this.cacheState.getErrorByPrecedence(key, baseKey, chartId),
      isDirty: this.cacheState.isDirty(key),
      isCompilePending: this.cacheState.isCompilationPending(key),
    };
  }

  getPaintState(
    chartId: string,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): ChartRenderCachePaintState {
    const legacyImportRenderStatus = this.cacheState.getImportRenderStatus(chartId);
    if (legacyImportRenderStatus) {
      return {
        resolvedSheetId: this.resolveSheetId(chartId, sheetId),
        importRenderStatus: legacyImportRenderStatus,
        error: undefined,
        marks: undefined,
        isDirty: this.cacheState.isDirty(chartId),
        isCompilePending: this.cacheState.isCompilationPending(chartId),
      };
    }

    const resolvedSheetId = this.resolveSheetId(chartId, sheetId);
    if (!resolvedSheetId) {
      return {
        resolvedSheetId: undefined,
        importRenderStatus: undefined,
        error: undefined,
        marks: undefined,
        isDirty: this.cacheState.isDirty(chartId),
        isCompilePending: this.cacheState.isCompilationPending(chartId),
      };
    }

    const key = this.cacheKey(chartId, resolvedSheetId, frame);
    const baseKey = this.cacheKey(chartId, resolvedSheetId);
    const keyMarks = this.cacheState.getMarks(key);
    const legacyMarks = frame ? undefined : this.cacheState.getMarks(chartId);
    return {
      resolvedSheetId,
      importRenderStatus: this.cacheState.getImportRenderStatusByPrecedence(key, baseKey, chartId),
      error: this.cacheState.getErrorByPrecedence(key, baseKey, chartId),
      marks: keyMarks ?? legacyMarks,
      isDirty: keyMarks != null ? this.cacheState.isDirty(key) : this.cacheState.isDirty(chartId),
      isCompilePending: this.cacheState.isCompilationPendingByPrecedence(key, baseKey, chartId),
    };
  }

  beginCompilation(chartId: string, sheetId: SheetId, frame?: NormalizedChartRenderFrame): void {
    this.cacheState.beginCompilation(this.cacheKey(chartId, sheetId, frame));
  }

  isCompilationPending(
    chartId: string,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): boolean {
    return this.cacheState.isCompilationPending(this.cacheKey(chartId, sheetId, frame));
  }

  commitMarks(chartId: string, marks: ChartMark[], options: CommitMarksOptions = {}): boolean {
    const key = this.cacheKey(chartId, options.sheetId, options.frame);
    if (!this.acceptsCommits) {
      this.clearPendingAliases(chartId, options.sheetId, options.frame);
      return false;
    }

    if (options.layout) {
      this.cacheState.setLayout(key, options.layout);
    }
    this.cacheState.setMarks(key, marks);
    this.cacheState.clearDirty(key);
    this.clearPendingAliases(chartId, options.sheetId, options.frame);
    this.fireCacheUpdate(chartId);
    return true;
  }

  commitError(
    chartId: string,
    error: ChartError,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): boolean {
    const key = this.cacheKey(chartId, sheetId, frame);
    if (!this.acceptsCommits) {
      this.clearPendingAliases(chartId, sheetId, frame);
      return false;
    }

    this.cacheState.setError(key, error);
    this.clearPendingAliases(chartId, sheetId, frame);
    this.fireCacheUpdate(chartId);
    return true;
  }

  syncImportRenderStatus(chartId: string, payload: unknown, sheetId?: SheetId): boolean {
    const key = this.cacheKey(chartId, sheetId);
    if (!hasImportStatus(payload)) {
      if (payload !== undefined) {
        const hadImportRenderStatus = this.cacheState.deleteImportRenderStatus(key);
        if (hadImportRenderStatus) this.cacheState.deleteError(key);
      }
      return false;
    }

    const renderStatus = importStatusToTerminalRenderStatus(payload.importStatus);
    if (!renderStatus) {
      const hadImportRenderStatus = this.cacheState.deleteImportRenderStatus(key);
      if (hadImportRenderStatus) this.cacheState.deleteError(key);
      return false;
    }

    if (!this.acceptsCommits) {
      this.clearPendingAliases(chartId, sheetId);
      return true;
    }

    this.cacheState.setImportRenderStatus(key, renderStatus);
    this.cacheState.deleteMarks(key);
    this.cacheState.deleteLayout(key);
    this.cacheState.clearDirty(key);
    this.cacheState.clearPending(key);
    this.commitError(
      chartId,
      {
        code: 'RENDER_FAILED',
        message: renderStatus.message,
        chartId,
        details: { importStatus: renderStatus.raw },
      },
      sheetId,
    );
    return true;
  }

  onCacheUpdate(listener: CacheUpdateListener): () => void {
    return this.listeners.subscribe(listener);
  }

  clearAllCaches(): void {
    this.cacheState.clear();
    this.fireCacheUpdate('*');
  }

  private clearPendingAliases(
    chartId: string,
    sheetId?: SheetId,
    frame?: NormalizedChartRenderFrame,
  ): void {
    this.cacheState.clearPendingAliases(
      this.cacheKey(chartId, sheetId, frame),
      this.cacheKey(chartId, sheetId),
      chartId,
    );
  }

  private matchingCacheKeys(chartId: string, sheetId?: SheetId): Set<string> {
    const baseKey = this.cacheKey(chartId, sheetId);
    return this.cacheState.matchingKeys(chartId, baseKey, sheetId);
  }

  /**
   * Snapshot listeners first so a listener that unsubscribes during iteration
   * does not skip the next listener via splice-during-forEach.
   */
  private fireCacheUpdate(chartId: string): void {
    this.listeners.fire(chartId);
  }
}
