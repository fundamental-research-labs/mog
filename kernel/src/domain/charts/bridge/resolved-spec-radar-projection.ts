import {
  RADAR_START_ANGLE,
  radarGeometryForPlotArea,
  radarPointAt,
  radarRadiusForValue,
  resolveRadarBlankPolicy,
  resolveRadarValueScale,
  resolveRadarVisualContract,
  seriesConfigForDataSeries,
  seriesSourceIndex,
  seriesSourceKey,
  type RadarBlankPolicy,
  type ChartConfig,
  type ChartData,
  type ChartDataPoint,
} from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import { chartPointCachePointsInsideCardinality } from '../chart-point-cache';

type LayoutSnapshot = ResolvedChartSpecSnapshot['resolved']['layout'];
type RadarProjectionSnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['radarProjection']
>;
type RadarRenderedBlankProjectionEvidence = NonNullable<
  RadarProjectionSnapshot['renderedBlankProjectionEvidence']
>[number];
type ChartSeriesConfig = NonNullable<ChartConfig['series']>[number];
type RadarVisualSeries = ReturnType<typeof resolveRadarVisualContract>['series'][number];

export function snapshotRadarProjection(input: {
  config: ChartConfig;
  chartData: ChartData;
  layout: LayoutSnapshot | null | undefined;
  chartArea?: { width: number; height: number };
  renderFrame?: { width: number; height: number };
}): RadarProjectionSnapshot | undefined {
  if (input.config.type !== 'radar') return undefined;
  const plotArea = input.layout?.plotArea;
  if (!plotArea) return undefined;

  const categoryOrder = input.chartData.categories.map((category) => category ?? null);
  if (categoryOrder.length < 3) return undefined;
  const categoryIndexByKey = new Map(
    categoryOrder.map((category, index) => [String(category), index]),
  );

  const chartWidth = positiveSize(input.chartArea?.width ?? input.renderFrame?.width);
  const chartHeight = positiveSize(input.chartArea?.height ?? input.renderFrame?.height);
  const plotAreaPx = {
    x: plotArea.left * chartWidth,
    y: plotArea.top * chartHeight,
    width: plotArea.width * chartWidth,
    height: plotArea.height * chartHeight,
  };
  const geometry = radarGeometryForPlotArea(plotAreaPx);
  const renderedBlankProjectionEvidence = radarRenderedBlankProjectionEvidence({
    config: input.config,
    chartData: input.chartData,
  });
  const cacheZeroLiveBlankEvidenceCount = renderedBlankProjectionEvidence.filter(
    (item) => item.cacheValue === 0,
  ).length;
  const contradictoryCacheLiveBlankEvidenceCount =
    renderedBlankProjectionEvidence.length - cacheZeroLiveBlankEvidenceCount;
  const blankPolicy = resolveRadarBlankPolicy({
    displayBlanksAs: input.config.displayBlanksAs,
    cacheZeroLiveBlankEvidenceCount,
    contradictoryCacheLiveBlankEvidenceCount,
  });
  const valueAxis = radarValueAxis(input.config);
  const valueScale = resolveRadarValueScale({
    values: renderableRadarValues(input.chartData, blankPolicy.blankPolicy),
    explicitMin: valueAxis?.min,
    explicitMax: valueAxis?.max,
    explicitMajorUnit: valueAxis?.majorUnit,
    includeZero: true,
  });
  if (!valueScale) return undefined;
  const valueDomain = valueScale.domain;

  const filled = input.config.radarFilled ?? input.config.subType === 'filled';
  const markers = input.config.radarMarkers ?? input.config.subType === 'markers';
  const radarVisual = resolveRadarVisualContract({
    config: input.config,
    chartData: input.chartData,
    filled,
    markers,
  });
  const projectionSeries = input.chartData.series.map((series, seriesIndex) => {
    const pointCount = Math.max(categoryOrder.length, series.data.length);
    const blankPointIndexes: number[] = [];
    const points: RadarProjectionSnapshot['series'][number]['points'] = [];
    const sourceSeriesIndex = seriesSourceIndex(series, seriesIndex);
    const sourceSeriesKey = seriesSourceKey(series, seriesIndex);
    const visual =
      radarVisual.seriesBySourceIndex.get(sourceSeriesIndex) ?? radarVisual.series[seriesIndex];

    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const point = series.data[pointIndex];
      const value = renderableRadarValue(point, blankPolicy.blankPolicy);
      const sourceBlank = !point || point.valueState === 'blank';
      const category = categoryOrder[pointIndex] ?? snapshotPointCategory(point);
      const categoryIndex =
        category === null ? undefined : categoryIndexByKey.get(String(category));
      if (sourceBlank) {
        blankPointIndexes.push(pointIndex);
      }
      if (value === undefined || categoryIndex === undefined) {
        continue;
      }

      const radius =
        sourceBlank && blankPolicy.blankPolicy === 'zero'
          ? 0
          : radarRadiusForValue(value, valueDomain, geometry.radius);
      const polarPoint = radarPointAt(categoryIndex, categoryOrder.length, geometry, radius);
      points.push({
        pointIndex,
        category,
        value,
        angle: polarPoint.angle,
        radius,
        radiusRatio: geometry.radius > 0 ? radius / geometry.radius : 0,
        x: polarPoint.x / chartWidth,
        y: polarPoint.y / chartHeight,
        ...(markers ? radarPointMarkerSnapshot(visual, pointIndex) : {}),
      });
    }

    return {
      seriesIndex,
      sourceSeriesIndex,
      sourceSeriesKey,
      name: series.name,
      pointCount,
      renderedPointCount: points.length,
      blankPointIndexes,
      closed:
        points.length >= 2 &&
        (blankPolicy.blankPolicy !== 'gap' || blankPointIndexes.length === 0),
      filled,
      ...(filled && visual?.fillColor ? { fillColor: visual.fillColor } : {}),
      ...(filled && visual?.fillOpacity !== undefined ? { fillOpacity: visual.fillOpacity } : {}),
      ...(visual?.strokeColor ? { strokeColor: visual.strokeColor } : {}),
      ...(visual?.strokeWidth !== undefined ? { strokeWidth: visual.strokeWidth } : {}),
      ...(visual?.strokeDash ? { strokeDash: visual.strokeDash } : {}),
      ...(visual?.strokeOpacity !== undefined ? { strokeOpacity: visual.strokeOpacity } : {}),
      markers,
      ...(markers
        ? {
            markerVisible: visual?.markerVisible ?? true,
            ...(visual?.markerShape ? { markerShape: visual.markerShape } : {}),
            ...(visual?.markerSize !== undefined ? { markerSize: visual.markerSize } : {}),
            ...(visual?.markerFill ? { markerFill: visual.markerFill } : {}),
            ...(visual?.markerStroke ? { markerStroke: visual.markerStroke } : {}),
            ...(visual?.markerStrokeWidth !== undefined
              ? { markerStrokeWidth: visual.markerStrokeWidth }
              : {}),
          }
        : {}),
      points,
    };
  });

  return {
    projectionType: 'radarPolar',
    categoryOrder,
    categoryCount: categoryOrder.length,
    startAngle: RADAR_START_ANGLE,
    clockwise: true,
    valueDomain: [valueDomain.min, valueDomain.max],
    valueTicks: valueScale.ticks,
    ...(valueScale.tickStep !== undefined ? { valueTickStep: valueScale.tickStep } : {}),
    valueDomainAuthority: valueScale.authority,
    explicitValueDomain: valueScale.explicitDomain,
    explicitValueTickStep: valueScale.explicitTickStep,
    center: {
      x: geometry.cx / chartWidth,
      y: geometry.cy / chartHeight,
    },
    radius: {
      pixels: geometry.radius,
      chartX: geometry.radius / chartWidth,
      chartY: geometry.radius / chartHeight,
    },
    ...(blankPolicy.displayBlanksAs ? { displayBlanksAs: blankPolicy.displayBlanksAs } : {}),
    blankPolicy: blankPolicy.blankPolicy,
    blankPolicyAuthority: blankPolicy.blankPolicyAuthority,
    ...(renderedBlankProjectionEvidence.length > 0
      ? { renderedBlankProjectionEvidence }
      : {}),
    filled,
    ...(filled && radarVisual.fillOpacity !== undefined
      ? { fillOpacity: radarVisual.fillOpacity }
      : {}),
    markers,
    ...(markers && radarVisual.markerSize !== undefined
      ? { markerSize: radarVisual.markerSize }
      : {}),
    ...(radarVisual.strokeWidth !== undefined ? { strokeWidth: radarVisual.strokeWidth } : {}),
    styleDiagnostics: radarVisual.styleDiagnostics,
    series: projectionSeries,
  };
}

