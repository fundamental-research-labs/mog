import type {
  ChartConfig,
  ChartData,
  ChartDataPoint,
  ChartDataSeries,
  ChartFormat,
  ChartStyleDiagnostic,
  DataLabelConfig,
  SeriesConfig,
} from '../../types';
import { renderedPointValueForRows } from './data-point-values';
import {
  CATEGORY_FIELD,
  PIE_COLOR_KEY_FIELD,
  PIE_LEGEND_KEY_FIELD,
  PIE_POINT_KEY_FIELD,
  POINT_FILL_FIELD,
  POINT_INDEX_FIELD,
  PIE_SLICE_CENTER_X_FIELD,
  PIE_SLICE_CENTER_Y_FIELD,
  PIE_SLICE_END_ANGLE_FIELD,
  PIE_SLICE_EXPLOSION_PERCENT_FIELD,
  PIE_SLICE_INNER_RADIUS_RATIO_FIELD,
  PIE_SLICE_MID_ANGLE_FIELD,
  PIE_SLICE_OUTER_RADIUS_RATIO_FIELD,
  PIE_SLICE_RING_INDEX_FIELD,
  PIE_SLICE_START_ANGLE_FIELD,
  SERIES_FILL_FIELD,
  SERIES_INDEX_FIELD,
  SOURCE_SERIES_INDEX_FIELD,
  SOURCE_SERIES_KEY_FIELD,
  VALUE_FIELD,
} from './fields';
import { isLegendShown } from './legend-spec';
import {
  defaultPieLikeExplosionPercent,
  doughnutInnerRadiusRatio,
  doughnutRingBand,
  effectivePieLikeExplosionPercent,
  firstSliceAngleRadians,
  isDoughnutLikeChartType,
  isPie3DLikeChartType,
  isPieLikeChartType,
  pieDoughnutArcFrame,
  pieDoughnutExplosionOffset,
  type PieDoughnutLayoutAuthority,
  pieLikeAngleUnitVector,
  pieLikeSliceGeometries,
  type PieDoughnutLayoutHints,
  type PieDoughnutLayoutReservation,
  type PieDoughnutPlotArea,
  type PieDoughnutStyleContextReservationMode,
  type PieDoughnutStyleContextStatus,
  type PieDoughnutVisualStatus,
} from './pie-like';
import { isNoFillNoLineSeries, resolvedCategoryColors } from './style';
import { linePointsToCanvasPx } from './units';
import {
  seriesConfigSourceIndex,
  seriesConfigForDataSeries,
  seriesSourceIndex,
  seriesSourceKey,
} from '../series-identity';
import { mergeChartFormats, resolveChartOwnerFormat } from '../style-resolver';

export type PieDoughnutGeometryFamily =
  | 'pie'
  | 'doughnut'
  | 'ofPie'
  | 'pie3dApproximation';

export interface PieDoughnutGeometrySlice {
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  pointIndex: number;
  pointKey: string;
  legendKey: string;
  colorKey: string;
  displayLabel: string;
  category: string | number | null;
  value: number;
  sanitizedValue: number;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  angle: number;
  centerX: number;
  centerY: number;
  explodedCenterX: number;
  explodedCenterY: number;
  innerRadius: number;
  outerRadius: number;
  innerRadiusRatio: number;
  outerRadiusRatio: number;
  explosionPercent: number;
  explosionOffset: number;
  x: number;
  y: number;
  arcBox: PieDoughnutPlotArea;
  fill?: string;
  visible: boolean;
}

export interface PieDoughnutGeometryRing {
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  ringIndex: number;
  innerRadius: number;
  outerRadius: number;
  innerRadiusRatio: number;
  outerRadiusRatio: number;
  slices: PieDoughnutGeometrySlice[];
}

export interface PieDoughnutGeometry {
  coordinateSystem: 'chartPixel';
  chartWidth: number;
  chartHeight: number;
  plotArea: PieDoughnutPlotArea;
  availableContentRect: PieDoughnutPlotArea;
  legendReservation: PieDoughnutLayoutReservation;
  labelReservation: PieDoughnutLayoutReservation;
  explosionReservation: PieDoughnutLayoutReservation;
  styleReservation: PieDoughnutLayoutReservation;
  arcBox: PieDoughnutPlotArea;
  family: PieDoughnutGeometryFamily;
  startAngle: number;
  clockwise: true;
  holeSize?: number;
  innerRadiusRatio: number;
  ringCount: number;
  centerX: number;
  centerY: number;
  rawRadius: number;
  radius: number;
  padding: number;
  layoutAuthority: PieDoughnutLayoutAuthority;
  manualArcInsetProfile?: string;
  manualArcInsetStatus?: PieDoughnutVisualStatus;
  manualArcInsetStatusReason?: string;
  arcFrameStatus: PieDoughnutVisualStatus;
  arcFrameStatusReason?: string;
  radiusStatus: PieDoughnutVisualStatus;
  radiusStatusReason?: string;
  legendLayoutStatus: PieDoughnutVisualStatus;
  legendLayoutStatusReason?: string;
  labelLayoutStatus: PieDoughnutVisualStatus;
  labelLayoutStatusReason?: string;
  explosionLayoutStatus: PieDoughnutVisualStatus;
  explosionLayoutStatusReason?: string;
  styleFootprintStatus: PieDoughnutVisualStatus;
  styleFootprintStatusReason?: string;
  sliceStyleStatus: PieDoughnutVisualStatus;
  sliceStyleStatusReason?: string;
  hasChartStyleContext?: boolean;
  styleContextStatus?: PieDoughnutStyleContextStatus;
  styleContextReason?: string;
  styleContextEffectFlags?: string[];
  unmodeledStyleOwnerKeys?: string[];
  styleContextReservationMode?: PieDoughnutStyleContextReservationMode;
  modeledStyleContextEffectBleed?: number;
  ringBandStatus: PieDoughnutVisualStatus;
  ringBandStatusReason?: string;
  holeSizeStatus: PieDoughnutVisualStatus;
  holeSizeStatusReason?: string;
  ringOrderStatus: PieDoughnutVisualStatus;
  ringOrderStatusReason?: string;
  rings: PieDoughnutGeometryRing[];
}

