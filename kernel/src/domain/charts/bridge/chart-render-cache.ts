import type {
  ChartError,
  ChartLayoutSnapshot,
  ChartMark,
} from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';

import {
  hasImportStatus,
  importStatusToTerminalRenderStatus,
  type ImportedChartRenderStatus,
} from './import-render-status';
import { ChartSheetIndex } from './chart-sheet-index';

type CacheUpdateListener = (chartId: string) => void;

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
  layout?: ChartLayoutSnapshot | null;
};

/**
 * Owns renderer-side chart cache state for the synchronous paint path.
 *
 * ChartBridge remains responsible for resolving data, compiling marks, and
 * painting to canvas. This class owns only cache/listener/index lifecycle.
 */
export class ChartRenderCache {
  /** Cache of compiled marks per chart ID or sheet-scoped cache key. */
  private readonly markCache = new Map<string, ChartMark[]>();

  /** Cache of layout snapshots per chart ID or sheet-scoped cache key. */
  private readonly layoutCache = new Map<string, ChartLayoutSnapshot>();

  /** Cache of chart errors per chart ID or sheet-scoped cache key. */
  private readonly errorCache = new Map<string, ChartError>();

  /** Renderer-side terminal import/render status for imported charts. */
  private readonly chartImportRenderStatus = new Map<string, ImportedChartRenderStatus>();

  /** Set of dirty charts that need recompilation. */
  private readonly dirtyCharts = new Set<string>();

  /** Set of chart IDs currently being recompiled. */
  private readonly pendingCompilations = new Set<string>();

  /** Sync paint-path chartId -> owning SheetId index. */
  private readonly chartSheetIndex = new ChartSheetIndex();

  /** Listeners notified when a real cache outcome is committed. */
  private readonly cacheUpdateListeners: CacheUpdateListener[] = [];

  private acceptsCommits = false;

  start(): void {
    this.acceptsCommits = true;
  }

  stop(): void {
    this.acceptsCommits = false;
    this.clearCacheState();
    this.chartSheetIndex.clear();
    // In-place clear, NOT reassignment: unsubscribe closures capture this array
    // by reference and must remain safe after stop().
    this.cacheUpdateListeners.length = 0;
  }

