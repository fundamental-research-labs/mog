import {
  extractChartData,
  extractChartDataFromRange,
  type CellDataAccessor,
  type ChartData,
} from '@mog/charts';
import type { ChartDataResult, ChartError } from '@mog-sdk/contracts/bridges';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { AxisType, ChartConfig } from '@mog-sdk/contracts/data/charts';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { normalizeImportedComboChart } from '../../../bridges/compute/chart-import-normalization';
import type { DocumentContext } from '../../../context/types';
import { getValue } from '../../cells/cell-reads';
import { get as getChart } from '../chart-store';
import {
  resolveChartRangeReferences,
  type ResolvedChartRangeReferences,
} from '../chart-range-references';
import {
  wireToAxisConfig,
  wireToDataLabelConfig,
  wireToLegendConfig,
  wireChartTypeToConfig,
  wireToSeriesConfigArray,
} from '../chart-type-converters';
import { normalizeChartDataForRendering } from './chart-render-data-normalizer';
import {
  isCellHidden,
  loadHiddenVisibility,
  withHiddenSeriesFiltered,
  type HiddenCellVisibility,
  type HiddenDimensionBridge,
} from './hidden-visibility';
import {
  applyWorkbookThemeColors,
  loadWorkbookThemeColorPalette,
  type ChartWorkbookThemeColorPalette,
  type WorkbookThemeBridge,
} from './theme-colors';
import {
  importedChartRenderStatusToError,
  importStatusToTerminalRenderStatus,
} from './import-render-status';

/**
 * Normalize wire AxisData to populate legacy aliases that the charts rendering
 * package reads (xAxis/yAxis/secondaryYAxis and per-axis type/show).
 */
export function normalizeAxisForRendering(
  axis: NonNullable<ChartConfig['axis']>,
): ChartConfig['axis'] {
  const normAxis = (a: (typeof axis)['categoryAxis']) =>
    a
      ? { ...a, type: (a.type ?? a.axisType) as AxisType | undefined, show: a.show ?? a.visible }
      : a;
  return {
    ...axis,
    xAxis: normAxis(axis.categoryAxis ?? axis.xAxis),
    yAxis: normAxis(axis.valueAxis ?? axis.yAxis),
    secondaryYAxis: normAxis(axis.secondaryValueAxis ?? axis.secondaryYAxis),
  };
}

function isNativeMissingChartType(
  chart: Pick<ChartFloatingObject, 'chartType' | 'importStatus'>,
): boolean {
  return (
    (chart.chartType === undefined || chart.chartType === null || chart.chartType === '') &&
    chart.importStatus === undefined
  );
}

export function unsupportedChartTypeError(
  chart: ChartFloatingObject,
  chartId: string = chart.id,
): ChartError | null {
  const normalizedChart = normalizeImportedComboChart(chart);
  const narrowedType = wireChartTypeToConfig(normalizedChart.chartType);
  if (narrowedType.type || isNativeMissingChartType(normalizedChart)) {
    return null;
  }

  return {
    code: 'INVALID_SPEC',
    message: narrowedType.diagnostics[0]?.message ?? 'Imported chart type is not supported',
    chartId,
    details: {
      chartType: normalizedChart.chartType,
      diagnostics: narrowedType.diagnostics,
    },
  };
}

/**
 * Convert a ChartFloatingObject to a ChartConfig for passing to the charts library.
 * Provides defaults for required fields that are optional in the gen type.
 */
