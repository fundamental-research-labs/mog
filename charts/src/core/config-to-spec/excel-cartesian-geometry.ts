import type {
  ChannelSpec,
  EncodingSpec,
  MarkSpec,
  MarkType,
  ScaleSpec,
} from '../../grammar/spec';
import { tickStep } from '../../primitives/scales/linear';
import type {
  ChartConfig,
  ChartData,
  ChartType,
  SeriesConfig,
  SingleAxisConfig,
} from '../../types';
import { seriesConfigForDataSeries } from '../series-identity';
import {
  applyAutoValueAxisTicks,
  buildAxisScaleSpec,
  explicitDomainBound,
  mapAxisConfigToAxisSpec,
  resolveAxisConfigForChannel,
} from './axis';
import { normalizeCategoryCrossing } from './axis-format-normalization';
import { chartImportSourceDialect, isBarLikeChartType } from './bar-geometry';
import {
  categoryKeyForIndex,
  shouldUseDateSerialCategoryAxis,
  shouldUseStableCategoryKeys,
  toFiniteNumber,
} from './category-axis';
import { MARK_TYPE_MAP } from './constants';
import {
  BUBBLE_SIZE_FIELD,
  RAW_BUBBLE_SIZE_FIELD,
  SCATTER_X_FIELD,
  VALUE_FIELD,
} from './fields';
import { maxRenderableBubbleMagnitude } from './data-point-values';
import {
  effectiveShowLines,
  effectiveShowMarkers,
  isSupportedChartType,
  normalizeYAxisIndex,
  resolveComboSeriesType,
} from './layers/combo-series-options';
import { resolveStackMode } from './subtypes';

const EXCEL_VALUE_AXIS_TICK_COUNT = 5;
const EXCEL_DIVERGING_VALUE_AXIS_TICK_COUNT = 8;
const DOMAIN_EPSILON = 1e-10;
const HEADROOM_STEP_FRACTION = 0.2;

export type ExcelCategoryPositionPolicy = 'between' | 'onCategory' | 'centeredSingleton';

export type ExcelCartesianXGeometryMode = 'categoryPoint' | 'dateSerial' | 'quantitative';

export type ExcelCartesianValueAxisGeometry = {
  axisGroup: 'primary' | 'secondary';
  domain?: [number, number];
  includeZero: boolean;
  explicitDomain: boolean;
  tickStep?: number;
};

export type ExcelCartesianSeriesGeometry = {
  seriesIndex: number;
  type: string;
  xRole: 'category' | 'quantitative';
  xMode: ExcelCartesianXGeometryMode;
  axisGroup: 'primary' | 'secondary';
  showLines?: boolean;
  showMarkers?: boolean;
  stackGroup?: string;
  markerLayer?: boolean;
  bubbleSizeAuthority?: 'series';
};

export type ExcelCartesianGeometryPlan = {
  x: {
    modes: ExcelCartesianXGeometryMode[];
    category?: {
      mode: 'categoryPoint' | 'dateSerial';
      domain: Array<string | number>;
      pointCount: number;
      positionPolicy?: ExcelCategoryPositionPolicy;
      stableKeys: boolean;
    };
    quantitative?: {
      mode: 'quantitative';
      domain?: [number, number];
      field: typeof SCATTER_X_FIELD;
    };
  };
  valueAxes: ExcelCartesianValueAxisGeometry[];
  area?: {
    stackMode: 'none' | 'zero' | 'normalize' | 'center';
    baseline: number;
    percentDomain?: [number, number];
    groups: Array<{
      axisGroup: 'primary' | 'secondary';
      xRole: 'category' | 'quantitative';
      seriesIndices: number[];
    }>;
  };
  bubble?: {
    sizeRepresents: 'area' | 'w';
    bubbleScale: number;
    showNegBubbles: boolean;
    maxRenderableMagnitude: number;
    maxRenderedArea: number;
    normalizedSizeField: typeof BUBBLE_SIZE_FIELD;
    rawSizeField: typeof RAW_BUBBLE_SIZE_FIELD;
  };
  series: ExcelCartesianSeriesGeometry[];
};

