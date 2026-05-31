import type { MarkSpec, MarkType } from '../../grammar/spec';
import type { ChartConfig, ChartType, SeriesConfig } from '../../types';
import { resolveFormatFillOpacity } from '../../utils/chart-colors';
import {
  resolveChartFillPaint,
  resolveChartLineStyle,
  resolveChartOwnerFormat,
  resolverContextFromConfig,
} from '../style-resolver';
import { MARK_TYPE_MAP } from './constants';
import {
  applySeriesLineFormat,
  hasExplicitNoLine,
  isNoFillNoLineSeries,
  resolveSeriesColor,
} from './style';
import {
  applyImportedBarOutline,
  applyPointStyleFields,
  applyPrimarySeriesFormat,
  hasPointStyleOverrides,
} from './mark-format';
import {
  SERIES_FILL_FIELD,
  SERIES_STROKE_FIELD,
  SERIES_STROKE_WIDTH_FIELD,
} from './fields';
import { resolveSubTypeMarkProps } from './subtypes';
import { linePointsToCanvasPx } from './units';

export { applyImportedBarOutline } from './mark-format';

/**
 * Attach pie slice explosion indices as metadata on the mark spec.
 * These are consumed by the OOXML exporter for per-slice explosion.
 */
export function applyPieSliceExplosion(mark: MarkSpec, config: ChartConfig): void {
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
    applyPrimarySeriesFormat(mark, config);
    applyPointStyleFields(mark, config);
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
    applyPrimarySeriesFormat(mark, config);
    applyPointStyleFields(mark, config);
    return mark;
  }

  // Doughnut: arc with innerRadius
  if (config.type === 'doughnut') {
    const mark: MarkSpec = {
      type: 'arc',
      innerRadius: 0.5,
      ...(subProps || {}),
    };
    applyPrimarySeriesFormat(mark, config);
    applyPointStyleFields(mark, config);
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
    applyPrimarySeriesFormat(mark, config);
    applyPointStyleFields(mark, config);
    if (config.pieSlice?.explodeOffset) {
      mark.padAngle = config.pieSlice.explodeOffset;
    }
    // Attach explosion indices as metadata for OOXML export
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // Scatter with lines
  if (config.type === 'scatter') {
    const showLines =
      config.showLines ?? config.series?.some((series) => series.showLines === true);
    const smoothLines =
      config.smoothLines ?? config.series?.some((series) => series.smooth === true);
    if (showLines) {
      const mark: MarkSpec = { type: 'line' };
      if (smoothLines) {
        mark.interpolate = 'monotone';
      }
      if (config.series?.some((series) => series.showMarkers === true)) {
        mark.point = true;
      }
      return mark;
    }
    // Smooth scatter (no lines but smooth points connected)
    if (smoothLines) {
      return { type: 'point', skipInvalidPositions: true };
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

  if (config.type === 'histogram') {
    return {
      type: 'histogram',
      binCount: config.histogram?.binCount,
      binWidth: config.histogram?.binWidth,
      underflowBinValue: config.histogram?.underflowBinValue,
      overflowBinValue: config.histogram?.overflowBinValue,
    };
  }

  if (config.type === 'boxplot') {
    return {
      type: 'boxplot',
      showOutlierPoints: config.boxplot?.showOutlierPoints ?? config.boxplot?.showOutliers,
      showMeanMarkers: config.boxplot?.showMeanMarkers ?? config.boxplot?.showMean,
      showMeanLine: config.boxplot?.showMeanLine,
      quartileMethod: config.boxplot?.quartileMethod,
    };
  }

  // If subType props change the mark type or add interpolation
  if (subProps) {
    const mark: MarkSpec = {
      type: subProps.type ?? baseType,
      ...subProps,
    };
    applyPrimarySeriesFormat(mark, config);
    applyImportedBarOutline(mark, config);
    return mark;
  }

  if (baseType === 'bar') {
    const mark: MarkSpec = {
      type: baseType,
      fillField: SERIES_FILL_FIELD,
      strokeField: SERIES_STROKE_FIELD,
      strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
    };
    applyPrimarySeriesFormat(mark, config);
    applyImportedBarOutline(mark, config);
    applyPointStyleFields(mark, config);
    return mark.stroke ||
      mark.strokeWidth !== undefined ||
      mark.fillPaint ||
      mark.fillField ||
      mark.strokeField
      ? mark
      : baseType;
  }

  if (baseType === 'point') {
    const mark: MarkSpec = {
      type: baseType,
      ...(config.type === 'scatter' || config.type === 'bubble'
        ? { skipInvalidPositions: true }
        : {}),
    };
    applyPointStyleFields(mark, config);
    return hasPointStyleOverrides(config) || mark.skipInvalidPositions ? mark : baseType;
  }

  if (baseType === 'line') {
    const series = config.series?.find((item) => !isNoFillNoLineSeries(item));
    if (hasExplicitNoLine(series)) {
      return { type: 'line', opacity: 0, strokeWidth: 0 };
    }
  }

  // Simple mark type string
  return baseType;
}

/**
 * Build a MarkSpec for an individual series (used in combo charts).
 * Handles per-series color, lineWidth, markerSize overrides.
 */
export function buildSeriesMark(
  markType: MarkType,
  seriesConf: SeriesConfig | undefined,
  seriesIndex: number,
  fallbackType?: ChartType,
  config?: ChartConfig,
): MarkSpec {
  const mark: MarkSpec = { type: markType };
  const color = seriesConf
    ? resolveSeriesColor(seriesConf, seriesIndex, fallbackType, config)
    : undefined;
  if (color) mark.color = color;
  const format = config
    ? resolveChartOwnerFormat(config, `series(${seriesIndex})`, seriesConf?.format)
    : seriesConf?.format;
  if (format && config) {
    const context = resolverContextFromConfig(config, `series(${seriesIndex})`);
    const fillPaint = resolveChartFillPaint(format.fill, context);
    if (fillPaint) mark.fillPaint = fillPaint;
    const line = resolveChartLineStyle(format.line, context, {
      widthToPx: linePointsToCanvasPx,
    });
    if (line) mark.line = line;
  }
  applySeriesLineFormat(mark, seriesConf, config, seriesIndex);
  if (hasExplicitNoLine(seriesConf) && (markType === 'line' || markType === 'area')) {
    mark.opacity = 0;
    mark.strokeWidth = 0;
  }
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
