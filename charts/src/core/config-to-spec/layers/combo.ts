import type {
  ChannelSpec,
  ConfigSpec,
  DataRow,
  EncodingSpec,
  MarkType,
  Transform,
  UnitSpec,
} from '../../../grammar/spec';
import type { ChartConfig, ChartData, ChartType, SeriesConfig } from '../../../types';
import { applyAutoValueAxisTicks, buildAxisScaleSpec, mapAxisConfigToAxisSpec } from '../axis';
import { applyBarGeometryValueAxisLayout } from '../bar-axis-layout';
import {
  applyAutomaticCategoryAxisCrossing,
  applyMogAutoValueAxisScale,
} from '../encoding-adjustments';
import { MARK_TYPE_MAP } from '../constants';
import { buildEncoding } from '../encoding';
import {
  chartValueValues,
  excelCategoryPointEncoding,
  excelQuantitativeXEncoding,
  excelValueEncodingForAxis,
  usesExcelCartesianGeometry,
  withExcelCartesianGeometryMark,
} from '../excel-cartesian-geometry';
import {
  MARKER_FILL_FIELD,
  MARKER_SHAPE_FIELD,
  MARKER_SIZE_FIELD,
  MARKER_STROKE_FIELD,
  MARKER_STROKE_WIDTH_FIELD,
  MARKER_VISIBLE_FIELD,
  BUBBLE_SIZE_FIELD,
  SCATTER_X_FIELD,
  SERIES_FILL_FIELD,
  SERIES_INDEX_FIELD,
  SERIES_STROKE_FIELD,
  SERIES_STROKE_WIDTH_FIELD,
  VALUE_FIELD,
} from '../fields';
import { buildSeriesMark } from '../marks';
import { resolveStackMode } from '../subtypes';
import { isNoFillNoLineSeries } from '../style';
import {
  applyPathValueAxisLayout,
  isPathLikeChartType,
  pathStackModeForMemberIndices,
  pathValueAxisIncludesZero,
  resolvePathAxisLayoutForMembers,
} from '../path-axis-layout';
import { maxRenderableBubbleMagnitude } from '../data-point-values';
import {
  isCartesianVisualSeriesType,
  resolveCartesianSeriesVisualContract,
} from '../xy-visual-contract';
import { seriesConfigForDataSeries, seriesSourceIndex } from '../../series-identity';
import { resolveBarGeometryGroups, type BarGeometryGroup } from '../bar-geometry';
import { shouldUseDateSerialCategoryAxis, shouldUseStableCategoryKeys } from '../category-axis';
import {
  effectiveShowLines,
  effectiveShowMarkers,
  isQuantitativeXSeries,
  isSupportedChartType,
  normalizeYAxisIndex,
  resolveComboSeriesType,
  shouldGroupAsBarSeries,
} from './combo-series-options';

type ExcelComboGeometry = {
  enabled: true;
  useDateSerialCategoryAxis: boolean;
  useStableCategoryKeys: boolean;
  yByAxis: Map<0 | 1, NonNullable<EncodingSpec['y']>>;
};

/**
 * Build layers for combo and dual-axis charts where each series can own its
 * chart family, x-role, y-axis binding, line visibility, and marker overlay.
 */
