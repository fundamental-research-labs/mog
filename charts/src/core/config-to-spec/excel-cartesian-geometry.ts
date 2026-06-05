import type {
  AxisLayoutStatus,
  AxisPercentLabelPolicy,
  AxisTickSkipSource,
  ChannelSpec,
  EncodingSpec,
  MarkSpec,
  MarkType,
  ScaleSpec,
} from '../../grammar/spec';
import type {
  ChartConfig,
  ChartData,
  ChartType,
  SeriesConfig,
  SingleAxisConfig,
} from '../../types';
import { resolveExcelAutoValueAxisScale } from '../chart-ir/excel-value-axis-scale';
import { seriesConfigForDataSeries, seriesSourceIndex } from '../series-identity';
import {
  applyAutoValueAxisTicks,
  buildAxisScaleSpec,
  explicitDomainBound,
  mapAxisConfigToAxisSpec,
  resolveAxisConfigForChannel,
} from './axis';
import {
  normalizeCategoryCrossing,
  normalizeValueAxisCrossingPlan,
  type NormalizedAxisPeerKind,
  type NormalizedValueAxisCrossingPlan,
} from './axis-format-normalization';
import { chartImportSourceDialect, isBarLikeChartType } from './bar-geometry';
import {
  categoryKeyForIndex,
  shouldUseDateSerialCategoryAxis,
  shouldUseStableCategoryKeys,
  toFiniteNumber,
} from './category-axis';
import { MARK_TYPE_MAP } from './constants';
import { BUBBLE_SIZE_FIELD, RAW_BUBBLE_SIZE_FIELD, SCATTER_X_FIELD, VALUE_FIELD } from './fields';
import { maxRenderableBubbleMagnitude } from './data-point-values';
import {
  pathStackModeForMemberIndices,
  pathValueAxisIncludesZero,
  resolvePathAxisLayoutForMembers,
} from './path-axis-layout';
import type { PathChartAxisLayout } from '../chart-ir/path-axis-layout';
import { isNoFillNoLineSeries } from './style';
import {
  effectiveShowLines,
  effectiveShowMarkers,
  isSupportedChartType,
  normalizeYAxisIndex,
  resolveComboSeriesType,
} from './layers/combo-series-options';
import {
  isCartesianVisualSeriesType,
  isPathVisualSeriesType,
  resolveCartesianSeriesVisualContract,
  type XYLineInterpolation,
  type XYSeriesVisualContract,
  type XYVisualContractStatus,
} from './xy-visual-contract';
import { resolveStackMode } from './subtypes';

const EXCEL_VALUE_AXIS_TICK_COUNT = 5;

export type ExcelCategoryPositionPolicy = 'between' | 'onCategory' | 'centeredSingleton';

export type ExcelCartesianXGeometryMode = 'categoryPoint' | 'dateSerial' | 'quantitative';

export type ExcelCartesianAxisRole =
  | 'categoryX'
  | 'dateCategoryX'
  | 'xValue'
  | 'primaryYValue'
  | 'secondaryYValue';

export type ExcelCartesianScaleAuthority = 'explicitDomain' | 'excelAutoDomain';
export type ExcelCartesianRenderedAxisOrient = 'top' | 'bottom' | 'left' | 'right';

export type ExcelCartesianAxisSourceGeometry = {
  axisPosition?: string;
  crossing?: 'automatic' | 'max' | 'min' | 'custom';
  crossingValue?: number;
  crossBetween?: string;
  isBetweenCategories?: boolean;
  reverse?: boolean;
  scaleType?: string;
  logBase?: number;
  explicitMin?: number;
  explicitMax?: number;
  majorUnit?: number;
  minorUnit?: number;
  tickLabelPosition?: string;
};

export type ExcelCartesianAxisCrossingGeometry = Omit<
  NormalizedValueAxisCrossingPlan,
  'unsupportedReason'
>;

export type ExcelCartesianValueAxisGeometry = {
  axisGroup: 'primary' | 'secondary';
  axisRole: 'primaryYValue' | 'secondaryYValue';
  domain?: [number, number];
  includeZero: boolean;
  explicitDomain: boolean;
  scaleAuthority: ExcelCartesianScaleAuthority;
  tickStep?: number;
  percentAxisLabelPolicy?: AxisPercentLabelPolicy;
  axisLayoutStatus?: AxisLayoutStatus;
  axisLayoutStatusReason?: string;
  valueAxisLayoutStatus?: AxisLayoutStatus;
  valueAxisLayoutStatusReason?: string;
  renderedAxisOrient?: ExcelCartesianRenderedAxisOrient;
  axisVisualStatus?: XYVisualContractStatus;
  axisVisualStatusReason?: string;
  crossingStatus?: XYVisualContractStatus;
  crossingStatusReason?: string;
  crossing?: ExcelCartesianAxisCrossingGeometry;
  reservationStatus?: XYVisualContractStatus;
  reservationStatusReason?: string;
  source?: ExcelCartesianAxisSourceGeometry;
};

