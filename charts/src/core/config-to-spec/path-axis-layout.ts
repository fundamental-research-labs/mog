import type { AxisSpec, ChannelSpec, EncodingSpec, StackMode } from '../../grammar/spec';
import type {
  ChartConfig,
  ChartData,
  ChartType,
  SeriesConfig,
  SingleAxisConfig,
} from '../../types';
import { resolvePathChartAxisLayout, type PathChartAxisLayout } from '../chart-ir/path-axis-layout';
import { seriesConfigForDataSeries } from '../series-identity';
import { resolveAxisConfigForChannel } from './axis';
import { chartImportSourceDialect } from './bar-geometry';
import { categoryDisplayLabel, shouldUseDateSerialCategoryAxis } from './category-axis';
import { DEFAULT_CHART_HEIGHT, DEFAULT_CHART_WIDTH, MARK_TYPE_MAP } from './constants';
import {
  isQuantitativeXSeries,
  isSupportedChartType,
  resolveComboSeriesType,
} from './layers/combo-series-options';
import { resolveStackMode } from './subtypes';
import { pointsToCanvasPx } from './units';

export function applyPathChartAxisLayout(
  config: ChartConfig,
  data: ChartData,
  encoding: EncodingSpec,
): void {
  if (chartImportSourceDialect(config) === undefined) return;

  const memberIndices = pathCategorySeriesIndices(config, data);
  if (memberIndices.length === 0) return;

  const useDateSerialCategoryAxis = shouldUseDateSerialCategoryAxis(config, data, false);
  const layout = resolvePathAxisLayoutForMembers({
    config,
    data,
    memberIndices,
    useDateSerialCategoryAxis,
  });

  applyPathCategoryAxisLayout(encoding.x, layout);

  if (config.type === 'combo') return;
  applyPathValueAxisLayout(encoding.y, layout);
}

export function resolvePathAxisLayoutForMembers(input: {
  config: ChartConfig;
  data: ChartData;
  memberIndices: readonly number[];
  axisIndex?: 0 | 1;
  categoryAxis?: SingleAxisConfig;
  valueAxis?: SingleAxisConfig;
  useDateSerialCategoryAxis?: boolean;
  stackMode?: StackMode;
  includeZero?: boolean;
}): PathChartAxisLayout {
  const axisIndex = input.axisIndex ?? 0;
  const useDateSerialCategoryAxis =
    input.useDateSerialCategoryAxis ??
    shouldUseDateSerialCategoryAxis(input.config, input.data, false);
  const stackMode =
    input.stackMode ?? pathStackModeForMemberIndices(input.config, input.data, input.memberIndices);
  const widthFromPoints = pointsToCanvasPx(input.config.width);
  const heightFromPoints = pointsToCanvasPx(input.config.height);

  return resolvePathChartAxisLayout({
    sourceDialect: chartImportSourceDialect(input.config),
    stackMode,
    data: input.data,
    seriesIndices: input.memberIndices,
    categoryAxis: input.categoryAxis ?? categoryAxisConfig(input.config),
    valueAxis: input.valueAxis ?? valueAxisConfig(input.config, axisIndex),
    chartWidth: widthFromPoints ?? chartWidthPx(input.config),
    chartHeight: heightFromPoints ?? chartHeightPx(input.config),
    categoryLabels: input.data.categories.map(categoryDisplayLabel),
    useDateSerialCategoryAxis,
    includeZero:
      input.includeZero ??
      pathValueAxisIncludesZero(input.config, input.data, input.memberIndices, stackMode),
    unitPercentValueAxis: unitPercentValueAxisPolicy({
      config: input.config,
      data: input.data,
      memberIndices: input.memberIndices,
      axisIndex,
      valueAxis: input.valueAxis ?? valueAxisConfig(input.config, axisIndex),
      stackMode,
    }),
  });
}

export function applyPathCategoryAxisLayout(
  channel: ChannelSpec | undefined,
  layout: PathChartAxisLayout,
): void {
  if (!channel || channel.axis === null) return;
  if (
    layout.categoryTickLabelSkip === undefined &&
    layout.categoryTickMarkSkip === undefined &&
    layout.categoryTickSkipSource === undefined &&
    layout.categoryAxisLayoutStatus === undefined &&
    layout.axisLayoutStatus === undefined
  ) {
    return;
  }

  channel.axis = withPathCategoryAxisLayout(channel.axis, layout);
  if (channel.secondaryAxis !== null && channel.secondaryAxis !== undefined) {
    channel.secondaryAxis = withPathCategoryAxisLayout(channel.secondaryAxis, layout);
  }
}

