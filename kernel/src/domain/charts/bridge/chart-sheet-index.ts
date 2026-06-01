import type { SheetId } from '@mog-sdk/contracts/core';

/**
 * Owns the sync paint-path chartId <-> SheetId index.
 *
 * Imported/replayed workbooks can surface the same chartId on multiple sheets,
 * so sheet context is part of the identity. Unscoped lookup resolves only when
 * a chartId has exactly one known sheet; explicit sheet context always wins.
 */
export class ChartSheetIndex {
  private readonly sheetIdsByChartId = new Map<string, Set<SheetId>>();
  private readonly chartIdsBySheetId = new Map<SheetId, Set<string>>();

  get(chartId: string): SheetId | undefined {
    return this.onlySheetId(chartId);
  }

  has(chartId: string, sheetId?: SheetId): boolean {
    const sheetIds = this.sheetIdsByChartId.get(chartId);
    if (!sheetIds) return false;
    return sheetId !== undefined ? sheetIds.has(sheetId) : sheetIds.size > 0;
  }

  set(chartId: string, sheetId: SheetId): void {
    let sheetIds = this.sheetIdsByChartId.get(chartId);
    if (!sheetIds) {
      sheetIds = new Set();
      this.sheetIdsByChartId.set(chartId, sheetIds);
    }
    sheetIds.add(sheetId);

    let chartIds = this.chartIdsBySheetId.get(sheetId);
    if (!chartIds) {
      chartIds = new Set();
      this.chartIdsBySheetId.set(sheetId, chartIds);
    }
    chartIds.add(chartId);
  }

  delete(chartId: string, sheetId?: SheetId): boolean {
    if (sheetId !== undefined) {
      return this.deleteContext(chartId, sheetId);
    }

    const onlySheetId = this.onlySheetId(chartId);
    if (onlySheetId === undefined) return false;
    return this.deleteContext(chartId, onlySheetId);
  }

  deleteSheet(sheetId: SheetId): string[] {
    const deletedChartIds = this.chartIdsForSheet(sheetId);
    for (const chartId of deletedChartIds) {
      this.deleteContext(chartId, sheetId);
    }
    return deletedChartIds;
  }

  clear(): void {
    this.sheetIdsByChartId.clear();
    this.chartIdsBySheetId.clear();
  }

  resolveSheetId(chartId: string, explicitSheetId?: SheetId): SheetId | undefined {
    return explicitSheetId ?? this.onlySheetId(chartId);
  }

  cacheKey(chartId: string, explicitSheetId?: SheetId): string {
    const sheetId = this.resolveSheetId(chartId, explicitSheetId);
    return sheetId !== undefined ? `${sheetId}::${chartId}` : chartId;
  }

  chartIdsForSheet(sheetId: SheetId): string[] {
    const chartIds = this.chartIdsBySheetId.get(sheetId);
    return chartIds ? Array.from(chartIds) : [];
  }

  private onlySheetId(chartId: string): SheetId | undefined {
    const sheetIds = this.sheetIdsByChartId.get(chartId);
    if (!sheetIds || sheetIds.size !== 1) return undefined;
    for (const sheetId of sheetIds) return sheetId;
    return undefined;
  }

  private deleteContext(chartId: string, sheetId: SheetId): boolean {
    const sheetIds = this.sheetIdsByChartId.get(chartId);
    if (!sheetIds?.delete(sheetId)) return false;
    if (sheetIds.size === 0) {
      this.sheetIdsByChartId.delete(chartId);
    }

    const chartIds = this.chartIdsBySheetId.get(sheetId);
    chartIds?.delete(chartId);
    if (chartIds?.size === 0) {
      this.chartIdsBySheetId.delete(sheetId);
    }

    return true;
  }
}
