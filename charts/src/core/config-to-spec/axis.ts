import type { AxisSpec, ScaleSpec, ScaleType } from '../../grammar/spec';
import type {
  AxisConfig,
  AxisType,
  ChartConfig,
  ChartFormat,
  ChartType,
  SingleAxisConfig,
} from '../../types';
import { resolveChartTextColor, resolveGridlineColor } from '../../utils/chart-colors';
import { MINOR_GRIDLINE_TICK_COUNT } from './constants';
import { isDateAxisConfig, toFiniteNumber } from './category-axis';
import { dashStyleToStrokeDash, hasVisibleLineStyle } from './series-style';
import { linePointsToCanvasPx, pointsToCanvasPx } from './units';

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

/**
 * Map AxisConfig.xAxis / yAxis type to a ChartSpec AxisSpec partial.
 */
export function mapAxisConfigToAxisSpec(axisConf: SingleAxisConfig): AxisSpec {
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
    // Minor grid lines are represented by halving the tick count.
    if (axisConf.minorGridLines) {
      spec.tickCount = MINOR_GRIDLINE_TICK_COUNT;
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
function axisTypeToScaleType(axisType: AxisType | undefined): ScaleType | undefined {
  if (!axisType) return undefined;
  if (axisType === 'log') return 'log';
  if (axisType === 'time') return 'time';
  // 'linear', 'category', 'value' are defaults - no explicit scale needed.
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
    const domain: [number | undefined, number | undefined] = [axisConf.min, axisConf.max];
    return { domain };
  }
  return undefined;
}

export function buildAxisScaleSpec(
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

export function resolveAxisConfigForChannel(
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

export function explicitDomainBound(
  domain: unknown[] | undefined,
  index: number,
): number | undefined {
  const value = domain?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function isHorizontalBarType(chartType: ChartType): boolean {
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
