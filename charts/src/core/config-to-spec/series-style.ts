import type { MarkSpec } from '../../grammar/spec';
import type { ChartConfig, ChartFormat, ChartType, SeriesConfig } from '../../types';
import {
  chartColorTintShade,
  chartStyleRepeatThemeColor,
  chartThemeColorKey,
  resolveChartColor,
  resolveFormatFillColor,
  resolveFormatLineColor,
  resolveLineColor,
} from '../../utils/chart-colors';
import { resolverContextFromConfig } from '../style-resolver';
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
  const fill = series.format?.fill;
  const fillTheme = fill?.type === 'solid' ? chartThemeColorKey(fill.color) : undefined;
  const fillHasExplicitTransform =
    fill?.type === 'solid' && chartColorTintShade(fill.color) !== undefined;
  const sourceIndex = typeof series.idx === 'number' ? series.idx : index;
  const fillColor =
    (fillHasExplicitTransform ? resolveFormatFillColor(series.format, context) : undefined) ??
    chartStyleRepeatThemeColor(fillTheme, sourceIndex) ??
    resolveFormatFillColor(series.format, context);
  const lineColor = resolveFormatLineColor(series.format, context);

  if (isStrokeColoredSeries(series, fallbackType)) {
    return (series.color ? resolveChartColor(series.color, context) : undefined) ?? lineColor ?? fillColor;
  }

  return (series.color ? resolveChartColor(series.color, context) : undefined) ?? fillColor ?? lineColor;
}

export function resolvedCategoryColors(config: ChartConfig): string[] | undefined {
  const seriesColors = (config.series ?? [])
    .map((series, index) =>
      isNoFillNoLineSeries(series)
        ? undefined
        : resolveSeriesColor(series, index, config.type, config),
    )
    .filter(Boolean) as string[];
  if (seriesColors.length > 0) return seriesColors;
  const configColors = (config.colors ?? [])
    .map((color) => resolveChartColor(color))
    .filter(Boolean) as string[];
  return configColors.length > 0 ? configColors : undefined;
}

export function hasVisibleLineStyle(line: unknown): boolean {
  if (!line || typeof line !== 'object') return false;
  const candidate = line as { color?: unknown; width?: unknown };
  return candidate.color !== undefined || candidate.width !== undefined;
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
  const line = seriesConf?.format?.line;
  if (line && hasVisibleLineStyle(line)) {
    const stroke = resolveLineColor(line, context);
    if (stroke) mark.stroke = stroke;
    const strokeWidth = linePointsToCanvasPx(line.width);
    if (strokeWidth !== undefined) mark.strokeWidth = strokeWidth;
  }

  const lineWidth = linePointsToCanvasPx(seriesConf?.lineWidth);
  if (lineWidth !== undefined) mark.strokeWidth = lineWidth;
}
