import { extractChartData, extractChartDataFromRange, type ChartData } from '@mog/charts';
import type { ChartDataResult, ChartError } from '@mog-sdk/contracts/bridges';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ChartConfig, ChartWorkbookThemeData } from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../../context/types';
import { get as getChart } from '../chart-store';
import {
  resolveChartRangeReferences,
  type ResolvedChartRangeReferences,
} from '../chart-range-references';
import { bubbleDataUnavailableError } from './chart-bubble-data-validation';
import { createCellAccessor, seriesSheetAliases } from './chart-cell-accessor';
import { toChartConfig, unsupportedChartTypeError } from './chart-config-normalizer';
import { chartDataToRows } from './chart-data-rows';
import {
  isNoFillNoLineSeriesConfig,
  normalizeChartDataForRendering,
  withSourceLinkedAxisNumberFormats,
  type SourceLinkedAxisNumberFormatResolution,
  type SourceLinkedAxisNumberFormatResolutions,
  type SourceLinkedAxisRole,
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
import {
  hasRenderablePointCache,
  hasRenderableSeries,
  withUnresolvedCacheFallback,
} from './chart-series-cache-fallback';

export {
  createCellAccessor,
  seriesSheetAliases,
  type CellAccessorOptions,
} from './chart-cell-accessor';
export { chartDataToRows } from './chart-data-rows';

export type ChartRenderData = {
  config: ChartConfig;
  data: ChartData;
};

export type ResolvedChartRenderData = ChartRenderData & {
  chart: ChartFloatingObject;
  resolvedRanges: ResolvedChartRangeReferences;
};

type ResolvedFormatBridge = {
  getResolvedFormat?: (
    sheetId: SheetId,
    row: number,
    col: number,
  ) => Promise<{ numberFormat?: string | null } | null | undefined>;
};

const GENERAL_FORMAT = 'General';
const SOURCE_LINKED_AXIS_ROLES: SourceLinkedAxisRole[] = [
  'category',
  'secondary category',
  'value',
  'secondary value',
];

function sourceLinkedAxisForRole(
  config: ChartConfig,
  role: SourceLinkedAxisRole,
): NonNullable<ChartConfig['axis']>['categoryAxis'] | undefined {
  const axis = config.axis;
  if (!axis) return undefined;
  switch (role) {
    case 'category':
      return axis.categoryAxis ?? axis.xAxis;
    case 'secondary category':
      return axis.secondaryCategoryAxis;
    case 'value':
      return axis.valueAxis ?? axis.yAxis;
    case 'secondary value':
      return axis.secondaryValueAxis ?? axis.secondaryYAxis;
  }
}

function axisGroupForRole(role: SourceLinkedAxisRole): 0 | 1 {
  return role === 'secondary category' || role === 'secondary value' ? 1 : 0;
}

function isSeriesBoundToAxis(
  series: NonNullable<ChartConfig['series']>[number] | undefined,
  axisGroup: 0 | 1,
): boolean {
  if (!series) return false;
  return axisGroup === 1 ? series.yAxisIndex === 1 : series.yAxisIndex !== 1;
}

function firstVisibleCellInRange(
  range: CellRange,
  hiddenVisibility: HiddenCellVisibility | undefined,
): { row: number; col: number } | undefined {
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      if (!isCellHidden(String(range.sheetId), row, col, hiddenVisibility)) {
        return { row, col };
      }
    }
  }
  return undefined;
}

function normalizeSourceFormatCode(formatCode: string | null | undefined): string {
  const normalized = formatCode?.trim();
  return normalized ? normalized : GENERAL_FORMAT;
}

function sourceFormatResolutionFromFormats(
  formatCodes: string[],
): SourceLinkedAxisNumberFormatResolution | undefined {
  const formatCode = formatCodes[0];
  if (!formatCode) return undefined;
  return {
    formatCode,
    missingSource: false,
    conflictingFormats: formatCodes.some((candidate) => candidate !== formatCode),
  };
}

function liveSourceRangesForAxisRole(
  config: ChartConfig,
  resolvedRanges: ResolvedChartRangeReferences,
  role: SourceLinkedAxisRole,
): CellRange[] {
  const axisGroup = axisGroupForRole(role);
  const sourceKind = role === 'category' || role === 'secondary category' ? 'categories' : 'values';
  const ranges: CellRange[] = [];

  for (const reference of resolvedRanges.seriesReferences) {
    const series = config.series?.[reference.index];
    if (!isSeriesBoundToAxis(series, axisGroup)) continue;
    if (isNoFillNoLineSeriesConfig(series)) continue;

    const range = reference[sourceKind]?.range;
    if (range) ranges.push(range);
  }

  return ranges;
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

    const data = chartDataToRows(chartRenderDataOrError.data, chartRenderDataOrError.config);

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

    const config = withUnresolvedCacheFallback(toChartConfig(chart), resolvedRanges);
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
      const sourceLinkedAxisFormats = await this.resolveLiveSourceLinkedAxisNumberFormats(
        config,
        resolvedRanges,
        hiddenVisibility,
      );
      const themedConfig = withSourceLinkedAxisNumberFormats(
        await this.withWorkbookThemeColors(renderConfig),
        sourceLinkedAxisFormats,
      );
      const normalizedData = normalizeChartDataForRendering(data, themedConfig);
      const bubbleError = bubbleDataUnavailableError(themedConfig, normalizedData, chartId);
      if (bubbleError) return bubbleError;
      return {
        config: themedConfig,
        data: normalizedData,
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

  private async resolveLiveSourceLinkedAxisNumberFormats(
    config: ChartConfig,
    resolvedRanges: ResolvedChartRangeReferences,
    hiddenVisibility: HiddenCellVisibility | undefined,
  ): Promise<SourceLinkedAxisNumberFormatResolutions | undefined> {
    const bridge = this.ctx.computeBridge as ResolvedFormatBridge | undefined;
    if (!bridge?.getResolvedFormat || !config.axis) return undefined;

    const resolutions: SourceLinkedAxisNumberFormatResolutions = {};
    await Promise.all(
      SOURCE_LINKED_AXIS_ROLES.map(async (role) => {
        if (!sourceLinkedAxisForRole(config, role)?.linkNumberFormat) return;
        const resolution = await this.resolveLiveSourceLinkedAxisNumberFormat(
          role,
          config,
          resolvedRanges,
          hiddenVisibility,
          bridge,
        );
        if (resolution) resolutions[role] = resolution;
      }),
    );

    return SOURCE_LINKED_AXIS_ROLES.some((role) => resolutions[role]) ? resolutions : undefined;
  }

  private async resolveLiveSourceLinkedAxisNumberFormat(
    role: SourceLinkedAxisRole,
    config: ChartConfig,
    resolvedRanges: ResolvedChartRangeReferences,
    hiddenVisibility: HiddenCellVisibility | undefined,
    bridge: ResolvedFormatBridge,
  ): Promise<SourceLinkedAxisNumberFormatResolution | undefined> {
    const ranges = liveSourceRangesForAxisRole(config, resolvedRanges, role);
    const formatCodes: string[] = [];

    for (const range of ranges) {
      const cell = firstVisibleCellInRange(range, hiddenVisibility);
      if (!cell) continue;
      try {
        const format = await bridge.getResolvedFormat?.(
          toSheetId(String(range.sheetId)),
          cell.row,
          cell.col,
        );
        formatCodes.push(normalizeSourceFormatCode(format?.numberFormat));
      } catch {
        // Fall back to imported caches for this axis when live format lookup fails.
      }
    }

    return sourceFormatResolutionFromFormats(formatCodes);
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
