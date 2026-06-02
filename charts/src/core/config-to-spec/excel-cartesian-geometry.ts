import type {
  ChannelSpec,
  EncodingSpec,
  MarkSpec,
  MarkType,
  ScaleSpec,
} from '../../grammar/spec';
import { tickStep } from '../../primitives/scales/linear';
import type { ChartConfig, ChartData, ChartType, SingleAxisConfig } from '../../types';
import {
  applyAutoValueAxisTicks,
  buildAxisScaleSpec,
  explicitDomainBound,
  mapAxisConfigToAxisSpec,
  resolveAxisConfigForChannel,
} from './axis';
import { normalizeCategoryCrossing } from './axis-format-normalization';
import { chartImportSourceDialect } from './bar-geometry';
import { categoryKeyForIndex, toFiniteNumber } from './category-axis';
import { MARK_TYPE_MAP } from './constants';
import { SCATTER_X_FIELD, VALUE_FIELD } from './fields';
import { resolveStackMode } from './subtypes';

const EXCEL_VALUE_AXIS_TICK_COUNT = 5;
const EXCEL_DIVERGING_VALUE_AXIS_TICK_COUNT = 8;
const DOMAIN_EPSILON = 1e-10;
const HEADROOM_STEP_FRACTION = 0.2;

export type ExcelCategoryPositionPolicy = 'between' | 'onCategory' | 'centeredSingleton';

export function usesExcelCartesianGeometry(config: Pick<ChartConfig, 'type' | 'extra'>): boolean {
  return chartImportSourceDialect(config) === 'ooxml' && isExcelCartesianChartType(config.type);
}

export function shouldUseExcelCategoryPointScale(
  config: ChartConfig,
  data: ChartData,
  options: {
    isHorizontal: boolean;
    useDateSerialCategoryAxis: boolean;
    seriesType?: ChartType;
  },
): boolean {
  if (!usesExcelCartesianGeometry(config)) return false;
  if (options.isHorizontal || options.useDateSerialCategoryAxis) return false;
  if (data.categories.length === 0) return false;

  const chartType = options.seriesType ?? config.type;
  const markType = MARK_TYPE_MAP[chartType];
  return markType === 'line' || markType === 'area' || chartType === 'combo';
}

export function applyExcelCategoryPointScale(
  channel: ChannelSpec | undefined,
  config: ChartConfig,
  data: ChartData,
  options: {
    isHorizontal: boolean;
    useDateSerialCategoryAxis: boolean;
    useStableCategoryKeys: boolean;
    seriesType?: ChartType;
  },
): void {
  if (!channel || channel.type !== 'nominal') return;
  if (!shouldUseExcelCategoryPointScale(config, data, options)) return;

  channel.scale = {
    ...(channel.scale ?? {}),
    ...excelCategoryPointScale(config, data, {
      isHorizontal: options.isHorizontal,
      useStableCategoryKeys: options.useStableCategoryKeys,
    }),
  };
}

export function excelCategoryPointEncoding(
  base: ChannelSpec,
  config: ChartConfig,
  data: ChartData,
  options: {
    isHorizontal: boolean;
    useStableCategoryKeys: boolean;
    seriesType: ChartType;
  },
): ChannelSpec {
  const channel: ChannelSpec = {
    ...base,
    type: 'nominal',
    scale: {
      ...(base.scale ?? {}),
      ...excelCategoryPointScale(config, data, options),
    },
  };
  return channel;
}

export function applyExcelCartesianValueScales(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
  options: { isHorizontal: boolean; isXYChart: boolean },
): void {
  if (!usesExcelCartesianGeometry(config)) return;

  if (options.isXYChart) {
    applyExcelAutoValueAxisScale(encoding.x, scatterXValues(data), { includeZero: false });
    applyExcelAutoValueAxisScale(encoding.y, chartValueValues(data), { includeZero: false });
    return;
  }

  const valueChannel = options.isHorizontal ? encoding.x : encoding.y;
  applyExcelAutoValueAxisScale(valueChannel, chartValueValues(data), {
    includeZero: excelChartValueAxisIncludesZero(config),
  });
}

