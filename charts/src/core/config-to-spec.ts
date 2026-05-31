/**
 * Comprehensive ChartConfig -> ChartSpec bridge.
 *
 * Maps ALL ChartConfig fields (storage format) to the corresponding ChartSpec
 * constructs (Vega-Lite compatible grammar format). This replaces the lossy
 * `configToSpec` in chart-engine.ts which only mapped ~3 of 30+ fields.
 *
 * Notable fixes from the old implementation:
 * - Bar chart encoding bug: x is now nominal (category), y is quantitative (value)
 * - Column chart: x is quantitative (value), y is nominal (category) (horizontal bar)
 *
 * Pure function - no DOM dependencies.
 */
import type {
  AxisSpec,
  ChannelSpec,
  ChartSpec,
  ConfigSpec,
  DataRow,
  EncodingSpec,
  LayerSpec,
  LegendOrient,
  LegendSpec,
  MarkSpec,
  MarkType,
  ScaleSpec,
  Transform,
  UnitSpec,
} from '../grammar/spec';
import type {
  AxisConfig,
  ChartConfig,
  ChartData,
  ChartDataPoint,
  ChartFormat,
  ChartType,
  LegendConfig,
  SeriesConfig,
  SingleAxisConfig,
} from '../types';
import { formatExcelSerialDateTick, formatTickValue } from '../grammar/axis-generator';
import { generateTicks, niceLinear } from '../primitives/scales/linear';
import {
  chartColorTintShade,
  chartStyleRepeatThemeColor,
  chartThemeColorKey,
  resolveChartColor,
  resolveChartTextColor,
  resolveFormatFillColor,
  resolveFormatFillOpacity,
  resolveFormatLineColor,
  resolveGridlineColor,
  resolveLineColor,
  resolveSolidFillColor,
} from '../utils/chart-colors';
import {
  CATEGORY_KEY_PREFIX,
  DEFAULT_CHART_HEIGHT,
  DEFAULT_CHART_WIDTH,
  MARK_TYPE_MAP,
  MINOR_GRIDLINE_TICK_COUNT,
  PIXELS_PER_COLUMN,
  PIXELS_PER_ROW,
  SERIES_OPACITY_FIELD,
} from './config-to-spec/constants';
import { buildDataLabelLayer } from './config-to-spec/layers/data-labels';
import { buildStockLayers } from './config-to-spec/layers/stock';
import { buildWaterfallLayers } from './config-to-spec/layers/waterfall';
import { hasSecondaryYAxis } from './config-to-spec/secondary-axis';
import { resolveStackMode, resolveSubTypeMarkProps } from './config-to-spec/subtypes';
import { buildTitle } from './config-to-spec/title';
import { buildTrendlineTransform, buildWaterfallTransforms } from './config-to-spec/transforms';
import { linePointsToCanvasPx, pointsToCanvasPx } from './config-to-spec/units';

export {
  buildDataLabelLayer,
  buildStockLayers,
  buildTitle,
  buildTrendlineTransform,
  buildWaterfallLayers,
  buildWaterfallTransforms,
  hasSecondaryYAxis,
  resolveStackMode,
  resolveSubTypeMarkProps,
};

function isStrokeColoredSeries(series: SeriesConfig, fallbackType: ChartType | undefined): boolean {
  const seriesType = (series.type ?? fallbackType) as ChartType | undefined;
  const markType = seriesType ? MARK_TYPE_MAP[seriesType] : undefined;
  return markType === 'line' || markType === 'point' || markType === 'rule';
}

function resolveSeriesColor(
  series: SeriesConfig,
  index: number,
  fallbackType?: ChartType,
): string | undefined {
  const fill = series.format?.fill;
  const fillTheme = fill?.type === 'solid' ? chartThemeColorKey(fill.color) : undefined;
  const fillHasExplicitTransform =
    fill?.type === 'solid' && chartColorTintShade(fill.color) !== undefined;
  const sourceIndex = typeof series.idx === 'number' ? series.idx : index;
  const fillColor =
    (fillHasExplicitTransform ? resolveFormatFillColor(series.format) : undefined) ??
    chartStyleRepeatThemeColor(fillTheme, sourceIndex) ??
    resolveFormatFillColor(series.format);
  const lineColor = resolveFormatLineColor(series.format);

  if (isStrokeColoredSeries(series, fallbackType)) {
    return (series.color ? resolveChartColor(series.color) : undefined) ?? lineColor ?? fillColor;
  }

  return (series.color ? resolveChartColor(series.color) : undefined) ?? fillColor ?? lineColor;
}

function resolvedCategoryColors(config: ChartConfig): string[] | undefined {
  const seriesColors = (config.series ?? [])
    .map((series, index) =>
      isNoFillNoLineSeries(series) ? undefined : resolveSeriesColor(series, index, config.type),
    )
    .filter(Boolean) as string[];
  if (seriesColors.length > 0) return seriesColors;
  const configColors = (config.colors ?? [])
    .map((color) => resolveChartColor(color))
    .filter(Boolean) as string[];
  return configColors.length > 0 ? configColors : undefined;
}

function normalizeAxisLabelAngle(
  axisConf: NonNullable<AxisConfig['xAxis']> | NonNullable<AxisConfig['yAxis']>,
): number | undefined {
  const textVerticalType = (
    axisConf.format as (ChartFormat & { textVerticalType?: string }) | undefined
  )?.textVerticalType;
  switch (textVerticalType) {
    case 'vert':
    case 'wordArtVert':
    case 'eaVert':
    case 'mongolianVert':
      return 90;
    case 'vert270':
    case 'wordArtVertRtl':
      return -90;
    case 'horz':
      return undefined;
    default:
      break;
  }

  const raw = axisConf.textOrientation ?? axisConf.format?.textRotation;
  if (raw === undefined) return undefined;
  if (raw === 0) return 0;
  const degrees = Math.abs(raw) >= 60000 ? raw / 60000 : raw;
  if (Math.abs(degrees) > 90) return undefined;
  if (Math.abs(degrees) <= 90) return degrees;
  return undefined;
}

function hasVisibleLineStyle(line: unknown): boolean {
  if (!line || typeof line !== 'object') return false;
  const candidate = line as { color?: unknown; width?: unknown };
  return candidate.color !== undefined || candidate.width !== undefined;
}

function isNoFillNoLineSeries(series: SeriesConfig | undefined): boolean {
  if (!series?.format) return false;
  return series.format.fill?.type === 'none' && !hasVisibleLineStyle(series.format.line);
}

