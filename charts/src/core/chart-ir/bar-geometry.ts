import type {
  AxisCategoryCrossing,
  BarGeometryGrouping,
  BarGeometrySpec,
  BarValueCrossingPolicy,
  ConfigSpec,
  StackMode,
} from '../../grammar/spec';
import type {
  ChartConfig,
  ChartData,
  ChartType,
  SeriesConfig,
  SingleAxisConfig,
} from '../../types';
import { pointsToCanvasPx } from '../config-to-spec/units';
import { manualLayoutFromValue } from '../config-to-spec/layout-hints-manual';
import { seriesConfigForDataSeries } from '../series-identity';
import { resolveBarColumnAxisLayout } from './bar-axis-layout';

export const DEFAULT_EXCEL_BAR_GAP_WIDTH = 150;
export const DEFAULT_EXCEL_CLUSTERED_BAR_OVERLAP = 0;
export const DEFAULT_EXCEL_STACKED_BAR_OVERLAP = 100;

const BAR_LIKE_CHART_TYPES = new Set<string>([
  'bar',
  'column',
  'bar3d',
  'column3d',
  'cylinderColClustered',
  'cylinderColStacked',
  'cylinderColStacked100',
  'cylinderBarClustered',
  'cylinderBarStacked',
  'cylinderBarStacked100',
  'cylinderCol',
  'coneColClustered',
  'coneColStacked',
  'coneColStacked100',
  'coneBarClustered',
  'coneBarStacked',
  'coneBarStacked100',
  'coneCol',
  'pyramidColClustered',
  'pyramidColStacked',
  'pyramidColStacked100',
  'pyramidBarClustered',
  'pyramidBarStacked',
  'pyramidBarStacked100',
  'pyramidCol',
]);

const HORIZONTAL_BAR_TYPES = new Set<string>([
  'bar',
  'bar3d',
  'cylinderBarClustered',
  'cylinderBarStacked',
  'cylinderBarStacked100',
  'coneBarClustered',
  'coneBarStacked',
  'coneBarStacked100',
  'pyramidBarClustered',
  'pyramidBarStacked',
  'pyramidBarStacked100',
]);

const STACKED_100_CHART_TYPES = new Set<string>([
  'cylinderColStacked100',
  'cylinderBarStacked100',
  'coneColStacked100',
  'coneBarStacked100',
  'pyramidColStacked100',
  'pyramidBarStacked100',
  'lineMarkersStacked100',
]);

const STACKED_CHART_TYPES = new Set<string>([
  'cylinderColStacked',
  'cylinderBarStacked',
  'coneColStacked',
  'coneBarStacked',
  'pyramidColStacked',
  'pyramidBarStacked',
  'lineMarkersStacked',
]);

export interface BarSlotGeometry {
  offset: number;
  size: number;
}

export interface BarGeometryGroup {
  key: string;
  geometry: BarGeometrySpec;
  seriesIndices: number[];
  yAxisIndex?: 0 | 1;
}

export interface ResolveBarGeometryGroupsOptions {
  includeSeries?: (input: {
    series: ChartData['series'][number];
    seriesConfig: SeriesConfig | undefined;
    index: number;
    seriesType: string | undefined;
  }) => boolean;
}

type ChartImportSourceDialect = 'ooxml' | 'ooxml-chart-ex';

type ChartRenderExtraMetadata = {
  imported?: unknown;
  sourceDialect?: unknown;
};

type BarPlotAreaContract = Pick<
  BarGeometrySpec,
  | 'plotAreaAuthority'
  | 'categoryPitchAuthority'
  | 'categoryPitchStatus'
  | 'categoryPitchStatusReason'
> & {
  plotAreaSource: NonNullable<BarGeometrySpec['plotAreaSource']>;
};

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isBarLikeChartType(type: ChartType | string | undefined): boolean {
  return typeof type === 'string' && BAR_LIKE_CHART_TYPES.has(type);
}