export type ExcelCartesianPathAxisLayoutGeometry = {
  categoryTickLabelSkip?: number;
  categoryTickMarkSkip?: number;
  categoryTickSkipSource?: AxisTickSkipSource;
  axisLength?: number;
  categoryPitch?: number;
  labelBudget?: number;
  projectedLabelWidth?: number;
  visibleLabelCount?: number;
  axisLayoutStatus?: AxisLayoutStatus;
  axisLayoutStatusReason?: string;
  categoryAxisLayoutStatus?: AxisLayoutStatus;
  categoryAxisLayoutStatusReason?: string;
  valueAxisLayoutStatus?: AxisLayoutStatus;
  valueAxisLayoutStatusReason?: string;
  reservationStatus?: AxisLayoutStatus;
  reservationStatusReason?: string;
};

export type ExcelCartesianSeriesGeometry = {
  seriesIndex: number;
  type: string;
  xRole: 'category' | 'quantitative';
  xMode: ExcelCartesianXGeometryMode;
  axisGroup: 'primary' | 'secondary';
  showLines?: boolean;
  showMarkers?: boolean;
  sourceShowLines?: boolean;
  lineVisibleInk?: boolean;
  lineNoFill?: boolean;
  lineZeroWidth?: boolean;
  lineStroke?: string;
  lineStrokeWidth?: number;
  lineDash?: number[];
  lineOpacity?: number;
  lineInterpolation?: XYLineInterpolation;
  lineVisualStatus?: XYVisualContractStatus;
  lineVisualStatusReason?: string;
  sourceShowMarkers?: boolean;
  markerVisibleInk?: boolean;
  markerShape?: string;
  markerSize?: number;
  markerFill?: string;
  markerStroke?: string;
  markerStrokeWidth?: number;
  markerOpacity?: number;
  markerVisualStatus?: XYVisualContractStatus;
  markerVisualStatusReason?: string;
  blankMarkerPolicy?: 'notApplicable' | 'suppressSourceBlankMarkers';
  blankMarkerPolicyStatus?: XYVisualContractStatus;
  blankMarkerPolicyStatusReason?: string;
  sourceBlankPointCount?: number;
  zeroProjectedSourceBlankPointCount?: number;
  sourceBlankMarkerGeometryCount?: number;
  suppressedSourceBlankMarkerCount?: number;
  markerEligiblePointCount?: number;
  bubbleVisibleInk?: boolean;
  bubbleVisualStatus?: XYVisualContractStatus;
  bubbleVisualStatusReason?: string;
  colorAuthorityStatus?: XYVisualContractStatus;
  colorAuthoritySource?: string;
  colorAuthorityReason?: string;
  stackGroup?: string;
  markerLayer?: boolean;
  bubbleSizeAuthority?: 'series';
};

