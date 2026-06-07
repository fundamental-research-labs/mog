import type { ChannelSpec, EncodingSpec } from '../../grammar/spec';
import { tickStep } from '../../primitives/scales/linear';
import type { ChartConfig, ChartData } from '../../types';
import { explicitDomainBound, isHorizontalBarType } from './axis';
import {
  chartImportSourceDialect,
  effectiveBarGeometry,
  hasExcelBarGeometryConfig,
} from './bar-geometry';
import { categoryDisplayLabel, categoryKeyForIndex } from './category-axis';
import { resolveStackMode } from './subtypes';

const STACKED_VALUE_AXIS_TICK_COUNT = 6;
const AUTO_VALUE_AXIS_TICK_COUNT = 5;
const DIVERGING_VALUE_AXIS_TICK_COUNT = 8;
const DOMAIN_EPSILON = 1e-10;
const HEADROOM_STEP_FRACTION = 0.2;

export function applyBarCategorySpacingScale(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
  isHorizontal: boolean,
): void {
  if (!hasExcelBarGeometryConfig(config)) return;
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel || categoryChannel.type !== 'nominal') return;
  if (
    categoryChannel.scale?.type !== undefined &&
    categoryChannel.scale.type !== 'band' &&
    categoryChannel.scale.type !== 'point'
  ) {
    return;
  }

  const barGeometry = effectiveBarGeometry(config, data);
  if (barGeometry?.categoryPositionPolicy === 'onCategory') {
    categoryChannel.scale = {
      ...(categoryChannel.scale ?? {}),
      type: 'point',
      padding: 0,
      categoryPositionPolicy: 'onCategory',
    };
    return;
  }

  categoryChannel.scale = {
    ...(categoryChannel.scale ?? {}),
    type: 'band',
    paddingInner: 0,
    paddingOuter: 0,
    ...(barGeometry?.categoryPositionPolicy
      ? { categoryPositionPolicy: barGeometry.categoryPositionPolicy }
      : {}),
  };
}

export function applyCategoryAxisLabels(
  data: ChartData,
  encoding: EncodingSpec,
  isHorizontal: boolean,
  useStableCategoryKeys: boolean,
  categoryLabelLevel?: number,
): void {
  const categoryChannel = isHorizontal ? encoding.y : encoding.x;
  if (!categoryChannel || categoryChannel.axis === null) return;

  const labelTextByValue: Record<string, string> = {};
  if (useStableCategoryKeys) {
    data.categories.forEach((category, index) => {
      labelTextByValue[categoryKeyForIndex(index)] = categoryDisplayLabel(category);
    });
  }

  const labelFormatByValue: Record<string, string> = {};
  if (data.categoryFormatCodes?.some(Boolean)) {
    data.categories.forEach((category, index) => {
      const formatCode = data.categoryFormatCodes?.[index];
      if (formatCode) {
        const key = useStableCategoryKeys ? categoryKeyForIndex(index) : String(category);
        labelFormatByValue[key] = formatCode;
      }
    });
  }

  const multiLevelLabelsByValue =
    categoryLabelLevel === undefined
      ? multiLevelCategoryLabelsByValue(data, useStableCategoryKeys)
      : {};
  if (
    Object.keys(labelTextByValue).length === 0 &&
    Object.keys(labelFormatByValue).length === 0 &&
    Object.keys(multiLevelLabelsByValue).length === 0
  ) {
    return;
  }

  categoryChannel.axis = {
    ...(categoryChannel.axis ?? {}),
    ...(Object.keys(labelTextByValue).length > 0 ? { labelTextByValue } : {}),
    ...(Object.keys(labelFormatByValue).length > 0 ? { labelFormatByValue } : {}),
    ...(Object.keys(multiLevelLabelsByValue).length > 0 ? { multiLevelLabelsByValue } : {}),
  };
  if (categoryChannel.secondaryAxis !== null && categoryChannel.secondaryAxis !== undefined) {
    categoryChannel.secondaryAxis = {
      ...categoryChannel.secondaryAxis,
      ...(Object.keys(labelTextByValue).length > 0 ? { labelTextByValue } : {}),
      ...(Object.keys(labelFormatByValue).length > 0 ? { labelFormatByValue } : {}),
      ...(Object.keys(multiLevelLabelsByValue).length > 0 ? { multiLevelLabelsByValue } : {}),
    };
  }
}