export function barOrientationForChartType(
  type: ChartType | string | undefined,
): NonNullable<BarGeometrySpec['orientation']> {
  return HORIZONTAL_BAR_TYPES.has(String(type)) ? 'horizontal' : 'vertical';
}

export function isHorizontalBarLikeChartType(type: ChartType | string | undefined): boolean {
  return isBarLikeChartType(type) && barOrientationForChartType(type) === 'horizontal';
}

export function isVerticalBarLikeChartType(type: ChartType | string | undefined): boolean {
  return isBarLikeChartType(type) && barOrientationForChartType(type) === 'vertical';
}

export function stackModeForChartType(type: ChartType | string | undefined): StackMode | undefined {
  if (STACKED_100_CHART_TYPES.has(String(type))) return 'normalize';
  if (STACKED_CHART_TYPES.has(String(type))) return 'zero';
  return undefined;
}

export function barGroupingForConfig(
  config: Pick<ChartConfig, 'type' | 'subType'>,
): BarGeometryGrouping {
  if (config.subType === 'stacked') return 'stacked';
  if (config.subType === 'percentStacked') return 'percentStacked';
  if (stackModeForChartType(config.type) === 'zero') return 'stacked';
  if (stackModeForChartType(config.type) === 'normalize') return 'percentStacked';
  return 'clustered';
}

export function barGroupingForConfigSpec(config: ConfigSpec | undefined): BarGeometryGrouping {
  if (config?.barGeometry?.grouping) return config.barGeometry.grouping;
  if (config?.stack === 'zero' || config?.stack === 'center') return 'stacked';
  if (config?.stack === 'normalize') return 'percentStacked';
  return 'clustered';
}

export function isStackedBarGrouping(grouping: BarGeometryGrouping | string): boolean {
  return grouping === 'stacked' || grouping === 'percentStacked';
}

export function effectiveGapWidth(sourceGapWidth: number | undefined): number {
  return clamp(finiteNumber(sourceGapWidth) ?? DEFAULT_EXCEL_BAR_GAP_WIDTH, 0, 500);
}

export function effectiveOverlap(
  sourceOverlap: number | undefined,
  grouping: BarGeometryGrouping | string,
): number {
  const fallback = isStackedBarGrouping(grouping)
    ? DEFAULT_EXCEL_STACKED_BAR_OVERLAP
    : DEFAULT_EXCEL_CLUSTERED_BAR_OVERLAP;
  return clamp(finiteNumber(sourceOverlap) ?? fallback, -100, 100);
}

export function hasExcelBarGeometryConfig(config: Pick<ChartConfig, 'type' | 'series'>): boolean {
  if (isBarLikeChartType(config.type)) return true;
  if (config.type !== 'combo') return false;

  const series = config.series ?? [];
  if (series.length === 0) return true;
  return series.some((item, index) =>
    isBarLikeChartType(item.type ?? defaultComboSeriesType(index)),
  );
}

export function effectiveBarGeometry(
  config: Pick<ChartConfig, 'type' | 'subType' | 'gapWidth' | 'overlap' | 'series'> &
    Partial<Pick<ChartConfig, 'axis' | 'extra' | 'width' | 'height' | 'plotLayout' | 'plotArea'>>,
  data?: Pick<ChartData, 'categories' | 'series'>,
): BarGeometrySpec | undefined {
  if (!hasExcelBarGeometryConfig(config)) return undefined;

  const firstBarSeriesType =
    config.type === 'combo'
      ? config.series?.find((series, index) =>
          isBarLikeChartType(series.type ?? defaultComboSeriesType(index)),
        )?.type
      : undefined;
  const geometryType = firstBarSeriesType ?? (config.type === 'combo' ? 'column' : config.type);
  return effectiveBarGeometryForType(config, geometryType, data);
}

