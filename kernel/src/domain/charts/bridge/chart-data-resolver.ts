import {
  HIDDEN_CHART_CELL,
  extractChartData,
  extractChartDataFromRange,
  seriesSourceIndex,
  seriesSourceKey,
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
    for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
      const series = data.series[seriesIndex];
      const point = series.data[i];
      if (!point) continue;
      if (point.valueState === 'hidden') continue;
      const row: Record<string, unknown> = {
        category: String(category),
        x: point.x,
        y: point.y,
        value: point.y,
        series: series.name,
        sourceSeriesIndex: seriesSourceIndex(series, seriesIndex),
        sourceSeriesKey: seriesSourceKey(series, seriesIndex),
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

function hasBubbleDimensionSource(
  ref: string | undefined,
  cache: NonNullable<ChartConfig['series']>[number]['valueCache'],
): boolean {
  return Boolean(ref?.trim()) || hasRenderablePointCache(cache);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function hasRenderableBubblePoint(
  point: ChartData['series'][number]['data'][number] | undefined,
  config: ChartConfig,
): boolean {
  if (!point || (point.valueState && point.valueState !== 'value')) return false;
  const x = finiteNumber(point.x);
  const y = finiteNumber(point.y);
  const size = finiteNumber(point.size);
  if (x === undefined || y === undefined || size === undefined) return false;
  return config.showNegBubbles === true || size > 0;
}

function bubbleDataUnavailableError(
  config: ChartConfig,
  data: ChartData,
  chartId: string,
): ChartError | null {
  if (config.type !== 'bubble') return null;
  if (
    data.series.some((series) =>
      series.data.some((point) => hasRenderableBubblePoint(point, config)),
    )
  ) {
    return null;
  }

  const seriesConfigs = config.series ?? [];
  const missingDimensions: string[] = [];
  if (!seriesConfigs.some((series) => hasBubbleDimensionSource(series.values, series.valueCache))) {
    missingDimensions.push('y values');
  }
  if (
    !seriesConfigs.some((series) =>
      hasBubbleDimensionSource(series.categories, series.categoryCache),
    )
  ) {
    missingDimensions.push('x values');
  }
  if (
    !seriesConfigs.some((series) =>
      hasBubbleDimensionSource(series.bubbleSize, series.bubbleSizeCache),
    )
  ) {
    missingDimensions.push('bubble sizes');
  }

  if (missingDimensions.length > 0) {
    return {
      code: 'DATA_UNAVAILABLE',
      message: `Bubble chart data is missing ${missingDimensions.join(', ')}`,
      chartId,
    };
  }

  const points = data.series.flatMap((series) => series.data);
  const allPointsHidden =
    points.length > 0 && points.every((point) => point?.valueState === 'hidden');
  return {
    code: 'DATA_UNAVAILABLE',
    message: allPointsHidden
      ? 'Bubble chart has no renderable points because all points are hidden'
      : 'Bubble chart has no renderable points after filtering invalid x, y, or size values',
    chartId,
  };
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
