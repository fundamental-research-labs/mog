import type { DataRow } from '../../grammar/spec';
import type { ChartColor, ChartConfig, ChartFormat, PointFormat, SeriesConfig } from '../../types';
import {
  MARKER_FILL_FIELD,
  MARKER_SHAPE_FIELD,
  MARKER_SIZE_FIELD,
  MARKER_STROKE_FIELD,
  MARKER_VISIBLE_FIELD,
  POINT_EXPLOSION_FIELD,
  POINT_FILL_FIELD,
  POINT_STYLE_VISIBLE_FIELD,
  POINT_STROKE_FIELD,
  POINT_STROKE_WIDTH_FIELD,
  SERIES_FILL_FIELD,
  SERIES_FILL_OPACITY_FIELD,
  SERIES_STROKE_FIELD,
  SERIES_STROKE_WIDTH_FIELD,
} from './fields';
import { isNoFillNoLineSeries, resolveSeriesColor } from './style';
import {
  resolveChartFillColor,
  resolveChartLineStyle,
  resolveChartOwnerFormat,
  resolverContextFromConfig,
} from '../style-resolver';
import { radarAutomaticMarkerShape } from '../radar-semantics';
import { resolveChartColor, resolveFormatFillOpacity } from '../../utils/chart-colors';
import { linePointsToCanvasPx } from './units';

export function applyPointStyle(
  row: DataRow,
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
  sourceSeriesIndex: number,
  pointFormat: PointFormat | undefined,
): void {
  const ownerKey =
    pointFormat?.idx === undefined ? undefined : pointOwnerKey(sourceSeriesIndex, pointFormat.idx);
  const resolverContext = config && ownerKey ? resolverContextFromConfig(config, ownerKey) : {};
  const format = config
    ? resolveChartOwnerFormat(config, ownerKey, pointChartFormat(pointFormat))
    : pointChartFormat(pointFormat);
  const fill =
    colorToCss(pointFormat?.fill, resolverContext) ??
    resolveChartFillColor(format?.fill, resolverContext);
  let hasStyle = false;
  if (fill) row[POINT_FILL_FIELD] = fill;
  const line = format?.line;
  const stroke = lineColor(line, resolverContext) ?? colorToCss(pointFormat?.border?.color);
  if (stroke) row[POINT_STROKE_FIELD] = stroke;
  const strokeWidth = linePointsToCanvasPx(line?.width) ?? pointFormat?.border?.width;
  if (strokeWidth !== undefined) row[POINT_STROKE_WIDTH_FIELD] = strokeWidth;
  const explosion = composedExplosion(seriesConfig?.explosion, pointFormat?.explosion);
  if (explosion !== undefined) row[POINT_EXPLOSION_FIELD] = explosion;
  hasStyle =
    fill !== undefined ||
    stroke !== undefined ||
    strokeWidth !== undefined ||
    explosion !== undefined;
  if (hasStyle) row[POINT_STYLE_VISIBLE_FIELD] = true;
}

export function applyMarker(
  row: DataRow,
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
  sourceSeriesIndex: number,
  pointFormat: PointFormat | undefined,
): void {
  const style = pointFormat?.markerStyle ?? seriesConfig?.markerStyle;
  const hasPointMarkerOverride =
    pointFormat?.markerStyle !== undefined || pointFormat?.markerSize !== undefined;
  if (style === 'none' && isRadarMarkerDefault(config)) {
    row[MARKER_VISIBLE_FIELD] = false;
    return;
  }
  if (seriesConfig?.showMarkers === false && !hasPointMarkerOverride) return;
  const showMarkers =
    style === 'none'
      ? false
      : pointFormat?.markerStyle !== undefined ||
        pointFormat?.markerSize !== undefined ||
        seriesConfig?.markerStyle !== undefined ||
        seriesConfig?.markerSize !== undefined ||
        seriesConfig?.showMarkers === true ||
        isMarkerDefaultChart(config, seriesConfig?.type);
  if (!showMarkers) return;

  row[MARKER_VISIBLE_FIELD] = true;
  row[MARKER_SHAPE_FIELD] = excelMarkerShape(style, sourceSeriesIndex, config);
  row[MARKER_SIZE_FIELD] = markerPointSizeToArea(
    pointFormat?.markerSize ?? seriesConfig?.markerSize,
  );
  const pointLine = pointFormat?.lineFormat ?? pointFormat?.visualFormat?.line;
  const ownerKey =
    pointFormat?.idx === undefined
      ? markerOwnerKey(sourceSeriesIndex)
      : markerPointOwnerKey(sourceSeriesIndex, pointFormat.idx);
  const resolverContext = config ? resolverContextFromConfig(config, ownerKey) : {};
  const fill =
    resolveChartColor(
      pointFormat?.markerBackgroundColor ?? seriesConfig?.markerBackgroundColor,
      resolverContext,
    ) ??
    colorToCss(pointFormat?.fill, resolverContext) ??
    resolveChartFillColor(pointFormat?.visualFormat?.fill, resolverContext);
  const stroke =
    resolveChartColor(
      pointFormat?.markerForegroundColor ?? seriesConfig?.markerForegroundColor,
      resolverContext,
    ) ??
    lineColor(pointLine, resolverContext) ??
    colorToCss(pointFormat?.border?.color);
  if (fill) row[MARKER_FILL_FIELD] = fill;
  if (stroke) row[MARKER_STROKE_FIELD] = stroke;
}