export function buildComboLayers(
  config: ChartConfig,
  data: ChartData,
  _rows: DataRow[],
): UnitSpec[] {
  const layers: UnitSpec[] = [];
  const seriesConfigs = config.series ?? [];
  const baseEncoding = buildEncoding(config, data);
  const xEncoding = baseEncoding.x ?? { field: 'category', type: 'nominal' as const };
  const yEncoding = baseEncoding.y ?? { field: VALUE_FIELD, type: 'quantitative' as const };
  const barGeometryGroups = resolveBarGeometryGroups(config, data);
  const emittedBarGroups = new Set<string>();
  const emittedAreaGroups = new Set<string>();
  const excelGeometry = buildExcelComboGeometry({
    config,
    data,
    seriesConfigs,
    baseY: yEncoding,
    barGeometryGroups,
  });

  for (let i = 0; i < data.series.length; i += 1) {
    const series = data.series[i];
    const seriesConf = seriesConfigForDataSeries(series, seriesConfigs, i);
    const sourceSeriesIndex = seriesSourceIndex(series, i);
    const rawSeriesType = resolveComboSeriesType(config, series, seriesConf, i);
    if (!isSupportedChartType(rawSeriesType)) continue;

    const markType = MARK_TYPE_MAP[rawSeriesType];
    const encoding = buildSeriesEncoding({
      config,
      data,
      baseEncoding,
      baseX: xEncoding,
      baseY: yEncoding,
      seriesConf,
      values: series.data
        .map((point) => point?.y)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)),
      seriesYAxisIndex: series.yAxisIndex,
      seriesType: rawSeriesType,
      excelGeometry,
    });
    const filter = seriesFilter(i);
    const visual = isCartesianVisualSeriesType(rawSeriesType)
      ? resolveCartesianSeriesVisualContract({
          config,
          seriesType: rawSeriesType,
          seriesConfig: seriesConf,
          sourceSeriesIndex,
        })
      : undefined;
    const sourceShowLine =
      visual?.sourceShowLines ?? effectiveShowLines(seriesConf, rawSeriesType, config);
    const showLine = visual?.lineVisibleInk ?? sourceShowLine;
    const showMarkers =
      visual?.markerVisibleInk ??
      effectiveShowMarkers(seriesConf, rawSeriesType, config, !sourceShowLine);

    if (markType === 'bar' && shouldGroupAsBarSeries(rawSeriesType)) {
      const barGroup = barGeometryGroups.find((group) => group.seriesIndices.includes(i));
      if (!barGroup || emittedBarGroups.has(barGroup.key)) continue;
      emittedBarGroups.add(barGroup.key);

      layers.push(
        buildBarGroupLayer({
          data,
          baseEncoding,
          encoding,
          group: barGroup,
          useSharedValueScale: excelGeometry?.enabled === true,
        }),
      );
      continue;
    }

    if (markType === 'area' && shouldGroupAsStackedAreaSeries(config, rawSeriesType)) {
      const yAxisIndex = normalizeYAxisIndex(seriesConf?.yAxisIndex ?? series.yAxisIndex);
      const xRole = isQuantitativeXSeries(seriesConf, rawSeriesType, config)
        ? 'quantitative'
        : 'category';
      const memberIndices = stackedAreaGroupMemberIndices({
        config,
        data,
        seriesConfigs,
        yAxisIndex,
        xRole,
      });

      if (memberIndices.length >= 1 && memberIndices.includes(i)) {
        const groupKey = `area:${yAxisIndex ?? 0}:${xRole}`;
        if (memberIndices[0] === i && !emittedAreaGroups.has(groupKey)) {
          emittedAreaGroups.add(groupKey);
          layers.push(
            buildAreaGroupLayer({
              config,
              data,
              baseEncoding,
              encoding,
              memberIndices,
              useSharedValueScale: excelGeometry?.enabled === true,
            }),
          );
        }
        if (showMarkers) {
          layers.push(
            buildMarkerLayer(
              config,
              seriesConf,
              sourceSeriesIndex,
              rawSeriesType,
              encoding,
              filter,
            ),
          );
        }
        continue;
      }
    }

    if (markType === 'point') {
      if (rawSeriesType === 'bubble') {
        if (showLine) {
          const lineEncoding = { ...encoding };
          delete lineEncoding.size;
          layers.push(
            buildMainLayer(
              'line',
              config,
              seriesConf,
              sourceSeriesIndex,
              rawSeriesType,
              lineEncoding,
              filter,
            ),
          );
        }
        if (visual?.bubbleVisibleInk !== false) {
          layers.push(
            buildMainLayer(
              'point',
              config,
              seriesConf,
              sourceSeriesIndex,
              rawSeriesType,
              encoding,
              filter,
            ),
          );
        }
        continue;
      }
      if (showLine) {
        layers.push(
          buildMainLayer(
            'line',
            config,
            seriesConf,
            sourceSeriesIndex,
            rawSeriesType,
            encoding,
            filter,
          ),
        );
      }
      if (showMarkers) {
        layers.push(
          buildMarkerLayer(config, seriesConf, sourceSeriesIndex, rawSeriesType, encoding, filter),
        );
      }
      continue;
    }

    if ((markType === 'line' || markType === 'area') && !showLine) {
      if (showMarkers) {
        layers.push(
          buildMarkerLayer(config, seriesConf, sourceSeriesIndex, rawSeriesType, encoding, filter),
        );
      }
      continue;
    }

    layers.push(
      buildMainLayer(
        markType,
        config,
        seriesConf,
        sourceSeriesIndex,
        rawSeriesType,
        encoding,
        filter,
      ),
    );
    if ((markType === 'line' || markType === 'area') && showMarkers) {
      layers.push(
        buildMarkerLayer(config, seriesConf, sourceSeriesIndex, rawSeriesType, encoding, filter),
      );
    }
  }

  return layers;
}

