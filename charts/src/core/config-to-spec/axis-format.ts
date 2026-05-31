import type { AxisOrient, AxisSpec, AxisTickMark } from '../../grammar/spec';
import type { ChartConfig, ChartFormat, SingleAxisConfig } from '../../types';
import { resolveChartTextColor, resolveGridlineColor } from '../../utils/chart-colors';
import { resolverContextFromConfig } from '../style-resolver';
import { isDateAxisConfig, toFiniteNumber } from './category-axis';
import { dashStyleToStrokeDash, hasVisibleLineStyle } from './series-style';
import { linePointsToCanvasPx, pointsToCanvasPx } from './units';

const DISPLAY_UNIT_FACTORS: Record<string, number> = {
  hundreds: 100,
  thousands: 1_000,
  tenthousands: 10_000,
  ten_thousands: 10_000,
  tenThousands: 10_000,
  hundredthousands: 100_000,
  hundred_thousands: 100_000,
  hundredThousands: 100_000,
  millions: 1_000_000,
  tenmillions: 10_000_000,
  ten_millions: 10_000_000,
  tenMillions: 10_000_000,
  hundredmillions: 100_000_000,
  hundred_millions: 100_000_000,
  hundredMillions: 100_000_000,
  billions: 1_000_000_000,
  trillions: 1_000_000_000_000,
};

/**
 * Map AxisConfig.xAxis / yAxis type to a ChartSpec AxisSpec partial.
 */
export function mapAxisConfigToAxisSpec(
  axisConf: SingleAxisConfig,
  orient?: AxisOrient,
  config?: ChartConfig,
  ownerKey = 'axis',
): AxisSpec {
  const spec: AxisSpec = {};
  const context = config ? resolverContextFromConfig(config, ownerKey) : {};
  spec.title = axisConf.title ?? null;
  if (orient) spec.orient = orient;
  if (axisConf.visible === false || axisConf.show === false) {
    spec.labels = false;
    spec.ticks = false;
    spec.domain = false;
    spec.grid = false;
    return spec;
  }
  if (axisConf.gridLines !== undefined) spec.grid = axisConf.gridLines;
  if (axisConf.minorGridLines !== undefined) spec.minorGrid = axisConf.minorGridLines;
  const tickMark = normalizeTickMark(axisConf.tickMarks);
  if (tickMark) {
    spec.tickMark = tickMark;
    if (tickMark === 'none') spec.ticks = false;
  }
  const minorTickMark = normalizeTickMark(axisConf.minorTickMarks);
  if (minorTickMark) {
    spec.minorTickMark = minorTickMark;
    spec.minorTicks = minorTickMark !== 'none';
  }
  if (axisConf.numberFormat) spec.format = axisConf.numberFormat;
  if (axisConf.linkNumberFormat !== undefined) spec.linkNumberFormat = axisConf.linkNumberFormat;
  if (isDateAxisConfig(axisConf)) {
    spec.formatType = 'time';
    const tickInterval = dateAxisTickInterval(axisConf);
    if (tickInterval) spec.tickInterval = tickInterval;
    else {
      const majorUnit = toFiniteNumber(axisConf.majorUnit);
      if (majorUnit !== undefined && majorUnit > 0) spec.tickStep = majorUnit;
    }
    const minorTickInterval = dateAxisMinorTickInterval(axisConf);
    if (minorTickInterval) spec.minorTickInterval = minorTickInterval;
    else {
      const minorUnit = toFiniteNumber(axisConf.minorUnit);
      if (minorUnit !== undefined && minorUnit > 0) spec.minorTickStep = minorUnit;
    }
  } else {
    const majorUnit = toFiniteNumber(axisConf.majorUnit);
    if (majorUnit !== undefined && majorUnit > 0) spec.tickStep = majorUnit;
    const minorUnit = toFiniteNumber(axisConf.minorUnit);
    if (minorUnit !== undefined && minorUnit > 0) spec.minorTickStep = minorUnit;
  }
  if (axisConf.crossesAt) spec.crossesAt = axisConf.crossesAt;
  if (axisConf.crossesAtValue !== undefined) spec.crossesAtValue = axisConf.crossesAtValue;
  const categoryCrossing = normalizeCategoryCrossing(axisConf);
  if (categoryCrossing) spec.categoryCrossing = categoryCrossing;

  const labelPosition = normalizeTickLabelPosition(axisConf.tickLabelPosition);
  if (labelPosition) {
    spec.labelPosition = labelPosition;
    if (labelPosition === 'none') spec.labels = false;
  }
  const tickLabelSkip = positiveInteger(axisConf.tickLabelSpacing);
  if (tickLabelSkip !== undefined) spec.tickLabelSkip = tickLabelSkip;
  const tickMarkSkip = positiveInteger(axisConf.tickMarkSpacing);
  if (tickMarkSkip !== undefined) spec.tickMarkSkip = tickMarkSkip;
  const displayUnitFactor = resolveDisplayUnitFactor(axisConf);
  if (displayUnitFactor !== undefined) spec.displayUnitFactor = displayUnitFactor;
  if (axisConf.displayUnitLabel) spec.displayUnitLabel = axisConf.displayUnitLabel;

  const labelFont = axisConf.format?.font;
  if (labelFont?.size !== undefined) spec.labelFontSize = pointsToCanvasPx(labelFont.size);
  if (labelFont?.name) spec.labelFontFamily = labelFont.name;
  const labelColor = resolveChartTextColor(labelFont?.color, context);
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
  const axisLineColor = resolveChartTextColor(axisLine?.color, context);
  if (axisLineColor) {
    spec.domainColor = axisLineColor;
    spec.tickColor = axisLineColor;
  }
  if (axisLine?.width !== undefined) {
    const lineWidth = linePointsToCanvasPx(axisLine.width);
    spec.domainWidth = lineWidth;
    spec.tickWidth = lineWidth;
  }

  const gridlineColor = resolveGridlineColor(axisConf.gridlineFormat?.color, context);
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
  const minorGridlineColor = resolveGridlineColor(axisConf.minorGridlineFormat?.color, context);
  if (minorGridlineColor) spec.minorGridColor = minorGridlineColor;
  if (axisConf.minorGridlineFormat?.width !== undefined) {
    spec.minorGridWidth = linePointsToCanvasPx(axisConf.minorGridlineFormat.width);
  }
  const minorGridDash = dashStyleToStrokeDash(
    axisConf.minorGridlineFormat?.dashStyle,
    linePointsToCanvasPx(axisConf.minorGridlineFormat?.width),
  );
  if (minorGridDash) spec.minorGridDash = minorGridDash;
  if (axisConf.minorGridlineFormat) {
    spec.minorGridOpacity =
      axisConf.minorGridlineFormat.transparency === undefined
        ? 1
        : Math.max(0, Math.min(1, 1 - axisConf.minorGridlineFormat.transparency));
  }

  const titleFont = axisConf.titleFormat?.font;
  if (titleFont?.size !== undefined) spec.titleFontSize = pointsToCanvasPx(titleFont.size);
  if (titleFont?.name) spec.titleFontFamily = titleFont.name;
  const titleColor = resolveChartTextColor(titleFont?.color, context);
  if (titleColor) spec.titleColor = titleColor;
  return spec;
}

