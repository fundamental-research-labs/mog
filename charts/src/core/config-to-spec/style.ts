import type { MarkSpec } from '../../grammar/spec';
import type {
  ChartConfig,
  ChartData,
  ChartFormat,
  ChartType,
  PointFormat,
  SeriesConfig,
} from '../../types';
import {
  chartColorTintShade,
  chartStyleRepeatThemeColor,
  chartThemeColorKey,
  resolveChartColor,
  resolveFormatFillColor,
  resolveFormatLineColor,
  resolveLineColor,
} from '../../utils/chart-colors';
import { seriesConfigForDataSeries, seriesSourceIndex } from '../series-identity';
import {
  resolveChartFillColor,
  resolveChartOwnerFormat,
  resolverContextFromConfig,
} from '../style-resolver';
import { MARK_TYPE_MAP } from './constants';
import { linePointsToCanvasPx } from './units';

const WORKBOOK_THEME_CATEGORY_COLOR_SLOTS = [
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
] as const;

export function isStrokeColoredSeries(
  series: SeriesConfig,
  fallbackType: ChartType | undefined,
): boolean {
  const seriesType = (series.type ?? fallbackType) as ChartType | undefined;
  const markType = seriesType ? MARK_TYPE_MAP[seriesType] : undefined;
  return markType === 'line' || markType === 'point' || markType === 'rule';
}

export function resolveSeriesColor(
  series: SeriesConfig,
  index: number,
  fallbackType?: ChartType,
  config?: ChartConfig,
): string | undefined {
  const context = config ? resolverContextFromConfig(config, `series(${index})`) : {};
  const format = config
    ? resolveChartOwnerFormat(config, `series(${index})`, series.format)
    : series.format;
  const fill = format?.fill;
  const fillTheme = fill?.type === 'solid' ? chartThemeColorKey(fill.color) : undefined;
  const fillHasExplicitTransform =
    fill?.type === 'solid' && chartColorTintShade(fill.color) !== undefined;
  const sourceIndex = typeof series.idx === 'number' ? series.idx : index;
  const fillColor =
    (fillHasExplicitTransform ? resolveFormatFillColor(format, context) : undefined) ??
    chartStyleRepeatThemeColor(fillTheme, sourceIndex) ??
    resolveFormatFillColor(format, context);
  const lineColor = resolveFormatLineColor(format, context);

  if (isStrokeColoredSeries(series, fallbackType)) {
    return (
      (series.color ? resolveChartColor(series.color, context) : undefined) ??
      lineColor ??
      fillColor
    );
  }

  return (
    (series.color ? resolveChartColor(series.color, context) : undefined) ?? fillColor ?? lineColor
  );
}

export function resolvedCategoryColors(
  config: ChartConfig,
  data?: ChartData,
): string[] | undefined {
  const configColors = resolvedConfigColors(config);
  const seriesColors = resolvedSeriesColors(config, data);

  if (variesColorsByCategory(config, data)) {
    const fallbackColors =
      configColors.length > 0
        ? configColors
        : seriesColors.length > 0
          ? seriesColors
          : (workbookThemeCategoryColors(config) ?? []);
    const pointColors = resolvedPointCategoryColors(config, data, fallbackColors);
    if (pointColors.length > 0) return pointColors;
    return fallbackColors.length > 0 ? fallbackColors : undefined;
  }

  if (seriesColors.length > 0) return seriesColors;
  return configColors.length > 0 ? configColors : undefined;
}

function resolvedPointCategoryColors(
  config: ChartConfig,
  data: ChartData | undefined,
  fallbackColors: string[],
): string[] {
  if (!data || data.categories.length === 0) return [];

  const pointColors: Array<string | undefined> = Array(data.categories.length);
  for (let renderedIndex = 0; renderedIndex < data.series.length; renderedIndex += 1) {
    const dataSeries = data.series[renderedIndex];
    const series = seriesConfigForDataSeries(dataSeries, config.series ?? [], renderedIndex);
    if (!series || isNoFillNoLineSeries(series)) continue;

    const sourceIndex = seriesSourceIndex(dataSeries, renderedIndex);
    for (const point of series.points ?? []) {
      if (!Number.isInteger(point.idx) || point.idx < 0 || point.idx >= pointColors.length) {
        continue;
      }
      pointColors[point.idx] ??= resolvePointFillColor(config, sourceIndex, point);
    }
  }

  if (!pointColors.some(Boolean)) return [];
  if (fallbackColors.length === 0) return pointColors.filter((color): color is string => !!color);
  return pointColors.map((color, index) => color ?? fallbackColors[index % fallbackColors.length]);
}

