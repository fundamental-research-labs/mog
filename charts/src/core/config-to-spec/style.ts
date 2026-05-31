import type { MarkSpec } from '../../grammar/spec';
import type { ChartConfig, ChartData, ChartFormat, ChartType, SeriesConfig } from '../../types';
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
import { resolveChartOwnerFormat, resolverContextFromConfig } from '../style-resolver';
import { MARK_TYPE_MAP } from './constants';
import { linePointsToCanvasPx } from './units';

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
    (series.color ? resolveChartColor(series.color, context) : undefined) ??
    fillColor ??
    lineColor
  );
}

export function resolvedCategoryColors(config: ChartConfig, data?: ChartData): string[] | undefined {
  const configColors = resolvedConfigColors(config);
  const seriesColors = resolvedSeriesColors(config, data);

  if (variesColorsByCategory(config)) {
    return configColors.length > 0
      ? configColors
      : seriesColors.length > 0
        ? seriesColors
        : undefined;
  }

  if (seriesColors.length > 0) return seriesColors;
  return configColors.length > 0 ? configColors : undefined;
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

function variesColorsByCategory(config: ChartConfig): boolean {
  if (config.varyByCategories !== undefined) return config.varyByCategories;
  return (
    config.type === 'pie' ||
    config.type === 'doughnut' ||
    config.type === 'pie3d' ||
    config.type === 'ofPie'
  );
}

function resolvedConfigColors(config: ChartConfig): string[] {
  const context = resolverContextFromConfig(config, 'chartArea');
  return (config.colors ?? [])
    .map((color) => resolveChartColor(color, context))
    .filter(Boolean) as string[];
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