export interface PieDoughnutGeometryInput {
  config: ChartConfig;
  data: ChartData;
  chartWidth: number;
  chartHeight: number;
  plotArea: PieDoughnutPlotArea;
  layoutHints?: PieDoughnutLayoutHints;
  includeSeries?: (input: {
    seriesConfig: SeriesConfig | undefined;
    dataSeries: ChartDataSeries;
    seriesIndex: number;
  }) => boolean;
}

interface SliceInput {
  seriesConfig: SeriesConfig | undefined;
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
  pointIndex: number;
  pointKey: string;
  legendKey: string;
  colorKey: string;
  category: string | number | null;
  value: number;
  fill?: string;
}

type VisiblePieDoughnutSeries = Array<{
  series: ChartDataSeries;
  seriesConfig: SeriesConfig | undefined;
  seriesIndex: number;
  sourceSeriesIndex: number;
  sourceSeriesKey: string;
}>;

export function buildPieDoughnutGeometry(
  input: PieDoughnutGeometryInput,
): PieDoughnutGeometry | undefined {
  const { config, data } = input;
  if (!isPieLikeChartType(config.type)) return undefined;

  const frame = pieDoughnutArcFrame(input.plotArea, input.layoutHints);
  const visibleSeries = visiblePieDoughnutSeries(input);
  const family = pieDoughnutFamily(config);
  const startAngle = firstSliceAngleRadians(config);
  const holeRatio = doughnutInnerRadiusRatio(config);
  const ringInputs = ringInputsForGeometry(config, data, visibleSeries);
  const colors = resolvedCategoryColors(config, data) ?? [];
  const rings = ringInputs.map((ringInput, ringIndex) => {
    const band =
      isDoughnutLikeChartType(config.type) && ringInputs.length > 1
        ? doughnutRingBand({ config, ringCount: ringInputs.length, ringIndex })
        : { innerRadius: holeRatio, outerRadius: 1 };
    const slices = slicesForRing({
      ...input,
      ringInput,
      ringIndex,
      ringCount: ringInputs.length,
      band,
      startAngle,
      colors,
      centerX: frame.centerX,
      centerY: frame.centerY,
      maxOuterRadius: frame.radius,
    });
    return {
      seriesIndex: ringInput.seriesIndex,
      sourceSeriesIndex: ringInput.sourceSeriesIndex,
      sourceSeriesKey: ringInput.sourceSeriesKey,
      ringIndex,
      innerRadius: frame.radius * band.innerRadius,
      outerRadius: frame.radius * band.outerRadius,
      innerRadiusRatio: band.innerRadius,
      outerRadiusRatio: band.outerRadius,
      slices,
    };
  });

  return {
    coordinateSystem: 'chartPixel',
    chartWidth: input.chartWidth,
    chartHeight: input.chartHeight,
    plotArea: input.plotArea,
    availableContentRect: frame.availableContentRect,
    legendReservation: frame.legendReservation,
    labelReservation: frame.labelReservation,
    explosionReservation: frame.explosionReservation,
    styleReservation: frame.styleReservation,
    arcBox: frame.arcBox,
    family,
    startAngle,
    clockwise: true,
    ...(isDoughnutLikeChartType(config.type) ? { holeSize: Math.round(holeRatio * 100) } : {}),
    innerRadiusRatio: holeRatio,
    ringCount: rings.length,
    centerX: frame.centerX,
    centerY: frame.centerY,
    rawRadius: frame.rawRadius,
    radius: frame.radius,
    padding: frame.padding,
    layoutAuthority: frame.layoutAuthority,
    ...(frame.manualArcInsetProfile
      ? { manualArcInsetProfile: frame.manualArcInsetProfile }
      : {}),
    ...(frame.manualArcInsetStatus
      ? { manualArcInsetStatus: frame.manualArcInsetStatus }
      : {}),
    ...(frame.manualArcInsetStatusReason
      ? { manualArcInsetStatusReason: frame.manualArcInsetStatusReason }
      : {}),
    arcFrameStatus: frame.arcFrameStatus,
    ...(frame.arcFrameStatusReason ? { arcFrameStatusReason: frame.arcFrameStatusReason } : {}),
    radiusStatus: frame.radiusStatus,
    ...(frame.radiusStatusReason ? { radiusStatusReason: frame.radiusStatusReason } : {}),
    legendLayoutStatus: frame.legendLayoutStatus,
    ...(frame.legendLayoutStatusReason
      ? { legendLayoutStatusReason: frame.legendLayoutStatusReason }
      : {}),
    labelLayoutStatus: frame.labelLayoutStatus,
    ...(frame.labelLayoutStatusReason
      ? { labelLayoutStatusReason: frame.labelLayoutStatusReason }
      : {}),
    explosionLayoutStatus: frame.explosionLayoutStatus,
    ...(frame.explosionLayoutStatusReason
      ? { explosionLayoutStatusReason: frame.explosionLayoutStatusReason }
      : {}),
    styleFootprintStatus: frame.styleFootprintStatus,
    ...(frame.styleFootprintStatusReason
      ? { styleFootprintStatusReason: frame.styleFootprintStatusReason }
      : {}),
    sliceStyleStatus: frame.sliceStyleStatus,
    ...(frame.sliceStyleStatusReason
      ? { sliceStyleStatusReason: frame.sliceStyleStatusReason }
      : {}),
    ...pieDoughnutStyleContextEvidence(input.layoutHints),
    ringBandStatus: 'verifiedDefault',
    holeSizeStatus: isDoughnutLikeChartType(config.type)
      ? holeSizeStatus(config)
      : 'verifiedDefault',
    ringOrderStatus: 'verifiedDefault',
    rings,
  };
}

