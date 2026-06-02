import {
  barBaselinePixelForDomain,
  buildExcelCartesianGeometryPlan,
  excelBarSlotGeometry,
  resolveBarGeometryGroups,
  type CartesianGeometryLayerTrace,
  type CartesianGeometryPointTrace,
  type CartesianGeometryScaleTrace,
  type CartesianGeometryTrace,
  type ChartConfig,
  type ChartData,
  type BarGeometryGroup,
} from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';

type BarGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['barGeometry']
>[number];
type CartesianGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['cartesianGeometry']
>;
type CartesianGeometryAxisRole = NonNullable<
  CartesianGeometrySnapshot['layers']
>[number]['xAxisRole'];
type CartesianGeometryValueAxisRole = NonNullable<
  CartesianGeometrySnapshot['layers']
>[number]['yAxisRole'];

const CATEGORY_FIELD = 'category';

export function snapshotBarGeometry(
  config: ChartConfig,
  chartData: ChartData,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
): BarGeometrySnapshot[] | undefined {
  const groups = resolveBarGeometryGroups(config, chartData, {
    includeSeries: ({ seriesConfig }) => !isNoFillNoLineSeriesConfig(seriesConfig),
  });
  if (groups.length === 0) return undefined;

  const visibleCategoryCount = chartData.categories.length;
  return groups.map((group) => {
    const geometry = group.geometry;
    const categoryAxisLength =
      geometry.orientation === 'horizontal' ? layout?.plotArea.height : layout?.plotArea.width;
    const categoryPitch =
      categoryAxisLength !== undefined
        ? categoryPitchForPolicy(
            categoryAxisLength,
            visibleCategoryCount,
            geometry.categoryPositionPolicy,
          )
        : undefined;
    const offsets =
      categoryPitch !== undefined
        ? group.seriesIndices.map((seriesIndex, sourceSlotIndex) => ({
            seriesIndex,
            offset: excelBarSlotGeometry(
              categoryPitch,
              group.seriesIndices.length,
              visualSlotIndex(sourceSlotIndex, group.seriesIndices.length, geometry.seriesSlotOrder),
              geometry,
            ).offset,
          }))
        : undefined;
    const barSize =
      categoryPitch !== undefined
        ? excelBarSlotGeometry(categoryPitch, group.seriesIndices.length, 0, geometry).size
        : undefined;
    const baselinePixel = baselinePixelForGeometry(geometry, layout);

    return {
      groupKey: group.key,
      orientation: geometry.orientation,
      grouping: geometry.grouping,
      sourceGapWidth: geometry.sourceGapWidth,
      sourceOverlap: geometry.sourceOverlap,
      gapWidth: geometry.gapWidth,
      overlap: geometry.overlap,
      ...(geometry.gapWidthClamped !== undefined ? { gapWidthClamped: geometry.gapWidthClamped } : {}),
      ...(geometry.overlapClamped !== undefined ? { overlapClamped: geometry.overlapClamped } : {}),
      seriesIndices: group.seriesIndices,
      ...(group.yAxisIndex !== undefined ? { yAxisIndex: group.yAxisIndex } : {}),
      ...(geometry.seriesSlotOrder !== undefined ? { seriesSlotOrder: geometry.seriesSlotOrder } : {}),
      categoryAxisRole: geometry.categoryAxisRole,
      valueAxisRole: geometry.valueAxisRole,
      categoryPositionPolicy: geometry.categoryPositionPolicy,
      ...(geometry.categoryTickLabelSkip !== undefined
        ? { categoryTickLabelSkip: geometry.categoryTickLabelSkip }
        : {}),
      ...(geometry.categoryTickMarkSkip !== undefined
        ? { categoryTickMarkSkip: geometry.categoryTickMarkSkip }
        : {}),
      ...(geometry.categoryTickSkipSource !== undefined
        ? { categoryTickSkipSource: geometry.categoryTickSkipSource }
        : {}),
      categoryCrossing: geometry.categoryCrossing,
      valueCrossing: geometry.valueCrossing,
      ...(geometry.valueCrossingValue !== undefined
        ? { valueCrossingValue: geometry.valueCrossingValue }
        : {}),
      ...(geometry.baselineValue !== undefined ? { baselineValue: geometry.baselineValue } : {}),
      ...(baselinePixel !== undefined ? { baselinePixel } : {}),
      ...(geometry.valueAxisDomain !== undefined
        ? { valueAxisDomain: geometry.valueAxisDomain }
        : {}),
      ...(geometry.valueAxisTickStep !== undefined
        ? { valueAxisTickStep: geometry.valueAxisTickStep }
        : {}),
      ...(geometry.valueAxisTickCount !== undefined
        ? { valueAxisTickCount: geometry.valueAxisTickCount }
        : {}),
      ...(geometry.percentDomain !== undefined ? { percentDomain: geometry.percentDomain } : {}),
      ...(geometry.percentAxisLabelPolicy !== undefined
        ? { percentAxisLabelPolicy: geometry.percentAxisLabelPolicy }
        : {}),
      ...(geometry.axisLayoutStatus !== undefined
        ? { axisLayoutStatus: geometry.axisLayoutStatus }
        : {}),
      ...(geometry.axisLayoutStatusReason !== undefined
        ? { axisLayoutStatusReason: geometry.axisLayoutStatusReason }
        : {}),
      geometryStatus: geometry.geometryStatus,
      plotAreaSource: geometry.plotAreaSource,
      ...(categoryAxisLength !== undefined ? { categoryAxisLength } : {}),
      visibleCategoryCount,
      ...(categoryPitch !== undefined ? { categoryPitch } : {}),
      ...(barSize !== undefined ? { barSize } : {}),
      ...(offsets !== undefined ? { offsets } : {}),
    };
  });
}

