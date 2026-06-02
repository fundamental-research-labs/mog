import type {
  ChartConfig,
  ChartData,
  ChartDataPoint,
  ChartDataSeries,
  DataLabelConfig,
  SeriesConfig,
} from '../../types';
import { renderedPointValueForRows } from './data-point-values';
import {
  CATEGORY_FIELD,
  POINT_FILL_FIELD,
  POINT_INDEX_FIELD,
  SERIES_FILL_FIELD,
  SERIES_INDEX_FIELD,
  SOURCE_SERIES_INDEX_FIELD,
  SOURCE_SERIES_KEY_FIELD,
  VALUE_FIELD,
} from './fields';
import { isLegendShown } from './legend';
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
  pieLikeAngleUnitVector,
  pieLikeSliceGeometries,
  type PieDoughnutLayoutHints,
  type PieDoughnutPlotArea,
} from './pie-like';
import { resolvedCategoryColors } from './style';
import { linePointsToCanvasPx } from './units';
import {
  seriesConfigForDataSeries,
  seriesSourceIndex,
  seriesSourceKey,
} from '../series-identity';

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
  category: string | number | null;
  value: number;
  sanitizedValue: number;
  startAngle: number;
  endAngle: number;
  midAngle: number;
  angle: number;
  centerX: number;
  centerY: number;
  explosionPercent: number;
  explosionOffset: number;
  x: number;
  y: number;
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
  arcBox: PieDoughnutPlotArea;
  family: PieDoughnutGeometryFamily;
  startAngle: number;
  clockwise: true;
  holeSize?: number;
  innerRadiusRatio: number;
  ringCount: number;
  centerX: number;
  centerY: number;
  radius: number;
  padding: number;
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
    arcBox: frame.arcBox,
    family,
    startAngle,
    clockwise: true,
    ...(isDoughnutLikeChartType(config.type) ? { holeSize: Math.round(holeRatio * 100) } : {}),
    innerRadiusRatio: holeRatio,
    ringCount: rings.length,
    centerX: frame.centerX,
    centerY: frame.centerY,
    radius: frame.radius,
    padding: frame.padding,
    rings,
  };
}

export function pieDoughnutRowsFromGeometry(
  geometry: PieDoughnutGeometry | undefined,
): Array<Record<string, unknown>> {
  if (!geometry) return [];
  return geometry.rings.flatMap((ring) =>
    ring.slices.map((slice) => ({
      [CATEGORY_FIELD]: slice.category ?? '',
      [VALUE_FIELD]: slice.value,
      [POINT_INDEX_FIELD]: slice.pointIndex,
      [SERIES_INDEX_FIELD]: slice.seriesIndex,
      [SOURCE_SERIES_INDEX_FIELD]: slice.sourceSeriesIndex,
      [SOURCE_SERIES_KEY_FIELD]: slice.sourceSeriesKey,
      ...(slice.fill ? { [POINT_FILL_FIELD]: slice.fill, [SERIES_FILL_FIELD]: slice.fill } : {}),
    })),
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
  return {
    preferSquareArcPlot: true,
    ...(outsideLabels ? { outsideLabelPadding: 28, leaderLinePadding: 12 } : {}),
    ...(maxExplosionPercent > 0 ? { explosionPaddingPercent: maxExplosionPercent } : {}),
    ...chartFrameBleedHint(config),
    ...(isLegendShown(config.legend) && data?.categories
      ? { legendEntryCount: data.categories.length }
      : {}),
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
      : sliceInputsForPie(input);
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
    return {
      seriesIndex: slice.seriesIndex,
      sourceSeriesIndex: slice.sourceSeriesIndex,
      sourceSeriesKey: slice.sourceSeriesKey,
      pointIndex: slice.pointIndex,
      category: slice.category,
      value: slice.value,
      sanitizedValue: Math.abs(slice.value),
      startAngle: geometry.startAngle,
      endAngle: geometry.endAngle,
      midAngle: geometry.midAngle,
      angle: geometry.angle,
      centerX: input.centerX,
      centerY: input.centerY,
      explosionPercent,
      explosionOffset,
      x: input.centerX + vector.x * explosionOffset,
      y: input.centerY + vector.y * explosionOffset,
      ...(slice.fill ? { fill: slice.fill } : {}),
      visible: true,
    };
  });
}

function sliceInputsForPie(input: PieDoughnutGeometryInput & {
  colors: readonly string[];
}): SliceInput[] {
  const visibleSeries = visiblePieDoughnutSeries(input);
  const pointCount = Math.max(
    input.data.categories.length,
    ...visibleSeries.map((series) => series.series.data.length),
  );
  const slices: SliceInput[] = [];
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    for (const series of visibleSeries) {
      const point = series.series.data[pointIndex];
      const value = renderedPointValueForRows(point, input.config, series.seriesConfig);
      if (!point || value === null) continue;
      slices.push({
        seriesConfig: series.seriesConfig,
        seriesIndex: series.seriesIndex,
        sourceSeriesIndex: series.sourceSeriesIndex,
        sourceSeriesKey: series.sourceSeriesKey,
        pointIndex,
        category: snapshotCategory(input.data, point, pointIndex),
        value,
        fill: colorAt(input.colors, slices.length),
      });
    }
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

function chartFrameBleedHint(config: ChartConfig): Pick<PieDoughnutLayoutHints, 'chartFrameBleed'> {
  const widths = [
    linePointsToCanvasPx(config.chartArea?.format?.line?.width),
    linePointsToCanvasPx(config.chartFormat?.line?.width),
    linePointsToCanvasPx(config.plotArea?.format?.line?.width),
    linePointsToCanvasPx(config.plotFormat?.line?.width),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const bleed = Math.max(0, ...widths);
  return bleed > 0 ? { chartFrameBleed: bleed } : {};
}

function pieDoughnutFamily(config: ChartConfig): PieDoughnutGeometryFamily {
  if (isPie3DLikeChartType(config.type)) return 'pie3dApproximation';
  if (isDoughnutLikeChartType(config.type)) return 'doughnut';
  if (config.type === 'ofPie') return 'ofPie';
  return 'pie';
}
