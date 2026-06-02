import {
  barBaselinePixelForDomain,
  buildExcelCartesianGeometryPlan,
  excelBarSlotGeometry,
  resolveBarGeometryGroups,
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
      gapWidthClamped: geometry.gapWidthClamped,
      overlapClamped: geometry.overlapClamped,
      seriesIndices: group.seriesIndices,
      yAxisIndex: group.yAxisIndex,
      seriesSlotOrder: geometry.seriesSlotOrder,
      categoryAxisRole: geometry.categoryAxisRole,
      valueAxisRole: geometry.valueAxisRole,
      categoryPositionPolicy: geometry.categoryPositionPolicy,
      categoryCrossing: geometry.categoryCrossing,
      valueCrossing: geometry.valueCrossing,
      valueCrossingValue: geometry.valueCrossingValue,
      baselineValue: geometry.baselineValue,
      baselinePixel,
      valueAxisDomain: geometry.valueAxisDomain,
      percentDomain: geometry.percentDomain,
      geometryStatus: geometry.geometryStatus,
      plotAreaSource: geometry.plotAreaSource,
      categoryAxisLength,
      visibleCategoryCount,
      categoryPitch,
      barSize,
      offsets,
    };
  });
}

export function snapshotCartesianGeometry(
  config: ChartConfig,
  chartData: ChartData,
): CartesianGeometrySnapshot | undefined {
  return buildExcelCartesianGeometryPlan(config, chartData);
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
