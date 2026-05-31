import type { SheetId } from '@mog-sdk/contracts/core';

/**
 * Owns the sync paint-path chartId -> SheetId index.
 *
 * The index is intentionally one-to-one from chartId to a single SheetId.
 * Callers that know the sheet explicitly should pass it through cacheKey /
 * resolveSheetId so explicit sheet context wins over the index lookup.
 */
export class ChartSheetIndex {
  private readonly chartSheets = new Map<string, SheetId>();

  get(chartId: string): SheetId | undefined {
    return this.chartSheets.get(chartId);
  }

  has(chartId: string): boolean {
    return this.chartSheets.has(chartId);
  }

  set(chartId: string, sheetId: SheetId): void {
    this.chartSheets.set(chartId, sheetId);
  }

  delete(chartId: string): boolean {
    return this.chartSheets.delete(chartId);
  }

  clear(): void {
    this.chartSheets.clear();
  }

  resolveSheetId(chartId: string, explicitSheetId?: SheetId): SheetId | undefined {
    return explicitSheetId ?? this.chartSheets.get(chartId);
  }

  cacheKey(chartId: string, explicitSheetId?: SheetId): string {
    const sheetId = this.resolveSheetId(chartId, explicitSheetId);
    return sheetId !== undefined ? `${sheetId}::${chartId}` : chartId;
  }

  chartIdsForSheet(sheetId: SheetId): string[] {
    const chartIds: string[] = [];
    for (const [chartId, chartSheetId] of this.chartSheets) {
      if (chartSheetId === sheetId) chartIds.push(chartId);
    }
    return chartIds;
  }
}