function buildSeriesEncoding(input: {
  config: ChartConfig;
  data: ChartData;
  baseEncoding: EncodingSpec;
  baseX: NonNullable<EncodingSpec['x']>;
  baseY: NonNullable<EncodingSpec['y']>;
  seriesConf: SeriesConfig | undefined;
  values: number[];
  seriesYAxisIndex: 0 | 1 | undefined;
  seriesType: ChartType;
  excelGeometry: ExcelComboGeometry | undefined;
}): EncodingSpec {
  const yAxisIndex = normalizeYAxisIndex(input.seriesConf?.yAxisIndex ?? input.seriesYAxisIndex);
  const plannedY = input.excelGeometry?.yByAxis.get(yAxisIndex ?? 0);
  const encoding: EncodingSpec = {
    x: seriesXEncoding(input),
    y: plannedY
      ? cloneChannel(plannedY)
      : { ...input.baseY, field: VALUE_FIELD, type: 'quantitative' },
  };
  if (input.baseEncoding.color) {
    encoding.color = { ...cloneChannel(input.baseEncoding.color), legend: null };
  }
  if (input.baseEncoding.opacity) {
    encoding.opacity = cloneChannel(input.baseEncoding.opacity);
  }
  if (input.seriesType === 'bubble') {
    encoding.size = {
      field: BUBBLE_SIZE_FIELD,
      type: 'quantitative',
      scale: {
        range: [0, bubbleMaxArea(input.config)],
        ...(input.excelGeometry
          ? { domain: [0, maxRenderableBubbleMagnitude(input.data, input.config)] }
          : {}),
      },
      legend: null,
    };
  }

  if (!plannedY && yAxisIndex === 1) {
    const secondaryAxis =
      input.config.axis?.secondaryValueAxis ?? input.config.axis?.secondaryYAxis;
    const secondaryAxisSpec = secondaryAxis
      ? mapAxisConfigToAxisSpec(secondaryAxis, input.config, 'secondaryValueAxis')
      : {};
    encoding.y = {
      field: VALUE_FIELD,
      type: 'quantitative',
      axis: {
        ...secondaryAxisSpec,
        orient: 'right',
        grid: secondaryAxisSpec.grid ?? false,
        title: secondaryAxisSpec.title ?? secondaryAxis?.title ?? null,
      },
    };
    if (secondaryAxis) {
      const scaleSpec = buildAxisScaleSpec(secondaryAxis, false);
      if (scaleSpec) encoding.y.scale = scaleSpec;
    }
  }

  if (plannedY) {
    applyAutomaticCategoryAxisCrossing(encoding);
    return encoding;
  }

  if (encoding.x?.field === SCATTER_X_FIELD) {
    applyAutoValueAxisTicks(encoding.x);
  }
  if (encoding.y?.field === VALUE_FIELD) {
    const includeZero = !isQuantitativeXSeries(input.seriesConf, input.seriesType, input.config);
    applyAutoValueAxisTicks(encoding.y, { includeZero });
    applyMogAutoValueAxisScale(encoding.y, input.values, { includeZero });
    applyAutomaticCategoryAxisCrossing(encoding);
  }

  return encoding;
}