export function applySeriesVisualStyle(
  row: DataRow,
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig | undefined,
  sourceSeriesIndex: number,
  value?: number,
  pointFormat?: PointFormat,
): void {
  if (!seriesConfig || isNoFillNoLineSeries(seriesConfig)) return;
  const baseFill = config
    ? resolveSeriesColor(seriesConfig, sourceSeriesIndex, config.type, config)
    : resolveSeriesColor(seriesConfig, sourceSeriesIndex);
  const fill =
    invertedNegativeFill(config, seriesConfig, sourceSeriesIndex, value, pointFormat) ?? baseFill;
  if (fill) row[SERIES_FILL_FIELD] = fill;

  const ownerKey = `series(${sourceSeriesIndex})`;
  const resolverContext = config ? resolverContextFromConfig(config, ownerKey) : {};
  const format = config
    ? resolveChartOwnerFormat(config, ownerKey, seriesConfig?.format)
    : seriesConfig?.format;
  const stroke = lineColor(format?.line, resolverContext);
  const strokeWidth = linePointsToCanvasPx(format?.line?.width);
  const fillOpacity = resolveFormatFillOpacity(format);
  if (stroke) row[SERIES_STROKE_FIELD] = stroke;
  if (format?.line?.noFill === true) row[SERIES_STROKE_WIDTH_FIELD] = 0;
  if (strokeWidth !== undefined) row[SERIES_STROKE_WIDTH_FIELD] = strokeWidth;
  if (fillOpacity !== undefined) row[SERIES_FILL_OPACITY_FIELD] = fillOpacity;
}

function invertedNegativeFill(
  config: ChartConfig | undefined,
  seriesConfig: SeriesConfig,
  sourceSeriesIndex: number,
  value: number | undefined,
  pointFormat: PointFormat | undefined,
): string | undefined {
  if (!(typeof value === 'number' && Number.isFinite(value) && value < 0)) return undefined;
  if ((pointFormat?.invertIfNegative ?? seriesConfig.invertIfNegative) !== true) return undefined;

  const ownerKey = `series(${sourceSeriesIndex})`;
  const context = config ? resolverContextFromConfig(config, ownerKey) : {};
  return resolveChartColor(seriesConfig.invertColor, context) ?? '#FFFFFF';
}

export function lineColor(
  line: PointFormat['lineFormat'] | undefined,
  context: Parameters<typeof resolveChartLineStyle>[1] = {},
): string | undefined {
  if (!line || line.noFill) return undefined;
  const resolved = resolveChartLineStyle(line, context, { widthToPx: linePointsToCanvasPx });
  return resolved?.paint?.type === 'solid' ? resolved.paint.color : undefined;
}

function colorToCss(
  color: unknown,
  context: Parameters<typeof resolveChartColor>[1] = {},
): string | undefined {
  if (typeof color === 'string') return color.startsWith('#') ? color : `#${color}`;
  if (color && typeof color === 'object' && 'theme' in color) {
    return resolveChartColor(color as ChartColor, context);
  }
  return undefined;
}

function composedExplosion(
  seriesExplosion: number | undefined,
  pointExplosion: number | undefined,
): number | undefined {
  const series = finiteNonNegative(seriesExplosion);
  const point = finiteNonNegative(pointExplosion);
  if (series === undefined && point === undefined) return undefined;
  return (series ?? 0) + (point ?? 0);
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined;
}

function pointChartFormat(pointFormat: PointFormat | undefined): ChartFormat | undefined {
  if (!pointFormat) return undefined;
  const base = pointFormat.visualFormat;
  if (!pointFormat.lineFormat) return base;
  return { ...(base ?? {}), line: pointFormat.lineFormat };
}

function pointOwnerKey(sourceSeriesIndex: number, pointIndex: number): string {
  return `point(seriesIdx=${sourceSeriesIndex},pointIdx=${pointIndex})`;
}

function markerOwnerKey(sourceSeriesIndex: number): string {
  return `marker(seriesIdx=${sourceSeriesIndex})`;
}

function markerPointOwnerKey(sourceSeriesIndex: number, pointIndex: number): string {
  return `markerPoint(seriesIdx=${sourceSeriesIndex},pointIdx=${pointIndex})`;
}

function isMarkerDefaultChart(config?: ChartConfig, seriesType?: string): boolean {
  return (
    config?.type === 'lineMarkers' ||
    config?.type === 'lineMarkersStacked' ||
    config?.type === 'lineMarkersStacked100' ||
    isRadarMarkerDefault(config) ||
    seriesType === 'lineMarkers' ||
    seriesType === 'lineMarkersStacked' ||
    seriesType === 'lineMarkersStacked100'
  );
}

function isRadarMarkerDefault(config?: ChartConfig): boolean {
  return Boolean(
    config?.type === 'radar' && (config.radarMarkers === true || config.subType === 'markers'),
  );
}

function excelMarkerShape(
  style: string | undefined,
  sourceSeriesIndex: number,
  config: ChartConfig | undefined,
): string {
  switch (style) {
    case 'square':
    case 'diamond':
    case 'star':
    case 'dash':
      return style;
    case 'triangle':
      return 'triangle-up';
    case 'plus':
      return 'cross';
    case 'x':
      return 'x';
    case 'dot':
    case 'circle':
      return 'circle';
    case 'auto':
    default:
      return isRadarMarkerDefault(config)
        ? radarAutomaticMarkerShape(sourceSeriesIndex)
        : 'circle';
  }
}

function markerPointSizeToArea(size?: number): number {
  const diameter = size ?? 7;
  return Math.max(4, diameter * diameter);
}