export function usesExcelCartesianGeometry(config: Pick<ChartConfig, 'type' | 'extra'>): boolean {
  return chartImportSourceDialect(config) === 'ooxml' && isExcelCartesianChartType(config.type);
}

export function buildExcelCartesianGeometryPlan(
  config: ChartConfig,
  data: ChartData,
): ExcelCartesianGeometryPlan | undefined {
  if (!usesExcelCartesianGeometry(config)) return undefined;

  const series = buildExcelCartesianSeriesGeometry(config, data);
  if (series.length === 0) return undefined;

  const useDateSerialCategoryAxis = shouldUseDateSerialCategoryAxis(config, data, false);
  const useStableCategoryKeys = shouldUseStableCategoryKeys(config, data, useDateSerialCategoryAxis);
  const hasCategoryX = series.some((item) => item.xRole === 'category');
  const hasQuantitativeX = series.some((item) => item.xRole === 'quantitative');
  const quantitativeSeriesIndices = series
    .filter((item) => item.xRole === 'quantitative')
    .map((item) => item.seriesIndex);
  const xModes = uniqueModes(series.map((item) => item.xMode));
  const quantitativeX = hasQuantitativeX
    ? {
        mode: 'quantitative' as const,
        domain: quantitativeXGeometryDomain(config, data, quantitativeSeriesIndices),
        field: SCATTER_X_FIELD as typeof SCATTER_X_FIELD,
      }
    : undefined;
  const categoryX = hasCategoryX
    ? {
        mode: useDateSerialCategoryAxis ? ('dateSerial' as const) : ('categoryPoint' as const),
        domain: useStableCategoryKeys
          ? data.categories.map((_category, index) => categoryKeyForIndex(index))
          : data.categories.map((category) =>
              useDateSerialCategoryAxis
                ? (toFiniteNumber(category) ?? String(category))
                : String(category),
            ),
        pointCount: data.categories.length,
        positionPolicy: useDateSerialCategoryAxis
          ? undefined
          : resolveExcelCategoryPositionPolicy(config, data, false),
        stableKeys: useStableCategoryKeys,
      }
    : undefined;

  return {
    x: {
      modes: xModes,
      ...(categoryX ? { category: categoryX } : {}),
      ...(quantitativeX ? { quantitative: quantitativeX } : {}),
    },
    valueAxes: buildExcelValueAxisGeometry(config, data, series),
    ...buildExcelAreaGeometry(config, data, series),
    ...buildExcelBubbleGeometry(config, data, series),
    series,
  };
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
  if (typeof mark === 'string') return { type: mark, baseline };
  const markSpec = mark as MarkSpec;
  return { ...markSpec, baseline };
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

function buildExcelCartesianSeriesGeometry(
  config: ChartConfig,
  data: ChartData,
): ExcelCartesianSeriesGeometry[] {
  const useDateSerialCategoryAxis = shouldUseDateSerialCategoryAxis(config, data, false);
  const seriesConfigs = config.series ?? [];
  return data.series.flatMap((series, index) => {
    const seriesConfig = seriesConfigForDataSeries(series, seriesConfigs, index);
    const seriesType = resolveGeometrySeriesType(config, series, seriesConfig, index);
    if (!seriesType || !isPointPathExcelCartesianSeriesType(seriesType)) return [];

    const xRole = isQuantitativeGeometryXSeries(config, seriesType, seriesConfig)
      ? 'quantitative'
      : 'category';
    const axisIndex = normalizeYAxisIndex(seriesConfig?.yAxisIndex ?? series.yAxisIndex) ?? 0;
    const markType = MARK_TYPE_MAP[seriesType];
    const showLines = effectiveShowLines(seriesConfig, seriesType, config);
    const showMarkers = effectiveShowMarkers(seriesConfig, seriesType, config, !showLines);
    const stackMode = resolveStackMode(config);
    const stackGroup =
      markType === 'area' && stackMode !== undefined ? `area:${axisIndex}:${xRole}` : undefined;

    return [
      {
        seriesIndex: index,
        type: seriesType,
        xRole,
        xMode:
          xRole === 'quantitative'
            ? 'quantitative'
            : useDateSerialCategoryAxis
              ? 'dateSerial'
              : 'categoryPoint',
        axisGroup: axisIndex === 1 ? 'secondary' : 'primary',
        showLines,
        showMarkers,
        ...(stackGroup ? { stackGroup } : {}),
        ...(showMarkers ? { markerLayer: true } : {}),
        ...(seriesType === 'bubble' ? { bubbleSizeAuthority: 'series' as const } : {}),
      },
    ];
  });
}

function buildExcelValueAxisGeometry(
  config: ChartConfig,
  data: ChartData,
  series: ExcelCartesianSeriesGeometry[],
): ExcelCartesianValueAxisGeometry[] {
  const byAxis = new Map<0 | 1, ExcelCartesianSeriesGeometry[]>();
  for (const item of series) {
    const axisIndex = item.axisGroup === 'secondary' ? 1 : 0;
    const members = byAxis.get(axisIndex) ?? [];
    members.push(item);
    byAxis.set(axisIndex, members);
  }

  return Array.from(byAxis.entries()).map(([axisIndex, members]) => {
    const includeZero = members.some((item) =>
      excelSeriesValueAxisIncludesZero(config, item.type as ChartType),
    );
    const axisConfig = valueAxisConfigForIndex(config, axisIndex);
    const configuredScale = axisConfig ? buildAxisScaleSpec(axisConfig, false) : undefined;
    const channel = excelValueEncodingForAxis({
      config,
      baseY: { field: VALUE_FIELD, type: 'quantitative' },
      axisIndex,
      values: geometryAxisValues(
        config,
        data,
        members.map((item) => item.seriesIndex),
      ),
      includeZero,
    });
    return {
      axisGroup: axisIndex === 1 ? 'secondary' : 'primary',
      domain: scaleDomain(channel.scale?.domain),
      includeZero,
      explicitDomain: hasExplicitScaleDomain(configuredScale?.domain),
      tickStep: positiveNumber(channel.axis?.tickStep),
    };
  });
}

function buildExcelAreaGeometry(
  config: ChartConfig,
  data: ChartData,
  series: ExcelCartesianSeriesGeometry[],
): Pick<ExcelCartesianGeometryPlan, 'area'> {
  const areaSeries = series.filter((item) => MARK_TYPE_MAP[item.type as ChartType] === 'area');
  if (areaSeries.length === 0) return {};

  const resolvedStackMode = resolveStackMode(config);
  const stackMode = resolvedStackMode === false ? undefined : resolvedStackMode;
  const groupsByKey = new Map<
    string,
    {
      axisGroup: 'primary' | 'secondary';
      xRole: 'category' | 'quantitative';
      seriesIndices: number[];
    }
  >();
  for (const item of areaSeries) {
    const key = item.stackGroup ?? `area:${item.axisGroup}:${item.xRole}:${item.seriesIndex}`;
    const group = groupsByKey.get(key) ?? {
      axisGroup: item.axisGroup,
      xRole: item.xRole,
      seriesIndices: [],
    };
    group.seriesIndices.push(item.seriesIndex);
    groupsByKey.set(key, group);
  }

  const memberIndices = areaSeries.map((item) => item.seriesIndex);
  return {
    area: {
      stackMode: stackMode ?? 'none',
      baseline: 0,
      ...(stackMode === 'normalize'
        ? { percentDomain: percentStackedGeometryDomain(data, memberIndices) }
        : {}),
      groups: Array.from(groupsByKey.values()),
    },
  };
}

function buildExcelBubbleGeometry(
  config: ChartConfig,
  data: ChartData,
  series: ExcelCartesianSeriesGeometry[],
): Pick<ExcelCartesianGeometryPlan, 'bubble'> {
  if (!series.some((item) => item.type === 'bubble')) return {};

  const sourceScale = typeof config.bubbleScale === 'number' ? config.bubbleScale : 100;
  const bubbleScale = Math.max(0, Math.min(300, sourceScale));
  return {
    bubble: {
      sizeRepresents: config.sizeRepresents === 'w' ? 'w' : 'area',
      bubbleScale,
      showNegBubbles: config.showNegBubbles === true,
      maxRenderableMagnitude: maxRenderableBubbleMagnitude(data, config),
      maxRenderedArea: 6400 * (bubbleScale / 100),
      normalizedSizeField: BUBBLE_SIZE_FIELD,
      rawSizeField: RAW_BUBBLE_SIZE_FIELD,
    },
  };
}

function resolveGeometrySeriesType(
  config: ChartConfig,
  series: ChartData['series'][number],
  seriesConfig: SeriesConfig | undefined,
  index: number,
): ChartType | undefined {
  const resolved = resolveComboSeriesType(config, series, seriesConfig, index);
  return isSupportedChartType(resolved) ? resolved : undefined;
}

function isQuantitativeGeometryXSeries(
  config: ChartConfig,
  seriesType: ChartType,
  seriesConfig: SeriesConfig | undefined,
): boolean {
  if (seriesConfig?.xRole === 'quantitative') return true;
  if (seriesConfig?.xRole === 'category') return false;
  return (
    config.type === 'scatter' ||
    config.type === 'bubble' ||
    seriesType === 'scatter' ||
    seriesType === 'bubble'
  );
}

function geometryAxisValues(
  config: ChartConfig,
  data: ChartData,
  memberIndices: readonly number[],
): number[] {
  const stackMode = resolveStackMode(config);
  if (stackMode === 'normalize') return percentStackedGeometryDomain(data, memberIndices);
  if (stackMode === 'zero') {
    return [
      ...chartValueValues(data, memberIndices),
      ...stackedGeometryValues(data, memberIndices),
    ];
  }
  return chartValueValues(data, memberIndices);
}

function percentStackedGeometryDomain(
  data: ChartData,
  memberIndices: readonly number[],
): [number, number] {
  const memberSet = new Set(memberIndices);
  const pointCount = Math.max(
    data.categories.length,
    ...data.series.map((series) => series.data.length),
  );
  let hasPositive = false;
  let hasNegative = false;
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    for (const seriesIndex of memberSet) {
      const value = data.series[seriesIndex]?.data[pointIndex]?.y;
      if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) continue;
      if (value > 0) hasPositive = true;
      else hasNegative = true;
    }
  }

  const min = hasNegative ? -100 : 0;
  const max = hasPositive ? 100 : 0;
  return min === max ? [min, min + 100] : [min, max];
}