function dashStyleToStrokeDash(
  dashStyle: NonNullable<ChartFormat['line']>['dashStyle'],
  width: number | undefined,
): number[] | undefined {
  const unit = Math.max(1, width ?? 1);
  switch (dashStyle) {
    case 'dot':
      return [unit, unit * 2];
    case 'dash':
      return [unit * 4, unit * 2];
    case 'dashDot':
      return [unit * 4, unit * 2, unit, unit * 2];
    case 'longDash':
      return [unit * 8, unit * 2];
    case 'longDashDot':
      return [unit * 8, unit * 2, unit, unit * 2];
    case 'longDashDotDot':
      return [unit * 8, unit * 2, unit, unit * 2, unit, unit * 2];
    default:
      return undefined;
  }
}

// =============================================================================
// Data Conversion
// =============================================================================

/**
 * Convert ChartData (categories + series) to flat DataRow[] for the grammar.
 * Each row gets { category, value, series } fields.
 *
 * For stock charts with OHLC data, we also emit open/high/low/close fields
 * from the data point's extra properties when available.
 */
export function chartDataToRows(data: ChartData, config?: ChartConfig): DataRow[] {
  const rows: DataRow[] = [];
  const categories = data.categories ?? [];
  const useExcelDateSerialCategories = config
    ? shouldUseDateSerialCategoryAxis(config, data, isHorizontalBarType(config.type))
    : false;
  const useStableCategoryKeys = shouldUseStableCategoryKeys(
    config,
    data,
    useExcelDateSerialCategories,
  );
  const seriesConfigs = config?.series ?? [];
  for (let i = 0; i < categories.length; i++) {
    const rawCategory = categories[i];
    const category = useExcelDateSerialCategories ? toFiniteNumber(rawCategory) : undefined;
    const rowCategory = useStableCategoryKeys
      ? categoryKeyForIndex(i)
      : (category ?? String(rawCategory));
    for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
      const series = data.series[seriesIndex];
      const point = series.data[i];
      if (point && shouldIncludePointInRows(point, config)) {
        const row: DataRow = {
          category: rowCategory,
          value: point.y,
          series: series.name,
        };
        if (config?.series?.some(isNoFillNoLineSeries)) {
          row[SERIES_OPACITY_FIELD] = isNoFillNoLineSeries(seriesConfigs[seriesIndex]) ? 0 : 1;
        }
        const categoryFormatCode = data.categoryFormatCodes?.[i];
        if (categoryFormatCode) row.categoryFormatCode = categoryFormatCode;
        // Propagate OHLC fields if present (for stock charts)
        if (point.open !== undefined) row.open = point.open;
        if (point.high !== undefined) row.high = point.high;
        if (point.low !== undefined) row.low = point.low;
        if (point.close !== undefined) row.close = point.close;
        rows.push(row);
      }
    }
  }
  return rows;
}

function categoryKeyForIndex(index: number): string {
  return `${CATEGORY_KEY_PREFIX}:${index}`;
}

function categoryDisplayLabel(value: string | number | null | undefined): string {
  return value == null ? '' : String(value);
}

function hasDuplicateOrBlankCategoryLabels(data: ChartData): boolean {
  const seen = new Set<string>();
  for (const category of data.categories ?? []) {
    const label = categoryDisplayLabel(category);
    if (label === '' || seen.has(label)) return true;
    seen.add(label);
  }
  return false;
}

function shouldUseStableCategoryKeys(
  config: ChartConfig | undefined,
  data: ChartData,
  useExcelDateSerialCategories: boolean,
): boolean {
  if (!config?.extra || useExcelDateSerialCategories) return false;
  return hasDuplicateOrBlankCategoryLabels(data);
}

function shouldIncludePointInRows(point: ChartDataPoint, config?: ChartConfig): boolean {
  if (!point.valueState || point.valueState === 'value') return true;
  if (point.valueState === 'blank') {
    return config?.displayBlanksAs === 'zero';
  }
  return false;
}

// =============================================================================
// Encoding Helpers
// =============================================================================

/**
 * Map AxisConfig.xAxis / yAxis type to a ChartSpec AxisSpec partial.
 */
function mapAxisConfigToAxisSpec(axisConf: SingleAxisConfig): AxisSpec {
  const spec: AxisSpec = {};
  spec.title = axisConf.title ?? null;
  if (axisConf.visible === false || axisConf.show === false) {
    spec.labels = false;
    spec.ticks = false;
    spec.domain = false;
    spec.grid = false;
    return spec;
  }
  if (axisConf.gridLines !== undefined) spec.grid = axisConf.gridLines;
  if (axisConf.minorGridLines !== undefined) {
    // Minor grid lines are represented by halving the tick count
    // (spec doesn't have a dedicated minor grid, so this is the closest mapping)
    if (axisConf.minorGridLines) {
      spec.tickCount = MINOR_GRIDLINE_TICK_COUNT; // More ticks to simulate minor gridlines
    }
  }
  if (axisConf.tickMarks === 'none') spec.ticks = false;
  if (axisConf.numberFormat) spec.format = axisConf.numberFormat;
  if (isDateAxisConfig(axisConf)) {
    spec.formatType = 'time';
    const tickInterval = dateAxisTickInterval(axisConf);
    if (tickInterval) spec.tickInterval = tickInterval;
    else {
      const majorUnit = toFiniteNumber(axisConf.majorUnit);
      if (majorUnit !== undefined && majorUnit > 0) spec.tickStep = majorUnit;
    }
  }
  if (axisConf.crossesAt) spec.crossesAt = axisConf.crossesAt;
  if (axisConf.crossesAtValue !== undefined) spec.crossesAtValue = axisConf.crossesAtValue;

  const labelFont = axisConf.format?.font;
  if (labelFont?.size !== undefined) spec.labelFontSize = pointsToCanvasPx(labelFont.size);
  if (labelFont?.name) spec.labelFontFamily = labelFont.name;
  const labelColor = resolveChartTextColor(labelFont?.color);
  if (labelColor) spec.labelColor = labelColor;

  const labelAngle = normalizeAxisLabelAngle(axisConf);
  const isCategoryAxis = axisConf.axisType === 'catAx' || axisConf.type === 'category';
  if (isCategoryAxis && axisConf.tickMarks === 'none') {
    spec.labelPadding = 14;
  }
  if (labelAngle !== undefined) {
    spec.labelAngle = labelAngle;
  }

  const axisLine = axisConf.format?.line;
  if (axisLine && !hasVisibleLineStyle(axisLine)) {
    spec.domain = false;
    spec.ticks = false;
  }
  const axisLineColor = resolveChartTextColor(axisLine?.color);
  if (axisLineColor) {
    spec.domainColor = axisLineColor;
    spec.tickColor = axisLineColor;
  }
  if (axisLine?.width !== undefined) {
    const lineWidth = linePointsToCanvasPx(axisLine.width);
    spec.domainWidth = lineWidth;
    spec.tickWidth = lineWidth;
  }

  const gridlineColor = resolveGridlineColor(axisConf.gridlineFormat?.color);
  if (gridlineColor) spec.gridColor = gridlineColor;
  if (axisConf.gridlineFormat?.width !== undefined) {
    spec.gridWidth = linePointsToCanvasPx(axisConf.gridlineFormat.width);
  }
  const gridDash = dashStyleToStrokeDash(
    axisConf.gridlineFormat?.dashStyle,
    linePointsToCanvasPx(axisConf.gridlineFormat?.width),
  );
  if (gridDash) spec.gridDash = gridDash;
  if (axisConf.gridlineFormat) {
    spec.gridOpacity =
      axisConf.gridlineFormat.transparency === undefined
        ? 1
        : Math.max(0, Math.min(1, 1 - axisConf.gridlineFormat.transparency));
  }

  const titleFont = axisConf.titleFormat?.font;
  if (titleFont?.size !== undefined) spec.titleFontSize = pointsToCanvasPx(titleFont.size);
  if (titleFont?.name) spec.titleFontFamily = titleFont.name;
  const titleColor = resolveChartTextColor(titleFont?.color);
  if (titleColor) spec.titleColor = titleColor;
  return spec;
}

