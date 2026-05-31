import {
  HIDDEN_CHART_CELL,
  extractChartData,
  extractChartDataFromRange,
  type CellDataAccessor,
  type ChartData,
} from '@mog/charts';
import type { ChartDataResult, ChartError } from '@mog-sdk/contracts/bridges';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ChartConfig, ChartWorkbookThemeData } from '@mog-sdk/contracts/data/charts';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import { getValue } from '../../cells/cell-reads';
import { get as getChart } from '../chart-store';
import {
  resolveChartRangeReferences,
  type ResolvedChartRangeReferences,
} from '../chart-range-references';
import { toChartConfig, unsupportedChartTypeError } from './chart-config-normalizer';
import {
  normalizeChartDataForRendering,
  withSourceLinkedAxisNumberFormats,
} from './chart-render-data-normalizer';
import {
  isCellHidden,
  loadHiddenVisibility,
  withHiddenSeriesFiltered,
  type HiddenCellVisibility,
  type HiddenDimensionBridge,
} from './hidden-visibility';
import {
  applyWorkbookThemeColors,
  loadWorkbookTheme,
  type WorkbookThemeBridge,
} from './theme-colors';
import {
  importedChartRenderStatusToError,
  importStatusToTerminalRenderStatus,
} from './import-render-status';

export type ChartRenderData = {
  config: ChartConfig;
  data: ChartData;
};

export type ResolvedChartRenderData = ChartRenderData & {
  chart: ChartFloatingObject;
  resolvedRanges: ResolvedChartRangeReferences;
};

export type CellAccessorOptions = {
  defaultSheetId?: SheetId;
  sheetAliases?: Map<string, string>;
  hiddenVisibility?: HiddenCellVisibility;
};

/**
 * Create a CellDataAccessor for the charts library.
 * Pre-fetches cell values into a map since the charts library expects sync access.
 */
export async function createCellAccessor(
  ctx: DocumentContext,
  ranges: Array<CellRange | null | undefined>,
  options?: CellAccessorOptions,
): Promise<CellDataAccessor> {
  const valueMap = new Map<string, ReturnType<CellDataAccessor['getValue']>>();
  const seen = new Set<string>();

  for (const range of ranges) {
    if (!range?.sheetId) continue;
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        const key = `${range.sheetId},${row},${col}`;
        if (seen.has(key)) continue;
        seen.add(key);

        if (isCellHidden(range.sheetId, row, col, options?.hiddenVisibility)) {
          valueMap.set(key, HIDDEN_CHART_CELL);
          continue;
        }

        const value = await getValue(ctx, toSheetId(range.sheetId), row, col);
        // CellError values are converted to null for chart data extraction.
        let chartValue: ReturnType<CellDataAccessor['getValue']>;
        if (value && typeof value === 'object' && 'type' in value) {
          chartValue = null;
        } else {
          chartValue = (value ?? null) as ReturnType<CellDataAccessor['getValue']>;
        }
        valueMap.set(key, chartValue);
      }
    }
  }

  return {
    getValue: (row: number, col: number, sheetId?: string) => {
      const resolvedSheetId = sheetId
        ? (options?.sheetAliases?.get(sheetId) ?? sheetId)
        : options?.defaultSheetId;
      if (!resolvedSheetId) return null;
      if (isCellHidden(resolvedSheetId, row, col, options?.hiddenVisibility)) {
        return HIDDEN_CHART_CELL;
      }
      return valueMap.get(`${resolvedSheetId},${row},${col}`) ?? null;
    },
  };
}

export function chartDataToRows(data: ChartData): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < (data.categories?.length || 0); i++) {
    const category = data.categories[i];
    for (const series of data.series) {
      const point = series.data[i];
      if (!point) continue;
      if (point.valueState === 'hidden') continue;
      const row: Record<string, unknown> = {
        category: String(category),
        x: point.x,
        y: point.y,
        value: point.y,
        series: series.name,
      };
      if (point.size !== undefined) row.size = point.size;
      if (point.open !== undefined) row.open = point.open;
      if (point.high !== undefined) row.high = point.high;
      if (point.low !== undefined) row.low = point.low;
      if (point.close !== undefined) row.close = point.close;
      if (point.volume !== undefined) row.volume = point.volume;
      rows.push(row);
    }
  }
  return rows;
}

export function seriesSheetAliases(
  resolvedRanges: ResolvedChartRangeReferences,
): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const series of resolvedRanges.seriesReferences) {
    for (const reference of [series.values, series.categories, series.bubbleSizes]) {
      const parsed = reference?.ref ? parseCellRange(reference.ref) : null;
      if (parsed?.sheetName && reference?.range.sheetId) {
        aliases.set(parsed.sheetName, String(reference.range.sheetId));
      }
    }
  }
  return aliases;
}

function hasRenderableSeries(series: NonNullable<ChartConfig['series']>[number]): boolean {
  return Boolean(series.values?.trim()) || hasRenderablePointCache(series.valueCache);
}

function hasRenderablePointCache(
  cache: NonNullable<ChartConfig['series']>[number]['valueCache'],
): boolean {
  if (!cache) return false;
  if (
    typeof cache.pointCount === 'number' &&
    Number.isInteger(cache.pointCount) &&
    cache.pointCount > 0
  ) {
    return true;
  }
  return cache.points.some((point) => point.idx >= 0);
}

export class ChartDataResolver {
  /** Full workbook theme context passed through to charts-core style resolution. */
  private workbookThemePromise: Promise<ChartWorkbookThemeData | null> | null = null;

  constructor(private readonly ctx: DocumentContext) {}