export function pieDoughnutRowsFromGeometry(
  geometry: PieDoughnutGeometry | undefined,
  baseRows: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  if (!geometry) return [];
  const baseRowsByKey = pieBaseRowsBySliceKey(baseRows);
  return geometry.rings.flatMap((ring) =>
    ring.slices.map((slice) => {
      const baseRow: Record<string, unknown> = baseRowsByKey.get(sliceRowKey(slice)) ?? {};
      return {
        ...baseRow,
        [CATEGORY_FIELD]: slice.category ?? '',
        [PIE_POINT_KEY_FIELD]: slice.pointKey,
        [PIE_LEGEND_KEY_FIELD]: slice.legendKey,
        [PIE_COLOR_KEY_FIELD]: slice.colorKey,
        [PIE_SLICE_RING_INDEX_FIELD]: ring.ringIndex,
        [PIE_SLICE_START_ANGLE_FIELD]: slice.startAngle,
        [PIE_SLICE_END_ANGLE_FIELD]: slice.endAngle,
        [PIE_SLICE_MID_ANGLE_FIELD]: slice.midAngle,
        [PIE_SLICE_CENTER_X_FIELD]: normalizedSliceCenterX(slice),
        [PIE_SLICE_CENTER_Y_FIELD]: normalizedSliceCenterY(slice),
        [PIE_SLICE_INNER_RADIUS_RATIO_FIELD]: slice.innerRadiusRatio,
        [PIE_SLICE_OUTER_RADIUS_RATIO_FIELD]: slice.outerRadiusRatio,
        [PIE_SLICE_EXPLOSION_PERCENT_FIELD]: slice.explosionPercent,
        [VALUE_FIELD]: slice.value,
        [POINT_INDEX_FIELD]: slice.pointIndex,
        [SERIES_INDEX_FIELD]: slice.seriesIndex,
        [SOURCE_SERIES_INDEX_FIELD]: slice.sourceSeriesIndex,
        [SOURCE_SERIES_KEY_FIELD]: slice.sourceSeriesKey,
        ...(slice.fill
          ? {
              [POINT_FILL_FIELD]:
                typeof baseRow[POINT_FILL_FIELD] === 'string'
                  ? baseRow[POINT_FILL_FIELD]
                  : slice.fill,
              [SERIES_FILL_FIELD]:
                typeof baseRow[SERIES_FILL_FIELD] === 'string'
                  ? baseRow[SERIES_FILL_FIELD]
                  : slice.fill,
            }
          : {}),
      };
    }),
  );
}

export function maxEffectivePieDoughnutExplosionPercent(
  config: ChartConfig,
  data: ChartData | undefined,
): number {
  if (!isPieLikeChartType(config.type)) return 0;
  let max = 0;
  const seriesConfigs = config.series ?? [];
  const seriesCount = data?.series.length ?? seriesConfigs.length;
  const pointCount = Math.max(
    data?.categories.length ?? 0,
    ...((data?.series ?? []).map((series) => series.data.length)),
    1,
  );
  for (let seriesIndex = 0; seriesIndex < Math.max(1, seriesCount); seriesIndex += 1) {
    const dataSeries = data?.series[seriesIndex];
    const seriesConfig = dataSeries
      ? seriesConfigForDataSeries(dataSeries, seriesConfigs, seriesIndex)
      : seriesConfigs[seriesIndex];
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const pointExplosion = seriesConfig?.points?.find((point) => point.idx === pointIndex)
        ?.explosion;
      const percent =
        effectivePieLikeExplosionPercent({
          seriesExplosion: seriesConfig?.explosion,
          pointExplosion,
          defaultExplosion: defaultPieLikeExplosionPercent(config, pointIndex),
        }) ?? 0;
      max = Math.max(max, percent);
    }
  }
  return max;
}

export function pieDoughnutLayoutHintsForConfig(
  config: ChartConfig,
  data: ChartData | undefined,
): PieDoughnutLayoutHints | undefined {
  if (!isPieLikeChartType(config.type)) return undefined;
  const outsideLabels = hasOutsidePieDoughnutLabels(config);
  const maxExplosionPercent = maxEffectivePieDoughnutExplosionPercent(config, data);
  const labelPressure = pieDoughnutLabelPressure(config, data);
  const legendMetrics = pieDoughnutLegendMetrics(data);
  const styleFootprint = pieDoughnutStyleFootprintHints(config);
  const manualLayoutSource = manualPieDoughnutLayoutSource(config);
  const ringCount = pieDoughnutRingCountForConfig(config, data);
  const holeRatio = doughnutInnerRadiusRatio(config);
  return {
    preferSquareArcPlot: true,
    family: pieDoughnutFamily(config),
    ringCount,
    ...(isDoughnutLikeChartType(config.type) ? { holeSize: Math.round(holeRatio * 100) } : {}),
    ...(manualLayoutSource
      ? { hasManualLayout: true, manualLayoutSource }
      : {}),
    ...(outsideLabels ? { outsideLabelPadding: 28, leaderLinePadding: 12 } : {}),
    ...(maxExplosionPercent > 0
      ? { explosionPaddingPercent: maxExplosionPercent, maxExplosionPercent }
      : {}),
    ...chartFrameBleedHint(config),
    ...(isLegendShown(config.legend) && data?.categories
      ? {
          legendEntryCount: data.categories.length,
          legendPosition: pieDoughnutLegendPosition(config),
          ...(legendMetrics.maxLabelLength > 0
            ? { legendMaxLabelLength: legendMetrics.maxLabelLength }
            : {}),
        }
      : { legendPosition: 'none' }),
    ...labelPressure,
    ...styleFootprint,
  };
}

function visiblePieDoughnutSeries(input: PieDoughnutGeometryInput): VisiblePieDoughnutSeries {
  const seriesConfigs = input.config.series ?? [];
  const visible: VisiblePieDoughnutSeries = [];
  for (let seriesIndex = 0; seriesIndex < input.data.series.length; seriesIndex += 1) {
    const series = input.data.series[seriesIndex];
    const seriesConfig = seriesConfigForDataSeries(series, seriesConfigs, seriesIndex);
    if (
      input.includeSeries &&
      !input.includeSeries({ seriesConfig, dataSeries: series, seriesIndex })
    ) {
      continue;
    }
    visible.push({
      series,
      seriesConfig,
      seriesIndex,
      sourceSeriesIndex: seriesSourceIndex(series, seriesIndex),
      sourceSeriesKey: seriesSourceKey(series, seriesIndex),
    });
  }
  return visible;
}

function ringInputsForGeometry(
  config: ChartConfig,
  data: ChartData,
  visibleSeries: VisiblePieDoughnutSeries,
): VisiblePieDoughnutSeries {
  if (isDoughnutLikeChartType(config.type)) {
    return visibleSeries.length > 0 ? visibleSeries : fallbackSeries(data);
  }
  return visibleSeries.length > 0 ? [visibleSeries[0]] : fallbackSeries(data);
}