/**
 * Map AxisType to ScaleType for encoding scale configuration.
 * Returns undefined for default types that don't need explicit scale setting.
 */
function axisTypeToScaleType(
  axisType: import('../types').AxisType | undefined,
): import('../grammar/spec').ScaleType | undefined {
  if (!axisType) return undefined;
  if (axisType === 'log') return 'log';
  if (axisType === 'time') return 'time';
  // 'linear', 'category', 'value' are defaults - no explicit scale needed
  return undefined;
}

/**
 * Build axis scale domain from min/max config.
 */
function buildAxisScaleDomain(
  axisConf: { min?: number; max?: number } | undefined,
): { domain?: [number | undefined, number | undefined] } | undefined {
  if (!axisConf) return undefined;
  if (axisConf.min !== undefined || axisConf.max !== undefined) {
    // Only set domain if at least one bound is given
    const domain: [number | undefined, number | undefined] = [axisConf.min, axisConf.max];
    return { domain };
  }
  return undefined;
}

function buildAxisScaleSpec(
  axisConf: SingleAxisConfig | undefined,
  useDateSerialCategoryAxis: boolean,
): ScaleSpec | undefined {
  if (!axisConf) {
    return useDateSerialCategoryAxis ? { type: 'linear', zero: false, nice: false } : undefined;
  }

  const scaleDomain = buildAxisScaleDomain(axisConf);
  const scaleType = useDateSerialCategoryAxis ? 'linear' : axisTypeToScaleType(axisConf.type);
  const hasExplicitDomain = Boolean(scaleDomain?.domain?.some((bound) => bound !== undefined));
  const scaleSpec: ScaleSpec = {
    ...(scaleDomain ?? {}),
    ...(scaleType ? { type: scaleType } : {}),
    ...(useDateSerialCategoryAxis ? { zero: false } : {}),
    ...(useDateSerialCategoryAxis || hasExplicitDomain ? { nice: false } : {}),
  };

  return Object.keys(scaleSpec).length > 0 ? scaleSpec : undefined;
}

function resolveAxisConfigForChannel(
  axis: AxisConfig | undefined,
  channel: 'x' | 'y',
  isHorizontal: boolean,
): SingleAxisConfig | undefined {
  if (!axis) return undefined;
  if (channel === 'x') {
    return isHorizontal ? (axis.valueAxis ?? axis.xAxis) : (axis.xAxis ?? axis.categoryAxis);
  }
  return isHorizontal ? (axis.categoryAxis ?? axis.yAxis) : (axis.yAxis ?? axis.valueAxis);
}

function isDateAxisConfig(axisConf: SingleAxisConfig | undefined): boolean {
  if (!axisConf) return false;
  const axisType = axisConf.axisType?.toLowerCase();
  return (
    axisType === 'dateax' ||
    axisType === 'date' ||
    axisConf.categoryType === 'dateAxis' ||
    axisConf.type === 'time'
  );
}

function dateAxisTickInterval(axisConf: SingleAxisConfig): AxisSpec['tickInterval'] | undefined {
  const majorUnit = toFiniteNumber(axisConf.majorUnit);
  if (majorUnit === undefined || majorUnit <= 0) return undefined;

  const unit = normalizeDateAxisTimeUnit(axisConf.majorTimeUnit ?? axisConf.baseTimeUnit);
  return unit ? { unit, step: majorUnit } : undefined;
}

function normalizeDateAxisTimeUnit(
  value: string | undefined,
): NonNullable<AxisSpec['tickInterval']>['unit'] | undefined {
  switch (value?.toLowerCase()) {
    case 'day':
    case 'days':
      return 'day';
    case 'month':
    case 'months':
      return 'month';
    case 'year':
    case 'years':
      return 'year';
    default:
      return undefined;
  }
}

function shouldUseDateSerialCategoryAxis(
  config: ChartConfig,
  data: ChartData,
  isHorizontal: boolean,
): boolean {
  if (!supportsContinuousCategoryAxis(config.type) || isHorizontal) return false;
  const categoryAxis = resolveAxisConfigForChannel(config.axis, 'x', isHorizontal);
  return isDateAxisConfig(categoryAxis) && hasFiniteCategorySerials(data);
}

function supportsContinuousCategoryAxis(chartType: ChartType): boolean {
  if (chartType === 'combo') return true;
  if (chartType === 'radar') return false;
  const markType = MARK_TYPE_MAP[chartType];
  return markType === 'line' || markType === 'area';
}

function shouldReverseHorizontalCategoryAxis(config: ChartConfig, isHorizontal: boolean): boolean {
  return isHorizontal && config.extra !== undefined;
}