export function applyPathValueAxisLayout(
  channel: ChannelSpec | undefined,
  layout: PathChartAxisLayout,
): void {
  if (!channel || channel.type !== 'quantitative') return;
  if (layout.valueAxisDomain) {
    channel.scale = {
      ...(channel.scale ?? {}),
      domain: layout.valueAxisDomain,
      nice: false,
      zero: layout.valueAxisDomain[0] <= 0 && layout.valueAxisDomain[1] >= 0,
    };
  }

  const hasValueAxisLayout =
    layout.valueAxisTickStep !== undefined ||
    layout.valueAxisTickCount !== undefined ||
    layout.percentAxisLabelPolicy !== undefined ||
    layout.valueAxisLayoutStatus !== undefined;
  if (channel.axis === null || !hasValueAxisLayout) return;

  channel.axis = {
    ...(channel.axis ?? {}),
    ...(layout.valueAxisTickStep !== undefined
      ? { tickStep: channel.axis?.tickStep ?? layout.valueAxisTickStep }
      : {}),
    ...(layout.valueAxisTickCount !== undefined
      ? { tickCount: channel.axis?.tickCount ?? layout.valueAxisTickCount }
      : {}),
    ...(layout.percentAxisLabelPolicy
      ? { percentAxisLabelPolicy: layout.percentAxisLabelPolicy }
      : {}),
    ...(layout.valueAxisLayoutStatus ? { axisLayoutStatus: layout.valueAxisLayoutStatus } : {}),
    ...(layout.valueAxisLayoutStatusReason
      ? { axisLayoutStatusReason: layout.valueAxisLayoutStatusReason }
      : {}),
    ...(layout.valueAxisLayoutStatus
      ? { pathValueAxisLayoutStatus: layout.valueAxisLayoutStatus }
      : {}),
    ...(layout.valueAxisLayoutStatusReason
      ? { pathValueAxisLayoutStatusReason: layout.valueAxisLayoutStatusReason }
      : {}),
  };
}

export function pathStackModeForMemberIndices(
  config: ChartConfig,
  data: ChartData,
  memberIndices: readonly number[],
): StackMode | undefined {
  const stackMode = resolveStackMode(config);
  if (!stackMode) return undefined;
  if (config.type !== 'combo') return stackMode;
  return memberIndices.some((index) => {
    const series = data.series[index];
    if (!series) return false;
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const seriesType = supportedSeriesType(config, series, seriesConfig, index);
    return seriesType !== undefined && MARK_TYPE_MAP[seriesType] === 'area';
  })
    ? stackMode
    : undefined;
}

export function pathValueAxisIncludesZero(
  config: ChartConfig,
  data: ChartData,
  memberIndices: readonly number[],
  stackMode = pathStackModeForMemberIndices(config, data, memberIndices),
): boolean {
  if (stackMode) return true;
  return memberIndices.some((index) => {
    const series = data.series[index];
    if (!series) return false;
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const seriesType = supportedSeriesType(config, series, seriesConfig, index);
    return seriesType !== undefined && MARK_TYPE_MAP[seriesType] === 'area';
  });
}

export function isPathLikeChartType(type: ChartType | string | undefined): type is ChartType {
  if (!isSupportedChartType(type)) return false;
  const markType = MARK_TYPE_MAP[type];
  return markType === 'line' || markType === 'area';
}

function withPathCategoryAxisLayout(
  axis: AxisSpec | undefined,
  layout: PathChartAxisLayout,
): AxisSpec {
  return {
    ...(axis ?? {}),
    ...(layout.categoryTickLabelSkip !== undefined
      ? { tickLabelSkip: layout.categoryTickLabelSkip }
      : {}),
    ...(layout.categoryTickMarkSkip !== undefined
      ? { tickMarkSkip: layout.categoryTickMarkSkip }
      : {}),
    ...(layout.categoryTickSkipSource && layout.categoryTickLabelSkip !== undefined
      ? { tickLabelSkipSource: layout.categoryTickSkipSource }
      : {}),
    ...(layout.categoryTickSkipSource && layout.categoryTickMarkSkip !== undefined
      ? { tickMarkSkipSource: layout.categoryTickSkipSource }
      : {}),
    ...(layout.categoryAxisLayoutStatus
      ? { axisLayoutStatus: layout.categoryAxisLayoutStatus }
      : layout.axisLayoutStatus
        ? { axisLayoutStatus: layout.axisLayoutStatus }
        : {}),
    ...(layout.categoryAxisLayoutStatusReason
      ? { axisLayoutStatusReason: layout.categoryAxisLayoutStatusReason }
      : layout.axisLayoutStatusReason
        ? { axisLayoutStatusReason: layout.axisLayoutStatusReason }
        : {}),
    ...(layout.categoryAxisLayoutStatus
      ? { pathCategoryAxisLayoutStatus: layout.categoryAxisLayoutStatus }
      : {}),
    ...(layout.categoryAxisLayoutStatusReason
      ? { pathCategoryAxisLayoutStatusReason: layout.categoryAxisLayoutStatusReason }
      : {}),
    ...(layout.axisLength !== undefined ? { pathAxisLength: layout.axisLength } : {}),
    ...(layout.categoryPitch !== undefined ? { pathCategoryPitch: layout.categoryPitch } : {}),
    ...(layout.labelBudget !== undefined ? { pathLabelBudget: layout.labelBudget } : {}),
    ...(layout.projectedLabelWidth !== undefined
      ? { pathProjectedLabelWidth: layout.projectedLabelWidth }
      : {}),
    ...(layout.visibleLabelCount !== undefined
      ? { pathVisibleLabelCount: layout.visibleLabelCount }
      : {}),
    ...(layout.reservationStatus ? { pathAxisReservationStatus: layout.reservationStatus } : {}),
    ...(layout.reservationStatusReason
      ? { pathAxisReservationStatusReason: layout.reservationStatusReason }
      : {}),
  };
}