function seriesXEncoding(input: {
  config: ChartConfig;
  data: ChartData;
  baseX: NonNullable<EncodingSpec['x']>;
  seriesConf: SeriesConfig | undefined;
  seriesType: ChartType;
  excelGeometry: ExcelComboGeometry | undefined;
}): NonNullable<EncodingSpec['x']> {
  if (isQuantitativeXSeries(input.seriesConf, input.seriesType, input.config)) {
    return input.excelGeometry
      ? excelQuantitativeXEncoding({
          config: input.config,
          data: input.data,
        })
      : quantitativeXEncoding(input.baseX);
  }

  if (
    input.excelGeometry &&
    !input.excelGeometry.useDateSerialCategoryAxis &&
    MARK_TYPE_MAP[input.seriesType] !== 'bar'
  ) {
    return excelCategoryPointEncoding(input.baseX, input.config, input.data, {
      isHorizontal: false,
      useStableCategoryKeys: input.excelGeometry.useStableCategoryKeys,
      seriesType: input.seriesType,
    }) as NonNullable<EncodingSpec['x']>;
  }

  return { ...input.baseX };
}

function quantitativeXEncoding(
  baseX: NonNullable<EncodingSpec['x']>,
): NonNullable<EncodingSpec['x']> {
  return {
    field: SCATTER_X_FIELD,
    type: 'quantitative',
    axis: baseX.axis,
    scale: { zero: false, nice: true, ...(baseX.scale ?? {}) },
  };
}

function buildMainLayer(
  markType: MarkType,
  config: ChartConfig,
  seriesConf: SeriesConfig | undefined,
  seriesIndex: number,
  seriesType: ChartType,
  encoding: EncodingSpec,
  filter: Transform,
): UnitSpec {
  const mark = buildSeriesMark(markType, seriesConf, seriesIndex, seriesType, config);
  delete mark.point;
  if (markType === 'line' && (seriesConf?.smooth ?? config.smoothLines)) {
    mark.interpolate = 'monotone';
  }
  const finalMark = withExcelCartesianGeometryMark(mark, config, { yChannel: encoding.y });
  return {
    mark: finalMark,
    encoding,
    transform: [filter],
  };
}

function buildMarkerLayer(
  config: ChartConfig,
  seriesConf: SeriesConfig | undefined,
  seriesIndex: number,
  seriesType: ChartType,
  encoding: EncodingSpec,
  filter: Transform,
): UnitSpec {
  const mark = buildSeriesMark('point', seriesConf, seriesIndex, seriesType, config);
  return {
    mark: {
      ...mark,
      type: 'point',
      strokeWidth: mark.strokeWidth ?? 1,
      strokeWidthField: MARKER_STROKE_WIDTH_FIELD,
      ...(encoding.x?.field === SCATTER_X_FIELD ? { skipInvalidPositions: true } : {}),
    },
    encoding: {
      x: encoding.x,
      y: encoding.y,
      size: { field: MARKER_SIZE_FIELD, type: 'quantitative', scale: null, legend: null },
      shape: { field: MARKER_SHAPE_FIELD, type: 'nominal', legend: null },
      fill: { field: MARKER_FILL_FIELD, type: 'nominal', legend: null },
      stroke: { field: MARKER_STROKE_FIELD, type: 'nominal', legend: null },
    },
    transform: [filter, { type: 'filter', filter: { field: MARKER_VISIBLE_FIELD, equal: true } }],
  };
}