export function snapshotCartesianGeometry(
  config: ChartConfig,
  chartData: ChartData,
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null = null,
  trace?: CartesianGeometryTrace,
): CartesianGeometrySnapshot | undefined {
  const plan = buildExcelCartesianGeometryPlan(config, chartData);
  if (!plan) return undefined;

  const seriesGeometry = seriesPointGeometry(trace);
  const layerSnapshots = trace?.layers.map((layer) => snapshotLayerGeometry(layer, trace, plan));
  const categoryXScale = categoryXLayerScale(trace);
  const quantitativeXScale = quantitativeXLayerScale(trace, plan.x.quantitative?.field);

  return {
    ...plan,
    geometryStatus: trace && layout ? 'available' : 'unavailable',
    ...(trace
      ? {
          coordinateSystem: trace.coordinateSystem,
          chartWidth: trace.chartWidth,
          chartHeight: trace.chartHeight,
          plotArea: trace.plotArea,
          layers: layerSnapshots,
        }
      : {}),
    x: {
      modes: plan.x.modes,
      ...(plan.x.category
        ? {
            category: {
              ...plan.x.category,
              ...scaleRangeSnapshot(categoryXScale, trace, 'x'),
            },
          }
        : {}),
      ...(plan.x.quantitative
        ? {
            quantitative: {
              ...plan.x.quantitative,
              ...quantitativeXScaleSnapshot(quantitativeXScale, trace),
            },
          }
        : {}),
    },
    valueAxes: plan.valueAxes.map((axis) => ({
      ...axis,
      ...valueAxisScaleSnapshot(plan, trace, axis.axisGroup),
    })),
    series: plan.series.map((series) => {
      const points = seriesGeometry.get(series.seriesIndex) ?? [];
      const layerIndices = uniqueNumbers(
        points
          .map((point) => point.layerIndex)
          .filter((value): value is number => value !== undefined),
      );
      const areaPoints = points.filter((point) => point.topPixel !== undefined);
      const bubblePoints = points.filter(
        (point) => point.rawBubbleSize !== undefined || point.renderedArea !== undefined,
      );

      return {
        ...series,
        ...(layerIndices.length > 0 ? { layers: layerIndices } : {}),
        ...(points.length > 0 ? { pointGeometry: points } : {}),
        ...(areaPoints.length > 0
          ? {
              areaGeometry: {
                baselinePixel: areaPoints.find((point) => point.baselinePixel !== undefined)
                  ?.baselinePixel,
                baselinePlotY: areaPoints.find((point) => point.baselinePlotY !== undefined)
                  ?.baselinePlotY,
                points: areaPoints,
              },
            }
          : {}),
        ...(bubblePoints.length > 0
          ? {
              bubbleGeometry: {
                sizeDomain: plan.bubble?.sizeDomain,
                sizeRange: plan.bubble?.sizeRange,
                maxRenderedArea: plan.bubble?.maxRenderedArea,
                maxRenderedRadius: plan.bubble?.maxRenderedRadius,
                clippingPolicy: plan.bubble?.clippingPolicy,
                points: bubblePoints,
              },
            }
          : {}),
      };
    }),
  };
}