function effectiveBarGeometryForType(
  config: Pick<ChartConfig, 'type' | 'subType' | 'gapWidth' | 'overlap'> &
    Partial<Pick<ChartConfig, 'axis' | 'extra' | 'width' | 'height' | 'plotLayout' | 'plotArea'>>,
  geometryType: ChartType | string,
  data?: Pick<ChartData, 'categories' | 'series'>,
  yAxisIndex?: 0 | 1,
  seriesIndices?: readonly number[],
): BarGeometrySpec {
  const sourceGapWidth = finiteNumber(config.gapWidth);
  const sourceOverlap = finiteNumber(config.overlap);
  const grouping = barGroupingForConfig({
    type: geometryType as ChartType,
    subType: config.subType,
  });
  const gapWidth = effectiveGapWidth(sourceGapWidth);
  const overlap = effectiveOverlap(sourceOverlap, grouping);

  const baseGeometry: BarGeometrySpec = {
    orientation: barOrientationForChartType(geometryType),
    grouping,
    sourceGapWidth,
    sourceOverlap,
    gapWidth,
    overlap,
    ...(sourceGapWidth !== undefined && sourceGapWidth !== gapWidth
      ? { gapWidthClamped: true }
      : {}),
    ...(sourceOverlap !== undefined && sourceOverlap !== overlap ? { overlapClamped: true } : {}),
  };
  return withBarColumnImportedGeometryContract(config, baseGeometry, {
    data,
    yAxisIndex,
    seriesIndices,
  });
}

export function resolveBarGeometryGroups(
  config: ChartConfig,
  chartData: Pick<ChartData, 'categories' | 'series'>,
  options: ResolveBarGeometryGroupsOptions = {},
): BarGeometryGroup[] {
  if (!hasExcelBarGeometryConfig(config)) return [];

  if (config.type !== 'combo') {
    const geometry = effectiveBarGeometry(config, chartData);
    if (!geometry) return [];
    const seriesIndices = chartData.series
      .map((series, index) => ({
        series,
        seriesConfig: seriesConfigForDataSeries(series, config.series ?? [], index),
        index,
      }))
      .filter(({ series, seriesConfig, index }) =>
        options.includeSeries
          ? options.includeSeries({
              series,
              seriesConfig,
              index,
              seriesType: seriesConfig?.type ?? series.type ?? config.type,
            })
          : true,
      )
      .map(({ index }) => index);
    if (seriesIndices.length === 0) return [];

    return [
      {
        key: `bar:0:${geometry.orientation ?? 'vertical'}:${geometry.grouping}`,
        geometry: withImportedSeriesSlotOrder(
          config,
          withBarColumnImportedGeometryContract(config, geometry, {
            data: chartData,
            seriesIndices,
          }),
        ),
        seriesIndices,
      },
    ];
  }

  const groups = new Map<string, BarGeometryGroup>();
  for (let index = 0; index < chartData.series.length; index += 1) {
    const series = chartData.series[index];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const seriesType = comboSeriesTypeForBarGeometry(config, series, seriesConfig, index);
    if (seriesType === undefined || !isBarLikeChartType(seriesType)) continue;
    if (
      options.includeSeries &&
      !options.includeSeries({ series, seriesConfig, index, seriesType })
    ) {
      continue;
    }

    const yAxisIndex = normalizeBarGeometryYAxisIndex(
      seriesConfig?.yAxisIndex ?? series.yAxisIndex,
    );
    const geometry = effectiveBarGeometryForType(config, seriesType, chartData, yAxisIndex, [
      index,
    ]);
    const key = `bar:${yAxisIndex ?? 0}:${geometry.orientation ?? 'vertical'}:${geometry.grouping}`;
    const existing = groups.get(key);
    if (existing) {
      existing.seriesIndices.push(index);
      existing.geometry = withBarColumnImportedGeometryContract(config, existing.geometry, {
        data: chartData,
        yAxisIndex,
        seriesIndices: existing.seriesIndices,
      });
      continue;
    }

    const seriesIndices = [index];
    groups.set(key, {
      key,
      geometry: withImportedSeriesSlotOrder(config, { ...geometry, seriesIndices }),
      seriesIndices,
      ...(yAxisIndex !== undefined ? { yAxisIndex } : {}),
    });
  }

  return [...groups.values()];
}