export type ExcelCartesianGeometryPlan = {
  x: {
    modes: ExcelCartesianXGeometryMode[];
    category?: {
      mode: 'categoryPoint' | 'dateSerial';
      axisRole: 'categoryX' | 'dateCategoryX';
      domain: Array<string | number>;
      pointCount: number;
      scaleAuthority: ExcelCartesianScaleAuthority;
      source?: ExcelCartesianAxisSourceGeometry;
      positionPolicy?: ExcelCategoryPositionPolicy;
      pathAxisLayout?: ExcelCartesianPathAxisLayoutGeometry;
      stableKeys: boolean;
    };
    quantitative?: {
      mode: 'quantitative';
      axisRole: 'xValue';
      domain?: [number, number];
      field: typeof SCATTER_X_FIELD;
      includeZero: boolean;
      explicitDomain: boolean;
      scaleAuthority: ExcelCartesianScaleAuthority;
      tickStep?: number;
      source?: ExcelCartesianAxisSourceGeometry;
      renderedAxisOrient?: ExcelCartesianRenderedAxisOrient;
      axisVisualStatus?: XYVisualContractStatus;
      axisVisualStatusReason?: string;
      crossingStatus?: XYVisualContractStatus;
      crossingStatusReason?: string;
      crossing?: ExcelCartesianAxisCrossingGeometry;
      reservationStatus?: XYVisualContractStatus;
      reservationStatusReason?: string;
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
      groupKey?: string;
      memberCount?: number;
      seriesIndices: number[];
      hiddenGeometrySeriesIndices?: number[];
    }>;
  };
  bubble?: {
    sizeRepresents: 'area' | 'w';
    bubbleScale: number;
    showNegBubbles: boolean;
    maxRenderableMagnitude: number;
    sizeDomain: [number, number];
    sizeRange: [number, number];
    maxRenderedArea: number;
    maxRenderedRadius: number;
    normalizedSizeField: typeof BUBBLE_SIZE_FIELD;
    rawSizeField: typeof RAW_BUBBLE_SIZE_FIELD;
    clippingPolicy: 'clipToPlotArea' | 'overflowPlotArea';
    sizeScaleAuthority: 'excelBubbleScale';
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
  const useStableCategoryKeys = shouldUseStableCategoryKeys(
    config,
    data,
    useDateSerialCategoryAxis,
  );
  const hasCategoryX = series.some((item) => item.xRole === 'category');
  const hasQuantitativeX = series.some((item) => item.xRole === 'quantitative');
  const quantitativeSeriesIndices = series
    .filter((item) => item.xRole === 'quantitative')
    .map((item) => item.seriesIndex);
  const xModes = uniqueModes(series.map((item) => item.xMode));
  const quantitativeX = hasQuantitativeX
    ? quantitativeXGeometry(config, data, quantitativeSeriesIndices)
    : undefined;
  const categoryAxisConfig = categoryAxisConfigForGeometry(config);
  const categoryAxisExplicitDomain = hasExplicitAxisDomain(categoryAxisConfig);
  const categoryPathSeriesIndices = series
    .filter((item) => item.xRole === 'category' && isPathGeometrySeriesType(item.type))
    .map((item) => item.seriesIndex);
  const categoryPathAxisLayout =
    hasCategoryX && categoryPathSeriesIndices.length > 0
      ? resolvePathAxisLayoutForMembers({
          config,
          data,
          memberIndices: categoryPathSeriesIndices,
          categoryAxis: categoryAxisConfig,
          useDateSerialCategoryAxis: useDateSerialCategoryAxis,
        })
      : undefined;
  const categoryX = hasCategoryX
    ? {
        mode: useDateSerialCategoryAxis ? ('dateSerial' as const) : ('categoryPoint' as const),
        axisRole: useDateSerialCategoryAxis ? ('dateCategoryX' as const) : ('categoryX' as const),
        domain: useStableCategoryKeys
          ? data.categories.map((_category, index) => categoryKeyForIndex(index))
          : data.categories.map((category) =>
              useDateSerialCategoryAxis
                ? (toFiniteNumber(category) ?? String(category))
                : String(category),
            ),
        pointCount: data.categories.length,
        scaleAuthority: scaleAuthority(categoryAxisExplicitDomain),
        ...optionalAxisSource(categoryAxisConfig),
        positionPolicy: useDateSerialCategoryAxis
          ? undefined
          : resolveExcelCategoryPositionPolicy(config, data, false),
        ...optionalPathAxisLayout(categoryPathAxisLayout),
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
        : {
            ...axisSpec,
            orient: xyValueAxisOrient(axisConfig, 'primaryYValue'),
          };

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
  const axisSpec = axisConfig
    ? mapAxisConfigToAxisSpec(axisConfig, input.config, 'valueAxis')
    : undefined;
  const channel: ChannelSpec = {
    field: SCATTER_X_FIELD,
    type: 'quantitative',
    axis: axisSpec
      ? {
          ...axisSpec,
          orient: xyValueAxisOrient(axisConfig, 'xValue'),
        }
      : undefined,
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

  const explicitTickStep = positiveNumber(channel.axis?.tickStep);
  const resolved = resolveExcelAutoValueAxisScale({
    values,
    includeZero: options.includeZero,
    tickCount: options.tickCount ?? EXCEL_VALUE_AXIS_TICK_COUNT,
    explicitTickStep,
  });
  if (!resolved) return;

  channel.scale = {
    ...scaleSpec,
    domain: resolved.domain,
    nice: false,
    ...(options.includeZero ? { zero: true } : { zero: false }),
  };
  if (channel.axis !== null && channel.axis !== undefined) {
    channel.axis = {
      ...channel.axis,
      tickStep: explicitTickStep ?? resolved.tickStep,
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

export function withExcelCartesianPathOrder<T extends MarkType | MarkSpec>(
  mark: T,
  config: ChartConfig,
): T | MarkSpec {
  if (!usesExcelCartesianGeometry(config)) return mark;
  const markType = typeof mark === 'string' ? mark : mark.type;
  if (markType !== 'line' && markType !== 'area') return mark;
  if (typeof mark === 'string') return { type: mark, pathOrder: 'source' };
  const markSpec = mark as MarkSpec;
  return { ...markSpec, pathOrder: 'source' };
}

export function withExcelAreaSurfaceExtentPolicy<T extends MarkType | MarkSpec>(
  mark: T,
  config: ChartConfig,
  data: ChartData | undefined,
): T | MarkSpec {
  if (!usesExcelCartesianGeometry(config) || !data) return mark;
  const markType = typeof mark === 'string' ? mark : mark.type;
  if (markType !== 'area') return mark;

  const positionPolicy = resolveExcelCategoryPositionPolicy(config, data, false);
  const areaSurfaceExtentPolicy =
    positionPolicy === 'between'
      ? 'plotEdgeCaps'
      : positionPolicy === 'centeredSingleton'
        ? 'centeredSingleton'
        : 'pointCaps';
  if (typeof mark === 'string') return { type: mark, areaSurfaceExtentPolicy };
  return { ...(mark as MarkSpec), areaSurfaceExtentPolicy };
}

export function withExcelCartesianGeometryMark<T extends MarkType | MarkSpec>(
  mark: T,
  config: ChartConfig,
  options: { yChannel?: ChannelSpec | undefined; data?: ChartData | undefined } = {},
): T | MarkSpec {
  return withExcelAreaSurfaceExtentPolicy(
    withExcelCartesianPathOrder(withExcelAreaBaseline(mark, config, options.yChannel), config),
    config,
    options.data,
  );
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
    const sourceSeriesIndex = seriesSourceIndex(series, index);
    const seriesType = resolveGeometrySeriesType(config, series, seriesConfig, index);
    if (!seriesType || !isPointPathExcelCartesianSeriesType(seriesType)) return [];

    const xRole = isQuantitativeGeometryXSeries(config, seriesType, seriesConfig)
      ? 'quantitative'
      : 'category';
    const axisIndex = normalizeYAxisIndex(seriesConfig?.yAxisIndex ?? series.yAxisIndex) ?? 0;
    const markType = MARK_TYPE_MAP[seriesType];
    const visual = isCartesianVisualSeriesType(seriesType)
      ? resolveCartesianSeriesVisualContract({
          config,
          seriesType,
          seriesConfig,
          sourceSeriesIndex,
        })
      : undefined;
    const showLines =
      visual?.sourceShowLines ?? effectiveShowLines(seriesConfig, seriesType, config);
    const showMarkers =
      visual?.sourceShowMarkers ??
      effectiveShowMarkers(seriesConfig, seriesType, config, !showLines);
    const blankMarkerPolicy = pathBlankMarkerPolicyGeometry({
      config,
      series,
      seriesType,
      markerVisibleInk: visual?.markerVisibleInk ?? showMarkers,
    });
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
        ...(visual ? xySeriesVisualGeometry(visual) : {}),
        ...blankMarkerPolicy,
        ...(stackGroup ? { stackGroup } : {}),
        ...((visual?.markerVisibleInk ?? showMarkers) ? { markerLayer: true } : {}),
        ...(seriesType === 'bubble' || seriesType === 'bubble3DEffect'
          ? { bubbleSizeAuthority: 'series' as const }
          : {}),
      },
    ];
  });
}

function xySeriesVisualGeometry(
  visual: XYSeriesVisualContract,
): Pick<
  ExcelCartesianSeriesGeometry,
  | 'sourceShowLines'
  | 'lineVisibleInk'
  | 'lineNoFill'
  | 'lineZeroWidth'
  | 'lineStroke'
  | 'lineStrokeWidth'
  | 'lineDash'
  | 'lineOpacity'
  | 'lineInterpolation'
  | 'lineVisualStatus'
  | 'lineVisualStatusReason'
  | 'sourceShowMarkers'
  | 'markerVisibleInk'
  | 'markerShape'
  | 'markerSize'
  | 'markerFill'
  | 'markerStroke'
  | 'markerStrokeWidth'
  | 'markerOpacity'
  | 'markerVisualStatus'
  | 'markerVisualStatusReason'
  | 'bubbleVisibleInk'
  | 'bubbleVisualStatus'
  | 'bubbleVisualStatusReason'
  | 'colorAuthorityStatus'
  | 'colorAuthoritySource'
  | 'colorAuthorityReason'
> {
  return {
    sourceShowLines: visual.sourceShowLines,
    lineVisibleInk: visual.lineVisibleInk,
    lineNoFill: visual.lineNoFill,
    lineZeroWidth: visual.lineZeroWidth,
    ...(visual.lineStroke ? { lineStroke: visual.lineStroke } : {}),
    ...(visual.lineStrokeWidth !== undefined ? { lineStrokeWidth: visual.lineStrokeWidth } : {}),
    ...(visual.lineDash ? { lineDash: visual.lineDash } : {}),
    ...(visual.lineOpacity !== undefined ? { lineOpacity: visual.lineOpacity } : {}),
    lineInterpolation: visual.lineInterpolation,
    lineVisualStatus: visual.lineVisualStatus,
    ...(visual.lineVisualStatusReason
      ? { lineVisualStatusReason: visual.lineVisualStatusReason }
      : {}),
    sourceShowMarkers: visual.sourceShowMarkers,
    markerVisibleInk: visual.markerVisibleInk,
    markerShape: visual.markerShape,
    markerSize: visual.markerSize,
    ...(visual.markerFill ? { markerFill: visual.markerFill } : {}),
    ...(visual.markerStroke ? { markerStroke: visual.markerStroke } : {}),
    ...(visual.markerStrokeWidth !== undefined
      ? { markerStrokeWidth: visual.markerStrokeWidth }
      : {}),
    ...(visual.markerOpacity !== undefined ? { markerOpacity: visual.markerOpacity } : {}),
    markerVisualStatus: visual.markerVisualStatus,
    ...(visual.markerVisualStatusReason
      ? { markerVisualStatusReason: visual.markerVisualStatusReason }
      : {}),
    bubbleVisibleInk: visual.bubbleVisibleInk,
    ...(visual.bubbleVisualStatus ? { bubbleVisualStatus: visual.bubbleVisualStatus } : {}),
    ...(visual.bubbleVisualStatusReason
      ? { bubbleVisualStatusReason: visual.bubbleVisualStatusReason }
      : {}),
    colorAuthorityStatus: visual.colorAuthorityStatus,
    ...(visual.colorAuthoritySource ? { colorAuthoritySource: visual.colorAuthoritySource } : {}),
    ...(visual.colorAuthorityReason ? { colorAuthorityReason: visual.colorAuthorityReason } : {}),
  };
}

function pathBlankMarkerPolicyGeometry(input: {
  config: ChartConfig;
  series: ChartData['series'][number];
  seriesType: ChartType;
  markerVisibleInk: boolean;
}): Pick<
  ExcelCartesianSeriesGeometry,
  | 'blankMarkerPolicy'
  | 'blankMarkerPolicyStatus'
  | 'blankMarkerPolicyStatusReason'
  | 'sourceBlankPointCount'
  | 'zeroProjectedSourceBlankPointCount'
> {
  if (!isPathVisualSeriesType(input.seriesType)) return {};

  const sourceBlankPointCount = input.series.data.filter(
    (point) => point?.valueState === 'blank',
  ).length;
  const zeroProjectedSourceBlankPointCount =
    input.config.displayBlanksAs === 'zero' ? sourceBlankPointCount : 0;

  if (zeroProjectedSourceBlankPointCount <= 0) {
    return {
      blankMarkerPolicy: 'notApplicable',
      blankMarkerPolicyStatus: 'verifiedDefault',
      blankMarkerPolicyStatusReason: 'noZeroProjectedSourceBlanks',
      ...(sourceBlankPointCount > 0 ? { sourceBlankPointCount } : {}),
    };
  }

  if (!input.markerVisibleInk) {
    return {
      blankMarkerPolicy: 'notApplicable',
      blankMarkerPolicyStatus: 'verifiedDefault',
      blankMarkerPolicyStatusReason: 'sourceMarkerDisabled',
      sourceBlankPointCount,
      zeroProjectedSourceBlankPointCount,
    };
  }

  return {
    blankMarkerPolicy: 'suppressSourceBlankMarkers',
    blankMarkerPolicyStatus: 'exact',
    sourceBlankPointCount,
    zeroProjectedSourceBlankPointCount,
  };
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
    const memberIndices = members.map((item) => item.seriesIndex);
    const pathMemberIndices = members
      .filter((item) => isPathGeometrySeriesType(item.type))
      .map((item) => item.seriesIndex);
    const stackMode = pathStackModeForMemberIndices(config, data, pathMemberIndices);
    const includeZero =
      pathMemberIndices.length > 0
        ? pathValueAxisIncludesZero(config, data, pathMemberIndices, stackMode)
        : members.some((item) => excelSeriesValueAxisIncludesZero(config, item.type as ChartType));
    const axisConfig = valueAxisConfigForIndex(config, axisIndex);
    const configuredScale = axisConfig ? buildAxisScaleSpec(axisConfig, false) : undefined;
    const explicitDomain = hasExplicitScaleDomain(configuredScale?.domain);
    const channel = excelValueEncodingForAxis({
      config,
      baseY: { field: VALUE_FIELD, type: 'quantitative' },
      axisIndex,
      values: geometryAxisValues(config, data, memberIndices),
      includeZero,
    });
    const pathAxisLayout =
      pathMemberIndices.length > 0
        ? resolvePathAxisLayoutForMembers({
            config,
            data,
            memberIndices: pathMemberIndices,
            axisIndex,
            valueAxis: axisConfig,
            stackMode,
            includeZero: pathValueAxisIncludesZero(config, data, pathMemberIndices, stackMode),
          })
        : undefined;
    const stackedAreaMembers = comboPathStackedAreaMemberIndices(config, data, pathMemberIndices);
    const effectivePathAxisLayout =
      pathAxisLayout &&
      stackedAreaMembers.length > 0 &&
      nonStackedMemberIndices(pathMemberIndices, stackedAreaMembers).length > 0
        ? withoutPathValueScaleLayout(pathAxisLayout)
        : pathAxisLayout;
    const axisRole = axisIndex === 1 ? 'secondaryYValue' : 'primaryYValue';
    const axisContract = xyAxisVisualContract(
      axisRole,
      axisConfig,
      xyValueAxisOrient(axisConfig, axisRole),
      valueAxisPeerKindForMembers(config, data, members),
      defaultCategoryCrossing(config),
    );
    return {
      axisGroup: axisIndex === 1 ? 'secondary' : 'primary',
      axisRole,
      domain: effectivePathAxisLayout?.valueAxisDomain ?? scaleDomain(channel.scale?.domain),
      includeZero,
      explicitDomain,
      scaleAuthority: scaleAuthority(explicitDomain),
      tickStep:
        effectivePathAxisLayout?.valueAxisTickStep ?? positiveNumber(channel.axis?.tickStep),
      ...(effectivePathAxisLayout?.percentAxisLabelPolicy
        ? { percentAxisLabelPolicy: effectivePathAxisLayout.percentAxisLabelPolicy }
        : {}),
      ...(effectivePathAxisLayout?.valueAxisLayoutStatus
        ? {
            axisLayoutStatus: effectivePathAxisLayout.valueAxisLayoutStatus,
            valueAxisLayoutStatus: effectivePathAxisLayout.valueAxisLayoutStatus,
          }
        : {}),
      ...(effectivePathAxisLayout?.valueAxisLayoutStatusReason
        ? {
            axisLayoutStatusReason: effectivePathAxisLayout.valueAxisLayoutStatusReason,
            valueAxisLayoutStatusReason: effectivePathAxisLayout.valueAxisLayoutStatusReason,
          }
        : {}),
      ...axisContract,
      ...optionalAxisSource(axisConfig),
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
      groupKey: string;
      memberCount: number;
      seriesIndices: number[];
      hiddenGeometrySeriesIndices: number[];
    }
  >();
  for (const item of areaSeries) {
    const key = item.stackGroup ?? `area:${item.axisGroup}:${item.xRole}:${item.seriesIndex}`;
    const seriesConfig = seriesConfigForDataSeries(
      data.series[item.seriesIndex],
      config.series ?? [],
      item.seriesIndex,
    );
    const group = groupsByKey.get(key) ?? {
      axisGroup: item.axisGroup,
      xRole: item.xRole,
      groupKey: key,
      memberCount: 0,
      seriesIndices: [],
      hiddenGeometrySeriesIndices: [],
    };
    group.seriesIndices.push(item.seriesIndex);
    if (isNoFillNoLineSeries(seriesConfig)) {
      group.hiddenGeometrySeriesIndices.push(item.seriesIndex);
    }
    group.memberCount = group.seriesIndices.length;
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
      groups: Array.from(groupsByKey.values()).map((group) => ({
        axisGroup: group.axisGroup,
        xRole: group.xRole,
        groupKey: group.groupKey,
        memberCount: group.memberCount,
        seriesIndices: group.seriesIndices,
        ...(group.hiddenGeometrySeriesIndices.length > 0
          ? { hiddenGeometrySeriesIndices: group.hiddenGeometrySeriesIndices }
          : {}),
      })),
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
  const maxRenderableMagnitude = maxRenderableBubbleMagnitude(data, config);
  const maxRenderedArea = 6400 * (bubbleScale / 100);
  return {
    bubble: {
      sizeRepresents: config.sizeRepresents === 'w' ? 'w' : 'area',
      bubbleScale,
      showNegBubbles: config.showNegBubbles === true,
      maxRenderableMagnitude,
      sizeDomain: [0, maxRenderableMagnitude],
      sizeRange: [0, maxRenderedArea],
      maxRenderedArea,
      maxRenderedRadius: Math.sqrt(maxRenderedArea / Math.PI),
      normalizedSizeField: BUBBLE_SIZE_FIELD,
      rawSizeField: RAW_BUBBLE_SIZE_FIELD,
      clippingPolicy: 'overflowPlotArea',
      sizeScaleAuthority: 'excelBubbleScale',
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
    config.type === 'bubble3DEffect' ||
    seriesType === 'scatter' ||
    seriesType === 'bubble' ||
    seriesType === 'bubble3DEffect'
  );
}

function geometryAxisValues(
  config: ChartConfig,
  data: ChartData,
  memberIndices: readonly number[],
): number[] {
  const stackMode = pathStackModeForMemberIndices(config, data, memberIndices);
  if (stackMode === 'normalize') return percentStackedGeometryDomain(data, memberIndices);
  if (stackMode === 'zero') {
    return [
      ...chartValueValues(data, memberIndices),
      ...stackedGeometryValues(data, memberIndices),
    ];
  }
  return chartValueValues(data, memberIndices);
}

function comboPathStackedAreaMemberIndices(
  config: ChartConfig,
  data: ChartData,
  memberIndices: readonly number[],
): number[] {
  if (config.type !== 'combo' || !resolveStackMode(config)) return [];
  const memberSet = new Set(memberIndices);
  return data.series.flatMap((series, index) => {
    if (!memberSet.has(index)) return [];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const seriesType = resolveGeometrySeriesType(config, series, seriesConfig, index);
    return seriesType && MARK_TYPE_MAP[seriesType] === 'area' ? [index] : [];
  });
}

function nonStackedMemberIndices(
  memberIndices: readonly number[],
  stackedAreaMembers: readonly number[],
): number[] {
  if (stackedAreaMembers.length === 0) return [...memberIndices];
  const stackedSet = new Set(stackedAreaMembers);
  return memberIndices.filter((index) => !stackedSet.has(index));
}

function withoutPathValueScaleLayout(layout: PathChartAxisLayout): PathChartAxisLayout {
  const rest = { ...layout };
  delete rest.valueAxisDomain;
  delete rest.valueAxisTickStep;
  delete rest.valueAxisTickCount;
  return rest;
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

function quantitativeXGeometry(
  config: ChartConfig,
  data: ChartData,
  memberIndices: readonly number[],
): NonNullable<ExcelCartesianGeometryPlan['x']['quantitative']> {
  const memberSet = new Set(memberIndices);
  const memberData: ChartData = {
    ...data,
    series: data.series.filter((_series, index) => memberSet.has(index)),
  };
  const axisConfig = quantitativeXAxisConfigForGeometry(config);
  const configuredScale = axisConfig ? buildAxisScaleSpec(axisConfig, false) : undefined;
  const explicitDomain = hasExplicitScaleDomain(configuredScale?.domain);
  const channel = excelQuantitativeXEncoding({ config, data: memberData });
  const axisContract = xyAxisVisualContract(
    'xValue',
    axisConfig,
    xyValueAxisOrient(axisConfig, 'xValue'),
    'quantitative',
  );
  return {
    mode: 'quantitative',
    axisRole: 'xValue',
    domain: scaleDomain(channel.scale?.domain),
    field: SCATTER_X_FIELD,
    includeZero: false,
    explicitDomain,
    scaleAuthority: scaleAuthority(explicitDomain),
    tickStep: positiveNumber(channel.axis?.tickStep),
    ...axisContract,
    ...optionalAxisSource(axisConfig),
  };
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
    padding: policy === 'between' || policy === 'centeredSingleton' ? 0.5 : 0,
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

type XYValueAxisRole = 'xValue' | 'primaryYValue' | 'secondaryYValue';

function valueAxisPeerKindForMembers(
  config: ChartConfig,
  data: ChartData,
  members: readonly ExcelCartesianSeriesGeometry[],
): NormalizedAxisPeerKind {
  if (members.some((item) => item.xRole === 'quantitative')) return 'quantitative';
  return shouldUseDateSerialCategoryAxis(config, data, false) ? 'dateSerial' : 'categoryPoint';
}

function xyAxisVisualContract(
  role: XYValueAxisRole,
  axisConfig: SingleAxisConfig | undefined,
  renderedAxisOrient: ExcelCartesianRenderedAxisOrient,
  peerAxisKind: NormalizedAxisPeerKind,
  defaultSourceCategoryCrossing?: 'between' | 'midCat',
): {
  renderedAxisOrient: ExcelCartesianRenderedAxisOrient;
  axisVisualStatus: XYVisualContractStatus;
  axisVisualStatusReason?: string;
  crossingStatus: XYVisualContractStatus;
  crossingStatusReason?: string;
  crossing?: ExcelCartesianAxisCrossingGeometry;
  reservationStatus: XYVisualContractStatus;
  reservationStatusReason?: string;
} {
  const sourcePosition = normalizeSourceAxisPosition(axisConfig?.position);
  const expected = role === 'xValue' ? 'horizontal' : 'vertical';
  const sourceOrientation = sourcePosition ? axisPositionOrientation(sourcePosition) : undefined;
  const axisVisualStatus =
    axisConfig?.position && !sourcePosition
      ? 'approximate'
      : !axisConfig
        ? 'verifiedDefault'
        : sourceOrientation === undefined || sourceOrientation === expected
          ? 'exact'
          : 'verifiedDefault';
  const crossingPlan = normalizeValueAxisCrossingPlan(
    axisConfig,
    peerAxisKind,
    peerAxisKind === 'categoryPoint' ? defaultSourceCategoryCrossing : undefined,
  );
  const { unsupportedReason, ...crossing } = crossingPlan;
  const crossingStatus: XYVisualContractStatus = unsupportedReason
    ? 'approximate'
    : axisConfig
      ? 'exact'
      : 'verifiedDefault';
  const axisVisualStatusReason =
    axisConfig?.position && !sourcePosition
      ? `sourceAxisPositionUnrecognized:${axisConfig.position}`
      : sourceOrientation && sourceOrientation !== expected
        ? `sourceAxisPositionStoredAs${sourcePosition};renderedAs${renderedAxisOrient}`
        : !axisConfig
          ? 'excelDefaultValueAxis'
          : undefined;
  return {
    renderedAxisOrient,
    axisVisualStatus,
    ...(axisVisualStatusReason ? { axisVisualStatusReason } : {}),
    crossingStatus,
    ...(unsupportedReason
      ? { crossingStatusReason: unsupportedReason }
      : !axisConfig
        ? { crossingStatusReason: 'excelDefaultCrossing' }
        : {}),
    crossing,
    reservationStatus: axisConfig ? 'exact' : 'verifiedDefault',
    ...(!axisConfig ? { reservationStatusReason: 'excelDefaultAxisReservation' } : {}),
  };
}

function xyValueAxisOrient(
  axisConfig: SingleAxisConfig | undefined,
  role: XYValueAxisRole,
): ExcelCartesianRenderedAxisOrient {
  const position = normalizeSourceAxisPosition(axisConfig?.position);
  if (role === 'xValue') {
    return position === 'top' || position === 'bottom' ? position : 'bottom';
  }
  if (role === 'secondaryYValue') {
    return position === 'left' || position === 'right' ? position : 'right';
  }
  return position === 'left' || position === 'right' ? position : 'left';
}

function normalizeSourceAxisPosition(
  position: string | undefined,
): ExcelCartesianRenderedAxisOrient | undefined {
  if (!position) return undefined;
  switch (position.toLowerCase()) {
    case 'b':
    case 'bottom':
      return 'bottom';
    case 't':
    case 'top':
      return 'top';
    case 'l':
    case 'left':
      return 'left';
    case 'r':
    case 'right':
      return 'right';
    default:
      return undefined;
  }
}

function axisPositionOrientation(
  position: ExcelCartesianRenderedAxisOrient,
): 'horizontal' | 'vertical' {
  return position === 'top' || position === 'bottom' ? 'horizontal' : 'vertical';
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

function categoryAxisConfigForGeometry(config: ChartConfig): SingleAxisConfig | undefined {
  return config.axis?.xAxis ?? config.axis?.categoryAxis;
}

function quantitativeXAxisConfigForGeometry(config: ChartConfig): SingleAxisConfig | undefined {
  return config.axis?.xAxis ?? config.axis?.valueAxis;
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

function isPathGeometrySeriesType(type: string): boolean {
  if (!isSupportedChartType(type)) return false;
  const markType = MARK_TYPE_MAP[type];
  return markType === 'line' || markType === 'area';
}

function optionalPathAxisLayout(layout: PathChartAxisLayout | undefined): {
  pathAxisLayout?: ExcelCartesianPathAxisLayoutGeometry;
} {
  if (!layout) return {};
  const pathAxisLayout: ExcelCartesianPathAxisLayoutGeometry = {
    ...(layout.categoryTickLabelSkip !== undefined
      ? { categoryTickLabelSkip: layout.categoryTickLabelSkip }
      : {}),
    ...(layout.categoryTickMarkSkip !== undefined
      ? { categoryTickMarkSkip: layout.categoryTickMarkSkip }
      : {}),
    ...(layout.categoryTickSkipSource
      ? { categoryTickSkipSource: layout.categoryTickSkipSource }
      : {}),
    ...(layout.axisLength !== undefined ? { axisLength: layout.axisLength } : {}),
    ...(layout.categoryPitch !== undefined ? { categoryPitch: layout.categoryPitch } : {}),
    ...(layout.labelBudget !== undefined ? { labelBudget: layout.labelBudget } : {}),
    ...(layout.projectedLabelWidth !== undefined
      ? { projectedLabelWidth: layout.projectedLabelWidth }
      : {}),
    ...(layout.visibleLabelCount !== undefined
      ? { visibleLabelCount: layout.visibleLabelCount }
      : {}),
    ...(layout.categoryAxisLayoutStatus
      ? {
          axisLayoutStatus: layout.categoryAxisLayoutStatus,
          categoryAxisLayoutStatus: layout.categoryAxisLayoutStatus,
        }
      : layout.axisLayoutStatus
        ? { axisLayoutStatus: layout.axisLayoutStatus }
        : {}),
    ...(layout.categoryAxisLayoutStatusReason
      ? {
          axisLayoutStatusReason: layout.categoryAxisLayoutStatusReason,
          categoryAxisLayoutStatusReason: layout.categoryAxisLayoutStatusReason,
        }
      : layout.axisLayoutStatusReason
        ? { axisLayoutStatusReason: layout.axisLayoutStatusReason }
        : {}),
    ...(layout.valueAxisLayoutStatus
      ? { valueAxisLayoutStatus: layout.valueAxisLayoutStatus }
      : {}),
    ...(layout.valueAxisLayoutStatusReason
      ? { valueAxisLayoutStatusReason: layout.valueAxisLayoutStatusReason }
      : {}),
    ...(layout.reservationStatus ? { reservationStatus: layout.reservationStatus } : {}),
    ...(layout.reservationStatusReason
      ? { reservationStatusReason: layout.reservationStatusReason }
      : {}),
  };
  return Object.keys(pathAxisLayout).length > 0 ? { pathAxisLayout } : {};
}

function hasExplicitScaleDomain(domain: unknown): boolean {
  return Array.isArray(domain) && domain.some((bound) => bound !== undefined);
}

function hasExplicitAxisDomain(axis: SingleAxisConfig | undefined): boolean {
  return axis?.min !== undefined || axis?.max !== undefined;
}

function scaleAuthority(explicitDomain: boolean): ExcelCartesianScaleAuthority {
  return explicitDomain ? 'explicitDomain' : 'excelAutoDomain';
}

function optionalAxisSource(axis: SingleAxisConfig | undefined): {
  source?: ExcelCartesianAxisSourceGeometry;
} {
  const source = axisSourceGeometry(axis);
  return source ? { source } : {};
}

function axisSourceGeometry(
  axis: SingleAxisConfig | undefined,
): ExcelCartesianAxisSourceGeometry | undefined {
  if (!axis) return undefined;
  const source: ExcelCartesianAxisSourceGeometry = {
    axisPosition: axis.position,
    crossing: axis.crossesAt,
    crossingValue: axis.crossesAtValue,
    crossBetween: axis.crossBetween,
    isBetweenCategories: axis.isBetweenCategories,
    reverse: axis.reverse,
    scaleType: axis.scaleType ?? axis.axisType ?? axis.type,
    logBase: axis.logBase,
    explicitMin: axis.min,
    explicitMax: axis.max,
    majorUnit: axis.majorUnit,
    minorUnit: axis.minorUnit,
    tickLabelPosition: axis.tickLabelPosition,
  };
  const entries = Object.entries(source).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as ExcelCartesianAxisSourceGeometry;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