function radarPointMarkerSnapshot(
  visual: RadarVisualSeries | undefined,
  pointIndex: number,
): Partial<RadarProjectionSnapshot['series'][number]['points'][number]> {
  if (!visual) return {};
  const pointVisual = visual.pointMarkers.find((point) => point.pointIndex === pointIndex);
  const markerVisible = pointVisual?.markerVisible ?? visual.markerVisible;
  const markerShape = pointVisual?.markerShape ?? visual.markerShape;
  const markerSize = pointVisual?.markerSize ?? visual.markerSize;
  const markerFill = pointVisual?.markerFill ?? visual.markerFill;
  const markerStroke = pointVisual?.markerStroke ?? visual.markerStroke;
  const markerStrokeWidth = pointVisual?.markerStrokeWidth ?? visual.markerStrokeWidth;
  return {
    markerVisible,
    ...(markerShape ? { markerShape } : {}),
    ...(markerSize !== undefined ? { markerSize } : {}),
    ...(markerFill ? { markerFill } : {}),
    ...(markerStroke ? { markerStroke } : {}),
    ...(markerStrokeWidth !== undefined ? { markerStrokeWidth } : {}),
  };
}

function numericValueCacheByPointIndex(
  valueCache: ChartSeriesConfig['valueCache'] | undefined,
): Map<number, { value: number; rawValue: string }> {
  const values = new Map<number, { value: number; rawValue: string }>();
  for (const point of chartPointCachePointsInsideCardinality(valueCache)) {
    const rawValue = point.value.trim();
    if (!rawValue) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    values.set(point.idx, { value, rawValue });
  }
  return values;
}

