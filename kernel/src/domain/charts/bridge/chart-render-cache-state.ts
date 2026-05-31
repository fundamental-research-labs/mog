import type { ChartError, ChartLayoutSnapshot, ChartMark } from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { ImportedChartRenderStatus } from './import-render-status';
import { matchingChartRenderCacheKeys } from './chart-render-cache-keys';

/**
 * Owns renderer-side cache maps and sets.
 *
 * The public ChartRenderCache facade computes chart/sheet/frame keys; this
 * class keeps the mutation rules for those keys in one place.
 */
export class ChartRenderCacheState {
  private readonly markCache = new Map<string, ChartMark[]>();
  private readonly layoutCache = new Map<string, ChartLayoutSnapshot>();
  private readonly errorCache = new Map<string, ChartError>();
  private readonly chartImportRenderStatus = new Map<string, ImportedChartRenderStatus>();
  private readonly dirtyCharts = new Set<string>();
  private readonly pendingCompilations = new Set<string>();

  clear(): void {
    this.markCache.clear();
    this.layoutCache.clear();
    this.errorCache.clear();
    this.chartImportRenderStatus.clear();
    this.dirtyCharts.clear();
    this.pendingCompilations.clear();
  }

  matchingKeys(chartId: string, baseKey: string, sheetId?: SheetId): Set<string> {
    return matchingChartRenderCacheKeys(chartId, baseKey, sheetId, [
      this.markCache.keys(),
      this.layoutCache.keys(),
      this.errorCache.keys(),
      this.chartImportRenderStatus.keys(),
      this.dirtyCharts,
      this.pendingCompilations,
    ]);
  }

  deleteKeys(keys: Iterable<string>): void {
    for (const key of keys) {
      this.markCache.delete(key);
      this.layoutCache.delete(key);
      this.errorCache.delete(key);
      this.chartImportRenderStatus.delete(key);
      this.dirtyCharts.delete(key);
      this.pendingCompilations.delete(key);
    }
  }

  invalidateKeys(keys: Iterable<string>): void {
    for (const key of keys) {
      this.errorCache.delete(key);
      this.dirtyCharts.add(key);
    }
  }

  hasMarks(key: string): boolean {
    return this.markCache.has(key);
  }

  getMarks(key: string): ChartMark[] | undefined {
    return this.markCache.get(key);
  }

  setMarks(key: string, marks: ChartMark[]): void {
    this.markCache.set(key, marks);
  }

  deleteMarks(key: string): void {
    this.markCache.delete(key);
  }

  getLayout(key: string): ChartLayoutSnapshot | undefined {
    return this.layoutCache.get(key);
  }

  setLayout(key: string, layout: ChartLayoutSnapshot): void {
    this.layoutCache.set(key, layout);
  }

  deleteLayout(key: string): void {
    this.layoutCache.delete(key);
  }

  getFreshLayout(key: string): ChartLayoutSnapshot | undefined {
    const cached = this.layoutCache.get(key);
    return cached && !this.dirtyCharts.has(key) ? cached : undefined;
  }

  getError(key: string): ChartError | undefined {
    return this.errorCache.get(key);
  }

  getErrorByPrecedence(key: string, baseKey: string, chartId: string): ChartError | undefined {
    return this.errorCache.get(key) ?? this.errorCache.get(baseKey) ?? this.errorCache.get(chartId);
  }

  setError(key: string, error: ChartError): void {
    this.errorCache.set(key, error);
  }

  deleteError(key: string): void {
    this.errorCache.delete(key);
  }

  getImportRenderStatus(key: string): ImportedChartRenderStatus | undefined {
    return this.chartImportRenderStatus.get(key);
  }

  getImportRenderStatusByPrecedence(
    key: string,
    baseKey: string,
    chartId: string,
  ): ImportedChartRenderStatus | undefined {
    return (
      this.chartImportRenderStatus.get(key) ??
      this.chartImportRenderStatus.get(baseKey) ??
      this.chartImportRenderStatus.get(chartId)
    );
  }

  setImportRenderStatus(key: string, renderStatus: ImportedChartRenderStatus): void {
    this.chartImportRenderStatus.set(key, renderStatus);
  }

  deleteImportRenderStatus(key: string): boolean {
    return this.chartImportRenderStatus.delete(key);
  }

  isDirty(key: string): boolean {
    return this.dirtyCharts.has(key);
  }

  clearDirty(key: string): void {
    this.dirtyCharts.delete(key);
  }

  getDirtyKeys(): string[] {
    return Array.from(this.dirtyCharts);
  }

  beginCompilation(key: string): void {
    this.pendingCompilations.add(key);
  }

  isCompilationPending(key: string): boolean {
    return this.pendingCompilations.has(key);
  }

  isCompilationPendingByPrecedence(key: string, baseKey: string, chartId: string): boolean {
    return (
      this.pendingCompilations.has(key) ||
      this.pendingCompilations.has(baseKey) ||
      this.pendingCompilations.has(chartId)
    );
  }

  clearPending(key: string): void {
    this.pendingCompilations.delete(key);
  }

  clearPendingAliases(key: string, baseKey: string, chartId: string): void {
    this.pendingCompilations.delete(key);
    this.pendingCompilations.delete(baseKey);
    this.pendingCompilations.delete(chartId);
  }
}
