import { extractChartData, extractChartDataFromRange, type ChartData } from '@mog/charts';
import type { ChartDataResult, ChartError } from '@mog-sdk/contracts/bridges';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
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
  normalizeChartDataForRendering,
  withSourceLinkedAxisNumberFormats,
} from './chart-render-data-normalizer';
import { resolveLiveSourceLinkedAxisNumberFormats } from './chart-source-linked-axis-resolution';
import {
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
        series.name?.range,
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
      const sourceLinkedAxisFormats = await resolveLiveSourceLinkedAxisNumberFormats({
        config,
        resolvedRanges,
        hiddenVisibility,
        bridge: this.ctx.computeBridge,
      });
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
      chartType: config.type,
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