export function excelValueEncodingForAxis(input: {
  config: ChartConfig;
  baseY: ChannelSpec;
  axisIndex: 0 | 1;
  values: readonly number[];
  includeZero: boolean;
}): ChannelSpec {
  const axisConfig = valueAxisConfigForIndex(input.config, input.axisIndex);
  const channel: ChannelSpec =
    input.axisIndex === 1
      ? secondaryValueEncoding(input.config, axisConfig)
      : {
          ...input.baseY,
          field: VALUE_FIELD,
          type: 'quantitative',
        };

  if (axisConfig) {
    const axisSpec = mapAxisConfigToAxisSpec(
      axisConfig,
      input.config,
      input.axisIndex === 1 ? 'secondaryValueAxis' : 'valueAxis',
    );
    channel.axis =
      input.axisIndex === 1
        ? {
            ...axisSpec,
            orient: 'right',
            grid: axisSpec.grid ?? false,
            title: axisSpec.title ?? axisConfig.title ?? null,
          }
        : axisSpec;

    const scaleSpec = buildAxisScaleSpec(axisConfig, false);
    if (scaleSpec) {
      channel.scale = { ...(channel.scale ?? {}), ...scaleSpec };
    }
  }

  applyExcelAutoValueAxisScale(channel, input.values, { includeZero: input.includeZero });
  return channel;
}

export function excelQuantitativeXEncoding(input: {
  config: ChartConfig;
  data: ChartData;
}): ChannelSpec {
  const axisConfig = input.config.axis?.xAxis ?? input.config.axis?.valueAxis;
  const channel: ChannelSpec = {
    field: SCATTER_X_FIELD,
    type: 'quantitative',
    axis: axisConfig ? mapAxisConfigToAxisSpec(axisConfig, input.config, 'valueAxis') : undefined,
    scale: {
      zero: false,
      nice: true,
      ...(axisConfig ? (buildAxisScaleSpec(axisConfig, false) ?? {}) : {}),
    },
  };
  applyExcelAutoValueAxisScale(channel, scatterXValues(input.data), { includeZero: false });
  return channel;
}

export function applyExcelAutoValueAxisScale(
  channel: ChannelSpec | undefined,
  values: readonly number[],
  options: { includeZero: boolean; tickCount?: number },
): void {
  if (!channel || channel.type !== 'quantitative' || channel.scale === null) return;

  applyAutoValueAxisTicks(channel, { includeZero: options.includeZero });

  const scaleSpec: ScaleSpec = channel.scale ?? {};
  if (scaleSpec.type && scaleSpec.type !== 'linear') return;
  if (hasExplicitScaleDomain(scaleSpec.domain)) return;

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

  const requestedTickCount = options.tickCount ?? EXCEL_VALUE_AXIS_TICK_COUNT;
  const tickCount =
    options.includeZero && dataMin < 0 && dataMax > 0
      ? Math.max(requestedTickCount, EXCEL_DIVERGING_VALUE_AXIS_TICK_COUNT)
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
    ...scaleSpec,
    domain: [roundDomainBound(domainMin), roundDomainBound(domainMax)],
    nice: false,
    ...(options.includeZero ? { zero: true } : { zero: false }),
  };
  if (channel.axis !== null && channel.axis !== undefined) {
    channel.axis = {
      ...channel.axis,
      tickStep: explicitTickStep ?? roundDomainBound(step),
    };
  }
}

export function excelChartValueAxisIncludesZero(config: ChartConfig): boolean {
  const markType = MARK_TYPE_MAP[config.type];
  return markType === 'bar' || markType === 'area' || resolveStackMode(config) !== undefined;
}

export function excelSeriesValueAxisIncludesZero(
  config: ChartConfig,
  seriesType: ChartType,
): boolean {
  const markType = MARK_TYPE_MAP[seriesType];
  return markType === 'bar' || markType === 'area' || resolveStackMode(config) !== undefined;
}

export function withExcelAreaBaseline<T extends MarkType | MarkSpec>(
  mark: T,
  config: ChartConfig,
  yChannel: ChannelSpec | undefined,
): T | MarkSpec {
  if (!usesExcelCartesianGeometry(config)) return mark;
  const markType = typeof mark === 'string' ? mark : mark.type;
  if (markType !== 'area') return mark;

  const baseline = resolveAreaBaselineValue(yChannel);
  if (baseline === undefined) return mark;
  return typeof mark === 'string' ? { type: mark, baseline } : { ...mark, baseline };
}

export function chartValueValues(data: ChartData, memberIndices?: readonly number[]): number[] {
  const values: number[] = [];
  const memberSet = memberIndices ? new Set(memberIndices) : undefined;
  data.series.forEach((series, seriesIndex) => {
    if (memberSet && !memberSet.has(seriesIndex)) return;
    for (const point of series.data) {
      if (typeof point?.y === 'number' && Number.isFinite(point.y)) values.push(point.y);
    }
  });
  return values;
}