function seriesPointGeometry(
  trace: CartesianGeometryTrace | undefined,
): Map<number, NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']>> {
  const bySeries = new Map<
    number,
    NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']>
  >();
  if (!trace) return bySeries;

  for (const layer of trace.layers) {
    for (const point of layer.points) {
      if (point.seriesIndex === undefined) continue;
      const current = bySeries.get(point.seriesIndex) ?? [];
      current.push(snapshotPointGeometry(point, layer));
      bySeries.set(point.seriesIndex, current);
    }
  }
  return bySeries;
}

function snapshotPointGeometry(
  point: CartesianGeometryPointTrace,
  layer: CartesianGeometryLayerTrace,
): NonNullable<CartesianGeometrySnapshot['series'][number]['pointGeometry']>[number] {
  return {
    ...point,
    layerIndex: layer.layerIndex,
    markType: layer.markType,
  };
}

function snapshotLayerGeometry(
  layer: CartesianGeometryLayerTrace,
  trace: CartesianGeometryTrace,
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
): NonNullable<CartesianGeometrySnapshot['layers']>[number] {
  const seriesIndices = uniqueNumbers(
    layer.points
      .map((point) => point.seriesIndex)
      .filter((value): value is number => value !== undefined),
  );
  return {
    layerIndex: layer.layerIndex,
    markType: layer.markType,
    xField: layer.xField,
    yField: layer.yField,
    sizeField: layer.sizeField,
    ...layerAxisRoles(layer, plan, seriesIndices),
    xScale: snapshotScaleGeometry(layer.xScale, trace, 'x'),
    yScale: snapshotScaleGeometry(layer.yScale, trace, 'y'),
    ...(layer.sizeScale ? { sizeScale: layer.sizeScale } : {}),
    pointCount: layer.points.length,
    seriesIndices,
    area: layer.area,
  };
}

function snapshotScaleGeometry(
  scale: CartesianGeometryScaleTrace | undefined,
  trace: CartesianGeometryTrace,
  axis: 'x' | 'y',
): NonNullable<CartesianGeometrySnapshot['layers']>[number]['xScale'] | undefined {
  if (!scale) return undefined;
  return {
    ...scale,
    ...scaleRangeSnapshot(scale, trace, axis),
  };
}

function quantitativeXScaleSnapshot(
  scale: CartesianGeometryScaleTrace | undefined,
  trace: CartesianGeometryTrace | undefined,
): Pick<
  NonNullable<CartesianGeometrySnapshot['x']['quantitative']>,
  'tickValues' | 'range' | 'plotRange'
> {
  if (!scale || !trace) return {};
  return {
    tickValues: scale.tickValues,
    ...scaleRangeSnapshot(scale, trace, 'x'),
  };
}

function valueAxisScaleSnapshot(
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
  trace: CartesianGeometryTrace | undefined,
  axisGroup: 'primary' | 'secondary',
): Pick<
  NonNullable<CartesianGeometrySnapshot['valueAxes'][number]>,
  'tickValues' | 'range' | 'plotRange'
> {
  if (!trace) return {};
  const seriesIndices = new Set(
    plan.series
      .filter((series) => series.axisGroup === axisGroup)
      .map((series) => series.seriesIndex),
  );
  const layer = trace.layers.find((item) =>
    item.points.some(
      (point) => point.seriesIndex !== undefined && seriesIndices.has(point.seriesIndex),
    ),
  );
  if (!layer?.yScale) return {};
  return {
    tickValues: layer.yScale.tickValues,
    ...scaleRangeSnapshot(layer.yScale, trace, 'y'),
  };
}

