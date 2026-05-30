/**
 * Chart Bridge
 *
 * Bridges the standalone charts library (@mog/charts) to the engine.
 * This bridge handles:
 * - Compiled marks caching (invalidated on data/spec changes)
 * - EventBus subscriptions for reactive updates
 * - Error state management
 * - Data resolution from CellIdRange to actual values
 *
 * Paint is synchronous — see `renderCached` / `onCacheUpdate` /
 * `ensureCompiled`. Mark compilation is async (data fetch + extract +
 * compile, all real work) but never executes on the paint path; the cache
 * breaks the coupling. The shape mirrors `ImageCache.getImage` / `onLoad`
 * for pictures: async producer, sync consumer, listener-driven repaint.
 *
 * Do NOT re-async `renderCached`: the canvas dispatch loop is sync and
 * applies a `(viewport.x, viewport.y)` translate around every floating
 * object's paint. An async paint method's `await` chain resolves after the
 * engine has restored that translate, and the chart paints in the wrong
 * canvas frame. The async chart paint canvas-state invariant depends on
 * this remaining synchronous.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md (sections 7, 8)
 */

import {
  collectMarks,
  compile,
  configToSpec,
  extractChartData,
  extractChartDataFromRange,
  renderMark,
  type CellDataAccessor,
  type ChartData,
  type ChartDataPoint,
  type ChartDataSeries,
  type CompileResult,
  type DataRow,
} from '@mog/charts';
import type {
  ChartBounds,
  ChartDataResult,
  ChartError,
  ChartErrorCode,
  ChartLayoutRect,
  ChartLayoutSnapshot,
  ChartMark,
  ChartRenderSnapshot,
  IChartBridge,
} from '@mog-sdk/contracts/bridges';
import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  AxisType,
  ChartConfig,
  ChartExportOptionsSnapshot,
  ChartType,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';
import type {
  CellChangedEvent,
  CellsBatchChangedEvent,
  ChartUpdatedEvent,
  FloatingObjectCreatedEvent,
  FloatingObjectDeletedEvent,
  FloatingObjectUpdatedEvent,
  RowsInsertedEvent,
  RowsDeletedEvent,
  ColumnsInsertedEvent,
  ColumnsDeletedEvent,
  SheetDeletedEvent,
} from '@mog-sdk/contracts/events';
import { parseCellRange, cellRangeToA1 } from '@mog/spreadsheet-utils/a1';
import { getValue } from '../cells/cell-reads';
import * as Charts from './chart-crud';
import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { normalizeImportedComboChart } from '../../bridges/compute/chart-import-normalization';
import {
  wireToAxisConfig,
  wireToDataLabelConfig,
  wireToLegendConfig,
  wireToSeriesConfigArray,
} from './chart-type-converters';

import type { DocumentContext } from '../../context/types';

// =============================================================================
// Chart Layout Types — the narrow ChartLayoutSnapshot used by this
// bridge now lives in contracts so IChartBridge can declare the same return
// type. See contracts/src/bridges/chart-bridge.ts.
// =============================================================================

/**
 * Normalize wire AxisData to populate legacy aliases that the charts rendering
 * package reads (xAxis/yAxis/secondaryYAxis and per-axis type/show).
 */
function normalizeAxisForRendering(axis: NonNullable<ChartConfig['axis']>): ChartConfig['axis'] {
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

/**
 * Fields that represent position/layout-only changes on a floating object.
 * Updates containing only these fields do not affect compiled chart marks
 * (data, axes, series, legends, etc.) and should not trigger cache invalidation.
 */
const POSITION_ONLY_FIELDS = new Set([
  'anchorRow',
  'anchorCol',
  'anchorRowOffset',
  'anchorColOffset',
  'anchorRowOffsetEmu',
  'anchorColOffsetEmu',
  'endRow',
  'endCol',
  'endRowOffset',
  'endColOffset',
  'endRowOffsetEmu',
  'endColOffsetEmu',
  'extentCx',
  'extentCy',
  'extentCxEmu',
  'extentCyEmu',
  'width',
  'height',
  'offsetX',
  'offsetY',
  'rotation',
  'zIndex',
]);

type FloatingObjectWithImportStatus = {
  type?: unknown;
  importStatus?: unknown;
};

type ImportedChartRenderStatus = {
  terminal: true;
  message: string;
  raw: unknown;
};

type HiddenCellVisibility = {
  hiddenRowsBySheet: Map<string, Set<number>>;
  hiddenColsBySheet: Map<string, Set<number>>;
};

type HiddenDimensionBridge = {
  getHiddenRows?: (sheetId: SheetId) => Promise<number[]>;
  getHiddenColumns?: (sheetId: SheetId) => Promise<number[]>;
};

/**
 * Returns true if changedFields contains only position/layout fields.
 * Returns false for empty or undefined fields (safe default: invalidate on unknown changes).
 */
export function isPositionOnlyUpdate(fields: string[]): boolean {
  return fields.length > 0 && fields.every((f) => POSITION_ONLY_FIELDS.has(f));
}

function hasImportStatus(value: unknown): value is { importStatus: unknown } {
  return typeof value === 'object' && value !== null && 'importStatus' in value;
}

function isChartPayload(value: unknown): value is FloatingObjectWithImportStatus {
  return (
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'chart'
  );
}

function stringField(value: unknown, keys: string[]): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === 'string' && field.trim()) return field.trim();
  }
  return undefined;
}

function booleanField(value: unknown, keys: string[]): boolean | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === 'boolean') return field;
  }
  return undefined;
}

function importStatusToTerminalRenderStatus(status: unknown): ImportedChartRenderStatus | null {
  if (status === null || status === undefined) return null;

  const tokenSource =
    typeof status === 'string'
      ? status
      : stringField(status, [
          'state',
          'status',
          'kind',
          'code',
          'result',
          'recoverability',
          'renderability',
        ]);
  const token = tokenSource
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  const renderable = booleanField(status, ['renderable', 'canRender']);
  const terminal = booleanField(status, ['terminal', 'isTerminal']);
  const normalTokens = ['renderable', 'ready', 'ok', 'success', 'loaded', 'native'];
  const terminalTokens = [
    'nonrenderable',
    'notrenderable',
    'preservednotrenderable',
    'unsupported',
    'unsupportedchart',
    'unsupportedcharttype',
    'placeholder',
    'terminal',
    'failed',
    'error',
  ];

  const isTerminal =
    renderable === false ||
    (terminal === true && token !== undefined && !normalTokens.includes(token)) ||
    (token !== undefined && terminalTokens.includes(token));
  if (!isTerminal) return null;

  const message =
    stringField(status, ['message', 'label', 'reason', 'description']) ??
    'Imported chart cannot be rendered';
  return { terminal: true, message, raw: status };
}

function isCellHidden(
  sheetId: string | undefined,
  row: number,
  col: number,
  visibility: HiddenCellVisibility | undefined,
): boolean {
  if (!sheetId || !visibility) return false;
  const key = String(sheetId);
  return (
    (visibility.hiddenRowsBySheet.get(key)?.has(row) ?? false) ||
    (visibility.hiddenColsBySheet.get(key)?.has(col) ?? false)
  );
}

function isRangeFullyHidden(range: CellRange, visibility: HiddenCellVisibility): boolean {
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      if (!isCellHidden(range.sheetId, row, col, visibility)) return false;
    }
  }
  return true;
}

/**
 * Convert a ChartFloatingObject to a ChartConfig for passing to the charts library.
 * Provides defaults for required fields that are optional in the gen type.
 */