function buildAreaGroupLayer(input: {
  config: ChartConfig;
  data: ChartData;
  baseEncoding: EncodingSpec;
  encoding: EncodingSpec;
  memberIndices: number[];
  useSharedValueScale?: boolean;
}): UnitSpec {
  const encoding: EncodingSpec = {
    ...input.encoding,
    y: input.useSharedValueScale
      ? input.encoding.y
      : withAreaGroupValueScale(input.encoding.y, input.config, input.data, input.memberIndices),
    detail: { field: SERIES_INDEX_FIELD, type: 'nominal', legend: null },
    ...(input.baseEncoding.color ? { color: { ...input.baseEncoding.color, legend: null } } : {}),
    ...(input.baseEncoding.opacity ? { opacity: { ...input.baseEncoding.opacity } } : {}),
  };
  applyAutomaticCategoryAxisCrossing(encoding);
  const mark = withExcelCartesianGeometryMark(
    {
      type: 'area',
      fillField: SERIES_FILL_FIELD,
      strokeField: SERIES_STROKE_FIELD,
      strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
    },
    input.config,
    { yChannel: encoding.y, data: input.data },
  );

  return {
    mark,
    encoding,
    transform: [
      { type: 'filter', filter: { field: SERIES_INDEX_FIELD, oneOf: input.memberIndices } },
    ],
  };
}

function buildBarGroupLayer(input: {
  data: ChartData;
  baseEncoding: EncodingSpec;
  encoding: EncodingSpec;
  group: BarGeometryGroup;
  useSharedValueScale?: boolean;
}): UnitSpec {
  const memberIndices = input.group.seriesIndices;

  const encoding: EncodingSpec = {
    ...input.encoding,
    y: input.useSharedValueScale
      ? input.encoding.y
      : withBarGroupValueScale(
          input.encoding.y,
          input.data,
          memberIndices,
          input.group.geometry.grouping,
        ),
    ...(input.baseEncoding.color ? { color: { ...input.baseEncoding.color, legend: null } } : {}),
    ...(input.baseEncoding.opacity ? { opacity: { ...input.baseEncoding.opacity } } : {}),
  };
  applyAutomaticCategoryAxisCrossing(encoding);

  return {
    mark: {
      type: 'bar',
      fillField: SERIES_FILL_FIELD,
      strokeField: SERIES_STROKE_FIELD,
      strokeWidthField: SERIES_STROKE_WIDTH_FIELD,
    },
    encoding,
    config: barGroupLayerConfig(input.group),
    transform: [{ type: 'filter', filter: { field: SERIES_INDEX_FIELD, oneOf: memberIndices } }],
  };
}

function barGroupLayerConfig(group: BarGeometryGroup): ConfigSpec {
  const stack = stackModeForBarGeometryGrouping(group.geometry.grouping);
  return {
    ...(stack ? { stack } : {}),
    barGeometry: group.geometry,
  };
}

function stackModeForBarGeometryGrouping(
  grouping: BarGeometryGroup['geometry']['grouping'],
): ConfigSpec['stack'] | undefined {
  if (grouping === 'percentStacked') return 'normalize';
  if (grouping === 'stacked') return 'zero';
  return undefined;
}

function shouldGroupAsStackedAreaSeries(config: ChartConfig, seriesType: ChartType): boolean {
  return MARK_TYPE_MAP[seriesType] === 'area' && resolveStackMode(config) !== undefined;
}

function comboSeriesGeometryRole(
  config: ChartConfig,
  seriesType: ChartType,
  seriesConf: SeriesConfig | undefined,
  sourceSeriesIndex: number,
): {
  geometryBearing: boolean;
  inkVisible: boolean;
  legendVisible: boolean;
  axisDomainBearing: boolean;
  valueAxisIncludesZero: boolean;
} {
  const markType = MARK_TYPE_MAP[seriesType];
  const visual = isCartesianVisualSeriesType(seriesType)
    ? resolveCartesianSeriesVisualContract({
        config,
        seriesType,
        seriesConfig: seriesConf,
        sourceSeriesIndex,
      })
    : undefined;
  const sourceShowLine =
    visual?.sourceShowLines ?? effectiveShowLines(seriesConf, seriesType, config);
  const showLine = visual?.lineVisibleInk ?? sourceShowLine;
  const showMarkers =
    visual?.markerVisibleInk ??
    effectiveShowMarkers(seriesConf, seriesType, config, !sourceShowLine);
  const showBubble = visual?.bubbleVisibleInk === true;
  const noFillNoLine = isNoFillNoLineSeries(seriesConf);
  const stackAreaBearing = shouldGroupAsStackedAreaSeries(config, seriesType);
  const inkVisible = !noFillNoLine && (showLine || showMarkers || showBubble || markType === 'bar');
  const geometryBearing = stackAreaBearing || inkVisible;

  return {
    geometryBearing,
    inkVisible,
    legendVisible: !noFillNoLine,
    axisDomainBearing: geometryBearing,
    valueAxisIncludesZero: markType === 'bar' || markType === 'area' || stackAreaBearing,
  };
}