function hasFiniteCategorySerials(data: ChartData): boolean {
  const categories = data.categories ?? [];
  if (categories.length === 0) return false;

  let finiteCount = 0;
  for (const category of categories) {
    const serial = toFiniteNumber(category);
    if (serial === undefined) return false;
    finiteCount += 1;
  }
  return finiteCount > 0;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function explicitDomainBound(domain: unknown[] | undefined, index: number): number | undefined {
  const value = domain?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Map LegendConfig.position to LegendOrient.
 */
function legendPositionToOrient(position: string): LegendOrient {
  switch (position) {
    case 't':
    case 'top':
      return 'top';
    case 'b':
    case 'bottom':
      return 'bottom';
    case 'l':
    case 'left':
      return 'left';
    case 'r':
    case 'right':
      return 'right';
    case 'tr':
    case 'topRight':
    case 'top-right':
    case 'corner':
      return 'top-right';
    case 'none':
      return 'none';
    default:
      return 'bottom';
  }
}

function isLegendShown(legend: LegendConfig | undefined): legend is LegendConfig {
  return Boolean(legend && legend.show && legend.visible !== false && legend.position !== 'none');
}

/**
 * Build encoding for the color channel, including legend config.
 */
function buildColorEncoding(
  hasMultipleSeries: boolean,
  legend?: LegendConfig,
  colors?: string[],
  reverseLegend?: boolean,
  legendDomain?: string[],
  symbolType?: LegendSpec['symbolType'],
): ChannelSpec | undefined {
  if (!hasMultipleSeries) return undefined;
  const channel: ChannelSpec = {
    field: 'series',
    type: 'nominal',
  };
  if ((colors && colors.length > 0) || (legendDomain && legendDomain.length > 0)) {
    channel.scale = {
      ...(legendDomain && legendDomain.length > 0 ? { domain: legendDomain } : {}),
      ...(colors && colors.length > 0 ? { range: colors } : {}),
    };
  }
  if (legend) {
    if (!isLegendShown(legend)) {
      channel.legend = null; // hide
    } else {
      const legendFont = legend.format?.font ?? legend.font;
      const labelColor = resolveChartTextColor(legendFont?.color);
      channel.legend = {
        orient: legendPositionToOrient(legend.position),
        title: null,
        ...(reverseLegend ? { reverse: true } : {}),
        ...(symbolType ? { symbolType } : {}),
        ...(legendFont?.size !== undefined
          ? { labelFontSize: pointsToCanvasPx(legendFont.size) }
          : {}),
        ...(legendFont?.name ? { labelFontFamily: legendFont.name } : {}),
        ...(labelColor ? { labelColor } : {}),
      };
    }
  }
  return channel;
}

function visibleLegendDomain(config: ChartConfig, data: ChartData): string[] | undefined {
  const seriesConfigs = config.series ?? [];
  if (!seriesConfigs.some(isNoFillNoLineSeries)) return undefined;

  const names: string[] = [];
  for (let index = 0; index < data.series.length; index += 1) {
    if (isNoFillNoLineSeries(seriesConfigs[index])) continue;
    const name = data.series[index]?.name;
    if (name && !names.includes(name)) names.push(name);
  }

  return names.length > 0 ? names : undefined;
}

function legendSymbolType(
  config: ChartConfig,
  data: ChartData,
): LegendSpec['symbolType'] | undefined {
  const markTypes = data.series
    .map((series, index) => {
      const seriesConfig = config.series?.[index];
      if (isNoFillNoLineSeries(seriesConfig)) return undefined;
      const seriesType = (seriesConfig?.type ?? series.type ?? config.type) as ChartType;
      return MARK_TYPE_MAP[seriesType];
    })
    .filter(Boolean);

  return markTypes.length > 0 && markTypes.every((markType) => markType === 'line')
    ? 'line'
    : undefined;
}

/**
 * Build the main encoding spec for a chart.
 *
 * IMPORTANT: The old chart-engine.ts had a bug where bar chart x/y types were
 * inverted. This implementation FIXES that:
 *
 *   column (vertical bars): x = nominal (category), y = quantitative (value)
 *   bar (horizontal bars):  x = quantitative (value), y = nominal (category)
 */
export function buildEncoding(config: ChartConfig, data: ChartData): EncodingSpec {
  const encoding: EncodingSpec = {};
  const chartType = config.type;
  const hasMultipleSeries = data.series.length > 1;

  // --- Pie / Doughnut / Pie3D / OfPie: theta + color instead of x/y ---
  if (
    chartType === 'pie' ||
    chartType === 'doughnut' ||
    chartType === 'pie3d' ||
    chartType === 'ofPie'
  ) {
    encoding.theta = {
      field: 'value',
      type: 'quantitative',
    };
    encoding.color = {
      field: 'category',
      type: 'nominal',
    };
    const categoryColors = resolvedCategoryColors(config);
    if (categoryColors) {
      encoding.color.scale = { range: categoryColors };
    }
    // Apply legend config to color channel
    if (config.legend) {
      if (!isLegendShown(config.legend)) {
        encoding.color.legend = null;
      } else {
        const legendFont = config.legend.format?.font ?? config.legend.font;
        const labelColor = resolveChartTextColor(legendFont?.color);
        encoding.color.legend = {
          orient: legendPositionToOrient(config.legend.position),
          title: null,
          ...(resolveStackMode(config) ? { reverse: true } : {}),
          ...(legendFont?.size !== undefined
            ? { labelFontSize: pointsToCanvasPx(legendFont.size) }
            : {}),
          ...(legendFont?.name ? { labelFontFamily: legendFont.name } : {}),
          ...(labelColor ? { labelColor } : {}),
        };
      }
    }
    return encoding;
  }

  // --- X/Y encoding for all other chart types ---
  // Excel column charts are vertical; Excel bar charts are horizontal.
  const isHorizontal = isHorizontalBarType(chartType);
  const useDateSerialCategoryAxis = shouldUseDateSerialCategoryAxis(config, data, isHorizontal);
  const useStableCategoryKeys = shouldUseStableCategoryKeys(
    config,
    data,
    useDateSerialCategoryAxis,
  );
  const categoryChannel: ChannelSpec = {
    field: 'category',
    type: useDateSerialCategoryAxis ? 'quantitative' : 'nominal',
    ...(useDateSerialCategoryAxis
      ? { scale: { type: 'linear', zero: false, nice: false } }
      : useStableCategoryKeys || shouldReverseHorizontalCategoryAxis(config, isHorizontal)
        ? {
            scale: {
              ...(useStableCategoryKeys
                ? { domain: data.categories.map((_category, index) => categoryKeyForIndex(index)) }
                : {}),
              ...(shouldReverseHorizontalCategoryAxis(config, isHorizontal)
                ? { reverse: true }
                : {}),
            },
          }
        : {}),
  };
  const valueChannel: ChannelSpec = { field: 'value', type: 'quantitative' };
  if (isHorizontal) {
    encoding.x = valueChannel;
    encoding.y = categoryChannel;
  } else {
    encoding.x = categoryChannel;
    encoding.y = valueChannel;
  }

  // Apply axis config
  if (config.axis) {
    const xAxis = resolveAxisConfigForChannel(config.axis, 'x', isHorizontal);
    if (xAxis && encoding.x) {
      encoding.x.axis = mapAxisConfigToAxisSpec(xAxis);
      const scaleSpec = buildAxisScaleSpec(xAxis, useDateSerialCategoryAxis);
      if (scaleSpec) encoding.x.scale = { ...(encoding.x.scale ?? {}), ...scaleSpec };
    }
    const yAxis = resolveAxisConfigForChannel(config.axis, 'y', isHorizontal);
    if (yAxis && encoding.y) {
      encoding.y.axis = mapAxisConfigToAxisSpec(yAxis);
      const scaleSpec = buildAxisScaleSpec(yAxis, false);
      if (scaleSpec) encoding.y.scale = { ...(encoding.y.scale ?? {}), ...scaleSpec };
    }
  }

  applyBarCategorySpacingScale(config, encoding, isHorizontal);
  applyCategoryAxisLabels(data, encoding, isHorizontal, useStableCategoryKeys);

  // Color encoding for multi-series
  const legendDomain = visibleLegendDomain(config, data);
  const colorChannel = buildColorEncoding(
    hasMultipleSeries,
    config.legend,
    resolvedCategoryColors(config),
    Boolean(resolveStackMode(config)) && !legendDomain,
    legendDomain,
    legendSymbolType(config, data),
  );
  if (colorChannel) {
    encoding.color = colorChannel;
  }
  if (config.series?.some(isNoFillNoLineSeries)) {
    encoding.opacity = {
      field: SERIES_OPACITY_FIELD,
      type: 'quantitative',
      scale: { domain: [0, 1], range: [0, 1] },
      legend: null,
    };
  }

  applyStackedValueDomain(config, data, encoding);
  applyAutomaticCategoryAxisCrossing(encoding);

  return encoding;
}

function hasBarSpacingConfig(config: ChartConfig): boolean {
  return typeof config.gapWidth === 'number' || typeof config.overlap === 'number';
}

function applyBarCategorySpacingScale(
  config: ChartConfig,
  encoding: EncodingSpec,
  isHorizontal: boolean,
): void {
  if (MARK_TYPE_MAP[config.type] !== 'bar' || !hasBarSpacingConfig(config)) return;
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel) return;

  categoryChannel.scale = {
    ...(categoryChannel.scale ?? {}),
    paddingInner: 0,
    paddingOuter: 0,
  };
}

function applyCategoryAxisLabels(
  data: ChartData,
  encoding: EncodingSpec,
  isHorizontal: boolean,
  useStableCategoryKeys: boolean,
): void {
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel || categoryChannel.axis === null) return;

  const labelTextByValue: Record<string, string> = {};
  if (useStableCategoryKeys) {
    data.categories.forEach((category, index) => {
      labelTextByValue[categoryKeyForIndex(index)] = categoryDisplayLabel(category);
    });
  }

  const labelFormatByValue: Record<string, string> = {};
  if (data.categoryFormatCodes?.some(Boolean)) {
    data.categories.forEach((category, index) => {
      const formatCode = data.categoryFormatCodes?.[index];
      if (formatCode) {
        const key = useStableCategoryKeys ? categoryKeyForIndex(index) : String(category);
        labelFormatByValue[key] = formatCode;
      }
    });
  }
  if (Object.keys(labelTextByValue).length === 0 && Object.keys(labelFormatByValue).length === 0) {
    return;
  }

  categoryChannel.axis = {
    ...(categoryChannel.axis ?? {}),
    ...(Object.keys(labelTextByValue).length > 0 ? { labelTextByValue } : {}),
    ...(Object.keys(labelFormatByValue).length > 0 ? { labelFormatByValue } : {}),
  };
}