function normalizeAxisLabelAngle(axisConf: SingleAxisConfig): number | undefined {
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

function dateAxisTickInterval(axisConf: SingleAxisConfig): AxisSpec['tickInterval'] | undefined {
  const majorUnit = toFiniteNumber(axisConf.majorUnit);
  if (majorUnit === undefined || majorUnit <= 0) return undefined;

  const unit = normalizeDateAxisTimeUnit(axisConf.majorTimeUnit ?? axisConf.baseTimeUnit);
  return unit ? { unit, step: majorUnit } : undefined;
}

function dateAxisMinorTickInterval(
  axisConf: SingleAxisConfig,
): AxisSpec['minorTickInterval'] | undefined {
  const minorUnit = toFiniteNumber(axisConf.minorUnit);
  if (minorUnit === undefined || minorUnit <= 0) return undefined;

  const unit = normalizeDateAxisTimeUnit(axisConf.minorTimeUnit);
  return unit ? { unit, step: minorUnit } : undefined;
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

function normalizeTickMark(value: string | undefined): AxisTickMark | undefined {
  switch (value?.toLowerCase()) {
    case 'none':
      return 'none';
    case 'in':
      return 'in';
    case 'out':
      return 'out';
    case 'cross':
      return 'cross';
    default:
      return undefined;
  }
}

function normalizeTickLabelPosition(
  value: string | undefined,
): AxisSpec['labelPosition'] | undefined {
  switch (value?.toLowerCase()) {
    case 'none':
      return 'none';
    case 'low':
      return 'low';
    case 'high':
      return 'high';
    case 'nextto':
    case 'next_to':
    case 'next-to':
      return 'nextTo';
    default:
      return undefined;
  }
}

function normalizeCategoryCrossing(
  axisConf: SingleAxisConfig,
): AxisSpec['categoryCrossing'] | undefined {
  const crossBetween = axisConf.crossBetween?.toLowerCase();
  if (crossBetween === 'between') return 'between';
  if (crossBetween === 'midcat' || crossBetween === 'mid_cat' || crossBetween === 'mid-cat') {
    return 'midCat';
  }
  if (axisConf.isBetweenCategories === true) return 'between';
  if (axisConf.isBetweenCategories === false) return 'midCat';
  return undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  const numeric = toFiniteNumber(value);
  if (numeric === undefined || numeric < 1) return undefined;
  return Math.floor(numeric);
}

function resolveDisplayUnitFactor(axisConf: SingleAxisConfig): number | undefined {
  const custom = toFiniteNumber(axisConf.customDisplayUnit);
  if (custom !== undefined && custom > 0) return custom;
  if (!axisConf.displayUnit) return undefined;

  const raw = axisConf.displayUnit.trim();
  const key = raw.replace(/[\s_-]/g, '').toLowerCase();
  return DISPLAY_UNIT_FACTORS[raw] ?? DISPLAY_UNIT_FACTORS[key];
}
