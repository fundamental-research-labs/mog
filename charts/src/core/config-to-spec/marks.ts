import type { MarkSpec, MarkType } from '../../grammar/spec';
import type { ChartConfig, ChartType, SeriesConfig } from '../../types';
import { resolveFormatFillOpacity, resolveLineColor } from '../../utils/chart-colors';
import { MARK_TYPE_MAP } from './constants';
import {
  applySeriesLineFormat,
  hasVisibleLineStyle,
  isNoFillNoLineSeries,
  resolveSeriesColor,
} from './series-style';
import { resolveSubTypeMarkProps } from './subtypes';
import { linePointsToCanvasPx } from './units';

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

export function applyImportedBarOutline(mark: MarkSpec, config: ChartConfig): void {
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

/**
 * Build a MarkSpec for an individual series (used in combo charts).
 * Handles per-series color, lineWidth, markerSize overrides.
 */
export function buildSeriesMark(
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
