import {
  RADAR_DEFAULT_FILLED_OPACITY,
  RADAR_START_ANGLE,
  radarAutomaticMarkerShape,
  radarGeometryForPlotArea,
  radarPointAt,
  radarRadiusForValue,
  resolveRadarValueScale,
  seriesSourceIndex,
  seriesSourceKey,
  type ChartConfig,
  type ChartData,
  type ChartDataPoint,
} from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

type LayoutSnapshot = ResolvedChartSpecSnapshot['resolved']['layout'];
type RadarProjectionSnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['radarProjection']
>;

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
  const valueAxis = radarValueAxis(input.config);
  const valueScale = resolveRadarValueScale({
    values: renderableRadarValues(input.chartData, input.config),
    explicitMin: valueAxis?.min,
    explicitMax: valueAxis?.max,
    explicitMajorUnit: valueAxis?.majorUnit,
    includeZero: true,
  });
  if (!valueScale) return undefined;
  const valueDomain = valueScale.domain;

  const filled = input.config.radarFilled ?? input.config.subType === 'filled';
  const markers = input.config.radarMarkers ?? input.config.subType === 'markers';
  const blankPolicy = input.config.displayBlanksAs === 'zero' ? 'zero' : 'skip';

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
    blankPolicy,
    filled,
    ...(filled ? { fillOpacity: RADAR_DEFAULT_FILLED_OPACITY } : {}),
    markers,
    series: input.chartData.series.map((series, seriesIndex) => {
      const pointCount = Math.max(categoryOrder.length, series.data.length);
      const blankPointIndexes: number[] = [];
      const points: RadarProjectionSnapshot['series'][number]['points'] = [];

      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const point = series.data[pointIndex];
        const value = renderableRadarValue(point, input.config);
        const category = categoryOrder[pointIndex] ?? snapshotPointCategory(point);
        const categoryIndex =
          category === null ? undefined : categoryIndexByKey.get(String(category));
        if (value === undefined || categoryIndex === undefined) {
          blankPointIndexes.push(pointIndex);
          continue;
        }

        const radius = radarRadiusForValue(value, valueDomain, geometry.radius);
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
        });
      }

      const configured = input.config.series?.[seriesIndex];
      return {
        seriesIndex,
        sourceSeriesIndex: seriesSourceIndex(series, seriesIndex),
        sourceSeriesKey: seriesSourceKey(series, seriesIndex),
        name: series.name,
        pointCount,
        renderedPointCount: points.length,
        blankPointIndexes,
        closed: points.length >= 2,
        filled,
        ...(filled ? { fillOpacity: RADAR_DEFAULT_FILLED_OPACITY } : {}),
        markers,
        ...(markers
          ? { markerShape: resolvedMarkerShape(configured?.markerStyle, seriesIndex) }
          : {}),
        points,
      };
    }),
  };
}

function renderableRadarValues(data: ChartData, config: ChartConfig): number[] {
  const values: number[] = [];
  for (const series of data.series) {
    for (const point of series.data) {
      const value = renderableRadarValue(point, config);
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}

function renderableRadarValue(
  point: ChartDataPoint | undefined,
  config: ChartConfig,
): number | undefined {
  if (!point || point.valueState === 'hidden') return undefined;
  if (point.valueState === 'blank') {
    return config.displayBlanksAs === 'zero' ? 0 : undefined;
  }
  if (point.valueState && point.valueState !== 'value') return undefined;
  return typeof point.y === 'number' && Number.isFinite(point.y) ? point.y : undefined;
}

function radarValueAxis(
  config: ChartConfig,
): { min?: number; max?: number; majorUnit?: number } | undefined {
  return config.axis?.yAxis ?? config.axis?.valueAxis;
}

function resolvedMarkerShape(style: string | undefined, seriesIndex: number): string {
  if (style && style !== 'auto') return style;
  return radarAutomaticMarkerShape(seriesIndex);
}

function snapshotPointCategory(point: ChartDataPoint | undefined): string | number | null {
  const value = point?.x;
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function positiveSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;
}