function comboSeriesTypeForBarGeometry(
  config: Pick<ChartConfig, 'type'>,
  series: ChartData['series'][number],
  seriesConfig: SeriesConfig | undefined,
  index: number,
): string | undefined {
  const fallbackComboType = config.type === 'combo' ? defaultComboSeriesType(index) : config.type;
  return seriesConfig?.type ?? series.type ?? fallbackComboType;
}

function defaultComboSeriesType(index: number): ChartType {
  return index === 0 ? 'column' : 'line';
}

function normalizeBarGeometryYAxisIndex(value: number | undefined): 0 | 1 | undefined {
  if (value === 0 || value === 1) return value;
  return undefined;
}

function withImportedSeriesSlotOrder(
  config: Pick<ChartConfig, 'extra'>,
  geometry: BarGeometrySpec,
): BarGeometrySpec {
  return shouldReverseImportedHorizontalBarSeries(config, geometry)
    ? { ...geometry, seriesSlotOrder: 'reverse' }
    : geometry;
}

export function chartImportSourceDialect(
  config: Partial<Pick<ChartConfig, 'extra'>>,
): ChartImportSourceDialect | undefined {
  if (typeof config.extra !== 'object' || config.extra === null) return undefined;

  const extra = config.extra as ChartRenderExtraMetadata;
  if (extra.sourceDialect === 'ooxml' || extra.sourceDialect === 'ooxml-chart-ex') {
    return extra.sourceDialect;
  }

  // Compatibility for older normalized import payloads that only carried an
  // imported sentinel. New normalizers should set sourceDialect explicitly.
  return extra.imported === true ? 'ooxml' : undefined;
}

export function isImportedStandardOoxmlChart(config: Pick<ChartConfig, 'extra'>): boolean {
  return chartImportSourceDialect(config) === 'ooxml';
}

export function shouldReverseImportedHorizontalBarSeries(
  config: Pick<ChartConfig, 'extra'>,
  barGeometry: BarGeometrySpec,
): boolean {
  return (
    isImportedStandardOoxmlChart(config) &&
    barGeometry.orientation === 'horizontal' &&
    barGeometry.grouping === 'clustered'
  );
}

export function hasExcelBarGeometrySpec(config: ConfigSpec | undefined): boolean {
  return (
    config?.barGeometry !== undefined ||
    finiteNumber(config?.gapWidth) !== undefined ||
    finiteNumber(config?.overlap) !== undefined
  );
}

export function effectiveBarGeometryFromSpec(config: ConfigSpec | undefined): BarGeometrySpec {
  if (config?.barGeometry) return config.barGeometry;

  const grouping = barGroupingForConfigSpec(config);
  const sourceGapWidth = finiteNumber(config?.gapWidth);
  const sourceOverlap = finiteNumber(config?.overlap);
  return {
    grouping,
    sourceGapWidth,
    sourceOverlap,
    gapWidth: effectiveGapWidth(sourceGapWidth),
    overlap: effectiveOverlap(sourceOverlap, grouping),
  };
}

export function excelBarSlotGeometry(
  categoryStep: number,
  groupCount: number,
  groupIndex: number,
  geometry: BarGeometrySpec,
): BarSlotGeometry {
  const safeGroupCount = isStackedBarGrouping(geometry.grouping) ? 1 : Math.max(1, groupCount);
  const safeGroupIndex = isStackedBarGrouping(geometry.grouping)
    ? 0
    : clamp(groupIndex, 0, safeGroupCount - 1);
  const gapRatio = effectiveGapWidth(geometry.gapWidth) / 100;
  const overlapRatio = effectiveOverlap(geometry.overlap, geometry.grouping) / 100;
  const groupStepUnits = 1 - overlapRatio;
  const clusterUnits = 1 + (safeGroupCount - 1) * groupStepUnits;
  const barSize = categoryStep / (clusterUnits + gapRatio);
  const clusterSize = barSize * clusterUnits;
  if (geometry.categoryPositionPolicy === 'onCategory') {
    return {
      offset: -clusterSize / 2 + safeGroupIndex * barSize * groupStepUnits,
      size: barSize,
    };
  }
  return {
    offset: (categoryStep - clusterSize) / 2 + safeGroupIndex * barSize * groupStepUnits,
    size: barSize,
  };
}