function toChartConfig(chart: ChartFloatingObject): ChartConfig {
  const normalizedChart = normalizeImportedComboChart(chart);
  return {
    type: (normalizedChart.chartType ?? 'bar') as ChartType,
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

type CompilerPathId = ResolvedChartSpecSnapshot['implementation']['compilerPathId'];
type AxisSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['axes']['category']>;
type RangeSnapshot = NonNullable<ResolvedChartSpecSnapshot['resolved']['ranges']['dataRange']>;

type ChartRenderData = {
  config: ChartConfig;
  data: ChartData;
};

function withCategoryFormatCodes(data: ChartData, config: ChartConfig): ChartData {
  const categoryLabelFormat = config.series?.find(
    (series) => series.categoryLabelFormat,
  )?.categoryLabelFormat;
  if (!categoryLabelFormat) return data;

  const categoryFormatCodes = data.categories.map(() => categoryLabelFormat.formatCode ?? null);
  for (const point of categoryLabelFormat.points ?? []) {
    if (point.idx >= 0 && point.idx < categoryFormatCodes.length && point.formatCode) {
      categoryFormatCodes[point.idx] = point.formatCode;
    }
  }

  return categoryFormatCodes.some(Boolean) ? { ...data, categoryFormatCodes } : data;
}

function hasVisibleChartLineStyle(line: unknown): boolean {
  if (!line || typeof line !== 'object') return false;
  const candidate = line as { color?: unknown; width?: unknown };
  return candidate.color !== undefined || candidate.width !== undefined;
}

function isNoFillNoLineSeriesConfig(
  series: NonNullable<ChartConfig['series']>[number] | undefined,
): boolean {
  if (!series?.format) return false;
  return series.format.fill?.type === 'none' && !hasVisibleChartLineStyle(series.format.line);
}

function isBlankChartScalar(value: string | number | null | undefined): boolean {
  return value === null || value === undefined || value === '';
}

function isBlankChartPoint(point: ChartDataPoint | undefined): boolean {
  if (!point) return true;
  return point.valueState === 'blank';
}

type ImportedPointCache = {
  pointCount?: unknown;
  points?: unknown;
};

type ImportedPointCachePoint = {
  idx?: unknown;
  value?: unknown;
};

function importedCategoryCache(
  series: NonNullable<ChartConfig['series']>[number] | undefined,
): ImportedPointCache | undefined {
  if (!series || typeof series !== 'object') return undefined;
  const cache = (series as { categoryCache?: unknown }).categoryCache;
  return cache && typeof cache === 'object' ? (cache as ImportedPointCache) : undefined;
}

function importedCachePointCount(cache: ImportedPointCache | undefined): number | undefined {
  const pointCount = cache?.pointCount;
  return typeof pointCount === 'number' && Number.isInteger(pointCount) && pointCount >= 0
    ? pointCount
    : undefined;
}

function importedCachePoint(
  cache: ImportedPointCache | undefined,
  pointIndex: number,
): ImportedPointCachePoint | undefined {
  const points = Array.isArray(cache?.points) ? cache.points : [];
  return points.find((point): point is ImportedPointCachePoint => {
    if (!point || typeof point !== 'object') return false;
    return (point as ImportedPointCachePoint).idx === pointIndex;
  });
}

function importedCategoryCacheValue(
  cache: ImportedPointCache | undefined,
  pointIndex: number,
): string | number | undefined {
  const point = importedCachePoint(cache, pointIndex);
  if (!point) return undefined;
  const value = point.value;
  if (value === null || value === undefined || value === '') return '';
  const numeric = Number(value);
  return Number.isFinite(numeric) && String(value).trim() !== '' ? numeric : String(value);
}

function normalizeImportedCategoryData(data: ChartData, config: ChartConfig): ChartData {
  const seriesConfig = config.series?.find(
    (series) => Boolean(series.categories) || importedCategoryCache(series),
  );
  if (!seriesConfig) return data;

  const categoryCache = importedCategoryCache(seriesConfig);
  const categoryPointCount = importedCachePointCount(categoryCache);
  if (!categoryCache && !seriesConfig.categories) return data;

  const maxLength = Math.max(
    data.categories.length,
    ...data.series.map((series) => series.data.length),
  );
  if (maxLength <= 0) return data;

  let changed = false;
  const categories: Array<string | number> = [];
  for (let pointIndex = 0; pointIndex < maxLength; pointIndex += 1) {
    const cached = importedCategoryCacheValue(categoryCache, pointIndex);
    const isOmittedCachedPoint =
      cached === undefined &&
      categoryPointCount !== undefined &&
      pointIndex >= 0 &&
      pointIndex < categoryPointCount;
    const isBeyondCachedDomain =
      categoryPointCount !== undefined &&
      pointIndex >= categoryPointCount &&
      data.series.every((series) => isBlankChartPoint(series.data[pointIndex]));
    const current =
      data.categories[pointIndex] ??
      data.series.find((series) => series.data[pointIndex])?.data[pointIndex]?.x ??
      '';
    const next = cached ?? (isOmittedCachedPoint || isBeyondCachedDomain ? '' : current);
    categories.push(next);
    if (next !== data.categories[pointIndex]) changed = true;
  }

  const series = data.series.map((item) => ({
    ...item,
    data: item.data.map((point, pointIndex) => {
      const category = categories[pointIndex];
      if (!point || point.x === category) return point;
      changed = true;
      return { ...point, x: category, name: String(category) };
    }),
  }));

  return changed ? { ...data, categories, series } : data;
}

function trimTrailingBlankChartData(data: ChartData): ChartData {
  let lastIndex = Math.max(
    data.categories.length,
    ...data.series.map((series) => series.data.length),
  ) - 1;

  while (
    lastIndex >= 0 &&
    isBlankChartScalar(data.categories[lastIndex]) &&
    data.series.every((series) => isBlankChartPoint(series.data[lastIndex]))
  ) {
    lastIndex -= 1;
  }

  if (lastIndex < 0) return { ...data, categories: [], series: [] };
  if (
    lastIndex === data.categories.length - 1 &&
    data.series.every((series) => lastIndex === series.data.length - 1)
  ) {
    return data;
  }

  return {
    ...data,
    categories: data.categories.slice(0, lastIndex + 1),
    ...(data.categoryFormatCodes
      ? { categoryFormatCodes: data.categoryFormatCodes.slice(0, lastIndex + 1) }
      : {}),
    series: data.series.map((series) => ({
      ...series,
      data: series.data.slice(0, lastIndex + 1),
    })),
  };
}

function normalizeChartDataForRendering(data: ChartData, config: ChartConfig): ChartData {
  return trimTrailingBlankChartData(
    normalizeImportedCategoryData(withCategoryFormatCodes(data, config), config),
  );
}

function defaultExportOptionsForSize(width: number, height: number): ChartExportOptionsSnapshot {
  return {
    format: 'png',
    width,
    height,
    pixelRatio: 1,
    physicalWidth: Math.max(1, Math.round(width)),
    physicalHeight: Math.max(1, Math.round(height)),
    backgroundColor: '#ffffff',
  };
}

function buildResolvedChartSpecSnapshot(input: {
  chart: ChartFloatingObject;
  sheetId: SheetId;
  config: ChartConfig;
  chartData: ChartData;
  resolvedRanges: Charts.ResolvedChartRangeReferences;
  exportOptions: ChartExportOptionsSnapshot;
  compilerPathId: CompilerPathId;
  compilerInputHash: string;
}): ResolvedChartSpecSnapshot {
  const categories = input.chartData.categories.map(snapshotScalar);
  const hasExplicitSeriesReferences =
    input.config.series?.some((item) =>
      Boolean(item.values || item.categories || item.bubbleSize),
    ) ?? false;
  const series = input.chartData.series.map((dataSeries, index) =>
    snapshotSeries(dataSeries, index, categories, input.config, hasExplicitSeriesReferences),
  );
  const legend = snapshotLegend(input.config, series);

  return {
    schemaVersion: 1,
    chartId: input.chart.id,
    sheetId: String(input.sheetId),
    chartObject: {
      id: input.chart.id,
      name: input.chart.name,
      anchorRow: input.chart.anchor?.anchorRow,
      anchorCol: input.chart.anchor?.anchorCol,
      width: input.chart.widthCells ?? input.chart.width,
      height: input.chart.heightCells ?? input.chart.height,
      widthPt: input.chart.widthPt,
      heightPt: input.chart.heightPt,
    },
    export: input.exportOptions,
    implementation: {
      renderAuthority: 'chartBridge',
      renderStatus: 'renderable',
      compilerPathId: input.compilerPathId,
      compilerInputHash: input.compilerInputHash,
      compilerVersion: 1,
    },
    resolved: {
      chartType: input.config.type,
      subType: input.config.subType,
      grouping: groupingFor(input.config),
      title: {
        present: titleText(input.config) !== undefined,
        text: titleText(input.config),
      },
      legend,
      axes: {
        category: snapshotAxis(input.config.axis?.categoryAxis ?? input.config.axis?.xAxis),
        value: snapshotAxis(input.config.axis?.valueAxis ?? input.config.axis?.yAxis),
        secondaryCategory: snapshotAxis(input.config.axis?.secondaryCategoryAxis),
        secondaryValue: snapshotAxis(
          input.config.axis?.secondaryValueAxis ?? input.config.axis?.secondaryYAxis,
        ),
      },
      series,
      categories,
      plot: {
        displayBlanksAs: input.config.displayBlanksAs,
        plotVisibleOnly: input.config.plotVisibleOnly,
        gapWidth: input.config.gapWidth,
        overlap: input.config.overlap,
      },
      ranges: {
        dataRange: snapshotRange(input.resolvedRanges.dataRange),
        categoryRange: snapshotRange(input.resolvedRanges.categoryRange),
        seriesRange: snapshotRange(input.resolvedRanges.seriesRange),
        seriesReferences: input.resolvedRanges.seriesReferences.map((seriesReference) => ({
          index: seriesReference.index,
          values: snapshotRange(seriesReference.values),
          categories: snapshotRange(seriesReference.categories),
        })),
        diagnostics: input.resolvedRanges.diagnostics.map((diagnostic) => ({
          kind: diagnostic.kind,
          code: diagnostic.code,
          ref: diagnostic.ref,
          sheetName: diagnostic.sheetName,
          message: diagnostic.message,
        })),
      },
      dataHashes: {
        categoriesHash: hashJson(categories),
        seriesHash: hashJson(series),
      },
    },
    diagnostics: {
      compiler: input.resolvedRanges.diagnostics.map((diagnostic) => diagnostic.message),
      unsupportedFeatures: unsupportedFeatureDiagnostics(input.config),
    },
  };
}

function snapshotAxis(
  axis: NonNullable<ChartConfig['axis']>['categoryAxis'],
): AxisSnapshot | undefined {
  if (!axis) return undefined;
  return {
    present: true,
    visible: axis.visible ?? axis.show,
    title: axis.title,
    axisType: axis.axisType ?? axis.type,
    scaleType: axis.scaleType,
    categoryType: axis.categoryType,
    min: axis.min,
    max: axis.max,
    majorUnit: axis.majorUnit,
    minorUnit: axis.minorUnit,
    logBase: axis.logBase,
    numberFormat: axis.numberFormat,
    position: axis.position,
    reverse: axis.reverse,
  };
}

function snapshotLegend(
  config: ChartConfig,
  series: ResolvedChartSpecSnapshot['resolved']['series'],
): ResolvedChartSpecSnapshot['resolved']['legend'] {
  const legend = config.legend;
  const present = !!legend && legend.position !== 'none';
  const deletedEntries = new Set(
    legend?.entries
      ?.filter((entry) => entry.delete || entry.visible === false)
      .map((entry) => entry.idx) ?? [],
  );
  const visible = present ? (legend?.visible ?? legend?.show ?? true) : false;
  return {
    present,
    visible,
    position: legend?.position,
    entries: present ? series.map((item) => item.name) : [],
    visibleEntries: visible
      ? series
          .filter(
            (_item, index) =>
              !deletedEntries.has(index) && !isNoFillNoLineSeriesConfig(config.series?.[index]),
          )
          .map((item) => item.name)
      : [],
  };
}

function snapshotSeries(
  series: ChartDataSeries,
  index: number,
  categories: Array<string | number | null>,
  config: ChartConfig,
  hasExplicitSeriesReferences: boolean,
): ResolvedChartSpecSnapshot['resolved']['series'][number] {
  const configured = config.series?.[index];
  const values: Array<number | null> = [];
  const blankMask: boolean[] = [];
  const seriesCategories = snapshotCategoriesForSeries(
    series,
    configured,
    categories,
    hasExplicitSeriesReferences,
  );
  const length = Math.max(seriesCategories.length, series.data.length);
  for (let pointIndex = 0; pointIndex < length; pointIndex += 1) {
    const value = numericPointValue(series.data[pointIndex]);
    values.push(value);
    blankMask.push(value === null);
  }
  const source = {
    values: configured?.values,
    categories: configured?.categories,
    bubbleSize: configured?.bubbleSize,
  };
  const name = snapshotSeriesName(series, configured, index);

  return {
    index,
    order: configured?.order ?? configured?.idx ?? index,
    name,
    type: series.type ?? configured?.type,
    axisGroup: series.yAxisIndex === 1 || configured?.yAxisIndex === 1 ? 'secondary' : 'primary',
    color: series.color ?? configured?.color ?? config.colors?.[index],
    source,
    categories: seriesCategories,
    values,
    blankMask,
    dataHash: hashJson({
      name,
      source,
      categories: seriesCategories,
      categoryFormatCodes: config.series?.[index]?.categoryLabelFormat,
      values,
      blankMask,
    }),
  };
}

function snapshotSeriesName(
  series: ChartDataSeries,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  index: number,
): string {
  if (!configured?.name && typeof configured?.idx === 'number' && Number.isInteger(configured.idx)) {
    return `Series ${configured.idx}`;
  }
  return series.name || `Series ${index + 1}`;
}

function snapshotCategoriesForSeries(
  series: ChartDataSeries,
  configured: NonNullable<ChartConfig['series']>[number] | undefined,
  categories: Array<string | number | null>,
  hasExplicitSeriesReferences: boolean,
): Array<string | number | null> {
  if (configured?.categories) {
    return series.data.map((point) => snapshotScalar(point?.x));
  }
  return !hasExplicitSeriesReferences ? categories : [];
}

function snapshotRange(reference: Charts.ResolvedChartRangeReference | null): RangeSnapshot | null {
  if (!reference) return null;
  return {
    kind: reference.kind,
    source: reference.source,
    ref: reference.ref,
    range: {
      sheetId: reference.range.sheetId ? String(reference.range.sheetId) : undefined,
      startRow: reference.range.startRow,
      startCol: reference.range.startCol,
      endRow: reference.range.endRow,
      endCol: reference.range.endCol,
    },
  };
}

function titleText(config: ChartConfig): string | undefined {
  const text =
    config.title ??
    config.chartTitle?.text ??
    config.titleRichText?.map((part) => part.text).join('');
  return text || undefined;
}

function groupingFor(config: ChartConfig): ResolvedChartSpecSnapshot['resolved']['grouping'] {
  if (config.subType === 'stacked') return 'stacked';
  if (config.subType === 'percentStacked') return 'percentStacked';
  if (config.subType === 'clustered') return 'clustered';
  return 'standard';
}

function numericPointValue(point: ChartDataPoint | undefined): number | null {
  if (point?.valueState && point.valueState !== 'value') return null;
  if (!point || typeof point.y !== 'number' || !Number.isFinite(point.y)) return null;
  return point.y;
}

function snapshotScalar(value: string | number | null | undefined): string | number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  return null;
}

function unsupportedFeatureDiagnostics(config: ChartConfig): string[] {
  const unsupported: string[] = [];
  if (String(config.type).endsWith('3d'))
    unsupported.push('3d chart rendering is approximated by the 2d chart backend');
  if (config.type === 'surface' || config.type === 'surface3d')
    unsupported.push('surface chart rendering is not fully semantic');
  if (config.wireframe) unsupported.push('surface wireframe rendering is not fully semantic');
  if (config.pivotOptions || config.showAllFieldButtons)
    unsupported.push('pivot chart field buttons are not rendered');
  return unsupported;
}

function hashJson(value: unknown): string {
  const text = stableStringify(value);
  let hashA = 0x811c9dc5;
  let hashB = 0x811c9dc5 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x01000193);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

// =============================================================================
// Chart WASM acceleration (optional — injected by compute-bridge)
// =============================================================================

/** Typed interface for chart WASM exports injected from compute-bridge. */
export interface ChartWasmExports {
  /** Index signature for compatibility with generic WASM module loaders. */
  [fn_name: string]: (...args: unknown[]) => unknown;
  chart_apply_transforms: (data: unknown, transforms: unknown) => unknown;
  chart_compute_regression: (
    points: unknown,
    method: unknown,
    degree: unknown,
    options: unknown,
  ) => unknown;
  chart_compute_stacking: (inputs: unknown, mode: unknown) => unknown;
  chart_compute_bins: (values: unknown, maxbins: unknown, step: unknown, nice: unknown) => unknown;
  chart_compute_statistics: (values: unknown) => unknown;
  chart_compute_density: (values: unknown, bandwidth: unknown, steps: unknown) => unknown;
}

let chartWasmExports: ChartWasmExports | null = null;

/**
 * Initialize the chart WASM backend.
 * Called by compute-bridge after loading @mog-sdk/wasm.
 */
export function initChartWasm(exports: ChartWasmExports): void {
  chartWasmExports = exports;
}

/**
 * Check if chart WASM module is available.
 */
function isChartWasmAvailable(): boolean {
  return chartWasmExports !== null;
}

/**
 * Try to apply transforms via WASM. Returns transformed DataRow[] or null if WASM unavailable.
 */
function tryWasmTransforms(data: DataRow[], transforms: unknown[]): DataRow[] | null {
  if (!isChartWasmAvailable()) return null;

  try {
    const result = chartWasmExports!.chart_apply_transforms(data, transforms);
    return result as DataRow[];
  } catch (err) {
    console.warn('[ChartBridge] WASM transform failed, falling back to TS:', err);
    return null;
  }
}

// =============================================================================
// Layout Extraction
// =============================================================================

/**
 * Extract a ChartLayoutSnapshot from a CompileResult.
 *
 * Converts the compiler's absolute pixel layout into normalized (0-1) coordinates
 * relative to the total chart dimensions, which is what the OfficeJS-style
 * getPlotAreaLayout / getLegendLayout / getTitleLayout APIs return.
 */
function extractLayoutSnapshot(result: CompileResult): ChartLayoutSnapshot | null {
  const layout = result.layout;
  if (!layout) return null;

  const totalW = layout.width || 1;
  const totalH = layout.height || 1;

  const normalize = (
    rect: { x: number; y: number; width: number; height: number } | undefined,
  ): ChartLayoutRect | undefined => {
    if (!rect) return undefined;
    return {
      left: rect.x / totalW,
      top: rect.y / totalH,
      width: rect.width / totalW,
      height: rect.height / totalH,
    };
  };

  const plotArea = normalize(layout.plotArea);
  if (!plotArea) return null;

  return {
    plotArea,
    legend: normalize(layout.legend),
    title: normalize(layout.title),
    // dataLabels: The compile result doesn't provide a separate data labels region;
    // this would need mark-level bounding box computation in a future iteration.
    dataLabels: undefined,
  };
}

// =============================================================================
// Re-export types from contracts for backward compatibility
// =============================================================================

// Re-export chart types from contracts
export type { ChartBounds, ChartDataResult, ChartError, ChartErrorCode, ChartMark };

// =============================================================================
// Chart Bridge Class
// =============================================================================

/**
 * Chart Bridge
 *
 * Connects the standalone charts library to the engine's reactive system.
 *
 * Key responsibilities:
 * 1. Cache compiled marks (invalidate on data/spec changes)
 * 2. Subscribe to cell and chart change events
 * 3. Resolve CellIdRange to actual cell data
 * 4. Provide render API for ChartLayer
 */
export class ChartBridge implements IChartBridge {
  /** Cache of compiled marks per chart ID */
  private markCache = new Map<string, ChartMark[]>();

  /** Cache of layout snapshots per chart ID (follows same stale pattern as markCache) */
  private layoutCache = new Map<string, ChartLayoutSnapshot>();

  /** Cache of chart errors per chart ID */
  private errorCache = new Map<string, ChartError>();

  /** Renderer-side terminal import/render status for imported charts. */
  private chartImportRenderStatus = new Map<string, ImportedChartRenderStatus>();

  /** Set of dirty charts that need recompilation */
  private dirtyCharts = new Set<string>();

  /** Set of chart IDs currently being recompiled (in-flight async compilation) */
  private pendingCompilations = new Set<string>();

  /**
   * Index from chartId to the SheetId that owns it.
   *
   * Populated by the floating-object event handlers (`:created`, `:updated`,
   * `:deleted`). The sync paint path (`renderCached`) uses this for an O(1)
   * sheet lookup instead of awaiting `getAllSheetIds` + a `Charts.get` per
   * sheet — the await chain is what made the old async `render()` paint in
   * the wrong canvas frame.
   */
  private chartSheetIndex = new Map<string, SheetId>();

  /** Listeners notified when a real cache outcome (marks or error) is committed. */
  private cacheUpdateListeners: Array<(chartId: string) => void> = [];

  /** Cleanup functions for event subscriptions */
  private cleanups: Array<() => void> = [];

  /** Whether the bridge has been started */
  private started = false;

  constructor(private ctx: DocumentContext) {}

  private cacheKey(chartId: string, sheetId?: SheetId): string {
    const resolvedSheetId = sheetId ?? this.chartSheetIndex.get(chartId);
    return resolvedSheetId ? `${resolvedSheetId}::${chartId}` : chartId;
  }

  private deleteCacheEntries(chartId: string, sheetId?: SheetId): void {
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

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the chart bridge - subscribe to events for reactive updates.
   *
   * @returns Cleanup function to stop the bridge
   */
  start(): () => void {
    if (this.started) {
      return () => this.stop();
    }
    this.started = true;

    this.setupSubscriptions();

    return () => this.stop();
  }

  /**
   * Stop the chart bridge and clean up subscriptions.
   */
  stop(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.markCache.clear();
    this.layoutCache.clear();
    this.errorCache.clear();
    this.chartImportRenderStatus.clear();
    this.dirtyCharts.clear();
    this.pendingCompilations.clear();
    this.chartSheetIndex.clear();
    // In-place clear, NOT reassignment — onCacheUpdate's unsubscribe closures
    // capture `this.cacheUpdateListeners` by reference and call indexOf/splice
    // at unsubscribe time. Reassigning would orphan those closures onto a
    // stale array, leaking the entry on the new array if the same listener
    // re-subscribes.
    this.cacheUpdateListeners.length = 0;
    this.started = false;
  }

  /**
   * Destroy the bridge - alias for stop().
   */
  destroy(): void {
    this.stop();
  }

  // ===========================================================================
  // Event Subscriptions
  // ===========================================================================

  /**
   * Set up EventBus subscriptions for reactive chart updates.
   */
  private setupSubscriptions(): void {
    // Event-bus seam: event payloads carry sheetId as raw string (see
    // CellChangedEvent / CellsBatchChangedEvent). Brand at subscription entry
    // until a follow-up round migrates event types to SheetId.
    const unsubCell = this.ctx.eventBus.on<CellChangedEvent>('cell:changed', (event) => {
      void this.handleCellChange(toSheetId(event.sheetId), event.row, event.col);
    });
    this.cleanups.push(unsubCell);

    const unsubBatch = this.ctx.eventBus.on<CellsBatchChangedEvent>(
      'cells:batch-changed',
      (event) => {
        void this.handleCellsBatchChange(toSheetId(event.sheetId), event.changes);
      },
    );
    this.cleanups.push(unsubBatch);

    // Subscribe to chart updates (emitted by handleFloatingObjectChanges for chart config changes)
    const unsubChart = this.ctx.eventBus.on<ChartUpdatedEvent>('chart:updated', (event) => {
      this.invalidateChart(event.chartId);
    });
    this.cleanups.push(unsubChart);

    // Subscribe to floating object events for chart-type objects.
    // This handles the live mutation path: when charts are created or updated
    // as floating objects, we invalidate the marks cache so the next render
    // fetches fresh data from ComputeBridge.
    //
    // The handlers also maintain `chartSheetIndex` so the sync paint path
    // (`renderCached`) can resolve chartId → sheetId in O(1) without awaiting.
    const unsubFoCreated = this.ctx.eventBus.on<FloatingObjectCreatedEvent>(
      'floatingObject:created',
      (event) => {
        if (event.objectType === 'chart' || isChartPayload(event.data)) {
          const eventSheetId = toSheetId(event.sheetId);
          this.chartSheetIndex.set(event.objectId, eventSheetId);
          if (!this.syncImportRenderStatus(event.objectId, event.data, eventSheetId)) {
            this.invalidateChart(event.objectId);
          }
        }
      },
    );
    this.cleanups.push(unsubFoCreated);

    const unsubFoUpdated = this.ctx.eventBus.on<FloatingObjectUpdatedEvent>(
      'floatingObject:updated',
      (event) => {
        if (isChartPayload(event.data)) {
          // Forward-looking: charts cannot move between sheets in the current
          // API (no setFloatingObjectSheetId surface), but if a cross-sheet
          // move is added later it will arrive here as `event.sheetId !==
          // chartSheetIndex.get(objectId)`. The conditional re-set costs
          // nothing today and prevents silent index drift if that lands.
          const eventSheetId = toSheetId(event.sheetId);
          if (this.chartSheetIndex.get(event.objectId) !== eventSheetId) {
            this.chartSheetIndex.set(event.objectId, eventSheetId);
          }
          const importStatusPayload = hasImportStatus(event.changes) ? event.changes : event.data;
          const hasTerminalImportStatus = this.syncImportRenderStatus(
            event.objectId,
            importStatusPayload,
            eventSheetId,
          );
          if (hasTerminalImportStatus) return;

          // Skip cache invalidation for position-only changes (drag/resize).
          // Position fields don't affect compiled marks (data, axes, series, etc.).
          // changedFields comes from Rust via the JSON update keys —
          // e.g. moveChart -> ["anchorRow", "anchorCol"], resizeChart -> ["width", "height"].
          const fields = event.changedFields ?? [];
          if (!isPositionOnlyUpdate(fields)) {
            this.invalidateChart(event.objectId);
          }
        }
      },
    );
    this.cleanups.push(unsubFoUpdated);

    // Cleanup on chart deletion: drop the index entry and every cache slot,
    // otherwise renderCached's ensureCompiled would chase a vanished chart.
    const unsubFoDeleted = this.ctx.eventBus.on<FloatingObjectDeletedEvent>(
      'floatingObject:deleted',
      (event) => {
        if (event.objectType === 'chart') {
          const eventSheetId = toSheetId(event.sheetId);
          this.chartSheetIndex.delete(event.objectId);
          this.deleteCacheEntries(event.objectId, eventSheetId);
        }
      },
    );
    this.cleanups.push(unsubFoDeleted);

    // Cascade clear on sheet deletion: every chart on the deleted sheet must
    // be evicted from the index and from every cache. Without this, a stale
    // chartId → vanished-sheetId entry survives and renderCached's
    // ensureCompiled would call getMarks against a sheet that no longer
    // exists.
    const unsubSheetDeleted = this.ctx.eventBus.on<SheetDeletedEvent>('sheet:deleted', (event) => {
      const deletedSheetId = toSheetId(event.sheetId);
      const orphanedChartIds: string[] = [];
      for (const [chartId, sheetId] of this.chartSheetIndex) {
        if (sheetId === deletedSheetId) orphanedChartIds.push(chartId);
      }
      for (const chartId of orphanedChartIds) {
        this.chartSheetIndex.delete(chartId);
        this.deleteCacheEntries(chartId, deletedSheetId);
      }
    });
    this.cleanups.push(unsubSheetDeleted);

    // Subscribe to structural changes (row/column insert/delete) to keep A1-string
    // dataRange references in sync. Charts that use dataRangeIdentity (CellIdRange)
    // auto-expand via the Rust engine; only legacy A1-string dataRange charts need
    // this JS-side adjustment.
    const unsubRowsInserted = this.ctx.eventBus.on<RowsInsertedEvent>('rows:inserted', (event) => {
      void this.handleRowsInserted(toSheetId(event.sheetId), event.startRow, event.count);
    });
    this.cleanups.push(unsubRowsInserted);

    const unsubRowsDeleted = this.ctx.eventBus.on<RowsDeletedEvent>('rows:deleted', (event) => {
      void this.handleRowsDeleted(toSheetId(event.sheetId), event.startRow, event.count);
    });
    this.cleanups.push(unsubRowsDeleted);

    const unsubColsInserted = this.ctx.eventBus.on<ColumnsInsertedEvent>(
      'columns:inserted',
      (event) => {
        void this.handleColumnsInserted(toSheetId(event.sheetId), event.startCol, event.count);
      },
    );
    this.cleanups.push(unsubColsInserted);

    const unsubColsDeleted = this.ctx.eventBus.on<ColumnsDeletedEvent>(
      'columns:deleted',
      (event) => {
        void this.handleColumnsDeleted(toSheetId(event.sheetId), event.startCol, event.count);
      },
    );
    this.cleanups.push(unsubColsDeleted);
  }

  /**
   * Handle a cell change - invalidate any charts that reference this cell.
   */
  private async handleCellChange(sheetId: SheetId, row: number, col: number): Promise<void> {
    // Guard: bail if the bridge was stopped (e.g., during document disposal)
    // while this fire-and-forget handler was already dispatched.
    if (!this.started) return;

    const charts = await this.getAllChartsInWorkbook();
    for (const chart of charts) {
      if (await this.chartReferencesCell(chart, sheetId, row, col)) {
        this.invalidateChart(chart.id);
      }
    }
  }

  private async handleCellsBatchChange(
    sheetId: SheetId,
    changes: Array<{ row: number; col: number }>,
  ): Promise<void> {
    if (!this.started || changes.length === 0) return;

    let startRow = Number.POSITIVE_INFINITY;
    let startCol = Number.POSITIVE_INFINITY;
    let endRow = Number.NEGATIVE_INFINITY;
    let endCol = Number.NEGATIVE_INFINITY;

    for (const change of changes) {
      startRow = Math.min(startRow, change.row);
      startCol = Math.min(startCol, change.col);
      endRow = Math.max(endRow, change.row);
      endCol = Math.max(endCol, change.col);
    }

    const affected = await this.getChartsAffectedByRange(sheetId, {
      sheetId,
      startRow,
      startCol,
      endRow,
      endCol,
    });
    for (const chartId of affected) {
      this.invalidateChart(chartId);
    }
  }

  private async getAllChartsInWorkbook(): Promise<ChartFloatingObject[]> {
    const sheetIds = await this.ctx.computeBridge.getSheetOrder();
    const perSheet = await Promise.all(
      sheetIds.map((id) => Charts.getAll(this.ctx, toSheetId(id))),
    );
    return perSheet.flat();
  }

  /**
   * Check if a chart's data range includes a specific cell.
   */
  private async chartReferencesCell(
    chart: ChartFloatingObject,
    sheetId: SheetId,
    row: number,
    col: number,
  ): Promise<boolean> {
    const resolved = await Charts.resolveChartRangeReferences(this.ctx, chart);
    const ranges = [
      resolved.dataRange,
      resolved.categoryRange,
      resolved.seriesRange,
      ...resolved.seriesReferences.flatMap((series) => [series.values, series.categories]),
    ];

    return ranges.some((entry) => {
      const range = entry?.range;
      return (
        range?.sheetId === sheetId &&
        row >= range.startRow &&
        row <= range.endRow &&
        col >= range.startCol &&
        col <= range.endCol
      );
    });
  }

  /**
   * Handle rows inserted — update A1-string dataRange for affected charts.
   *
   * Excel semantics:
   *   at < startRow          → shift entire range down by count
   *   startRow < at ≤ endRow → expand endRow by count (insertion strictly inside)
   *   at > endRow            → no change
   * Charts using dataRangeIdentity auto-expand via the Rust engine; skip them.
   */
  private async handleRowsInserted(
    sheetId: SheetId,
    startRow: number,
    count: number,
  ): Promise<void> {
    if (!this.started) return;
    const charts = await Charts.getAll(this.ctx, sheetId);
    for (const chart of charts) {
      if (chart.dataRangeIdentity || !chart.dataRange) continue;
      const range = parseCellRange(chart.dataRange);
      if (!range) continue;

      if (startRow < range.startRow) {
        // Insertion before range — shift range down
        const newRange = {
          ...range,
          startRow: range.startRow + count,
          endRow: range.endRow + count,
        };
        await Charts.update(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id);
      } else if (startRow > range.startRow && startRow <= range.endRow) {
        // Insertion strictly inside range — expand endRow
        const newRange = { ...range, endRow: range.endRow + count };
        await Charts.update(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id);
      }
      // Insertion at startRow or after endRow: no change
    }
  }

  /**
   * Handle rows deleted — update A1-string dataRange for affected charts.
   *
   * Deleted rows: [startRow, startRow + count - 1] (inclusive, 0-indexed).
   *   delEnd < rangeStart   → shift range up by count
   *   delStart > rangeEnd   → no change
   *   otherwise             → shrink range by the overlap, clip start if needed
   */
  private async handleRowsDeleted(
    sheetId: SheetId,
    startRow: number,
    count: number,
  ): Promise<void> {
    if (!this.started) return;
    const charts = await Charts.getAll(this.ctx, sheetId);
    for (const chart of charts) {
      if (chart.dataRangeIdentity || !chart.dataRange) continue;
      const range = parseCellRange(chart.dataRange);
      if (!range) continue;

      const delEnd = startRow + count - 1;

      if (delEnd < range.startRow) {
        // Deletion entirely before range — shift range up
        const newRange = {
          ...range,
          startRow: range.startRow - count,
          endRow: range.endRow - count,
        };
        await Charts.update(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id);
      } else if (startRow > range.endRow) {
        // Deletion entirely after range — no change
      } else {
        // Deletion overlaps range
        const overlapStart = Math.max(startRow, range.startRow);
        const overlapEnd = Math.min(delEnd, range.endRow);
        const deletedWithin = overlapEnd - overlapStart + 1;

        const newStartRow = startRow < range.startRow ? startRow : range.startRow;
        const newEndRow = range.endRow - deletedWithin;

        if (newEndRow < newStartRow) {
          // Entire range was deleted — just invalidate, keep stale range
          this.invalidateChart(chart.id);
          continue;
        }

        const newRange = { ...range, startRow: newStartRow, endRow: newEndRow };
        await Charts.update(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id);
      }
    }
  }

  /**
   * Handle columns inserted — update A1-string dataRange for affected charts.
   * Same semantics as handleRowsInserted but for columns.
   */
  private async handleColumnsInserted(
    sheetId: SheetId,
    startCol: number,
    count: number,
  ): Promise<void> {
    if (!this.started) return;
    const charts = await Charts.getAll(this.ctx, sheetId);
    for (const chart of charts) {
      if (chart.dataRangeIdentity || !chart.dataRange) continue;
      const range = parseCellRange(chart.dataRange);
      if (!range) continue;

      if (startCol < range.startCol) {
        // Insertion before range — shift range right
        const newRange = {
          ...range,
          startCol: range.startCol + count,
          endCol: range.endCol + count,
        };
        await Charts.update(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id);
      } else if (startCol > range.startCol && startCol <= range.endCol) {
        // Insertion strictly inside range — expand endCol
        const newRange = { ...range, endCol: range.endCol + count };
        await Charts.update(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id);
      }
    }
  }

  /**
   * Handle columns deleted — update A1-string dataRange for affected charts.
   * Same semantics as handleRowsDeleted but for columns.
   */
  private async handleColumnsDeleted(
    sheetId: SheetId,
    startCol: number,
    count: number,
  ): Promise<void> {
    if (!this.started) return;
    const charts = await Charts.getAll(this.ctx, sheetId);
    for (const chart of charts) {
      if (chart.dataRangeIdentity || !chart.dataRange) continue;
      const range = parseCellRange(chart.dataRange);
      if (!range) continue;

      const delEnd = startCol + count - 1;

      if (delEnd < range.startCol) {
        // Deletion entirely before range — shift range left
        const newRange = {
          ...range,
          startCol: range.startCol - count,
          endCol: range.endCol - count,
        };
        await Charts.update(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id);
      } else if (startCol > range.endCol) {
        // Deletion entirely after range — no change
      } else {
        // Deletion overlaps range
        const overlapStart = Math.max(startCol, range.startCol);
        const overlapEnd = Math.min(delEnd, range.endCol);
        const deletedWithin = overlapEnd - overlapStart + 1;

        const newStartCol = startCol < range.startCol ? startCol : range.startCol;
        const newEndCol = range.endCol - deletedWithin;

        if (newEndCol < newStartCol) {
          this.invalidateChart(chart.id);
          continue;
        }

        const newRange = { ...range, startCol: newStartCol, endCol: newEndCol };
        await Charts.update(this.ctx, sheetId, chart.id, { dataRange: cellRangeToA1(newRange) });
        this.invalidateChart(chart.id);
      }
    }
  }

  /**
   * Invalidate a chart's compiled marks cache.
   * Note: layoutCache also follows the same stale pattern — we keep stale layouts
   * available during async recompilation, and getMarks() replaces both caches.
   */
  invalidateChart(chartId: string): void {
    const key = this.cacheKey(chartId);
    // Don't delete markCache or layoutCache — keep stale data for rendering during
    // async recompilation. This prevents blank frames when the async bridge call
    // hasn't resolved yet.
    // getMarks() checks dirtyCharts first and will recompile + replace both cache entries.
    this.errorCache.delete(key);
    this.dirtyCharts.add(key);
  }

  /**
   * Check if a chart is dirty (needs recompilation).
   */
  isChartDirty(chartId: string): boolean {
    const key = this.cacheKey(chartId);
    return this.dirtyCharts.has(key) || !this.markCache.has(key);
  }

  /**
   * Clear the dirty flag for a chart after rendering.
   */
  clearDirtyFlag(chartId: string): void {
    this.dirtyCharts.delete(this.cacheKey(chartId));
  }

  // ===========================================================================
  // Data Resolution
  // ===========================================================================

  /**
   * Resolve chart data from CellIdRange to actual values.
   *
   * This converts the CRDT-safe CellIdRange references to actual cell data
   * that can be passed to the charts library for rendering.
   *
   * @param sheetId - Sheet containing the chart
   * @param chartId - Chart ID
   * @returns Resolved data or error
   */
  async resolveChartData(sheetId: SheetId, chartId: string): Promise<ChartDataResult> {
    const chart = await Charts.get(this.ctx, sheetId, chartId);
    if (!chart) {
      return {
        success: false,
        error: {
          code: 'CHART_NOT_FOUND',
          message: 'Chart not found',
          chartId,
        },
      };
    }

    const resolvedRanges = await Charts.resolveChartRangeReferences(this.ctx, chart);
    const chartRenderDataOrError = await this.resolveChartDataForRendering(
      chart,
      resolvedRanges,
      chartId,
    );
    if ('code' in chartRenderDataOrError) {
      return {
        success: false,
        error: chartRenderDataOrError,
      };
    }

    const data = this.chartDataToRows(chartRenderDataOrError.data);

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

  private chartDataToRows(data: ChartData): Record<string, unknown>[] {
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

  // ===========================================================================
  // Mark Compilation
  // ===========================================================================

  /**
   * Get compiled marks for a chart.
   *
   * Returns cached marks if available, otherwise compiles the chart spec.
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @returns Compiled marks or error
   */
  async getMarks(sheetId: SheetId, chartId: string): Promise<ChartMark[] | ChartError> {
    const key = this.cacheKey(chartId, sheetId);
    // Started-gate at function entry: a caller landing here after stop()
    // (e.g. an in-flight ensureCompiled racing a bridge teardown) must NOT
    // mutate caches or add to pendingCompilations. Without this, the
    // pending-check short-circuit at the top of subsequent calls would
    // perpetually return stale, since pendingCompilations would never clear.
    if (!this.started) {
      const cachedMarks = this.markCache.get(key);
      if (cachedMarks) return cachedMarks;
      return {
        code: 'CHART_NOT_FOUND',
        message: 'Chart bridge is stopped',
        chartId,
      };
    }

    // Check error cache first
    const cachedError = this.errorCache.get(key);
    if (cachedError) {
      return cachedError;
    }

    // Check marks cache
    const cachedMarks = this.markCache.get(key);
    if (cachedMarks && !this.dirtyCharts.has(key)) {
      return cachedMarks;
    }

    // If a recompilation is already in flight, return stale marks to avoid blank frames.
    // The in-flight compilation will update the cache when it resolves.
    // NOTE: this short-circuit deliberately does NOT fire onCacheUpdate
    // listeners — only the in-flight compile's real cache-commit fires them.
    // Firing here would loop: renderCached → ensureCompiled → getMarks →
    // pending short-circuit → listener → markDirty('drawing') → next frame
    // → renderCached again → loop until the original compile resolves.
    if (cachedMarks && this.pendingCompilations.has(key)) {
      return cachedMarks;
    }

    this.pendingCompilations.add(key);

    // Get chart spec
    const chart = await Charts.get(this.ctx, sheetId, chartId);
    if (!chart) {
      const error: ChartError = {
        code: 'CHART_NOT_FOUND',
        message: 'Chart not found',
        chartId,
      };
      this.commitError(chartId, error, sheetId);
      return error;
    }

    const resolvedRanges = await Charts.resolveChartRangeReferences(this.ctx, chart);
    const chartRenderDataOrError = await this.resolveChartDataForRendering(
      chart,
      resolvedRanges,
      chartId,
    );
    if ('code' in chartRenderDataOrError) {
      this.commitError(chartId, chartRenderDataOrError, sheetId);
      return chartRenderDataOrError;
    }
    const { config, data: chartData } = chartRenderDataOrError;

    if (chartData.series.length === 0) {
      const error: ChartError = {
        code: 'EMPTY_DATA',
        message: 'Chart data range is empty',
        chartId,
      };
      this.commitError(chartId, error, sheetId);
      return error;
    }

    // Convert to ChartSpec and compile
    const spec = configToSpec(config, chartData);

    // Try WASM-accelerated transforms if available
    const specDataValues =
      spec.data && 'values' in spec.data ? (spec.data.values as DataRow[]) : [];
    const wasmData = spec.transform ? tryWasmTransforms(specDataValues, spec.transform) : null;

    let compileResult;
    if (wasmData) {
      // WASM already applied transforms — compile without them
      compileResult = compile({ ...spec, transform: undefined, data: { values: wasmData } });
    } else {
      // Fallback: let compile() handle transforms in TS
      compileResult = compile(spec);
    }

    // Flatten all marks into a single array
    const marks = collectMarks(compileResult) as ChartMark[];

    // Extract layout snapshot from compile result and cache it.
    // Gate on `started`: stop() can run mid-compile (between any two awaits
    // above), in which case it has cleared caches and an unguarded
    // layoutCache.set would re-pollute. layoutCache is read by getLayout, not
    // by the renderer's dirty-flag path, so no listener fire is needed here.
    const layoutSnapshot = extractLayoutSnapshot(compileResult);
    if (this.started && layoutSnapshot) {
      this.layoutCache.set(key, layoutSnapshot);
    }

    // Real cache commit — fires listeners so the renderer dirties the
    // drawing layer and the next frame paints from cache instead of the
    // placeholder. commitMarks bails if stop() ran mid-compile.
    this.commitMarks(chartId, marks, sheetId);

    return marks;
  }

  /**
   * Commit a marks outcome to the cache and notify cache-update listeners.
   *
   * Gated on `started`: if stop() ran mid-compile, the caches were cleared
   * and we must not re-pollute them. The pendingCompilations cleanup is
   * mirrored by stop() so the bridge is fully reset on teardown.
   */
  private commitMarks(chartId: string, marks: ChartMark[], sheetId?: SheetId): void {
    const key = this.cacheKey(chartId, sheetId);
    if (!this.started) {
      this.pendingCompilations.delete(key);
      this.pendingCompilations.delete(chartId);
      return;
    }
    this.markCache.set(key, marks);
    this.dirtyCharts.delete(key);
    this.pendingCompilations.delete(key);
    this.pendingCompilations.delete(chartId);
    this.fireCacheUpdate(chartId);
  }

  /**
   * Commit an error outcome to the cache and notify listeners.
   *
   * Without firing listeners on errors, a chart whose first compile fails
   * (CHART_NOT_FOUND or EMPTY_DATA) would paint "Chart loading…" forever:
   * renderCached → ensureCompiled → errorCache populated → no signal → the
   * placeholder freezes until something else dirties the drawing layer.
   */
  private commitError(chartId: string, error: ChartError, sheetId?: SheetId): void {
    const key = this.cacheKey(chartId, sheetId);
    if (!this.started) {
      this.pendingCompilations.delete(key);
      this.pendingCompilations.delete(chartId);
      return;
    }
    this.errorCache.set(key, error);
    this.pendingCompilations.delete(key);
    this.pendingCompilations.delete(chartId);
    this.fireCacheUpdate(chartId);
  }

  private syncImportRenderStatus(chartId: string, payload: unknown, sheetId?: SheetId): boolean {
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

  /**
   * Notify cacheUpdateListeners. Snapshots the array first so a listener
   * that calls its own `off()` mid-iteration doesn't skip the next listener
   * via splice-during-forEach.
   */
  private fireCacheUpdate(chartId: string): void {
    for (const listener of [...this.cacheUpdateListeners]) {
      listener(chartId);
    }
  }

  /**
   * Compile marks for a chart at specific pixel dimensions.
   *
   * Unlike getMarks(), this does NOT use or update the marks/layout cache.
   * It performs a one-off compilation at the requested dimensions, which is
   * needed for image export (marks are dimension-dependent).
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @param width - Target width in pixels
   * @param height - Target height in pixels
   * @returns Compiled marks or error
   */
  async getMarksAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
  ): Promise<ChartMark[] | ChartError> {
    const snapshot = await this.compileChartRenderSnapshotAtSize(
      sheetId,
      chartId,
      width,
      height,
      defaultExportOptionsForSize(width, height),
    );
    if ('code' in snapshot) return snapshot;
    return snapshot.marks;
  }

  async getRenderSnapshotAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
    exportOptions: ChartExportOptionsSnapshot,
  ): Promise<ChartRenderSnapshot | ChartError> {
    return this.compileChartRenderSnapshotAtSize(sheetId, chartId, width, height, exportOptions);
  }

  private async compileChartRenderSnapshotAtSize(
    sheetId: SheetId,
    chartId: string,
    width: number,
    height: number,
    exportOptions: ChartExportOptionsSnapshot,
  ): Promise<ChartRenderSnapshot | ChartError> {
    const chart = await Charts.get(this.ctx, sheetId, chartId);
    if (!chart) {
      return {
        code: 'CHART_NOT_FOUND',
        message: 'Chart not found',
        chartId,
      };
    }

    const resolvedRanges = await Charts.resolveChartRangeReferences(this.ctx, chart);
    const chartRenderDataOrError = await this.resolveChartDataForRendering(
      chart,
      resolvedRanges,
      chartId,
    );
    if ('code' in chartRenderDataOrError) {
      return chartRenderDataOrError;
    }
    const { config, data: chartData } = chartRenderDataOrError;

    if (chartData.series.length === 0) {
      return {
        code: 'EMPTY_DATA',
        message: 'Chart data range is empty',
        chartId,
      };
    }

    const spec = configToSpec(config, chartData);

    // Try WASM-accelerated transforms if available
    const specDataValues =
      spec.data && 'values' in spec.data ? (spec.data.values as DataRow[]) : [];
    const wasmData = spec.transform ? tryWasmTransforms(specDataValues, spec.transform) : null;
    const compilerPathId = wasmData ? 'wasm-transforms+ts-grammar' : 'ts-grammar';
    const compileInput = wasmData
      ? { ...spec, transform: undefined, data: { values: wasmData } }
      : spec;

    // Compile at the target dimensions (override via CompileOptions)
    const compileResult = compile(compileInput, undefined, { width, height });

    // Flatten all marks into a single array (same as getMarks)
    const marks = collectMarks(compileResult) as ChartMark[];

    return {
      marks,
      resolvedChartSpec: buildResolvedChartSpecSnapshot({
        chart,
        sheetId,
        config,
        chartData,
        resolvedRanges,
        exportOptions,
        compilerPathId,
        compilerInputHash: hashJson({
          chartId,
          sheetId,
          config,
          chartData,
          resolvedRanges,
          compileInput,
        }),
      }),
    };
  }

  /**
   * Create a CellDataAccessor for the charts library.
   * Pre-fetches cell values into a map since the charts library expects sync access.
   */
  private async createCellAccessor(
    ranges: Array<CellRange | null | undefined>,
    options?: {
      defaultSheetId?: SheetId;
      sheetAliases?: Map<string, string>;
      hiddenVisibility?: HiddenCellVisibility;
    },
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

          const value = await getValue(this.ctx, toSheetId(range.sheetId), row, col);
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

  private async resolveChartDataForRendering(
    chart: ChartFloatingObject,
    resolvedRanges: Charts.ResolvedChartRangeReferences,
    chartId: string,
  ): Promise<ChartRenderData | ChartError> {
    const config = toChartConfig(chart);
    const hasExplicitSeriesValues = config.series?.some((series) => series.values?.trim());

    if (hasExplicitSeriesValues) {
      const seriesRanges = resolvedRanges.seriesReferences.flatMap((series) => [
        series.values?.range,
        series.categories?.range,
      ]);
      const hiddenVisibility = config.plotVisibleOnly
        ? await this.loadHiddenVisibility(seriesRanges)
        : undefined;
      const renderConfig = hiddenVisibility
        ? this.withHiddenSeriesFiltered(config, resolvedRanges, hiddenVisibility)
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

      const accessor = await this.createCellAccessor(seriesRanges, {
        defaultSheetId: chart.sheetId ? toSheetId(chart.sheetId) : undefined,
        sheetAliases: this.seriesSheetAliases(resolvedRanges),
        hiddenVisibility,
      });
      const data = extractChartData(accessor, renderConfig);
      return {
        config: renderConfig,
        data: normalizeChartDataForRendering(data, renderConfig),
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
      ? await this.loadHiddenVisibility(dataRanges)
      : undefined;
    const cellAccessor = await this.createCellAccessor(dataRanges, { hiddenVisibility });
    const data = extractChartDataFromRange(cellAccessor, dataRange, {
      categoryRange: resolvedRanges.categoryRange?.range,
      seriesRange: resolvedRanges.seriesRange?.range,
      seriesOrientation: chart.seriesOrientation as ChartConfig['seriesOrientation'],
    });
    return {
      config,
      data: normalizeChartDataForRendering(data, config),
    };
  }

  private async loadHiddenVisibility(
    ranges: Array<CellRange | null | undefined>,
  ): Promise<HiddenCellVisibility | undefined> {
    const sheetIds = new Set<string>();
    for (const range of ranges) {
      if (range?.sheetId) sheetIds.add(String(range.sheetId));
    }
    if (sheetIds.size === 0) return undefined;

    const bridge = this.ctx.computeBridge as HiddenDimensionBridge | undefined;
    if (!bridge?.getHiddenRows && !bridge?.getHiddenColumns) return undefined;

    const hiddenRowsBySheet = new Map<string, Set<number>>();
    const hiddenColsBySheet = new Map<string, Set<number>>();
    await Promise.all(
      [...sheetIds].map(async (id) => {
        const sheet = toSheetId(id);
        const [rows, cols] = await Promise.all([
          bridge.getHiddenRows?.(sheet) ?? Promise.resolve([]),
          bridge.getHiddenColumns?.(sheet) ?? Promise.resolve([]),
        ]);
        hiddenRowsBySheet.set(id, new Set(rows));
        hiddenColsBySheet.set(id, new Set(cols));
      }),
    );

    return { hiddenRowsBySheet, hiddenColsBySheet };
  }

  private withHiddenSeriesFiltered(
    config: ChartConfig,
    resolvedRanges: Charts.ResolvedChartRangeReferences,
    hiddenVisibility: HiddenCellVisibility,
  ): ChartConfig {
    if (!config.series?.length) return config;
    const series = config.series.filter((_, index) => {
      const valuesRange = resolvedRanges.seriesReferences[index]?.values?.range;
      return !valuesRange || !isRangeFullyHidden(valuesRange, hiddenVisibility);
    });
    return series.length === config.series.length ? config : { ...config, series };
  }

  private seriesSheetAliases(
    resolvedRanges: Charts.ResolvedChartRangeReferences,
  ): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const series of resolvedRanges.seriesReferences) {
      for (const reference of [series.values, series.categories]) {
        const parsed = reference?.ref ? parseCellRange(reference.ref) : null;
        if (parsed?.sheetName && reference?.range.sheetId) {
          aliases.set(parsed.sheetName, String(reference.range.sheetId));
        }
      }
    }
    return aliases;
  }

  // ===========================================================================
  // Render API
  // ===========================================================================
  //
  // Paint is synchronous and reads from cache only. Mark compilation is async
  // (data fetch + extract + compile) but lives off the paint path; the cache
  // breaks the coupling. See ImageCache.getImage / onLoad for the pattern
  // template — async producer, sync consumer, listener-driven repaint.
  //
  // The previous async `render()` returned a Promise that the canvas dispatch
  // loop discarded. By the time the await chain resolved, the engine had
  // already restored its `(viewport.x, viewport.y)` translate, so the chart's
  // own `ctx.translate(bounds.x, bounds.y)` landed in canvas-pixel space
  // without the viewport offset and the chart painted in the wrong frame.
  // `withRenderContext`'s rotation/flip were also dropped because they were
  // restored before the chart painted. The sync contract restores both.

  /**
   * Synchronous render from cache. See {@link IChartBridge.renderCached}.
   */
  renderCached(
    chartId: string,
    ctx: CanvasRenderingContext2D,
    bounds: ChartBounds,
    sheetId?: SheetId,
  ): void {
    const legacyImportRenderStatus = this.chartImportRenderStatus.get(chartId);
    if (legacyImportRenderStatus) {
      this.renderError(ctx, bounds, {
        code: 'RENDER_FAILED',
        message: legacyImportRenderStatus.message,
        chartId,
        details: { importStatus: legacyImportRenderStatus.raw },
      });
      return;
    }

    const resolvedSheetId = sheetId ?? this.chartSheetIndex.get(chartId);
    if (!resolvedSheetId) {
      // First-paint case: floatingObject:created hasn't been delivered yet,
      // OR the chart was already deleted. Either way paint a placeholder; the
      // recovery path is the existing floating-object-pipeline call into
      // sheet-coordinator.ts which dirties the drawing layer once the event
      // lands. ensureCompiled would no-op anyway without a sheetId.
      this.renderPlaceholder(ctx, bounds, 'Chart loading…');
      return;
    }
    const key = this.cacheKey(chartId, resolvedSheetId);

    const importRenderStatus =
      this.chartImportRenderStatus.get(key) ?? this.chartImportRenderStatus.get(chartId);
    if (importRenderStatus) {
      this.renderError(ctx, bounds, {
        code: 'RENDER_FAILED',
        message: importRenderStatus.message,
        chartId,
        details: { importStatus: importRenderStatus.raw },
      });
      return;
    }

    const error = this.errorCache.get(key) ?? this.errorCache.get(chartId);
    if (error) {
      // Error precedence over loading: a known error state must not retry on
      // every frame. invalidateChart() clears errorCache when the upstream
      // fix lands (data range edited, etc.) and recovery happens normally.
      this.renderError(ctx, bounds, error);
      return;
    }

    const keyMarks = this.markCache.get(key);
    const legacyMarks = this.markCache.get(chartId);
    const marks = keyMarks ?? legacyMarks;
    const isDirty = keyMarks != null ? this.dirtyCharts.has(key) : this.dirtyCharts.has(chartId);
    const isCompilePending =
      this.pendingCompilations.has(key) || this.pendingCompilations.has(chartId);

    if (!marks) {
      // Cold-cache path: placeholder + background recompile. The compile
      // commit fires onCacheUpdate, the renderer dirties the drawing layer,
      // the next frame paints real marks from cache.
      this.renderPlaceholder(ctx, bounds, 'Chart loading…');
      if (!isCompilePending) {
        void this.ensureCompiled(chartId, resolvedSheetId);
      }
      return;
    }

    if (isDirty && !isCompilePending) {
      // Stale-but-show: paint stale marks this frame, kick a background
      // recompile. Mirrors getMarks's pendingCompilations stale-return at
      // the top of getMarks() and avoids a placeholder flash on every cell
      // edit affecting a chart's data range.
      void this.ensureCompiled(chartId, resolvedSheetId);
    }

    this.renderMarks(ctx, marks, bounds);
  }

  /**
   * Subscribe to cache-update notifications. See {@link IChartBridge.onCacheUpdate}.
   */
  onCacheUpdate(listener: (chartId: string) => void): () => void {
    this.cacheUpdateListeners.push(listener);
    return () => {
      const i = this.cacheUpdateListeners.indexOf(listener);
      if (i >= 0) this.cacheUpdateListeners.splice(i, 1);
    };
  }

  /**
   * Trigger compilation if dirty or absent. See {@link IChartBridge.ensureCompiled}.
   */
  async ensureCompiled(chartId: string, sheetId?: SheetId): Promise<void> {
    const resolvedSheetId = sheetId ?? this.chartSheetIndex.get(chartId);
    if (!resolvedSheetId) return;
    await this.getMarks(resolvedSheetId, chartId);
  }

  /**
   * Render a placeholder rectangle (cold-cache / loading state).
   *
   * Intentionally a minimal duplicate of
   * `canvas/drawing-canvas/src/renderers/render-utils.ts:renderPlaceholder` —
   * the kernel cannot import from canvas (kernel → canvas is forbidden by
   * the layering rules). Style mirrors `renderError` below: square-corner
   * grey rect, centred 12px label.
   *
   * Coordinate semantics: paints at `(bounds.x, bounds.y, bounds.w, bounds.h)`
   * in the engine-translated frame (engine + withRenderContext have already
   * applied the viewport offset). Do NOT translate to (0, 0) first — that
   * re-introduces the very frame-drift this round removes.
   */
  private renderPlaceholder(
    ctx: CanvasRenderingContext2D,
    bounds: ChartBounds,
    label: string,
  ): void {
    const { x, y, width, height } = bounds;

    ctx.save();
    ctx.fillStyle = '#f0f0f0';
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = '#999999';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + width / 2, y + height / 2, width - 8);
    ctx.restore();
  }

  /**
   * Render an error state for a chart.
   */
  private renderError(ctx: CanvasRenderingContext2D, bounds: ChartBounds, error: ChartError): void {
    const { x, y, width, height } = bounds;

    // Draw error background
    ctx.fillStyle = '#f8d7da';
    ctx.fillRect(x, y, width, height);

    // Draw error border
    ctx.strokeStyle = '#f5c6cb';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);

    // Draw error text
    ctx.fillStyle = '#721c24';
    ctx.font = '14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Truncate message if too long
    const maxChars = Math.floor(width / 8);
    const message =
      error.message.length > maxChars
        ? error.message.substring(0, maxChars - 3) + '...'
        : error.message;

    ctx.fillText(message, x + width / 2, y + height / 2);
  }

  /**
   * Render compiled marks to canvas using the charts library renderer.
   */
  private renderMarks(
    ctx: CanvasRenderingContext2D,
    marks: ChartMark[],
    bounds: ChartBounds,
  ): void {
    ctx.save();
    ctx.translate(bounds.x, bounds.y);

    // Create clipping region
    ctx.beginPath();
    ctx.rect(0, 0, bounds.width, bounds.height);
    ctx.clip();

    // Use the charts library's renderMark for full mark type support
    // (rect, path, arc, text, symbol)
    for (const mark of marks) {
      renderMark(ctx, mark as Parameters<typeof renderMark>[1]);
    }

    ctx.restore();
  }

  // ===========================================================================
  // Layout Retrieval
  // ===========================================================================

  /**
   * Get the layout snapshot for a chart.
   *
   * Returns a cached layout if available. If the chart is dirty (needs recompilation),
   * triggers getMarks() first to recompile and populate the layout cache.
   *
   * @param sheetId - Sheet ID
   * @param chartId - Chart ID
   * @returns Layout snapshot or null if chart not found / has no layout
   */
  async getLayout(sheetId: SheetId, chartId: string): Promise<ChartLayoutSnapshot | null> {
    const key = this.cacheKey(chartId, sheetId);
    // If layout is cached and chart is not dirty, return it directly
    const cached = this.layoutCache.get(key);
    if (cached && !this.dirtyCharts.has(key)) {
      return cached;
    }

    // Trigger recompilation which will populate the layout cache
    const marksOrError = await this.getMarks(sheetId, chartId);
    if ('code' in marksOrError) {
      return null;
    }

    return this.layoutCache.get(key) ?? null;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Get charts that are affected by changes in a specific cell range.
   *
   * Useful for determining which charts need re-rendering after a batch update.
   */
  async getChartsAffectedByRange(sheetId: SheetId, range: CellRange): Promise<string[]> {
    const charts = await this.getAllChartsInWorkbook();
    const affected: string[] = [];

    for (const chart of charts) {
      const resolved = await Charts.resolveChartRangeReferences(this.ctx, chart);
      const ranges = [resolved.dataRange, resolved.categoryRange, resolved.seriesRange];
      const overlaps = ranges.some((entry) => {
        const chartRange = entry?.range;
        return (
          chartRange?.sheetId === sheetId &&
          range.startRow <= chartRange.endRow &&
          range.endRow >= chartRange.startRow &&
          range.startCol <= chartRange.endCol &&
          range.endCol >= chartRange.startCol
        );
      });

      if (overlaps) {
        affected.push(chart.id);
      }
    }

    return affected;
  }

  /**
   * Get all dirty charts that need re-rendering.
   */
  getDirtyCharts(): string[] {
    return Array.from(this.dirtyCharts);
  }

  /**
   * Clear all caches. Useful for testing or full refresh.
   *
   * Fires onCacheUpdate listeners with the sentinel chartId `'*'` so the
   * renderer dirties the drawing layer. Without this signal, on-screen marks
   * would freeze (we have no marks in cache, but the renderer wouldn't know
   * to re-paint until something else dirtied it).
   */
  clearAllCaches(): void {
    this.markCache.clear();
    this.layoutCache.clear();
    this.errorCache.clear();
    this.chartImportRenderStatus.clear();
    this.dirtyCharts.clear();
    this.pendingCompilations.clear();
    this.fireCacheUpdate('*');
  }

  // ===========================================================================
  // Headless Image Export
  // ===========================================================================

  // TODO(06-CONSUMERS): Headless chart image export is not yet implemented.
  // The `exportChartImage` operation in chart-operations.ts currently returns
  // a "not implemented" error because it requires a canvas context
  // (OffscreenCanvas or DOM canvas) which is not available in headless/kernel
  // mode. To support server-side chart image export:
  //   1. Use OffscreenCanvas (available in Web Workers and Node 18+)
  //   2. Call getMarks() to compile the chart, then renderMarks() to an
  //      OffscreenCanvas, then canvas.toDataURL() / canvas.toBlob()
  //   3. Wire this through chart-operations.ts exportChartImage()
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new ChartBridge instance.
 *
 * @param ctx - Store context
 * @returns ChartBridge instance (not started)
 */
export function createChartBridge(ctx: DocumentContext): ChartBridge {
  return new ChartBridge(ctx);
}