function multiLevelCategoryLabelsByValue(
  data: ChartData,
  useStableCategoryKeys: boolean,
): Record<string, string[]> {
  const levels = data.categoryLevels;
  if (!levels?.length) return {};

  const sortedLevels = [...levels].sort((a, b) => a.level - b.level);
  const labelsByValue: Record<string, string[]> = {};
  data.categories.forEach((category, pointIndex) => {
    const labels = sortedLevels.map((level) => categoryDisplayLabel(level.labels[pointIndex]));
    if (!labels.some((label) => label !== '')) return;
    const key = useStableCategoryKeys ? categoryKeyForIndex(pointIndex) : String(category);
    labelsByValue[key] = labels;
  });
  return labelsByValue;
}

export function applyStackedValueDomain(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
): void {
  const stack = resolveStackMode(config);
  if (!stack) return;
  if (chartImportSourceDialect(config) === 'ooxml' && hasExcelBarGeometryConfig(config)) return;

  const chartType = config.type;
  const valueChannel = isHorizontalBarType(chartType) ? encoding.x : encoding.y;
  if (!valueChannel) return;

  const existingDomain = Array.isArray(valueChannel.scale?.domain)
    ? valueChannel.scale.domain
    : undefined;
  const explicitMin = explicitDomainBound(existingDomain, 0);
  const explicitMax = explicitDomainBound(existingDomain, 1);

  if (stack === 'normalize') {
    let hasPositive = false;
    let hasNegative = false;
    for (let pointIndex = 0; pointIndex < (data.categories?.length ?? 0); pointIndex += 1) {
      for (const series of data.series) {
        const value = series.data[pointIndex]?.y;
        if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
        if (value > 0) hasPositive = true;
        else hasNegative = true;
      }
    }

    const defaultMin = hasNegative ? -100 : 0;
    const defaultMax = hasPositive ? 100 : 0;
    valueChannel.scale = {
      ...(valueChannel.scale ?? {}),
      domain: [
        explicitMin ?? defaultMin,
        explicitMax ?? (defaultMax === defaultMin ? 100 : defaultMax),
      ],
      nice: false,
    };
    return;
  }

  let maxPositive = 0;
  let minNegative = 0;
  for (let pointIndex = 0; pointIndex < (data.categories?.length ?? 0); pointIndex += 1) {
    let positive = 0;
    let negative = 0;
    for (const series of data.series) {
      const value = series.data[pointIndex]?.y;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value >= 0) positive += value;
      else negative += value;
    }
    if (positive > maxPositive) maxPositive = positive;
    if (negative < minNegative) minNegative = negative;
  }

  if (maxPositive === 0 && minNegative === 0) return;

  const isAutoPositiveStack = explicitMax === undefined && minNegative === 0 && maxPositive > 0;
  const isAutoNegativeStack = explicitMin === undefined && maxPositive === 0 && minNegative < 0;
  const isAutoDivergingStack =
    explicitMin === undefined && explicitMax === undefined && minNegative < 0 && maxPositive > 0;

  valueChannel.scale = {
    ...(valueChannel.scale ?? {}),
    domain: [
      explicitMin ??
        (isAutoNegativeStack ? -niceStackedAxisUpperBound(Math.abs(minNegative)) : minNegative),
      explicitMax ?? (isAutoPositiveStack ? niceStackedAxisUpperBound(maxPositive) : maxPositive),
    ],
    ...(isAutoDivergingStack
      ? { nice: valueChannel.scale?.nice ?? STACKED_VALUE_AXIS_TICK_COUNT }
      : isAutoPositiveStack || isAutoNegativeStack
        ? { nice: false }
        : {}),
  };

  if (isAutoPositiveStack || isAutoNegativeStack || isAutoDivergingStack) {
    valueChannel.axis = {
      ...(valueChannel.axis ?? {}),
      tickCount: valueChannel.axis?.tickCount ?? STACKED_VALUE_AXIS_TICK_COUNT,
    };
  }
}

function niceStackedAxisUpperBound(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;

  const step = tickStep(0, value, STACKED_VALUE_AXIS_TICK_COUNT);
  if (!Number.isFinite(step) || step <= 0) return value;

  const ratio = value / step;
  const roundedRatio = Math.round(ratio);
  const upperRatio =
    Math.abs(ratio - roundedRatio) < DOMAIN_EPSILON ? roundedRatio + 1 : Math.ceil(ratio);
  return roundDomainBound(upperRatio * step);
}