export function barBaselineValueForDomain(
  geometry: Pick<BarGeometrySpec, 'valueCrossing' | 'valueCrossingValue'> | undefined,
  domain: readonly unknown[] | undefined,
): number | undefined {
  const domainMin = numericDomainBound(domain, 0);
  const domainMax = numericDomainBound(domain, 1);
  const crossing = geometry?.valueCrossing ?? 'automatic';

  if (crossing === 'custom') {
    return finiteNumber(geometry?.valueCrossingValue) ?? 0;
  }
  if (crossing === 'min') return domainMin;
  if (crossing === 'max') return domainMax;
  if (domainMin === undefined || domainMax === undefined) return 0;
  if (domainMin <= 0 && domainMax >= 0) return 0;
  return domainMax < 0 ? domainMax : domainMin;
}

export function barBaselinePixelForDomain(input: {
  geometry: Pick<BarGeometrySpec, 'valueCrossing' | 'valueCrossingValue'> | undefined;
  domain: readonly unknown[] | undefined;
  range: readonly [number, number];
}): number | undefined {
  const baselineValue = barBaselineValueForDomain(input.geometry, input.domain);
  const domainMin = numericDomainBound(input.domain, 0);
  const domainMax = numericDomainBound(input.domain, 1);
  if (
    baselineValue === undefined ||
    domainMin === undefined ||
    domainMax === undefined ||
    domainMin === domainMax
  ) {
    return undefined;
  }
  const t = (baselineValue - domainMin) / (domainMax - domainMin);
  const raw = input.range[0] + t * (input.range[1] - input.range[0]);
  const min = Math.min(input.range[0], input.range[1]);
  const max = Math.max(input.range[0], input.range[1]);
  return clamp(raw, min, max);
}