function isHorizontalBarType(chartType: ChartType): boolean {
  switch (chartType) {
    case 'bar':
    case 'bar3d':
    case 'cylinderBarClustered':
    case 'cylinderBarStacked':
    case 'cylinderBarStacked100':
    case 'coneBarClustered':
    case 'coneBarStacked':
    case 'coneBarStacked100':
    case 'pyramidBarClustered':
    case 'pyramidBarStacked':
    case 'pyramidBarStacked100':
      return true;
    default:
      return false;
  }
}

function applyStackedValueDomain(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
): void {
  const stack = resolveStackMode(config);
  if (!stack || stack === 'normalize') return;

  const chartType = config.type;
  const valueChannel = isHorizontalBarType(chartType) ? encoding.x : encoding.y;
  if (!valueChannel) return;

  const existingDomain = Array.isArray(valueChannel.scale?.domain)
    ? valueChannel.scale.domain
    : undefined;
  const explicitMin = explicitDomainBound(existingDomain, 0);
  const explicitMax = explicitDomainBound(existingDomain, 1);

  let maxPositive = 0;
  let minNegative = 0;
  for (let pointIndex = 0; pointIndex < (data.categories?.length ?? 0); pointIndex += 1) {
    let positive = 0;
    let negative = 0;
    for (const series of data.series) {
      const value = series.data[pointIndex]?.y;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value >= 0) positive += value;
      else negative += value;
    }
    if (positive > maxPositive) maxPositive = positive;
    if (negative < minNegative) minNegative = negative;
  }

  if (maxPositive === 0 && minNegative === 0) return;

  const isAutoDivergingStack =
    explicitMin === undefined && explicitMax === undefined && minNegative < 0 && maxPositive > 0;

  valueChannel.scale = {
    ...(valueChannel.scale ?? {}),
    domain: [explicitMin ?? minNegative, explicitMax ?? maxPositive],
    ...(isAutoDivergingStack ? { nice: valueChannel.scale?.nice ?? 6 } : {}),
  };

  if (isAutoDivergingStack) {
    valueChannel.axis = {
      ...(valueChannel.axis ?? {}),
      tickCount: valueChannel.axis?.tickCount ?? 6,
    };
  }
}

function applyAutomaticCategoryAxisCrossing(encoding: EncodingSpec): void {
  const x = encoding.x;
  const y = encoding.y;
  if (!x || !y || x.type !== 'nominal' || y.type !== 'quantitative') return;
  if (x.axis === null || x.axis?.crossesAt !== undefined) return;

  const scaleDomain = Array.isArray(y.scale?.domain) ? y.scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined || min >= 0 || max <= 0) return;

  x.axis = {
    ...(x.axis ?? {}),
    crossesAt: 'automatic',
  };
}

// =============================================================================
// Mark Spec Builder
// =============================================================================

/**
 * Attach pie slice explosion indices as metadata on the mark spec.
 * These are consumed by the OOXML exporter for per-slice explosion.
 */
function applyPieSliceExplosion(mark: MarkSpec, config: ChartConfig): void {
  if (!config.pieSlice) return;
  const pieSlice = config.pieSlice as typeof config.pieSlice & { explodedIndex?: number };
  const explodedIndex = pieSlice.explodedIndex ?? pieSlice.explosion;
  if (explodedIndex !== undefined) {
    mark._explodedIndex = explodedIndex;
  }
  if (pieSlice.explodedIndices !== undefined && pieSlice.explodedIndices.length > 0) {
    mark._explodedIndices = pieSlice.explodedIndices;
  }
}