function fallbackSeries(data: ChartData): VisiblePieDoughnutSeries {
  const series = data.series[0];
  if (!series) return [];
  return [
    {
      series,
      seriesConfig: undefined,
      seriesIndex: 0,
      sourceSeriesIndex: seriesSourceIndex(series, 0),
      sourceSeriesKey: seriesSourceKey(series, 0),
    },
  ];
}

function slicesForRing(input: PieDoughnutGeometryInput & {
  ringInput: VisiblePieDoughnutSeries[number];
  ringIndex: number;
  ringCount: number;
  band: { innerRadius: number; outerRadius: number };
  startAngle: number;
  colors: readonly string[];
  centerX: number;
  centerY: number;
  maxOuterRadius: number;
}): PieDoughnutGeometrySlice[] {
  const sliceInputs =
    isDoughnutLikeChartType(input.config.type)
      ? sliceInputsForSeries(input, input.ringInput)
      : sliceInputsForPie(input, input.ringInput);
  const geometries = pieLikeSliceGeometries({
    values: sliceInputs.map((slice) => slice.value),
    startAngle: input.startAngle,
    innerRadiusRatio: input.band.innerRadius,
    outerRadiusRatio: input.band.outerRadius,
  });
  return geometries.map((geometry, sliceIndex) => {
    const slice = sliceInputs[sliceIndex];
    const defaultExplosion = defaultPieLikeExplosionPercent(input.config, slice.pointIndex);
    const pointExplosion = slice.seriesConfig?.points?.find((point) => point.idx === slice.pointIndex)
      ?.explosion;
    const explosionPercent =
      effectivePieLikeExplosionPercent({
        seriesExplosion: slice.seriesConfig?.explosion,
        pointExplosion,
        defaultExplosion,
      }) ?? 0;
    const outerRadius = input.maxOuterRadius * input.band.outerRadius;
    const explosionOffset = pieDoughnutExplosionOffset(outerRadius, explosionPercent);
    const vector = pieLikeAngleUnitVector(geometry.midAngle);
    const innerRadius = input.maxOuterRadius * input.band.innerRadius;
    const arcBox = {
      x: input.centerX - outerRadius + vector.x * explosionOffset,
      y: input.centerY - outerRadius + vector.y * explosionOffset,
      width: outerRadius * 2,
      height: outerRadius * 2,
    };
    return {
      seriesIndex: slice.seriesIndex,
      sourceSeriesIndex: slice.sourceSeriesIndex,
      sourceSeriesKey: slice.sourceSeriesKey,
      pointIndex: slice.pointIndex,
      pointKey: slice.pointKey,
      legendKey: slice.legendKey,
      colorKey: slice.colorKey,
      displayLabel: pieDisplayLabel(slice.category, slice.pointIndex),
      category: slice.category,
      value: slice.value,
      sanitizedValue: Math.abs(slice.value),
      startAngle: geometry.startAngle,
      endAngle: geometry.endAngle,
      midAngle: geometry.midAngle,
      angle: geometry.angle,
      centerX: input.centerX,
      centerY: input.centerY,
      explodedCenterX: input.centerX + vector.x * explosionOffset,
      explodedCenterY: input.centerY + vector.y * explosionOffset,
      innerRadius,
      outerRadius,
      innerRadiusRatio: input.band.innerRadius,
      outerRadiusRatio: input.band.outerRadius,
      explosionPercent,
      explosionOffset,
      x: input.centerX + vector.x * explosionOffset,
      y: input.centerY + vector.y * explosionOffset,
      arcBox,
      ...(slice.fill ? { fill: slice.fill } : {}),
      visible: true,
    };
  });
}

function sliceInputsForPie(
  input: PieDoughnutGeometryInput & {
    colors: readonly string[];
  },
  series: VisiblePieDoughnutSeries[number],
): SliceInput[] {
  const pointCount = Math.max(input.data.categories.length, series.series.data.length);
  const slices: SliceInput[] = [];
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const point = series.series.data[pointIndex];
    const value = renderedPointValueForRows(point, input.config, series.seriesConfig);
    if (!point || value === null) continue;
    slices.push({
      seriesConfig: series.seriesConfig,
      seriesIndex: series.seriesIndex,
      sourceSeriesIndex: series.sourceSeriesIndex,
      sourceSeriesKey: series.sourceSeriesKey,
      pointIndex,
      pointKey: piePointKey({
        sourceSeriesKey: series.sourceSeriesKey,
        sourceSeriesIndex: series.sourceSeriesIndex,
        pointIndex,
      }),
      legendKey: pieLegendKey({ pointIndex }),
      colorKey: pieColorKey({ pointIndex }),
      category: snapshotCategory(input.data, point, pointIndex),
      value,
      fill: colorAt(input.colors, pointIndex),
    });
  }
  return slices;
}

function sliceInputsForSeries(
  input: PieDoughnutGeometryInput & {
    colors: readonly string[];
  },
  series: VisiblePieDoughnutSeries[number],
): SliceInput[] {
  const slices: SliceInput[] = [];
  for (let pointIndex = 0; pointIndex < series.series.data.length; pointIndex += 1) {
    const point = series.series.data[pointIndex];
    const value = renderedPointValueForRows(point, input.config, series.seriesConfig);
    if (!point || value === null) continue;
    slices.push({
      seriesConfig: series.seriesConfig,
      seriesIndex: series.seriesIndex,
      sourceSeriesIndex: series.sourceSeriesIndex,
      sourceSeriesKey: series.sourceSeriesKey,
      pointIndex,
      pointKey: piePointKey({
        sourceSeriesKey: series.sourceSeriesKey,
        sourceSeriesIndex: series.sourceSeriesIndex,
        pointIndex,
      }),
      legendKey: pieLegendKey({ pointIndex }),
      colorKey: pieColorKey({ pointIndex }),
      category: snapshotCategory(input.data, point, pointIndex),
      value,
      fill: colorAt(input.colors, pointIndex),
    });
  }
  return slices;
}

function snapshotCategory(
  data: ChartData,
  point: ChartDataPoint | undefined,
  pointIndex: number,
): string | number | null {
  const category = data.categories[pointIndex] ?? point?.x;
  return typeof category === 'string' || typeof category === 'number' ? category : null;
}