function stackedAreaGroupMemberIndices(input: {
  config: ChartConfig;
  data: ChartData;
  seriesConfigs: SeriesConfig[];
  yAxisIndex: 0 | 1 | undefined;
  xRole: 'category' | 'quantitative';
}): number[] {
  return input.data.series
    .map((series, index) => {
      const seriesConf = seriesConfigForDataSeries(series, input.seriesConfigs, index);
      const sourceSeriesIndex = seriesSourceIndex(series, index);
      const rawSeriesType = resolveComboSeriesType(input.config, series, seriesConf, index);
      const yAxisIndex = normalizeYAxisIndex(seriesConf?.yAxisIndex ?? series.yAxisIndex);
      const xRole =
        rawSeriesType && isSupportedChartType(rawSeriesType)
          ? isQuantitativeXSeries(seriesConf, rawSeriesType, input.config)
            ? 'quantitative'
            : 'category'
          : undefined;
      return { index, rawSeriesType, seriesConf, sourceSeriesIndex, yAxisIndex, xRole };
    })
    .filter(
      (
        item,
      ): item is {
        index: number;
        rawSeriesType: ChartType;
        seriesConf: SeriesConfig | undefined;
        sourceSeriesIndex: number;
        yAxisIndex: 0 | 1 | undefined;
        xRole: 'category' | 'quantitative';
      } =>
        isSupportedChartType(item.rawSeriesType) &&
        shouldGroupAsStackedAreaSeries(input.config, item.rawSeriesType) &&
        comboSeriesGeometryRole(
          input.config,
          item.rawSeriesType,
          item.seriesConf,
          item.sourceSeriesIndex,
        )
          .geometryBearing &&
        (item.yAxisIndex ?? 0) === (input.yAxisIndex ?? 0) &&
        item.xRole === input.xRole,
    )
    .map((item) => item.index);
}

function withAreaGroupValueScale(
  y: EncodingSpec['y'],
  config: ChartConfig,
  data: ChartData,
  memberIndices: number[],
): EncodingSpec['y'] {
  if (!y) return y;
  const adjusted = { ...y };
  if (hasExplicitScaleDomain(adjusted)) return adjusted;

  if (resolveStackMode(config) === 'normalize') {
    const domain = percentStackedMemberDomain(data, memberIndices);
    adjusted.scale = { ...(adjusted.scale ?? {}), domain, nice: false };
    return adjusted;
  }

  applyMogAutoValueAxisScale(adjusted, stackedMemberValues(data, memberIndices), {
    includeZero: true,
  });
  return adjusted;
}

function withBarGroupValueScale(
  y: EncodingSpec['y'],
  data: ChartData,
  memberIndices: number[],
  grouping: BarGeometryGroup['geometry']['grouping'],
): EncodingSpec['y'] {
  if (!y) return y;
  const adjusted = { ...y };
  if (hasExplicitScaleDomain(adjusted)) return adjusted;

  if (grouping === 'percentStacked') {
    adjusted.scale = {
      ...(adjusted.scale ?? {}),
      domain: percentStackedMemberDomain(data, memberIndices),
      nice: false,
    };
    return adjusted;
  }

  const values =
    grouping === 'stacked'
      ? stackedMemberValues(data, memberIndices)
      : memberValues(data, memberIndices);
  applyMogAutoValueAxisScale(adjusted, values, { includeZero: true });
  return adjusted;
}