  cacheKey(chartId: string, sheetId?: SheetId): string {
    return this.chartSheetIndex.cacheKey(chartId, sheetId);
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

  chartIdsForSheet(sheetId: SheetId): string[] {
    return this.chartSheetIndex.chartIdsForSheet(sheetId);
  }

  deleteChartCaches(chartId: string, sheetId?: SheetId): void {
    const keys = new Set([chartId, this.cacheKey(chartId, sheetId)]);
    for (const key of keys) {
      this.markCache.delete(key);
      this.layoutCache.delete(key);
      this.errorCache.delete(key);
      this.chartImportRenderStatus.delete(key);
      this.dirtyCharts.delete(key);
      this.pendingCompilations.delete(key);
    }
  }

  invalidateChart(chartId: string, sheetId?: SheetId): void {
    const key = this.cacheKey(chartId, sheetId);
    // Keep stale marks/layouts available during async recompilation; only the
    // known error is cleared so recovery can paint once the compile succeeds.
    this.errorCache.delete(key);
    this.dirtyCharts.add(key);
  }

  isChartDirty(chartId: string, sheetId?: SheetId): boolean {
    const key = this.cacheKey(chartId, sheetId);
    return this.dirtyCharts.has(key) || !this.markCache.has(key);
  }

  clearDirtyFlag(chartId: string, sheetId?: SheetId): void {
    this.dirtyCharts.delete(this.cacheKey(chartId, sheetId));
  }

  getDirtyChartKeys(): string[] {
    return Array.from(this.dirtyCharts);
  }

  getCachedMarks(chartId: string, sheetId?: SheetId): ChartMark[] | undefined {
    return this.markCache.get(this.cacheKey(chartId, sheetId));
  }

  getCachedError(chartId: string, sheetId?: SheetId): ChartError | undefined {
    return this.errorCache.get(this.cacheKey(chartId, sheetId));
  }

  getCachedLayout(chartId: string, sheetId?: SheetId): ChartLayoutSnapshot | undefined {
    return this.layoutCache.get(this.cacheKey(chartId, sheetId));
  }

  getImportRenderStatus(
    chartId: string,
    sheetId?: SheetId,
  ): ImportedChartRenderStatus | undefined {
    return this.chartImportRenderStatus.get(this.cacheKey(chartId, sheetId));
  }

  getFreshLayout(chartId: string, sheetId: SheetId): ChartLayoutSnapshot | undefined {
    const key = this.cacheKey(chartId, sheetId);
    const cached = this.layoutCache.get(key);
    return cached && !this.dirtyCharts.has(key) ? cached : undefined;
  }

  getCompileState(chartId: string, sheetId: SheetId): ChartRenderCacheCompileState {
    const key = this.cacheKey(chartId, sheetId);
    return {
      key,
      marks: this.markCache.get(key),
      error: this.errorCache.get(key),
      isDirty: this.dirtyCharts.has(key),
      isCompilePending: this.pendingCompilations.has(key),
    };
  }

  getPaintState(chartId: string, sheetId?: SheetId): ChartRenderCachePaintState {
    const legacyImportRenderStatus = this.chartImportRenderStatus.get(chartId);
    if (legacyImportRenderStatus) {
      return {
        resolvedSheetId: this.resolveSheetId(chartId, sheetId),
        importRenderStatus: legacyImportRenderStatus,
        error: undefined,
        marks: undefined,
        isDirty: this.dirtyCharts.has(chartId),
        isCompilePending: this.pendingCompilations.has(chartId),
      };
    }

    const resolvedSheetId = this.resolveSheetId(chartId, sheetId);
    if (!resolvedSheetId) {
      return {
        resolvedSheetId: undefined,
        importRenderStatus: undefined,
        error: undefined,
        marks: undefined,
        isDirty: this.dirtyCharts.has(chartId),
        isCompilePending: this.pendingCompilations.has(chartId),
      };
    }

    const key = this.cacheKey(chartId, resolvedSheetId);
    const keyMarks = this.markCache.get(key);
    const legacyMarks = this.markCache.get(chartId);
    return {
      resolvedSheetId,
      importRenderStatus:
        this.chartImportRenderStatus.get(key) ?? this.chartImportRenderStatus.get(chartId),
      error: this.errorCache.get(key) ?? this.errorCache.get(chartId),
      marks: keyMarks ?? legacyMarks,
      isDirty: keyMarks != null ? this.dirtyCharts.has(key) : this.dirtyCharts.has(chartId),
      isCompilePending:
        this.pendingCompilations.has(key) || this.pendingCompilations.has(chartId),
    };
  }

  beginCompilation(chartId: string, sheetId: SheetId): void {
    this.pendingCompilations.add(this.cacheKey(chartId, sheetId));
  }

  isCompilationPending(chartId: string, sheetId?: SheetId): boolean {
    return this.pendingCompilations.has(this.cacheKey(chartId, sheetId));
  }

  commitMarks(chartId: string, marks: ChartMark[], options: CommitMarksOptions = {}): boolean {
    const key = this.cacheKey(chartId, options.sheetId);
    if (!this.acceptsCommits) {
      this.clearPendingAliases(chartId, options.sheetId);
      return false;
    }

    if (options.layout) {
      this.layoutCache.set(key, options.layout);
    }
    this.markCache.set(key, marks);
    this.dirtyCharts.delete(key);
    this.clearPendingAliases(chartId, options.sheetId);
    this.fireCacheUpdate(chartId);
    return true;
  }

  commitError(chartId: string, error: ChartError, sheetId?: SheetId): boolean {
    const key = this.cacheKey(chartId, sheetId);
    if (!this.acceptsCommits) {
      this.clearPendingAliases(chartId, sheetId);
      return false;
    }

    this.errorCache.set(key, error);
    this.clearPendingAliases(chartId, sheetId);
    this.fireCacheUpdate(chartId);
    return true;
  }

  syncImportRenderStatus(chartId: string, payload: unknown, sheetId?: SheetId): boolean {
    const key = this.cacheKey(chartId, sheetId);
    if (!hasImportStatus(payload)) {
      if (payload !== undefined) {
        const hadImportRenderStatus = this.chartImportRenderStatus.delete(key);
        if (hadImportRenderStatus) this.errorCache.delete(key);
      }
      return false;
    }

    const renderStatus = importStatusToTerminalRenderStatus(payload.importStatus);
    if (!renderStatus) {
      const hadImportRenderStatus = this.chartImportRenderStatus.delete(key);
      if (hadImportRenderStatus) this.errorCache.delete(key);
      return false;
    }

    if (!this.acceptsCommits) {
      this.clearPendingAliases(chartId, sheetId);
      return true;
    }

    this.chartImportRenderStatus.set(key, renderStatus);
    this.markCache.delete(key);
    this.layoutCache.delete(key);
    this.dirtyCharts.delete(key);
    this.pendingCompilations.delete(key);
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
    this.cacheUpdateListeners.push(listener);
    return () => {
      const i = this.cacheUpdateListeners.indexOf(listener);
      if (i >= 0) this.cacheUpdateListeners.splice(i, 1);
    };
  }

  clearAllCaches(): void {
    this.clearCacheState();
    this.fireCacheUpdate('*');
  }

  private clearCacheState(): void {
    this.markCache.clear();
    this.layoutCache.clear();
    this.errorCache.clear();
    this.chartImportRenderStatus.clear();
    this.dirtyCharts.clear();
    this.pendingCompilations.clear();
  }

  private clearPendingAliases(chartId: string, sheetId?: SheetId): void {
    this.pendingCompilations.delete(this.cacheKey(chartId, sheetId));
    this.pendingCompilations.delete(chartId);
  }

  /**
   * Snapshot listeners first so a listener that unsubscribes during iteration
   * does not skip the next listener via splice-during-forEach.
   */
  private fireCacheUpdate(chartId: string): void {
    for (const listener of [...this.cacheUpdateListeners]) {
      listener(chartId);
    }
  }
}