function categoryXLayerScale(
  trace: CartesianGeometryTrace | undefined,
): CartesianGeometryScaleTrace | undefined {
  if (!trace) return undefined;
  return trace.layers.find((layer) => layer.xField === CATEGORY_FIELD && layer.xScale)?.xScale;
}

function quantitativeXLayerScale(
  trace: CartesianGeometryTrace | undefined,
  field: string | undefined,
): CartesianGeometryScaleTrace | undefined {
  if (!trace || !field) return undefined;
  return trace.layers.find((layer) => layer.xField === field && layer.xScale)?.xScale;
}

function layerAxisRoles(
  layer: CartesianGeometryLayerTrace,
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
  seriesIndices: readonly number[],
): {
  xAxisRole?: CartesianGeometryAxisRole;
  yAxisRole?: CartesianGeometryValueAxisRole;
} {
  const xAxisRole =
    layer.xField === plan.x.quantitative?.field
      ? ('xValue' as const)
      : plan.x.category?.axisRole;
  const yAxisRole = layerValueAxisRole(plan, seriesIndices);
  return {
    ...(xAxisRole ? { xAxisRole } : {}),
    ...(yAxisRole ? { yAxisRole } : {}),
  };
}

function layerValueAxisRole(
  plan: NonNullable<ReturnType<typeof buildExcelCartesianGeometryPlan>>,
  seriesIndices: readonly number[],
): CartesianGeometryValueAxisRole | undefined {
  const seriesIndexSet = new Set(seriesIndices);
  const series = plan.series.find((item) => seriesIndexSet.has(item.seriesIndex));
  if (!series) return undefined;
  return series?.axisGroup === 'secondary' ? 'secondaryYValue' : 'primaryYValue';
}

function scaleRangeSnapshot(
  scale: CartesianGeometryScaleTrace | undefined,
  trace: CartesianGeometryTrace | undefined,
  axis: 'x' | 'y',
): { range?: [number, number]; plotRange?: [number, number] } {
  if (!scale?.range || !trace) return {};
  return {
    range: scale.range,
    plotRange: scale.range.map((value) =>
      axis === 'x'
        ? normalize(value - trace.plotArea.x, trace.plotArea.width)
        : normalize(value - trace.plotArea.y, trace.plotArea.height),
    ) as [number, number],
  };
}

function uniqueNumbers(values: readonly number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function normalize(value: number, extent: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(extent) || extent === 0) return NaN;
  return roundSnapshotNumber(value / extent);
}

function roundSnapshotNumber(value: number): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) < 1e-9) return 0;
  return Number.parseFloat(value.toFixed(6));
}

function categoryPitchForPolicy(
  axisLength: number,
  categoryCount: number,
  policy: BarGeometrySnapshot['categoryPositionPolicy'],
): number | undefined {
  if (categoryCount <= 0) return undefined;
  if (policy === 'onCategory' && categoryCount > 1) {
    return axisLength / (categoryCount - 1);
  }
  return axisLength / categoryCount;
}

function visualSlotIndex(
  slotIndex: number,
  seriesCount: number,
  order: BarGeometrySnapshot['seriesSlotOrder'],
): number {
  return order === 'reverse' ? seriesCount - 1 - slotIndex : slotIndex;
}

function baselinePixelForGeometry(
  geometry: BarGeometryGroup['geometry'],
  layout: ResolvedChartSpecSnapshot['resolved']['layout'] | null,
): number | undefined {
  if (!layout) return undefined;
  const domain = geometry.percentDomain ?? geometry.valueAxisDomain;
  const range =
    geometry.orientation === 'horizontal'
      ? ([layout.plotArea.left, layout.plotArea.left + layout.plotArea.width] as [number, number])
      : ([layout.plotArea.top + layout.plotArea.height, layout.plotArea.top] as [number, number]);
  return barBaselinePixelForDomain({ geometry, domain, range });
}