function hasExplicitScaleDomain(y: NonNullable<EncodingSpec['y']>): boolean {
  return Array.isArray(y.scale?.domain);
}

function percentStackedMemberDomain(data: ChartData, memberIndices: number[]): [number, number] {
  const memberSet = new Set(memberIndices);
  let hasPositive = false;
  let hasNegative = false;
  for (let pointIndex = 0; pointIndex < data.categories.length; pointIndex += 1) {
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

function stackedMemberValues(data: ChartData, memberIndices: number[]): number[] {
  const memberSet = new Set(memberIndices);
  const values: number[] = [];
  for (let pointIndex = 0; pointIndex < data.categories.length; pointIndex += 1) {
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

function memberValues(data: ChartData, memberIndices: number[]): number[] {
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

function buildExcelComboGeometry(input: {
  config: ChartConfig;
  data: ChartData;
  seriesConfigs: SeriesConfig[];
  baseY: NonNullable<EncodingSpec['y']>;
  barGeometryGroups: BarGeometryGroup[];
}): ExcelComboGeometry | undefined {
  if (!usesExcelCartesianGeometry(input.config)) return undefined;

  const useDateSerialCategoryAxis = shouldUseDateSerialCategoryAxis(input.config, input.data, false);
  const useStableCategoryKeys = shouldUseStableCategoryKeys(
    input.config,
    input.data,
    useDateSerialCategoryAxis,
  );
  const membersByAxis = new Map<0 | 1, number[]>();
  const pathMembersByAxis = new Map<0 | 1, number[]>();
  const includeZeroByAxis = new Map<0 | 1, boolean>();

  input.data.series.forEach((series, index) => {
    const seriesConf = seriesConfigForDataSeries(series, input.seriesConfigs, index);
    const sourceSeriesIndex = seriesSourceIndex(series, index);
    const rawSeriesType = resolveComboSeriesType(input.config, series, seriesConf, index);
    if (!isSupportedChartType(rawSeriesType)) return;
    const role = comboSeriesGeometryRole(
      input.config,
      rawSeriesType,
      seriesConf,
      sourceSeriesIndex,
    );
    if (!role.axisDomainBearing) return;

    const axisIndex = normalizeYAxisIndex(seriesConf?.yAxisIndex ?? series.yAxisIndex) ?? 0;
    const members = membersByAxis.get(axisIndex) ?? [];
    members.push(index);
    membersByAxis.set(axisIndex, members);
    if (isPathLikeChartType(rawSeriesType)) {
      const pathMembers = pathMembersByAxis.get(axisIndex) ?? [];
      pathMembers.push(index);
      pathMembersByAxis.set(axisIndex, pathMembers);
    }
    includeZeroByAxis.set(
      axisIndex,
      (includeZeroByAxis.get(axisIndex) ?? false) || role.valueAxisIncludesZero,
    );
  });

  const yByAxis = new Map<0 | 1, NonNullable<EncodingSpec['y']>>();
  for (const [axisIndex, memberIndices] of membersByAxis) {
    const channel = excelValueEncodingForAxis({
      config: input.config,
      baseY: input.baseY,
      axisIndex,
      values: comboAxisValues(input.config, input.data, memberIndices),
      includeZero: includeZeroByAxis.get(axisIndex) ?? false,
    }) as NonNullable<EncodingSpec['y']>;
    const pathMemberIndices = pathMembersByAxis.get(axisIndex) ?? [];
    if (pathMemberIndices.length > 0) {
      const stackMode = pathStackModeForMemberIndices(
        input.config,
        input.data,
        pathMemberIndices,
      );
      const stackedAreaMembers = comboStackedAreaMemberIndices(
        input.config,
        input.data,
        pathMemberIndices,
      );
      const hasMixedStackPathMembers =
        stackedAreaMembers.length > 0 &&
        nonStackedMemberIndices(pathMemberIndices, stackedAreaMembers).length > 0;
      const layout = resolvePathAxisLayoutForMembers({
        config: input.config,
        data: input.data,
        memberIndices: pathMemberIndices,
        axisIndex,
        stackMode,
        includeZero: pathValueAxisIncludesZero(
          input.config,
          input.data,
          pathMemberIndices,
          stackMode,
        ),
      });
      applyPathValueAxisLayout(
        channel,
        hasMixedStackPathMembers ? withoutPathValueScaleLayout(layout) : layout,
      );
    }
    const barGroup = input.barGeometryGroups.find(
      (group) => (group.yAxisIndex ?? 0) === axisIndex,
    );
    if (barGroup?.geometry.grouping === 'percentStacked') {
      applyBarGeometryValueAxisLayout(channel, barGroup.geometry);
    }
    yByAxis.set(axisIndex, channel);
  }

  return {
    enabled: true,
    useDateSerialCategoryAxis,
    useStableCategoryKeys,
    yByAxis,
  };
}

function comboAxisValues(
  config: ChartConfig,
  data: ChartData,
  memberIndices: number[],
): number[] {
  const stackMode = pathStackModeForMemberIndices(config, data, memberIndices);
  const stackedAreaMembers = comboStackedAreaMemberIndices(config, data, memberIndices);
  if (stackMode === 'normalize' && stackedAreaMembers.length > 0) {
    return [
      ...chartValueValues(data, nonStackedMemberIndices(memberIndices, stackedAreaMembers)),
      ...percentStackedMemberDomain(data, stackedAreaMembers),
    ];
  }
  if (stackMode === 'zero') {
    return [
      ...chartValueValues(data, memberIndices),
      ...stackedMemberValues(data, stackedAreaMembers.length > 0 ? stackedAreaMembers : memberIndices),
    ];
  }
  return chartValueValues(data, memberIndices);
}

function withoutPathValueScaleLayout(
  layout: ReturnType<typeof resolvePathAxisLayoutForMembers>,
): ReturnType<typeof resolvePathAxisLayoutForMembers> {
  const rest = { ...layout };
  delete rest.valueAxisDomain;
  delete rest.valueAxisTickStep;
  delete rest.valueAxisTickCount;
  return rest;
}

function comboStackedAreaMemberIndices(
  config: ChartConfig,
  data: ChartData,
  memberIndices: number[],
): number[] {
  if (!resolveStackMode(config)) return [];
  const memberSet = new Set(memberIndices);
  return data.series.flatMap((series, index) => {
    if (!memberSet.has(index)) return [];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], index);
    const seriesType = resolveComboSeriesType(config, series, seriesConfig, index);
    if (!isSupportedChartType(seriesType)) return [];
    return shouldGroupAsStackedAreaSeries(config, seriesType) ? [index] : [];
  });
}

function nonStackedMemberIndices(
  memberIndices: number[],
  stackedAreaMembers: number[],
): number[] {
  if (stackedAreaMembers.length === 0) return memberIndices;
  const stackedSet = new Set(stackedAreaMembers);
  return memberIndices.filter((index) => !stackedSet.has(index));
}

function cloneChannel(channel: ChannelSpec): ChannelSpec {
  return {
    ...channel,
    ...(channel.axis ? { axis: { ...channel.axis } } : {}),
    ...(channel.secondaryAxis ? { secondaryAxis: { ...channel.secondaryAxis } } : {}),
    ...(channel.scale ? { scale: { ...channel.scale } } : {}),
  };
}

function bubbleMaxArea(config: ChartConfig): number {
  const scale = typeof config.bubbleScale === 'number' ? config.bubbleScale : 100;
  return 6400 * (Math.max(0, Math.min(300, scale)) / 100);
}

function seriesFilter(seriesIndex: number): Transform {
  return { type: 'filter', filter: { field: SERIES_INDEX_FIELD, equal: seriesIndex } };
}
