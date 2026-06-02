import {
  excelBarSlotGeometry,
  resolveBarGeometryGroups,
  type ChartConfig,
  type ChartData,
} from '@mog/charts';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import { isNoFillNoLineSeriesConfig } from './chart-render-data-normalizer';

type BarGeometrySnapshot = NonNullable<
  ResolvedChartSpecSnapshot['resolved']['plot']['barGeometry']
>[number];

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
      categoryAxisLength !== undefined && visibleCategoryCount > 0
        ? categoryAxisLength / visibleCategoryCount
        : undefined;
    const offsets =
      categoryPitch !== undefined
        ? group.seriesIndices.map((seriesIndex, slotIndex) => ({
            seriesIndex,
            offset: excelBarSlotGeometry(
              categoryPitch,
              group.seriesIndices.length,
              slotIndex,
              geometry,
            ).offset,
          }))
        : undefined;
    const barSize =
      categoryPitch !== undefined
        ? excelBarSlotGeometry(categoryPitch, group.seriesIndices.length, 0, geometry).size
        : undefined;

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
      categoryAxisLength,
      visibleCategoryCount,
      categoryPitch,
      barSize,
      offsets,
    };
  });
}