function withBarColumnImportedGeometryContract(
  config: Pick<ChartConfig, 'type' | 'axis' | 'extra'> &
    Partial<Pick<ChartConfig, 'width' | 'height' | 'plotLayout' | 'plotArea'>>,
  geometry: BarGeometrySpec,
  options: {
    data?: Pick<ChartData, 'categories' | 'series'>;
    yAxisIndex?: 0 | 1;
    seriesIndices?: readonly number[];
  } = {},
): BarGeometrySpec {
  const orientation = geometry.orientation ?? barOrientationForChartType(config.type);
  const categoryAxisRole = orientation === 'horizontal' ? 'y' : 'x';
  const valueAxisRole = orientation === 'horizontal' ? 'x' : 'y';
  const categoryAxis = categoryAxisConfig(config, orientation);
  const valueAxis = valueAxisConfig(config, orientation, options.yAxisIndex);
  const categoryCrossing =
    normalizeAxisCategoryCrossing(valueAxis) ??
    normalizeAxisCategoryCrossing(categoryAxis) ??
    'between';
  const categoryPositionPolicy = categoryPositionPolicyForCrossing(
    categoryCrossing,
    options.data?.categories.length,
  );
  const valueCrossing = normalizeValueCrossing(categoryAxis?.crossesAt) ?? 'automatic';
  const valueCrossingValue = finiteNumber(categoryAxis?.crossesAtValue);
  const axisLayout = resolveBarColumnAxisLayout({
    sourceDialect: chartImportSourceDialect(config),
    orientation,
    grouping: geometry.grouping,
    data: options.data,
    seriesIndices: options.seriesIndices,
    categoryAxis,
    valueAxis,
    chartWidth: pointsToCanvasPx(config.width),
    chartHeight: pointsToCanvasPx(config.height),
  });
  const valueAxisDomain = axisLayout.valueAxisDomain;
  const baselineValue = barBaselineValueForDomain(
    { valueCrossing, valueCrossingValue },
    valueAxisDomain,
  );
  const plotAreaContract = plotAreaAuthorityForConfig(config);
  const geometryStatus = geometryStatusForConfig(
    config,
    axisLayout.axisLayoutStatus,
    plotAreaContract.plotAreaSource,
  );

  return {
    ...geometry,
    categoryAxisRole,
    valueAxisRole,
    categoryPositionPolicy,
    categoryCrossing,
    valueCrossing,
    ...(valueCrossingValue !== undefined ? { valueCrossingValue } : {}),
    ...(baselineValue !== undefined ? { baselineValue } : {}),
    ...(valueAxisDomain ? { valueAxisDomain } : {}),
    ...(axisLayout.categoryTickLabelSkip !== undefined
      ? { categoryTickLabelSkip: axisLayout.categoryTickLabelSkip }
      : {}),
    ...(axisLayout.categoryTickMarkSkip !== undefined
      ? { categoryTickMarkSkip: axisLayout.categoryTickMarkSkip }
      : {}),
    ...(axisLayout.categoryTickSkipSource
      ? { categoryTickSkipSource: axisLayout.categoryTickSkipSource }
      : {}),
    ...(axisLayout.categoryTickStatus ? { categoryTickStatus: axisLayout.categoryTickStatus } : {}),
    ...(axisLayout.categoryTickStatusReason
      ? { categoryTickStatusReason: axisLayout.categoryTickStatusReason }
      : {}),
    ...(axisLayout.valueAxisTickStep !== undefined
      ? { valueAxisTickStep: axisLayout.valueAxisTickStep }
      : {}),
    ...(axisLayout.valueAxisTickCount !== undefined
      ? { valueAxisTickCount: axisLayout.valueAxisTickCount }
      : {}),
    ...(axisLayout.percentDomain ? { percentDomain: axisLayout.percentDomain } : {}),
    ...(axisLayout.percentAxisLabelPolicy
      ? { percentAxisLabelPolicy: axisLayout.percentAxisLabelPolicy }
      : {}),
    ...(axisLayout.valueAxisScaleSource
      ? { valueAxisScaleSource: axisLayout.valueAxisScaleSource }
      : {}),
    ...(axisLayout.valueAxisScaleStatus
      ? { valueAxisScaleStatus: axisLayout.valueAxisScaleStatus }
      : {}),
    ...(axisLayout.valueAxisScaleStatusReason
      ? { valueAxisScaleStatusReason: axisLayout.valueAxisScaleStatusReason }
      : {}),
    ...(axisLayout.axisLayoutStatus ? { axisLayoutStatus: axisLayout.axisLayoutStatus } : {}),
    ...(axisLayout.axisLayoutStatusReason
      ? { axisLayoutStatusReason: axisLayout.axisLayoutStatusReason }
      : {}),
    ...geometryStatus,
    ...plotAreaContract,
    ...(options.seriesIndices ? { seriesIndices: [...options.seriesIndices] } : {}),
  };
}