function roundDomainBound(value: number): number {
  return Number.parseFloat(value.toPrecision(12));
}

export function applyAutomaticCategoryAxisCrossing(encoding: EncodingSpec): void {
  const x = encoding.x;
  const y = encoding.y;
  if (!x || !y) return;

  if (x.type === 'nominal' && y.type === 'quantitative') {
    applyAutomaticCrossingToCategoryChannel(x, y);
  } else if (y.type === 'nominal' && x.type === 'quantitative') {
    applyAutomaticCrossingToCategoryChannel(y, x);
  }
}

function applyAutomaticCrossingToCategoryChannel(
  categoryChannel: ChannelSpec,
  valueChannel: ChannelSpec,
): void {
  if (categoryChannel.axis === null || categoryChannel.axis?.crossesAt !== undefined) return;

  const scaleDomain = Array.isArray(valueChannel.scale?.domain)
    ? valueChannel.scale.domain
    : undefined;
  const min = explicitDomainBound(scaleDomain, 0);
  const max = explicitDomainBound(scaleDomain, 1);
  if (min === undefined || max === undefined || min >= 0 || max <= 0) return;

  categoryChannel.axis = {
    ...(categoryChannel.axis ?? {}),
    crossesAt: 'automatic',
  };
}

export function applyMogAutoValueAxisScale(
  channel: ChannelSpec | undefined,
  values: readonly number[],
  options: { includeZero: boolean; tickCount?: number } = { includeZero: true },
): void {
  if (!channel || channel.type !== 'quantitative' || channel.scale === null) return;
  if (channel.scale?.type && channel.scale.type !== 'linear') return;
  if (hasExplicitScaleDomain(channel.scale?.domain)) return;

  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return;

  const dataMin = Math.min(...finiteValues);
  const dataMax = Math.max(...finiteValues);
  let axisMin = options.includeZero ? Math.min(0, dataMin) : dataMin;
  let axisMax = options.includeZero ? Math.max(0, dataMax) : dataMax;
  if (axisMin === axisMax) {
    if (axisMin === 0) {
      axisMax = 1;
    } else if (axisMin > 0) {
      axisMin = options.includeZero ? 0 : axisMin * 0.9;
      axisMax *= 1.1;
    } else {
      axisMin *= 1.1;
      axisMax = options.includeZero ? 0 : axisMax * 0.9;
    }
  }

  const diverging = options.includeZero && dataMin < 0 && dataMax > 0;
  const requestedTickCount = options.tickCount ?? AUTO_VALUE_AXIS_TICK_COUNT;
  const tickCount = diverging
    ? Math.max(requestedTickCount, DIVERGING_VALUE_AXIS_TICK_COUNT)
    : requestedTickCount;
  const explicitTickStep = positiveNumber(channel.axis?.tickStep);
  const step = explicitTickStep ?? Math.abs(tickStep(axisMin, axisMax, tickCount));
  if (!Number.isFinite(step) || step <= 0) return;

  let domainMin = Math.floor(axisMin / step) * step;
  let domainMax = Math.ceil(axisMax / step) * step;

  if (options.includeZero && dataMin >= 0) domainMin = Math.min(0, domainMin);
  if (options.includeZero && dataMax <= 0) domainMax = Math.max(0, domainMax);
  if (domainMin === domainMax) domainMax = domainMin + step;

  if (domainMax > 0 && dataMax > 0 && domainMax - dataMax <= step * HEADROOM_STEP_FRACTION) {
    domainMax += step;
  }
  if (domainMin < 0 && dataMin < 0 && dataMin - domainMin <= step * HEADROOM_STEP_FRACTION) {
    domainMin -= step;
  }

  channel.scale = {
    ...(channel.scale ?? {}),
    domain: [roundDomainBound(domainMin), roundDomainBound(domainMax)],
    nice: false,
    ...(options.includeZero ? { zero: true } : {}),
  };
  if (channel.axis !== null && channel.axis !== undefined) {
    channel.axis = {
      ...channel.axis,
      tickStep: explicitTickStep ?? roundDomainBound(step),
    };
  }
}

function hasExplicitScaleDomain(domain: unknown): boolean {
  return Array.isArray(domain) && domain.some((bound) => bound !== undefined);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