function colorAt(colors: readonly string[], index: number): string | undefined {
  return colors.length > 0 ? colors[index % colors.length] : undefined;
}

export function piePointKey(input: {
  sourceSeriesKey?: string;
  sourceSeriesIndex: number;
  pointIndex: number;
}): string {
  const seriesKey =
    input.sourceSeriesKey && input.sourceSeriesKey.length > 0
      ? input.sourceSeriesKey
      : `series-${input.sourceSeriesIndex}`;
  return `${seriesKey}:point-${input.pointIndex}`;
}

export function pieLegendKey(input: { pointIndex: number }): string {
  return `point-${input.pointIndex}`;
}

export function pieColorKey(input: { pointIndex: number }): string {
  return `point-${input.pointIndex}`;
}

export function pieDisplayLabel(
  category: string | number | null | undefined,
  pointIndex: number,
): string {
  if (category === undefined || category === null || String(category).length === 0) {
    return `Point ${pointIndex + 1}`;
  }
  return String(category);
}

export function pieDoughnutColorDomain(config: ChartConfig, data: ChartData): string[] {
  const geometry = buildPieDoughnutGeometry({
    config,
    data,
    chartWidth: 2,
    chartHeight: 2,
    plotArea: { x: 0, y: 0, width: 2, height: 2 },
    includeSeries: ({ seriesConfig }) => !isNoFillNoLineSeries(seriesConfig),
  });
  const domain: string[] = [];
  for (const slice of geometry?.rings.flatMap((ring) => ring.slices) ?? []) {
    if (!domain.includes(slice.colorKey)) domain.push(slice.colorKey);
  }
  return domain;
}

function normalizedSliceCenterX(
  slice: Pick<PieDoughnutGeometrySlice, 'midAngle' | 'outerRadiusRatio' | 'explosionPercent'>,
): number {
  return normalizedSliceCenter(slice).x;
}

function normalizedSliceCenterY(
  slice: Pick<PieDoughnutGeometrySlice, 'midAngle' | 'outerRadiusRatio' | 'explosionPercent'>,
): number {
  return normalizedSliceCenter(slice).y;
}

function normalizedSliceCenter(
  slice: Pick<PieDoughnutGeometrySlice, 'midAngle' | 'outerRadiusRatio' | 'explosionPercent'>,
): { x: number; y: number } {
  const vector = pieLikeAngleUnitVector(slice.midAngle);
  const offset = (slice.outerRadiusRatio / 2) * (slice.explosionPercent / 100);
  return {
    x: 0.5 + vector.x * offset,
    y: 0.5 + vector.y * offset,
  };
}

function pieBaseRowsBySliceKey(
  rows: readonly Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = rowSliceKey(row);
    if (key && !byKey.has(key)) byKey.set(key, row);
  }
  return byKey;
}

function rowSliceKey(row: Record<string, unknown>): string | undefined {
  const seriesIndex = row[SERIES_INDEX_FIELD];
  const sourceSeriesIndex = row[SOURCE_SERIES_INDEX_FIELD];
  const pointIndex = row[POINT_INDEX_FIELD];
  if (
    typeof seriesIndex !== 'number' ||
    typeof sourceSeriesIndex !== 'number' ||
    typeof pointIndex !== 'number'
  ) {
    return undefined;
  }
  return `${seriesIndex}|${sourceSeriesIndex}|${pointIndex}`;
}

function sliceRowKey(
  slice: Pick<PieDoughnutGeometrySlice, 'seriesIndex' | 'sourceSeriesIndex' | 'pointIndex'>,
): string {
  return `${slice.seriesIndex}|${slice.sourceSeriesIndex}|${slice.pointIndex}`;
}

function hasOutsidePieDoughnutLabels(config: ChartConfig): boolean {
  return dataLabelConfigs(config).some((label) => {
    if (!label || label.show === false || label.delete === true) return false;
    return (
      label.position === 'outside' ||
      label.position === 'outsideEnd' ||
      label.position === 'callout'
    );
  });
}

function dataLabelConfigs(config: ChartConfig): DataLabelConfig[] {
  const labels: DataLabelConfig[] = [];
  if (config.dataLabels) labels.push(config.dataLabels);
  for (const series of config.series ?? []) {
    if (series.dataLabels) labels.push(series.dataLabels);
    for (const point of series.points ?? []) {
      if (point.dataLabel) labels.push(point.dataLabel);
    }
  }
  return labels;
}

function pieDoughnutLabelPressure(
  config: ChartConfig,
  data: ChartData | undefined,
): Pick<
  PieDoughnutLayoutHints,
  | 'labelCount'
  | 'outsideLabelCount'
  | 'defaultLabelCount'
  | 'zeroValueLabelCount'
  | 'nearZeroValueLabelCount'
  | 'maxLabelTextLength'
> {
  const labels = dataLabelConfigs(config).filter(
    (label) => label && label.show !== false && label.delete !== true,
  );
  if (labels.length === 0 || !data) return {};

  const pointCount = Math.max(
    data.categories.length,
    ...data.series.map((series) => series.data.length),
    0,
  );
  const outsideLabelCount = labels.some((label) => isOutsideLabelPosition(label.position))
    ? pointCount
    : 0;
  const defaultLabelCount = labels.some((label) => isAutoPieDoughnutLabelPosition(label.position))
    ? pointCount
    : 0;
  const valuePressure = pieDoughnutValueLabelPressure(config, data);
  const zeroValueLabelCount = valuePressure.zeroValueLabelCount ?? 0;
  const nearZeroValueLabelCount = valuePressure.nearZeroValueLabelCount ?? 0;
  const maxLabelTextLength = Math.max(
    0,
    ...data.categories.map((category, pointIndex) =>
      estimatedLabelTextLength(config, category, pointIndex),
    ),
  );

  return {
    labelCount: pointCount,
    ...(outsideLabelCount > 0 ? { outsideLabelCount } : {}),
    ...(defaultLabelCount > 0 ? { defaultLabelCount } : {}),
    ...(zeroValueLabelCount > 0
      ? { zeroValueLabelCount }
      : {}),
    ...(nearZeroValueLabelCount > 0
      ? { nearZeroValueLabelCount }
      : {}),
    ...(maxLabelTextLength > 0 ? { maxLabelTextLength } : {}),
  };
}