export function toChartConfig(chart: ChartFloatingObject): ChartConfig {
  const normalizedChart = normalizeImportedComboChart(chart);
  const narrowedType = wireChartTypeToConfig(normalizedChart.chartType);
  if (!narrowedType.type && !isNativeMissingChartType(normalizedChart)) {
    throw new Error(narrowedType.diagnostics[0]?.message ?? 'Imported chart type is not supported');
  }

  return {
    type: narrowedType.type ?? 'bar',
    anchorRow: normalizedChart.anchor.anchorRow,
    anchorCol: normalizedChart.anchor.anchorCol,
    width: normalizedChart.widthCells ?? normalizedChart.width ?? 4,
    height: normalizedChart.heightCells ?? normalizedChart.height ?? 10,
    dataRange: normalizedChart.dataRange ?? '',
    seriesRange: normalizedChart.seriesRange,
    categoryRange: normalizedChart.categoryRange,
    seriesOrientation: normalizedChart.seriesOrientation as ChartConfig['seriesOrientation'],
    title: normalizedChart.title,
    subtitle: normalizedChart.subtitle,
    // Narrow wire shapes to public *Config at the boundary — see
    // chart-type-converters.ts for why this is not a cast.
    legend: normalizedChart.legend ? wireToLegendConfig(normalizedChart.legend) : undefined,
    axis: normalizedChart.axis
      ? normalizeAxisForRendering(wireToAxisConfig(normalizedChart.axis))
      : undefined,
    colors: normalizedChart.colors,
    series: normalizedChart.series ? wireToSeriesConfigArray(normalizedChart.series) : undefined,
    dataLabels: normalizedChart.dataLabels
      ? wireToDataLabelConfig(normalizedChart.dataLabels)
      : undefined,
    pieSlice: normalizedChart.pieSlice,
    trendline: Array.isArray(normalizedChart.trendline)
      ? normalizedChart.trendline[0]
      : normalizedChart.trendline,
    trendlines: normalizedChart.trendline,
    showLines: normalizedChart.showLines,
    smoothLines: normalizedChart.smoothLines,
    radarFilled: normalizedChart.radarFilled,
    radarMarkers: normalizedChart.radarMarkers,
    waterfall: normalizedChart.waterfall as ChartConfig['waterfall'],
    displayBlanksAs: normalizedChart.displayBlanksAs as ChartConfig['displayBlanksAs'],
    plotVisibleOnly: normalizedChart.plotVisibleOnly,
    gapWidth: normalizedChart.gapWidth,
    overlap: normalizedChart.overlap,
    doughnutHoleSize: normalizedChart.doughnutHoleSize,
    firstSliceAngle: normalizedChart.firstSliceAngle,
    bubbleScale: normalizedChart.bubbleScale,
    splitType: normalizedChart.splitType as ChartConfig['splitType'],
    splitValue: normalizedChart.splitValue,
    style: normalizedChart.style,
    chartFormat: normalizedChart.chartFormat as ChartConfig['chartFormat'],
    plotFormat: normalizedChart.plotFormat as ChartConfig['plotFormat'],
    titleFormat: normalizedChart.titleFormat as ChartConfig['titleFormat'],
    subType: normalizedChart.subType as ChartConfig['subType'],
    extra: normalizedChart.ooxml,
  };
}

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
          valueMap.set(key, null);
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
      if (isCellHidden(resolvedSheetId, row, col, options?.hiddenVisibility)) return null;
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
      rows.push({
        category: String(category),
        value: point.y,
        series: series.name,
      });
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

export class ChartDataResolver {
  /** Workbook theme color palette used to resolve imported chart scheme colors. */
  private workbookThemeColorPalettePromise: Promise<ChartWorkbookThemeColorPalette | null> | null =
    null;

  constructor(private readonly ctx: DocumentContext) {}

  clearWorkbookThemeColorCache(): void {
    this.workbookThemeColorPalettePromise = null;
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
    const hasExplicitSeriesValues = config.series?.some((series) => series.values?.trim());

    if (hasExplicitSeriesValues) {
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

      if (valueRanges.length === 0) {
        return {
          code: 'DATA_UNAVAILABLE',
          message:
            resolvedRanges.diagnostics[0]?.message ?? 'Chart series value ranges are unavailable',
          chartId,
        };
      }

      const accessor = await createCellAccessor(this.ctx, seriesRanges, {
        defaultSheetId: chart.sheetId ? toSheetId(chart.sheetId) : undefined,
        sheetAliases: seriesSheetAliases(resolvedRanges),
        hiddenVisibility,
      });
      const data = extractChartData(accessor, renderConfig);
      const themedConfig = await this.withWorkbookThemeColors(renderConfig);
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
    const themedConfig = await this.withWorkbookThemeColors(config);
    return {
      config: themedConfig,
      data: normalizeChartDataForRendering(data, themedConfig),
    };
  }

  private async withWorkbookThemeColors(config: ChartConfig): Promise<ChartConfig> {
    return applyWorkbookThemeColors(config, () => this.getWorkbookThemeColorPalette());
  }

  private async getWorkbookThemeColorPalette(): Promise<ChartWorkbookThemeColorPalette | null> {
    this.workbookThemeColorPalettePromise ??= loadWorkbookThemeColorPalette(
      this.ctx.computeBridge as WorkbookThemeBridge | undefined,
    );
    return this.workbookThemeColorPalettePromise;
  }
}