export function scatterXValues(data: ChartData, memberIndices?: readonly number[]): number[] {
  const values: number[] = [];
  const memberSet = memberIndices ? new Set(memberIndices) : undefined;
  data.series.forEach((series, seriesIndex) => {
    if (memberSet && !memberSet.has(seriesIndex)) return;
    for (const point of series.data) {
      const x = toFiniteNumber(point?.x);
      if (x !== undefined) values.push(x);
    }
  });
  return values;
}

function excelCategoryPointScale(
  config: ChartConfig,
  data: ChartData,
  options: {
    isHorizontal: boolean;
    useStableCategoryKeys: boolean;
  },
): ScaleSpec {
  const policy = resolveExcelCategoryPositionPolicy(config, data, options.isHorizontal);
  return {
    type: 'point',
    domain: options.useStableCategoryKeys
      ? data.categories.map((_category, index) => categoryKeyForIndex(index))
      : data.categories.map((category) => String(category)),
    padding: policy === 'between' ? 0.5 : 0,
  };
}

function resolveExcelCategoryPositionPolicy(
  config: ChartConfig,
  data: ChartData,
  isHorizontal: boolean,
): ExcelCategoryPositionPolicy {
  if (data.categories.length <= 1) return 'centeredSingleton';

  const categoryAxis = config.axis
    ? resolveAxisConfigForChannel(config.axis, isHorizontal ? 'y' : 'x', isHorizontal)
    : undefined;
  const valueAxis = config.axis
    ? resolveAxisConfigForChannel(config.axis, isHorizontal ? 'x' : 'y', isHorizontal)
    : undefined;
  const crossing =
    normalizeCrossing(categoryAxis) ?? normalizeCrossing(valueAxis) ?? defaultCategoryCrossing(config);

  return crossing === 'between' ? 'between' : 'onCategory';
}

function normalizeCrossing(axis: SingleAxisConfig | undefined): 'between' | 'midCat' | undefined {
  return axis ? normalizeCategoryCrossing(axis) : undefined;
}

function defaultCategoryCrossing(config: ChartConfig): 'between' | 'midCat' {
  return MARK_TYPE_MAP[config.type] === 'bar' ? 'between' : 'midCat';
}

function resolveAreaBaselineValue(yChannel: ChannelSpec | undefined): number | undefined {
  if (!yChannel || yChannel.type !== 'quantitative') return undefined;
  const domain = Array.isArray(yChannel.scale?.domain) ? yChannel.scale.domain : undefined;
  const domainMin = explicitDomainBound(domain, 0);
  const domainMax = explicitDomainBound(domain, 1);
  const crossesAt = yChannel.axis && yChannel.axis !== null ? yChannel.axis.crossesAt : undefined;

  if (crossesAt === 'custom') {
    return finiteNumber(yChannel.axis?.crossesAtValue);
  }
  if (crossesAt === 'min') return domainMin;
  if (crossesAt === 'max') return domainMax;
  return 0;
}

function secondaryValueEncoding(
  config: ChartConfig,
  axisConfig: SingleAxisConfig | undefined,
): ChannelSpec {
  const axisSpec = axisConfig ? mapAxisConfigToAxisSpec(axisConfig, config, 'secondaryValueAxis') : {};
  return {
    field: VALUE_FIELD,
    type: 'quantitative',
    axis: {
      ...axisSpec,
      orient: 'right',
      grid: axisSpec.grid ?? false,
      title: axisSpec.title ?? axisConfig?.title ?? null,
    },
  };
}

function valueAxisConfigForIndex(
  config: ChartConfig,
  axisIndex: 0 | 1,
): SingleAxisConfig | undefined {
  if (axisIndex === 1) {
    return config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;
  }
  return config.axis?.yAxis ?? config.axis?.valueAxis;
}

function isExcelCartesianChartType(type: ChartType): boolean {
  switch (type) {
    case 'line':
    case 'lineMarkers':
    case 'lineMarkersStacked':
    case 'lineMarkersStacked100':
    case 'area':
    case 'scatter':
    case 'bubble':
    case 'combo':
      return true;
    default:
      return false;
  }
}

function hasExplicitScaleDomain(domain: unknown): boolean {
  return Array.isArray(domain) && domain.some((bound) => bound !== undefined);
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function roundDomainBound(value: number): number {
  if (Math.abs(value) < DOMAIN_EPSILON) return 0;
  return Number.parseFloat(value.toPrecision(12));
}