  clearWorkbookThemeColorCache(): void {
    this.workbookThemePromise = null;
  }

  clearCaches(): void {
    this.clearWorkbookThemeColorCache();
  }

  async resolveChartData(sheetId: SheetId, chartId: string): Promise<ChartDataResult> {
    const chartRenderDataOrError = await this.resolveForRendering(sheetId, chartId);
    if ('code' in chartRenderDataOrError) {
      return {
        success: false,
        error: chartRenderDataOrError,
      };
    }

    const data = chartDataToRows(chartRenderDataOrError.data);

    if (data.length === 0) {
      return {
        success: false,
        error: {
          code: 'EMPTY_DATA',
          message: 'Chart data range is empty',
          chartId,
        },
      };
    }

    return { success: true, data };
  }

  async resolveForRendering(
    sheetId: SheetId,
    chartId: string,
  ): Promise<ResolvedChartRenderData | ChartError> {
    const chart = await getChart(this.ctx, sheetId, chartId);
    if (!chart) {
      return {
        code: 'CHART_NOT_FOUND',
        message: 'Chart not found',
        chartId,
      };
    }

    const terminalImportStatus = importStatusToTerminalRenderStatus(chart.importStatus);
    if (terminalImportStatus) {
      return importedChartRenderStatusToError(chartId, terminalImportStatus);
    }

    const resolvedRanges = await resolveChartRangeReferences(this.ctx, chart);
    const chartRenderDataOrError = await this.resolveChartDataForRendering(
      chart,
      resolvedRanges,
      chartId,
    );
    if ('code' in chartRenderDataOrError) return chartRenderDataOrError;

    return {
      chart,
      resolvedRanges,
      ...chartRenderDataOrError,
    };
  }

  async resolveChartDataForRendering(
    chart: ChartFloatingObject,
    resolvedRanges: ResolvedChartRangeReferences,
    chartId: string,
  ): Promise<ChartRenderData | ChartError> {
    const chartTypeError = unsupportedChartTypeError(chart, chartId);
    if (chartTypeError) return chartTypeError;

    const config = toChartConfig(chart);
    const hasRenderableSeriesData = config.series?.some((series) => hasRenderableSeries(series));

    if (hasRenderableSeriesData) {
      const seriesRanges = resolvedRanges.seriesReferences.flatMap((series) => [
        series.values?.range,
        series.categories?.range,
        series.bubbleSizes?.range,
      ]);
      const hiddenVisibility = config.plotVisibleOnly
        ? await loadHiddenVisibility(
            seriesRanges,
            this.ctx.computeBridge as HiddenDimensionBridge | undefined,
          )
        : undefined;
      const renderConfig = hiddenVisibility
        ? withHiddenSeriesFiltered(config, resolvedRanges, hiddenVisibility)
        : config;
      const valueRanges = resolvedRanges.seriesReferences
        .map((series) => series.values?.range)
        .filter(Boolean);

      const hasCacheBackedValues = renderConfig.series?.some((series) =>
        hasRenderablePointCache(series.valueCache),
      );
      if (valueRanges.length === 0 && !hasCacheBackedValues) {
        return {
          code: 'DATA_UNAVAILABLE',
          message:
            resolvedRanges.diagnostics[0]?.message ?? 'Chart series value data is unavailable',
          chartId,
        };
      }

      const accessor = await createCellAccessor(this.ctx, seriesRanges, {
        defaultSheetId: chart.sheetId ? toSheetId(chart.sheetId) : undefined,
        sheetAliases: seriesSheetAliases(resolvedRanges),
        hiddenVisibility,
      });
      const data = extractChartData(accessor, renderConfig);
      const themedConfig = withSourceLinkedAxisNumberFormats(
        await this.withWorkbookThemeColors(renderConfig),
      );
      return {
        config: themedConfig,
        data: normalizeChartDataForRendering(data, themedConfig),
      };
    }

    const dataRange = resolvedRanges.dataRange?.range;
    if (!dataRange) {
      return {
        code: 'DATA_UNAVAILABLE',
        message: resolvedRanges.diagnostics[0]?.message ?? 'Chart data range is unavailable',
        chartId,
      };
    }

    const dataRanges = [
      dataRange,
      resolvedRanges.categoryRange?.range,
      resolvedRanges.seriesRange?.range,
    ];
    const hiddenVisibility = config.plotVisibleOnly
      ? await loadHiddenVisibility(
          dataRanges,
          this.ctx.computeBridge as HiddenDimensionBridge | undefined,
        )
      : undefined;
    const cellAccessor = await createCellAccessor(this.ctx, dataRanges, { hiddenVisibility });
    const data = extractChartDataFromRange(cellAccessor, dataRange, {
      categoryRange: resolvedRanges.categoryRange?.range,
      seriesRange: resolvedRanges.seriesRange?.range,
      seriesOrientation: chart.seriesOrientation as ChartConfig['seriesOrientation'],
    });
    const themedConfig = withSourceLinkedAxisNumberFormats(
      await this.withWorkbookThemeColors(config),
    );
    return {
      config: themedConfig,
      data: normalizeChartDataForRendering(data, themedConfig),
    };
  }

  private async withWorkbookThemeColors(config: ChartConfig): Promise<ChartConfig> {
    return applyWorkbookThemeColors(config, () => this.getWorkbookTheme());
  }

  private async getWorkbookTheme(): Promise<ChartWorkbookThemeData | null> {
    this.workbookThemePromise ??= loadWorkbookTheme(
      this.ctx.computeBridge as WorkbookThemeBridge | undefined,
    );
    return this.workbookThemePromise;
  }
}