function resolvePointFillColor(
  config: ChartConfig,
  sourceSeriesIndex: number,
  point: PointFormat,
): string | undefined {
  const ownerKey = `point(seriesIdx=${sourceSeriesIndex},pointIdx=${point.idx})`;
  const context = resolverContextFromConfig(config, ownerKey);
  const format = resolveChartOwnerFormat(config, ownerKey, point.visualFormat);
  return colorToCss(point.fill) ?? resolveChartFillColor(format?.fill, context);
}

function resolvedSeriesColors(config: ChartConfig, data?: ChartData): string[] {
  const seriesConfigs = config.series ?? [];
  const colorInputs =
    data && data.series.length > 0
      ? data.series.map((series, renderedIndex) => ({
          series: seriesConfigForDataSeries(series, seriesConfigs, renderedIndex),
          sourceIndex: seriesSourceIndex(series, renderedIndex),
        }))
      : seriesConfigs.map((series, index) => ({ series, sourceIndex: index }));
  const seriesColors = colorInputs
    .map(({ series, sourceIndex }) =>
      series && !isNoFillNoLineSeries(series)
        ? resolveSeriesColor(series, sourceIndex, config.type, config)
        : undefined,
    )
    .filter(Boolean) as string[];
  return seriesColors;
}

export function variesColorsByCategory(config: ChartConfig, data?: ChartData): boolean {
  if (config.varyByCategories !== undefined) return config.varyByCategories;
  return (
    config.type === 'pie' ||
    config.type === 'doughnut' ||
    config.type === 'pie3d' ||
    config.type === 'ofPie' ||
    defaultsToBubbleCategoryColors(config, data)
  );
}

function defaultsToBubbleCategoryColors(config: ChartConfig, data?: ChartData): boolean {
  const legend = config.legend;
  return (
    config.type === 'bubble' &&
    data?.series.length === 1 &&
    legend !== undefined &&
    legend.show === true &&
    legend.visible !== false &&
    legend.position !== 'none'
  );
}

function workbookThemeCategoryColors(config: ChartConfig): string[] | undefined {
  const context = resolverContextFromConfig(config, 'chartArea');
  const colors = WORKBOOK_THEME_CATEGORY_COLOR_SLOTS.map((theme) =>
    resolveChartColor({ theme }, context),
  ).filter(Boolean) as string[];
  return colors.length > 0 ? colors : undefined;
}

function resolvedConfigColors(config: ChartConfig): string[] {
  const context = resolverContextFromConfig(config, 'chartArea');
  return (config.colors ?? [])
    .map((color) => resolveChartColor(color, context))
    .filter(Boolean) as string[];
}

function colorToCss(color: unknown): string | undefined {
  if (typeof color !== 'string') return undefined;
  return color.startsWith('#') ? color : `#${color}`;
}

export function hasVisibleLineStyle(line: unknown): boolean {
  if (!line || typeof line !== 'object') return false;
  const candidate = line as { color?: unknown; width?: unknown; noFill?: unknown };
  if (candidate.noFill === true) return false;
  return candidate.color !== undefined || candidate.width !== undefined;
}

export function hasExplicitNoLine(series: SeriesConfig | undefined): boolean {
  return series?.format?.line?.noFill === true;
}

export function isNoFillNoLineSeries(series: SeriesConfig | undefined): boolean {
  if (!series?.format) return false;
  return series.format.fill?.type === 'none' && !hasVisibleLineStyle(series.format.line);
}

export function dashStyleToStrokeDash(
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

export function applySeriesLineFormat(
  mark: MarkSpec,
  seriesConf: SeriesConfig | undefined,
  config?: ChartConfig,
  seriesIndex = 0,
): void {
  const context = config ? resolverContextFromConfig(config, `series(${seriesIndex})`) : {};
  const format = config
    ? resolveChartOwnerFormat(config, `series(${seriesIndex})`, seriesConf?.format)
    : seriesConf?.format;
  const line = format?.line;
  if (line && hasVisibleLineStyle(line)) {
    const stroke = resolveLineColor(line, context);
    if (stroke) mark.stroke = stroke;
    const strokeWidth = linePointsToCanvasPx(line.width);
    if (strokeWidth !== undefined) mark.strokeWidth = strokeWidth;
  }
  if (hasExplicitNoLine(seriesConf)) {
    mark.opacity = 0;
    mark.strokeWidth = 0;
  }

  const lineWidth = linePointsToCanvasPx(seriesConf?.lineWidth);
  if (lineWidth !== undefined && !hasExplicitNoLine(seriesConf)) mark.strokeWidth = lineWidth;
}