function stackedGeometryValues(data: ChartData, memberIndices: readonly number[]): number[] {
  const memberSet = new Set(memberIndices);
  const pointCount = Math.max(
    data.categories.length,
    ...data.series.map((series) => series.data.length),
  );
  const values: number[] = [];
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    let positive = 0;
    let negative = 0;
    for (const seriesIndex of memberSet) {
      const value = data.series[seriesIndex]?.data[pointIndex]?.y;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (value >= 0) positive += value;
      else negative += value;
    }
    values.push(positive, negative);
  }
  return values;
}

function uniqueModes(modes: ExcelCartesianXGeometryMode[]): ExcelCartesianXGeometryMode[] {
  return Array.from(new Set(modes));
}

function scaleDomain(domain: unknown): [number, number] | undefined {
  if (!Array.isArray(domain) || domain.length < 2) return undefined;
  const min = finiteNumber(domain[0]);
  const max = finiteNumber(domain[1]);
  return min !== undefined && max !== undefined ? [min, max] : undefined;
}

function quantitativeXGeometryDomain(
  config: ChartConfig,
  data: ChartData,
  memberIndices: readonly number[],
): [number, number] | undefined {
  const memberSet = new Set(memberIndices);
  const memberData: ChartData = {
    ...data,
    series: data.series.filter((_series, index) => memberSet.has(index)),
  };
  return scaleDomain(excelQuantitativeXEncoding({ config, data: memberData }).scale?.domain);
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
    normalizeCrossing(categoryAxis) ??
    normalizeCrossing(valueAxis) ??
    defaultCategoryCrossing(config);

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
  const axisSpec = axisConfig
    ? mapAxisConfigToAxisSpec(axisConfig, config, 'secondaryValueAxis')
    : {};
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
  if (isBarLikeChartType(type)) return true;
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

function isPointPathExcelCartesianSeriesType(type: ChartType): boolean {
  const markType = MARK_TYPE_MAP[type];
  return markType === 'line' || markType === 'area' || markType === 'point';
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