function pieDoughnutValueLabelPressure(
  config: ChartConfig,
  data: ChartData,
): Pick<PieDoughnutLayoutHints, 'zeroValueLabelCount' | 'nearZeroValueLabelCount'> {
  let zeroValueLabelCount = 0;
  let nearZeroValueLabelCount = 0;
  for (let seriesIndex = 0; seriesIndex < data.series.length; seriesIndex += 1) {
    const series = data.series[seriesIndex];
    const seriesConfig = seriesConfigForDataSeries(series, config.series ?? [], seriesIndex);
    const values = series.data
      .map((point) => renderedPointValueForRows(point, config, seriesConfig))
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const total = values.reduce((sum, value) => sum + Math.abs(value), 0);
    for (const value of values) {
      const magnitude = Math.abs(value);
      if (magnitude === 0) {
        zeroValueLabelCount += 1;
      } else if (total > 0 && magnitude / total < 0.015) {
        nearZeroValueLabelCount += 1;
      }
    }
  }
  return { zeroValueLabelCount, nearZeroValueLabelCount };
}

function pieDoughnutLegendMetrics(data: ChartData | undefined): { maxLabelLength: number } {
  if (!data) return { maxLabelLength: 0 };
  return {
    maxLabelLength: Math.max(
      0,
      ...data.categories.map((category, index) => pieDisplayLabel(category, index).length),
    ),
  };
}

function estimatedLabelTextLength(
  config: ChartConfig,
  category: string | number | null | undefined,
  pointIndex: number,
): number {
  const labels = dataLabelConfigs(config);
  if (labels.length === 0) return 0;
  const label = labels.find((candidate) => candidate.show !== false && candidate.delete !== true);
  if (!label) return 0;
  if (label.text) return label.text.length;
  const parts: string[] = [];
  if (label.showSeriesName) parts.push('Series');
  if (label.showCategoryName || label.showCategory) {
    parts.push(pieDisplayLabel(category, pointIndex));
  }
  if (label.showValue) parts.push('123');
  if (label.showPercentage || label.showPercent) parts.push('100%');
  return parts.length > 0 ? parts.join(label.separator ?? ', ').length : 0;
}

function isOutsideLabelPosition(position: DataLabelConfig['position']): boolean {
  return position === 'outside' || position === 'outsideEnd' || position === 'callout';
}

function isAutoPieDoughnutLabelPosition(position: DataLabelConfig['position']): boolean {
  return position === undefined || position === 'bestFit';
}

function manualPieDoughnutLayoutSource(
  config: ChartConfig,
): PieDoughnutLayoutHints['manualLayoutSource'] | undefined {
  if (config.plotLayout !== undefined) return 'plotLayout';
  if (config.plotArea?.layout !== undefined) return 'plotAreaLayout';
  return undefined;
}

function pieDoughnutRingCountForConfig(
  config: ChartConfig,
  data: ChartData | undefined,
): number {
  if (!isDoughnutLikeChartType(config.type)) return 1;
  return Math.max(1, data?.series.length ?? config.series?.length ?? 1);
}

function pieDoughnutLegendPosition(
  config: ChartConfig,
): NonNullable<PieDoughnutLayoutHints['legendPosition']> {
  if (!isLegendShown(config.legend)) return 'none';
  if (config.legend?.overlay === true) return 'overlay';
  switch (config.legend?.position) {
    case 'left':
    case 'right':
    case 'top':
    case 'bottom':
      return config.legend.position;
    case 'custom':
      return 'custom';
    default:
      return 'right';
  }
}

function holeSizeStatus(config: ChartConfig): PieDoughnutVisualStatus {
  if (!isDoughnutLikeChartType(config.type)) return 'verifiedDefault';
  const hasExplicitHoleSize =
    config.doughnutHoleSize !== undefined ||
    (config.series ?? []).some((series) => series.doughnutHoleSize !== undefined);
  return hasExplicitHoleSize ? 'exact' : 'verifiedDefault';
}

