import type { AxisOrient, AxisSpec } from '../../grammar/spec';
import type { ChartConfig, SingleAxisConfig } from '../../types';
import { resolveChartOwnerFormat, resolverContextFromConfig } from '../style-resolver';
import { dateAxisMinorTickInterval, dateAxisTickInterval } from './axis-format-date';
import { resolveDisplayUnitFactor } from './axis-format-display-units';
import {
  normalizeAxisLabelAngle,
  normalizeCategoryCrossing,
  normalizeTickLabelPosition,
  normalizeTickMark,
  positiveInteger,
} from './axis-format-normalization';
import {
  applyAxisGridlineStyle,
  applyAxisLabelStyle,
  applyAxisLineStyle,
  applyAxisTitleStyle,
} from './axis-format-styles';
import { applyAxisTextDefaults } from './axis-defaults';
import { isDateAxisConfig, toFiniteNumber } from './category-axis';

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
  const axisFormat = config
    ? resolveChartOwnerFormat(config, ownerKey, axisConf.format)
    : axisConf.format;
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
  if (tickLabelSkip !== undefined) {
    spec.tickLabelSkip = tickLabelSkip;
    spec.tickLabelSkipSource = 'explicit';
  }
  const tickMarkSkip = positiveInteger(axisConf.tickMarkSpacing);
  if (tickMarkSkip !== undefined) {
    spec.tickMarkSkip = tickMarkSkip;
    spec.tickMarkSkipSource = 'explicit';
  }
  const displayUnitFactor = resolveDisplayUnitFactor(axisConf);
  if (displayUnitFactor !== undefined) spec.displayUnitFactor = displayUnitFactor;
  if (axisConf.displayUnitLabel) spec.displayUnitLabel = axisConf.displayUnitLabel;

  applyAxisLabelStyle(spec, axisFormat, context);

  const labelAngle = normalizeAxisLabelAngle(axisConf);
  const isCategoryAxis = axisConf.axisType === 'catAx' || axisConf.type === 'category';
  if (isCategoryAxis && axisConf.tickMarks === 'none') {
    spec.labelPadding = 14;
  }
  if (labelAngle !== undefined) {
    spec.labelAngle = labelAngle;
  }

  applyAxisLineStyle(spec, axisFormat, context);
  applyAxisGridlineStyle(spec, axisConf, context);
  applyAxisTitleStyle(spec, axisConf, context);
  applyAxisTextDefaults(spec);
  return spec;
}