function applyImportedBarOutline(mark: MarkSpec, config: ChartConfig): void {
  if (MARK_TYPE_MAP[config.type] !== 'bar') return;
  const line = config.series?.find(
    (series) => !isNoFillNoLineSeries(series) && hasVisibleLineStyle(series.format?.line),
  )?.format?.line;
  if (!line) return;

  mark.stroke = resolveLineColor(line) ?? mark.stroke ?? '#000000';
  const strokeWidth = linePointsToCanvasPx(line.width);
  if (strokeWidth !== undefined) mark.strokeWidth = strokeWidth;
}

/**
 * Build the mark spec for a chart, incorporating subType props and
 * chart-type-specific settings.
 */
export function buildMark(config: ChartConfig): MarkType | MarkSpec {
  const baseType = MARK_TYPE_MAP[config.type] ?? 'bar';
  const subProps = resolveSubTypeMarkProps(config);

  // Pie3D: same as pie (3D is visual-only)
  if (config.type === 'pie3d') {
    const mark: MarkSpec = {
      type: 'arc',
      ...(subProps || {}),
    };
    if (config.pieSlice?.explodeOffset) {
      mark.padAngle = config.pieSlice.explodeOffset;
    }
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // OfPie: pie-of-pie or bar-of-pie (render as arc; no grammar equivalent for secondary pie)
  if (config.type === 'ofPie') {
    const mark: MarkSpec = {
      type: 'arc',
      ...(subProps || {}),
    };
    return mark;
  }

  // Doughnut: arc with innerRadius
  if (config.type === 'doughnut') {
    const mark: MarkSpec = {
      type: 'arc',
      innerRadius: 0.5,
      ...(subProps || {}),
    };
    // Pie slice explosion
    if (config.pieSlice?.explodeOffset) {
      mark.padAngle = config.pieSlice.explodeOffset;
    }
    // Attach explosion indices as metadata for OOXML export
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // Pie: arc (no innerRadius)
  if (config.type === 'pie') {
    const mark: MarkSpec = {
      type: 'arc',
      ...(subProps || {}),
    };
    if (config.pieSlice?.explodeOffset) {
      mark.padAngle = config.pieSlice.explodeOffset;
    }
    // Attach explosion indices as metadata for OOXML export
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // Scatter with lines
  if (config.type === 'scatter') {
    if (config.showLines) {
      const mark: MarkSpec = { type: 'line' };
      if (config.smoothLines) {
        mark.interpolate = 'monotone';
      }
      mark.point = true;
      return mark;
    }
    // Smooth scatter (no lines but smooth points connected)
    if (config.smoothLines) {
      return { type: 'point' };
    }
  }

  // Radar: line with linear-closed interpolation + optional fill + markers
  if (config.type === 'radar') {
    const mark: MarkSpec = { type: config.radarFilled ? 'area' : 'line' };
    mark.interpolate = 'linear-closed';
    if (config.radarMarkers) {
      mark.point = true;
    }
    return mark;
  }

  // Funnel: bar with decreasing width (represented as horizontal bars)
  if (config.type === 'funnel') {
    return { type: 'bar', cornerRadius: 2 };
  }

  // If subType props change the mark type or add interpolation
  if (subProps) {
    const mark: MarkSpec = {
      type: subProps.type ?? baseType,
      ...subProps,
    };
    applyImportedBarOutline(mark, config);
    return mark;
  }

  if (baseType === 'bar') {
    const mark: MarkSpec = { type: baseType };
    applyImportedBarOutline(mark, config);
    return mark.stroke || mark.strokeWidth !== undefined ? mark : baseType;
  }

  // Simple mark type string
  return baseType;
}

// =============================================================================
// Config Spec Builder (global config options)
// =============================================================================

/**
 * Build the ConfigSpec from chart-level settings: stacking, colors, data labels.
 */
export function buildConfigSpec(
  config: ChartConfig,
  encoding?: EncodingSpec,
  data?: ChartData,
): ConfigSpec | undefined {
  const configSpec: ConfigSpec = {};
  let hasConfig = false;

  // Stacking
  const stack = resolveStackMode(config);
  if (stack !== undefined) {
    configSpec.stack = stack;
    hasConfig = true;
  }

  if (typeof config.gapWidth === 'number') {
    configSpec.gapWidth = config.gapWidth;
    hasConfig = true;
  }
  if (typeof config.overlap === 'number') {
    configSpec.overlap = config.overlap;
    hasConfig = true;
  }

  // Colors
  const categoryColors = resolvedCategoryColors(config);
  if (categoryColors && categoryColors.length > 0) {
    configSpec.range = { category: categoryColors };
    hasConfig = true;
  }

  const background =
    resolveFormatFillColor(config.chartFormat) ??
    resolveSolidFillColor(config.chartArea?.fill) ??
    resolveFormatFillColor(config.chartArea?.format);
  if (background) {
    configSpec.background = background;
    hasConfig = true;
  }

  const leftYAxisLabelWidth =
    estimateNominalYAxisLabelWidth(encoding, data) ?? estimateYAxisLabelWidth(encoding);
  const rightYAxisLabelWidth = estimateSecondaryYAxisLabelWidth(config, data);
  const bottomMargin = estimateXAxisBottomMargin(encoding);
  if (
    leftYAxisLabelWidth !== undefined ||
    rightYAxisLabelWidth !== undefined ||
    bottomMargin !== undefined
  ) {
    configSpec.layoutHints = {
      ...(leftYAxisLabelWidth !== undefined
        ? { leftYAxisLabelWidth, yAxisLabelWidth: leftYAxisLabelWidth }
        : {}),
      ...(rightYAxisLabelWidth !== undefined ? { rightYAxisLabelWidth } : {}),
      ...(bottomMargin !== undefined ? { bottomMargin } : {}),
    };
    hasConfig = true;
  }

  return hasConfig ? configSpec : undefined;
}

function estimateNominalYAxisLabelWidth(
  encoding: EncodingSpec | undefined,
  data: ChartData | undefined,
): number | undefined {
  const y = encoding?.y;
  if (!y || y.type === 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }

  const labels = data?.categories ?? [];
  if (labels.length === 0) return undefined;

  const maxLabelLength = Math.max(0, ...labels.map((label) => String(label ?? '').length));
  if (maxLabelLength === 0) return undefined;

  const fontSize = y.axis?.labelFontSize ?? 11;
  const estimatedWidth = Math.ceil(maxLabelLength * fontSize * 0.52);
  return Math.max(60, Math.min(660, estimatedWidth));
}

function estimateYAxisLabelWidth(encoding: EncodingSpec | undefined): number | undefined {
  const y = encoding?.y;
  if (!y || y.type !== 'quantitative' || y.axis === null || y.axis?.labels === false) {
    return undefined;
  }

  return estimateQuantitativeAxisLabelWidth(y.axis, y.scale, y.format);
}

function estimateSecondaryYAxisLabelWidth(
  config: ChartConfig,
  data: ChartData | undefined,
): number | undefined {
  if (!hasSecondaryYAxis(config, data)) return undefined;
  const secondaryAxis = config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;
  if (!secondaryAxis) return undefined;

  const axis = mapAxisConfigToAxisSpec(secondaryAxis);
  const scale = buildAxisScaleSpec(secondaryAxis, false);
  return estimateQuantitativeAxisLabelWidth(axis, scale, axis.format);
}

function estimateQuantitativeAxisLabelWidth(
  axis: AxisSpec | undefined,
  scale: ScaleSpec | null | undefined,
  format: string | undefined,
): number | undefined {
  if (axis?.labels === false) return undefined;

  const scaleDomain = Array.isArray(scale?.domain) ? scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined) return undefined;

  const tickCount = axis?.tickCount ?? 10;
  const domain =
    scale?.nice === false
      ? ([min, max] as [number, number])
      : niceLinear(min, max, typeof scale?.nice === 'number' ? scale.nice : tickCount);
  const ticks = generateTicks(domain[0], domain[1], tickCount);
  const values = ticks.length > 0 ? ticks : domain;
  const maxLabelLength = Math.max(
    0,
    ...values.map((value) => formatTickValue(value, format ?? axis?.format).length),
  );
  if (maxLabelLength === 0) return undefined;

  const fontSize = axis?.labelFontSize ?? 11;
  const maxMagnitude = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
  const charWidthRatio = maxMagnitude >= 1_000_000 ? 0.6 : 0.52;
  const estimatedWidth = Math.ceil(maxLabelLength * fontSize * charWidthRatio);
  return Math.max(36, Math.min(320, estimatedWidth));
}

function estimateXAxisBottomMargin(encoding: EncodingSpec | undefined): number | undefined {
  const x = encoding?.x;
  const y = encoding?.y;
  if (!x || x.axis === null || x.axis?.labels === false) return undefined;

  const labelAngle = x.axis?.labelAngle ?? 0;
  const fontSize = x.axis?.labelFontSize ?? 11;
  const labelPadding = x.axis?.labelPadding ?? (labelAngle ? 2 : 3);
  const tickExtent = x.axis?.ticks === false ? 0 : (x.axis?.tickSize ?? 6);

  if (Math.abs(labelAngle) > 1) {
    const labelWidth = estimateXAxisMaxLabelWidth(x, fontSize);
    const radians = (Math.abs(labelAngle) * Math.PI) / 180;
    const rotatedHeight =
      Math.sin(radians) * labelWidth + Math.cos(radians) * fontSize;
    return Math.max(40, Math.ceil(tickExtent + labelPadding + rotatedHeight + 8));
  }

  if (
    !y ||
    y.type !== 'quantitative' ||
    x.axis?.crossesAt !== 'automatic'
  ) {
    return undefined;
  }

  const scaleDomain = Array.isArray(y.scale?.domain) ? y.scale.domain : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined || min >= 0 || max <= 0) return undefined;

  return Math.max(24, Math.ceil(fontSize + labelPadding + 3));
}

function estimateXAxisMaxLabelWidth(x: ChannelSpec, fontSize: number): number {
  const axis = x.axis;
  const format = x.format ?? axis?.format;
  const scaleDomain = Array.isArray(x.scale?.domain) ? x.scale.domain : undefined;
  const candidates = scaleDomain?.filter((value) => value !== undefined) ?? [];
  if (candidates.length === 0) return fontSize * 8;

  const maxLabelLength = Math.max(
    1,
    ...candidates.map((value) => {
      const text =
        axis?.formatType === 'time'
          ? formatExcelSerialDateTick(value, format)
          : formatTickValue(value, format);
      return text.length;
    }),
  );
  return Math.ceil(maxLabelLength * fontSize * 0.52);
}

// =============================================================================
// Layer Builders (Combo, Stock, Waterfall, Data Labels)
// =============================================================================

/**
 * Build layers for combo charts where each series can have its own mark type.
 * Handles per-series encoding overrides: color, lineWidth, markerSize,
 * dataLabels, and trendline (3b + 3c).
 */
export function buildComboLayers(
  config: ChartConfig,
  data: ChartData,
  _rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const seriesConfigs = config.series ?? [];
  const baseEncoding = buildEncoding(config, data);
  const xEncoding = baseEncoding.x ?? { field: 'category', type: 'nominal' };
  const yEncoding = baseEncoding.y ?? { field: 'value', type: 'quantitative' };
  const secondaryYAxis = config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;

  for (let i = 0; i < data.series.length; i++) {
    const series = data.series[i];
    const seriesConf = seriesConfigs[i];
    const fallbackComboType =
      config.type === 'combo' ? (i === 0 ? 'column' : 'line') : (config.type ?? 'line');
    const seriesType = (seriesConf?.type ?? series.type ?? fallbackComboType) as ChartType;
    const markType = MARK_TYPE_MAP[seriesType] ?? 'bar';
    const yAxisIndex = seriesConf?.yAxisIndex ?? series.yAxisIndex;

    const layerEncoding: EncodingSpec = {
      x: { ...xEncoding },
      y: { ...yEncoding, field: 'value', type: 'quantitative' },
    };

    // Per-series y-axis encoding for dual-axis support
    if (yAxisIndex === 1) {
      const secondaryAxis = secondaryYAxis;
      const secondaryAxisSpec = secondaryAxis ? mapAxisConfigToAxisSpec(secondaryAxis) : {};
      layerEncoding.y = {
        field: 'value',
        type: 'quantitative',
        axis: {
          ...secondaryAxisSpec,
          orient: 'right',
          grid: secondaryAxisSpec.grid ?? false,
          title: secondaryAxisSpec.title ?? secondaryAxis?.title ?? null,
        },
      };
      // Apply secondary axis scale domain if configured
      if (secondaryAxis) {
        const scaleSpec = buildAxisScaleSpec(secondaryAxis, false);
        if (scaleSpec) layerEncoding.y.scale = scaleSpec;
      }
    }

    const layerSpec: UnitSpec = {
      mark: buildSeriesMark(markType, seriesConf, i, config.type),
      encoding: layerEncoding,
      transform: [
        {
          type: 'filter',
          filter: { field: 'series', equal: series.name },
        },
      ],
    };

    layers.push(layerSpec);

    // Per-series data labels: add a text overlay layer for this series
    if (seriesConf?.dataLabels?.show) {
      const labelLayer: UnitSpec = {
        mark: { type: 'text' },
        encoding: {
          ...layerEncoding,
          text: { field: 'value', type: 'quantitative' },
        },
        transform: [
          {
            type: 'filter',
            filter: { field: 'series', equal: series.name },
          },
        ],
      };
      layers.push(labelLayer);
    }

    // Per-series trendline: add a regression layer for this series
    if (seriesConf?.trendline?.show) {
      const trendTransforms = buildTrendlineTransform(seriesConf.trendline);
      const trendMark: MarkSpec = { type: 'line' };
      if (seriesConf.trendline.color) trendMark.color = seriesConf.trendline.color;
      if (seriesConf.trendline.lineWidth) trendMark.strokeWidth = seriesConf.trendline.lineWidth;
      trendMark.strokeDash = [4, 4]; // dashed for trendlines

      const trendLayer: UnitSpec = {
        mark: trendMark,
        encoding: {
          x: { ...xEncoding },
          y: { field: 'value', type: 'quantitative' },
        },
        transform: [
          {
            type: 'filter',
            filter: { field: 'series', equal: series.name },
          },
          ...trendTransforms,
        ],
      };
      layers.push(trendLayer);
    }
  }

  return layers;
}

/**
 * Build a MarkSpec for an individual series (used in combo charts).
 * Handles per-series color, lineWidth, markerSize overrides.
 */
function buildSeriesMark(
  markType: MarkType,
  seriesConf: SeriesConfig | undefined,
  seriesIndex: number,
  fallbackType?: ChartType,
): MarkSpec {
  const mark: MarkSpec = { type: markType };
  const color = seriesConf ? resolveSeriesColor(seriesConf, seriesIndex, fallbackType) : undefined;
  if (color) mark.color = color;
  applySeriesLineFormat(mark, seriesConf);
  const fillOpacity = resolveFormatFillOpacity(seriesConf?.format);
  if (fillOpacity !== undefined) {
    if (markType === 'area') {
      mark.fillOpacity = fillOpacity;
    } else if (markType === 'bar' || markType === 'point' || markType === 'arc') {
      mark.opacity = fillOpacity;
    }
  }
  if (seriesConf?.showMarkers) mark.point = true;
  if (seriesConf?.markerSize) {
    mark.point = { size: seriesConf.markerSize, filled: true };
  }
  return mark;
}

function applySeriesLineFormat(mark: MarkSpec, seriesConf: SeriesConfig | undefined): void {
  const line = seriesConf?.format?.line;
  if (line && hasVisibleLineStyle(line)) {
    const stroke = resolveLineColor(line);
    if (stroke) mark.stroke = stroke;
    const strokeWidth = linePointsToCanvasPx(line.width);
    if (strokeWidth !== undefined) mark.strokeWidth = strokeWidth;
  }

  const lineWidth = linePointsToCanvasPx(seriesConf?.lineWidth);
  if (lineWidth !== undefined) mark.strokeWidth = lineWidth;
}

/**
 * Build the resolve spec for dual-axis charts.
 * When series have different yAxisIndex values, we need independent y scales.
 */
function buildResolve(config: ChartConfig, data?: ChartData): ChartSpec['resolve'] | undefined {
  if (!hasSecondaryYAxis(config, data)) return undefined;
  return {
    scale: { y: 'independent' },
    axis: { y: 'independent' },
  };
}

// =============================================================================
// Main: configToSpec
// =============================================================================

/**
 * Convert ChartConfig + ChartData to ChartSpec format.
 * LOSSLESS: maps every ChartConfig field to the appropriate ChartSpec construct.
 */
export function configToSpec(config: ChartConfig, data: ChartData): ChartSpec {
  // 1. Convert data
  const rows = chartDataToRows(data, config);

  // 2. Build title
  const title = buildTitle(config);

  // 3. Build encoding
  const encoding = buildEncoding(config, data);

  // 4. Build mark
  const mark = buildMark(config);

  // 5. Build config (stacking, colors)
  const configSpec = buildConfigSpec(config, encoding, data);

  // 6. Build transforms
  const transforms: Transform[] = [];

  // Trendline transforms (scatter)
  if (config.trendline?.show) {
    transforms.push(...buildTrendlineTransform(config.trendline));
  }

  // 7. Build dimensions (cell units -> pixels)
  const width = config.width ? config.width * PIXELS_PER_COLUMN : DEFAULT_CHART_WIDTH;
  const height = config.height ? config.height * PIXELS_PER_ROW : DEFAULT_CHART_HEIGHT;

  // 8. Handle layered chart types (combo, stock, waterfall, dual-axis)
  if (config.type === 'combo' || hasSecondaryYAxis(config, data)) {
    const layers = buildComboLayers(config, data, rows);

    // Data label layer for the whole chart
    if (config.dataLabels?.show) {
      const labelLayer = buildDataLabelLayer(config.dataLabels, encoding);
      if (labelLayer) layers.push(labelLayer);
    }

    const resolve = buildResolve(config, data);
    const sharedEncoding: EncodingSpec | undefined =
      encoding.color && isLegendShown(config.legend) ? { color: { ...encoding.color } } : undefined;
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      ...(sharedEncoding ? { encoding: sharedEncoding } : {}),
      title,
      config: configSpec,
      ...(resolve ? { resolve } : {}),
    };
    return spec;
  }

  if (config.type === 'stock') {
    const layers = buildStockLayers(config, data, rows);
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
    };
    return spec;
  }

  if (config.type === 'waterfall') {
    const layers = buildWaterfallLayers(config, data, rows);
    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
    };
    return spec;
  }

  // 9. Handle data labels as overlay layer
  if (config.dataLabels?.show) {
    const mainLayer: UnitSpec = { mark, encoding };
    const labelLayer = buildDataLabelLayer(config.dataLabels, encoding);
    const layers: ChartSpec[] = [mainLayer];
    if (labelLayer) layers.push(labelLayer);

    const spec: LayerSpec = {
      width,
      height,
      data: { values: rows },
      layer: layers,
      title,
      config: configSpec,
      ...(transforms.length > 0 ? { transform: transforms } : {}),
    };
    return spec;
  }

  // 10. Simple single-mark spec
  const spec: UnitSpec = {
    width,
    height,
    mark,
    data: { values: rows },
    encoding,
    title,
    ...(configSpec ? { config: configSpec } : {}),
    ...(transforms.length > 0 ? { transform: transforms } : {}),
  };

  return spec;
}