function pathCategorySeriesIndices(config: ChartConfig, data: ChartData): number[] {
  if (config.type !== 'combo') {
    return isPathLikeChartType(config.type) ? data.series.map((_series, index) => index) : [];
  }

  return data.series.flatMap((series, index) => {
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const seriesType = supportedSeriesType(config, series, seriesConfig, index);
    if (!seriesType || !isPathLikeChartType(seriesType)) return [];
    if (isQuantitativeXSeries(seriesConfig, seriesType, config)) return [];
    return [index];
  });
}

function supportedSeriesType(
  config: ChartConfig,
  series: ChartData['series'][number] | undefined,
  seriesConfig: SeriesConfig | undefined,
  index: number,
): ChartType | undefined {
  if (!series) return undefined;
  const seriesType = resolveComboSeriesType(config, series, seriesConfig, index);
  return isSupportedChartType(seriesType) ? seriesType : undefined;
}

function chartWidthPx(config: ChartConfig): number {
  return pointsToCanvasPx(config.width) ?? DEFAULT_CHART_WIDTH;
}

function chartHeightPx(config: ChartConfig): number {
  return pointsToCanvasPx(config.height) ?? DEFAULT_CHART_HEIGHT;
}

function categoryAxisConfig(config: ChartConfig): SingleAxisConfig | undefined {
  return resolveAxisConfigForChannel(config.axis, 'x', false);
}

function valueAxisConfig(config: ChartConfig, axisIndex: 0 | 1): SingleAxisConfig | undefined {
  if (axisIndex === 1) {
    return config.axis?.secondaryValueAxis ?? config.axis?.secondaryYAxis;
  }
  return resolveAxisConfigForChannel(config.axis, 'y', false);
}

function unitPercentValueAxisPolicy(input: {
  config: ChartConfig;
  data: ChartData;
  memberIndices: readonly number[];
  axisIndex: 0 | 1;
  valueAxis: SingleAxisConfig | undefined;
  stackMode: StackMode | undefined;
}): boolean {
  if (chartImportSourceDialect(input.config) !== 'ooxml') return false;
  if (input.axisIndex !== 1) return false;
  if (input.stackMode === 'normalize') return false;
  if (
    finiteNumber(input.valueAxis?.min) !== undefined ||
    finiteNumber(input.valueAxis?.max) !== undefined
  ) {
    return false;
  }
  if (!hasPercentFormat(input)) return false;
  const values = memberFiniteValues(input.data, input.memberIndices);
  return values.length > 0 && values.every((value) => value >= 0 && value <= 1);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function hasPercentFormat(input: {
  config: ChartConfig;
  data: ChartData;
  memberIndices: readonly number[];
  valueAxis: SingleAxisConfig | undefined;
}): boolean {
  if (formatContainsPercent(input.valueAxis?.numberFormat)) return true;
  return input.memberIndices.some((seriesIndex) => {
    const series = input.data.series[seriesIndex];
    const seriesConfig = seriesConfigForDataSeries(series, input.config.series ?? [], seriesIndex);
    const cache = seriesConfig?.valueCache;
    if (formatContainsPercent(cache?.formatCode)) return true;
    return cache?.points?.some((point) => formatContainsPercent(point.formatCode)) === true;
  });
}

function memberFiniteValues(data: ChartData, memberIndices: readonly number[]): number[] {
  const memberSet = new Set(memberIndices);
  const values: number[] = [];
  data.series.forEach((series, seriesIndex) => {
    if (!memberSet.has(seriesIndex)) return;
    for (const point of series.data) {
      if (typeof point?.y === 'number' && Number.isFinite(point.y)) values.push(point.y);
    }
  });
  return values;
}

function formatContainsPercent(format: string | undefined): boolean {
  return typeof format === 'string' && format.includes('%');
}