function chartFrameBleedHint(config: ChartConfig): Pick<PieDoughnutLayoutHints, 'chartFrameBleed'> {
  const frameFormats = pieDoughnutResolvedFrameFormats(config);
  const widths = [
    linePointsToCanvasPx(frameFormats.chartArea?.line?.width),
    linePointsToCanvasPx(frameFormats.plotArea?.line?.width),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const bleed = Math.max(0, ...widths);
  return bleed > 0 ? { chartFrameBleed: bleed } : {};
}

function pieDoughnutStyleContextEvidence(
  hints: PieDoughnutLayoutHints | undefined,
): Pick<
  PieDoughnutGeometry,
  | 'hasChartStyleContext'
  | 'styleContextStatus'
  | 'styleContextReason'
  | 'styleContextEffectFlags'
  | 'unmodeledStyleOwnerKeys'
  | 'styleContextReservationMode'
  | 'modeledStyleContextEffectBleed'
> {
  if (!hints) return {};
  const styleContextEffectFlags = uniqueStrings(hints.styleContextEffectFlags ?? []);
  const unmodeledStyleOwnerKeys = uniqueStrings(hints.unmodeledStyleOwnerKeys ?? []);
  return {
    ...(hints.hasChartStyleContext ? { hasChartStyleContext: true } : {}),
    ...(hints.styleContextStatus ? { styleContextStatus: hints.styleContextStatus } : {}),
    ...(hints.styleContextReason ? { styleContextReason: hints.styleContextReason } : {}),
    ...(styleContextEffectFlags.length > 0 ? { styleContextEffectFlags } : {}),
    ...(unmodeledStyleOwnerKeys.length > 0 ? { unmodeledStyleOwnerKeys } : {}),
    ...(hints.styleContextReservationMode
      ? { styleContextReservationMode: hints.styleContextReservationMode }
      : {}),
    ...(hints.modeledStyleContextEffectBleed !== undefined
      ? { modeledStyleContextEffectBleed: hints.modeledStyleContextEffectBleed }
      : {}),
  };
}

function pieDoughnutStyleFootprintHints(
  config: ChartConfig,
): Pick<
  PieDoughnutLayoutHints,
  | 'hasRoundedFrame'
  | 'hasChartFrameShadow'
  | 'hasPlotFrameShadow'
  | 'hasFrameStyleEffect'
  | 'hasSliceStyleEffect'
  | 'styleId'
  | 'hasBuiltInStyleEffect'
  | 'hasChartStyleContext'
  | 'styleContextStatus'
  | 'styleContextReason'
  | 'styleContextEffectFlags'
  | 'unmodeledStyleOwnerKeys'
  | 'styleContextReservationMode'
  | 'modeledStyleContextEffectBleed'
> {
  const frameFormats = pieDoughnutResolvedFrameFormats(config);
  const styleContext = classifyPieDoughnutStyleContext(config);
  const builtInStyleFlags = typeof config.style === 'number' ? ['builtInChartStyle'] : [];
  const styleContextEffectFlags = uniqueStrings([
    ...(styleContext.styleContextEffectFlags ?? []),
    ...builtInStyleFlags,
  ]);
  const hasChartFrameShadow =
    hasVisibleShadow(frameFormats.chartArea?.shadow) || styleContext.hasChartFrameShadow;
  const hasPlotFrameShadow =
    hasVisibleShadow(frameFormats.plotArea?.shadow) || styleContext.hasPlotFrameShadow;
  const hasFrameStyleEffect =
    hasUnmodeledFill(frameFormats.chartArea?.fill) ||
    hasUnmodeledFill(frameFormats.plotArea?.fill) ||
    styleContext.hasFrameStyleEffect;
  const hasSliceStyleEffect =
    hasPieDoughnutSliceStyleEffect(config) || styleContext.hasSliceStyleEffect;

  return {
    ...(typeof config.style === 'number'
      ? { styleId: config.style, hasBuiltInStyleEffect: true }
      : {}),
    ...(styleContext.hasChartStyleContext ? { hasChartStyleContext: true } : {}),
    ...(styleContext.styleContextStatus && styleContext.styleContextStatus !== 'none'
      ? { styleContextStatus: styleContext.styleContextStatus }
      : {}),
    ...(styleContext.styleContextReason
      ? { styleContextReason: styleContext.styleContextReason }
      : {}),
    ...(styleContextEffectFlags.length > 0 ? { styleContextEffectFlags } : {}),
    ...(styleContext.unmodeledStyleOwnerKeys.length > 0
      ? { unmodeledStyleOwnerKeys: styleContext.unmodeledStyleOwnerKeys }
      : {}),
    ...(styleContext.styleContextReservationMode
      ? { styleContextReservationMode: styleContext.styleContextReservationMode }
      : {}),
    ...(styleContext.modeledStyleContextEffectBleed !== undefined
      ? { modeledStyleContextEffectBleed: styleContext.modeledStyleContextEffectBleed }
      : {}),
    ...(typeof config.style === 'number'
      ? {
          styleContextStatus: 'builtInChartStyleEffect' as const,
          styleContextReason: 'builtInSliceEffectUnmodeled',
        }
      : {}),
    ...(config.roundedCorners ? { hasRoundedFrame: true } : {}),
    ...(hasChartFrameShadow ? { hasChartFrameShadow: true } : {}),
    ...(hasPlotFrameShadow ? { hasPlotFrameShadow: true } : {}),
    ...(hasFrameStyleEffect ? { hasFrameStyleEffect: true } : {}),
    ...(hasSliceStyleEffect ? { hasSliceStyleEffect: true } : {}),
  };
}

interface PieDoughnutResolvedFrameFormats {
  chartArea?: ChartFormat;
  plotArea?: ChartFormat;
}

function pieDoughnutResolvedFrameFormats(
  config: ChartConfig,
): PieDoughnutResolvedFrameFormats {
  const chartFormat = mergeChartFormats(
    mergeChartFormats(
      config.chartArea?.format,
      config.chartArea?.fill ? { fill: config.chartArea.fill } : undefined,
    ),
    config.chartFormat,
  );
  const plotFormat = mergeChartFormats(
    mergeChartFormats(
      config.plotArea?.format,
      config.plotArea?.fill ? { fill: config.plotArea.fill } : undefined,
    ),
    config.plotFormat,
  );
  return {
    chartArea: resolveChartOwnerFormat(config, 'chartArea', chartFormat),
    plotArea: resolveChartOwnerFormat(config, 'plotArea', plotFormat),
  };
}

interface PieDoughnutStyleContextClassification {
  hasChartStyleContext: boolean;
  styleContextStatus?: PieDoughnutStyleContextStatus;
  styleContextReason?: string;
  styleContextEffectFlags?: string[];
  unmodeledStyleOwnerKeys: string[];
  styleContextReservationMode?: PieDoughnutStyleContextReservationMode;
  modeledStyleContextEffectBleed?: number;
  hasChartFrameShadow?: boolean;
  hasPlotFrameShadow?: boolean;
  hasFrameStyleEffect?: boolean;
  hasSliceStyleEffect?: boolean;
}

function classifyPieDoughnutStyleContext(
  config: ChartConfig,
): PieDoughnutStyleContextClassification {
  const context = config.chartStyleContext;
  if (!context) {
    return {
      hasChartStyleContext: false,
      styleContextStatus: 'none',
      unmodeledStyleOwnerKeys: [],
    };
  }

  const styleContextEffectFlags: string[] = [];
  const unmodeledStyleOwnerKeys = new Set<string>();
  let hasUnresolvedPayload = false;
  let hasFrameStyleEffect = false;
  let hasSliceStyleEffect = false;
  let hasChartFrameShadow = false;
  let hasPlotFrameShadow = false;

  if (context.colorMapOverride) {
    styleContextEffectFlags.push('colorMapOverride');
  }

  const contextDiagnostics = unmodeledStyleDiagnostics(context.diagnostics);
  if (contextDiagnostics.length > 0) {
    hasUnresolvedPayload = true;
    styleContextEffectFlags.push('styleContextDiagnostics');
    for (const diagnostic of contextDiagnostics) {
      if (diagnostic.ownerKey) unmodeledStyleOwnerKeys.add(diagnostic.ownerKey);
    }
  }

  for (const owner of context.owners ?? []) {
    const ownerKey = owner.ownerKey || 'unknownOwner';
    const ownerFlags = pieDoughnutStyleOwnerEffectFlags(ownerKey, owner.format);
    if (ownerFlags.length > 0) {
      styleContextEffectFlags.push(...ownerFlags);
      unmodeledStyleOwnerKeys.add(ownerKey);
      const ownerScope = pieDoughnutStyleOwnerScope(ownerKey);
      if (ownerScope === 'slice') {
        hasSliceStyleEffect = true;
      } else {
        hasFrameStyleEffect = true;
      }
      if (hasVisibleShadow(owner.format?.shadow)) {
        if (ownerScope === 'plotFrame') {
          hasPlotFrameShadow = true;
        } else if (ownerScope !== 'slice') {
          hasChartFrameShadow = true;
        }
      }
    } else if (owner.format) {
      styleContextEffectFlags.push(`${ownerKey}:resolvedFormat`);
    }

    if (owner.richText?.length) {
      styleContextEffectFlags.push(`${ownerKey}:richText`);
    }

    const ownerDiagnostics = unmodeledStyleDiagnostics(owner.diagnostics);
    if (ownerDiagnostics.length > 0) {
      hasUnresolvedPayload = true;
      styleContextEffectFlags.push(`${ownerKey}:diagnostics`);
      unmodeledStyleOwnerKeys.add(ownerKey);
    }

    if (hasImportedDrawingMlPayload(owner.importedDrawingMl)) {
      hasUnresolvedPayload = true;
      styleContextEffectFlags.push(`${ownerKey}:importedDrawingMl`);
      unmodeledStyleOwnerKeys.add(ownerKey);
    }
  }

  if (hasUnresolvedPayload) {
    return {
      hasChartStyleContext: true,
      styleContextStatus: 'unresolvedDrawingMlOrDiagnostics',
      styleContextReason: 'styleContextDrawingMlOrDiagnosticsUnmodeled',
      styleContextEffectFlags: uniqueStrings(styleContextEffectFlags),
      unmodeledStyleOwnerKeys: uniqueStrings([...unmodeledStyleOwnerKeys]),
      hasChartFrameShadow,
      hasPlotFrameShadow,
      hasFrameStyleEffect,
      hasSliceStyleEffect,
    };
  }

  if (hasSliceStyleEffect) {
    return {
      hasChartStyleContext: true,
      styleContextStatus: 'unmodeledSliceFootprint',
      styleContextReason: 'sliceBevelOrGradientUnmodeled',
      styleContextEffectFlags: uniqueStrings(styleContextEffectFlags),
      unmodeledStyleOwnerKeys: uniqueStrings([...unmodeledStyleOwnerKeys]),
      hasSliceStyleEffect: true,
    };
  }

  if (hasFrameStyleEffect || hasChartFrameShadow || hasPlotFrameShadow) {
    return {
      hasChartStyleContext: true,
      styleContextStatus: 'unmodeledFrameFootprint',
      styleContextReason: 'frameStyleFootprintUnmodeled',
      styleContextEffectFlags: uniqueStrings(styleContextEffectFlags),
      unmodeledStyleOwnerKeys: uniqueStrings([...unmodeledStyleOwnerKeys]),
      hasChartFrameShadow,
      hasPlotFrameShadow,
      hasFrameStyleEffect,
    };
  }

  return {
    hasChartStyleContext: true,
    styleContextStatus: 'modeledReservation',
    styleContextReason: 'styleContextFootprintResolved',
    styleContextEffectFlags: uniqueStrings(styleContextEffectFlags),
    unmodeledStyleOwnerKeys: [],
    styleContextReservationMode: 'modeledEffectBleed',
    modeledStyleContextEffectBleed: 2,
  };
}

function hasPieDoughnutSliceStyleEffect(config: ChartConfig): boolean {
  return (config.series ?? []).some((series, seriesIndex) => {
    const seriesFormat = resolveChartOwnerFormat(config, `series(${seriesIndex})`, series.format);
    if (series.showShadow || hasVisibleShadow(seriesFormat?.shadow)) return true;
    if (hasUnmodeledFill(seriesFormat?.fill)) return true;

    const sourceSeriesIndex = seriesConfigSourceIndex(series, seriesIndex);
    return (series.points ?? []).some((point) => {
      const ownerKey = `point(seriesIdx=${sourceSeriesIndex},pointIdx=${point.idx})`;
      const pointFormat = resolveChartOwnerFormat(config, ownerKey, point.visualFormat);
      if (hasVisibleShadow(pointFormat?.shadow)) return true;
      return hasUnmodeledFill(pointFormat?.fill);
    });
  });
}

function pieDoughnutStyleOwnerEffectFlags(
  ownerKey: string,
  format: ChartFormat | undefined,
): string[] {
  if (!format) return [];
  const flags: string[] = [];
  if (hasUnmodeledFill(format.fill)) flags.push(`${ownerKey}:fillEffect`);
  if (hasVisibleShadow(format.shadow)) flags.push(`${ownerKey}:shadow`);
  return flags;
}

function pieDoughnutStyleOwnerScope(
  ownerKey: string,
): 'chartFrame' | 'plotFrame' | 'slice' | 'other' {
  if (ownerKey === 'plotArea' || ownerKey.startsWith('plotArea.')) return 'plotFrame';
  if (ownerKey === 'chartArea' || ownerKey.startsWith('chartArea.')) return 'chartFrame';
  if (
    ownerKey.startsWith('series') ||
    ownerKey.startsWith('point') ||
    ownerKey.startsWith('markerPoint')
  ) {
    return 'slice';
  }
  return 'other';
}

function unmodeledStyleDiagnostics(
  diagnostics: readonly ChartStyleDiagnostic[] | undefined,
): ChartStyleDiagnostic[] {
  return (diagnostics ?? []).filter((diagnostic) => diagnostic.disposition !== 'rendered');
}

function hasImportedDrawingMlPayload(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.length > 0;
  return true;
}

function hasVisibleShadow(shadow: { visible?: boolean } | undefined): boolean {
  return shadow !== undefined && shadow.visible !== false;
}

function hasUnmodeledFill(fill: { type?: string } | undefined): boolean {
  return fill?.type === 'gradient' || fill?.type === 'pattern';
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function pieDoughnutFamily(config: ChartConfig): PieDoughnutGeometryFamily {
  if (isPie3DLikeChartType(config.type)) return 'pie3dApproximation';
  if (isDoughnutLikeChartType(config.type)) return 'doughnut';
  if (config.type === 'ofPie') return 'ofPie';
  return 'pie';
}