function radarRenderedBlankProjectionEvidence(input: {
  config: ChartConfig;
  chartData: ChartData;
}): RadarRenderedBlankProjectionEvidence[] {
  const evidence: RadarRenderedBlankProjectionEvidence[] = [];
  for (let seriesIndex = 0; seriesIndex < input.chartData.series.length; seriesIndex += 1) {
    const series = input.chartData.series[seriesIndex]!;
    const configured = seriesConfigForDataSeries(
      series,
      input.config.series ?? [],
      seriesIndex,
    );
    const valueCacheByIndex = numericValueCacheByPointIndex(configured?.valueCache);
    if (valueCacheByIndex.size === 0) continue;
    const sourceSeriesIndex = seriesSourceIndex(series, seriesIndex);
    const sourceSeriesKey = seriesSourceKey(series, seriesIndex);
    const pointCount = Math.max(input.chartData.categories.length, series.data.length);
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const point = series.data[pointIndex];
      const sourceBlank = !point || point.valueState === 'blank';
      if (!sourceBlank) continue;
      const cacheValue = valueCacheByIndex.get(pointIndex);
      if (!cacheValue) continue;
      evidence.push({
        authority: 'chartCacheLiveSourceBlank',
        seriesIndex,
        sourceSeriesIndex,
        sourceSeriesKey,
        pointIndex,
        sourceValue: null,
        cacheValue: cacheValue.value,
        cacheRawValue: cacheValue.rawValue,
      });
    }
  }
  return evidence;
}

function renderableRadarValues(data: ChartData, blankPolicy: RadarBlankPolicy): number[] {
  const values: number[] = [];
  for (const series of data.series) {
    for (const point of series.data) {
      const value = renderableRadarValue(point, blankPolicy);
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

function renderableRadarValue(
  point: ChartDataPoint | undefined,
  blankPolicy: RadarBlankPolicy,
): number | undefined {
  if (!point || point.valueState === 'hidden') return undefined;
  if (point.valueState === 'blank') {
    return blankPolicy === 'zero' ? 0 : undefined;
  }
  if (point.valueState && point.valueState !== 'value') return undefined;
  return typeof point.y === 'number' && Number.isFinite(point.y) ? point.y : undefined;
}

function radarValueAxis(
  config: ChartConfig,
): { min?: number; max?: number; majorUnit?: number } | undefined {
  return config.axis?.yAxis ?? config.axis?.valueAxis;
}

function snapshotPointCategory(point: ChartDataPoint | undefined): string | number | null {
  const value = point?.x;
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function positiveSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}