function plotAreaAuthorityForConfig(
  config: Partial<Pick<ChartConfig, 'plotLayout' | 'plotArea' | 'extra'>>,
): BarPlotAreaContract {
  const dialect = chartImportSourceDialect(config);
  const manualPlotArea = manualLayoutFromValue(config.plotLayout ?? config.plotArea?.layout);
  if (dialect === 'ooxml' && manualPlotArea) {
    return {
      plotAreaSource: 'manual',
      plotAreaAuthority: 'manualLayout',
      categoryPitchAuthority: 'manualLayout',
    };
  }
  if (dialect === 'ooxml') {
    return {
      plotAreaSource: 'auto',
      plotAreaAuthority: 'rendererAuto',
      categoryPitchAuthority: 'rendererAuto',
      categoryPitchStatus: 'approximate',
      categoryPitchStatusReason: 'importedAutoPlotAreaCategoryPitch',
    };
  }
  return {
    plotAreaSource: manualPlotArea ? 'manual' : 'auto',
    plotAreaAuthority: manualPlotArea ? 'manualLayout' : 'rendererAuto',
    categoryPitchAuthority: manualPlotArea ? 'manualLayout' : 'rendererAuto',
    categoryPitchStatus: 'verifiedDefault',
  };
}

function categoryAxisConfig(
  config: Pick<ChartConfig, 'axis'>,
  orientation: BarGeometrySpec['orientation'],
): SingleAxisConfig | undefined {
  if (!config.axis) return undefined;
  return orientation === 'horizontal'
    ? (config.axis.categoryAxis ?? config.axis.yAxis)
    : (config.axis.xAxis ?? config.axis.categoryAxis);
}

function valueAxisConfig(
  config: Pick<ChartConfig, 'axis'>,
  orientation: BarGeometrySpec['orientation'],
  yAxisIndex: 0 | 1 | undefined,
): SingleAxisConfig | undefined {
  if (!config.axis) return undefined;
  if (yAxisIndex === 1) return config.axis.secondaryValueAxis ?? config.axis.secondaryYAxis;
  return orientation === 'horizontal'
    ? (config.axis.valueAxis ?? config.axis.xAxis)
    : (config.axis.yAxis ?? config.axis.valueAxis);
}

function normalizeAxisCategoryCrossing(
  axis: SingleAxisConfig | undefined,
): AxisCategoryCrossing | undefined {
  const crossBetween = axis?.crossBetween?.toLowerCase();
  if (crossBetween === 'between') return 'between';
  if (crossBetween === 'midcat' || crossBetween === 'mid_cat' || crossBetween === 'mid-cat') {
    return 'midCat';
  }
  if (axis?.isBetweenCategories === true) return 'between';
  if (axis?.isBetweenCategories === false) return 'midCat';
  return undefined;
}

function categoryPositionPolicyForCrossing(
  crossing: AxisCategoryCrossing,
  categoryCount: number | undefined,
): NonNullable<BarGeometrySpec['categoryPositionPolicy']> {
  if (categoryCount !== undefined && categoryCount <= 1) return 'centeredSingleton';
  return crossing === 'midCat' ? 'onCategory' : 'between';
}

function normalizeValueCrossing(value: unknown): BarValueCrossingPolicy | undefined {
  return value === 'automatic' || value === 'min' || value === 'max' || value === 'custom'
    ? value
    : undefined;
}

function geometryStatusForConfig(
  config: Pick<ChartConfig, 'extra'>,
  axisLayoutStatus: BarGeometrySpec['axisLayoutStatus'] | undefined,
  plotAreaSource: NonNullable<BarGeometrySpec['plotAreaSource']>,
): Pick<BarGeometrySpec, 'geometryStatus' | 'geometryStatusReason'> {
  const dialect = chartImportSourceDialect(config);
  if (dialect === 'ooxml-chart-ex') return { geometryStatus: 'approximate' };
  if (dialect === 'ooxml') {
    const autoPlotArea = plotAreaSource === 'auto';
    return {
      geometryStatus: axisLayoutStatus === 'approximate' || autoPlotArea ? 'approximate' : 'exact',
      ...(autoPlotArea ? { geometryStatusReason: 'importedAutoPlotAreaCategoryPitch' } : {}),
    };
  }
  if (axisLayoutStatus === 'approximate') return { geometryStatus: 'approximate' };
  return { geometryStatus: 'verifiedDefault' };
}

function numericDomainBound(
  domain: readonly unknown[] | undefined,
  index: number,
): number | undefined {
  const value = domain?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
