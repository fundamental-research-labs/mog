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
import { SERIES_FILL_FIELD, SERIES_STROKE_FIELD, SERIES_STROKE_WIDTH_FIELD } from './fields';
import { resolveSubTypeMarkProps } from './subtypes';
import { linePointsToCanvasPx } from './units';
import { barOrientationForChartType } from './bar-geometry';
import { RADAR_DEFAULT_FILLED_OPACITY } from '../radar-semantics';
import {
  doughnutInnerRadiusRatio,
  firstSliceAngleRadians,
  isDoughnutLikeChartType,
  isExplodedPieLikeChartType,
  isPie3DLikeChartType,
} from './pie-like';

export { applyImportedBarOutline } from './mark-format';

/**
 * Attach pie slice explosion indices as metadata on the mark spec.
 * These are consumed by the OOXML exporter for per-slice explosion.
 */
export function applyPieSliceExplosion(mark: MarkSpec, config: ChartConfig): void {
  const pieSlice = config.pieSlice as
    | (typeof config.pieSlice & { explodedIndex?: number })
    | undefined;
  if (!pieSlice && !isExplodedPieLikeChartType(config.type)) return;

  const explodedIndex = pieSlice?.explodedIndex;
  if (explodedIndex !== undefined) {
    mark._explodedIndex = explodedIndex;
  }
  if (pieSlice?.explodedIndices !== undefined && pieSlice.explodedIndices.length > 0) {
    mark._explodedIndices = pieSlice.explodedIndices;
  }
  const explosionOffset =
    finiteNumber(pieSlice?.explodeOffset) ??
    finiteNumber(pieSlice?.explosion) ??
    (isExplodedPieLikeChartType(config.type) ? 25 : undefined);
  if (explosionOffset !== undefined && explosionOffset > 0) {
    mark._explosionOffset = explosionOffset;
  }
  if (
    pieSlice?.explodeAll === true ||
    isExplodedPieLikeChartType(config.type) ||
    (pieSlice?.explodeOffset !== undefined &&
      explodedIndex === undefined &&
      (!pieSlice.explodedIndices || pieSlice.explodedIndices.length === 0)) ||
    (pieSlice?.explosion !== undefined &&
      explodedIndex === undefined &&
      (!pieSlice.explodedIndices || pieSlice.explodedIndices.length === 0))
  ) {
    mark._explodeAll = true;
  }
}

/**
 * Build the mark spec for a chart, incorporating subType props and
 * chart-type-specific settings.
 */
export function buildMark(config: ChartConfig): MarkType | MarkSpec {
  const baseType = MARK_TYPE_MAP[config.type] ?? 'bar';
  const subProps = resolveSubTypeMarkProps(config);

  if (baseType === 'bar3d') {
    const mark: MarkSpec = {
      type: 'bar3d',
      fillField: SERIES_FILL_FIELD,
      strokeField: SERIES_STROKE_FIELD,
      strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
      chart3d: {
        family: 'bar',
        orientation: barOrientationForChartType(config.type),
        barShape: resolveBar3DShape(config),
        gapDepth: config.gapDepth,
        view3d: config.view3d,
      },
    };
    applyPrimarySeriesFormat(mark, config);
    applyImportedBarOutline(mark, config);
    applyPointStyleFields(mark, config);
    return mark;
  }

  if (baseType === 'line3d') {
    const mark: MarkSpec = {
      type: 'line3d',
      chart3d: { family: 'line', gapDepth: config.gapDepth, view3d: config.view3d },
    };
    const series = config.series?.find((item) => !isNoFillNoLineSeries(item));
    if (hasExplicitNoLine(series)) {
      mark.opacity = 0;
      mark.strokeWidth = 0;
    }
    if (config.subType === 'smooth') {
      mark.interpolate = 'monotone';
    } else if (config.subType === 'stepped') {
      mark.interpolate = 'step';
    }
    return mark;
  }

  if (baseType === 'area3d') {
    const mark: MarkSpec = {
      type: 'area3d',
      chart3d: { family: 'area', gapDepth: config.gapDepth, view3d: config.view3d },
    };
    return mark;
  }

  if (isPie3DLikeChartType(config.type)) {
    const mark: MarkSpec = {
      type: 'arc3d',
      chart3d: { family: 'pie', view3d: config.view3d },
      startAngle: firstSliceAngleRadians(config),
      ...(subProps || {}),
    };
    applyPrimarySeriesFormat(mark, config);
    applyPointStyleFields(mark, config);
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // OfPie: pie-of-pie or bar-of-pie (render as arc; no grammar equivalent for secondary pie)
  if (config.type === 'ofPie') {
    const mark: MarkSpec = {
      type: 'arc',
      startAngle: firstSliceAngleRadians(config),
      ...(subProps || {}),
    };
    applyPrimarySeriesFormat(mark, config);
    applyPointStyleFields(mark, config);
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // Doughnut: arc with innerRadius
  if (isDoughnutLikeChartType(config.type)) {
    const mark: MarkSpec = {
      type: 'arc',
      innerRadius: doughnutInnerRadiusRatio(config),
      startAngle: firstSliceAngleRadians(config),
      ...(subProps || {}),
    };
    applyPrimarySeriesFormat(mark, config);
    applyPointStyleFields(mark, config);
    applyPieSliceExplosion(mark, config);
    return mark;
  }

  // Pie: arc (no innerRadius)
  if (config.type === 'pie' || config.type === 'pieExploded') {
    const mark: MarkSpec = {
      type: 'arc',
      startAngle: firstSliceAngleRadians(config),
      ...(subProps || {}),
    };
    applyPrimarySeriesFormat(mark, config);
    applyPointStyleFields(mark, config);
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

  // Radar: radial polygon series with optional fill + markers.
  if (config.type === 'radar') {
    const radarFilled = config.radarFilled ?? config.subType === 'filled';
    const radarMarkers = config.radarMarkers ?? config.subType === 'markers';
    const mark: MarkSpec = {
      type: 'radar',
      fillField: SERIES_FILL_FIELD,
      strokeField: SERIES_STROKE_FIELD,
      strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
    };
    if (radarFilled) {
      mark.fillOpacity = RADAR_DEFAULT_FILLED_OPACITY;
    }
    if (radarMarkers) {
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

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveBar3DShape(
  config: ChartConfig,
): NonNullable<NonNullable<MarkSpec['chart3d']>['barShape']> {
  if (config.barShape) return config.barShape;
  if (String(config.type).startsWith('cylinder')) return 'cylinder';
  if (String(config.type).startsWith('cone')) return 'cone';
  if (String(config.type).startsWith('pyramid')) return 'pyramid';
  return 'box';
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
