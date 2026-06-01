import {
  effectiveBarGeometry,
  excelBarSlotGeometry,
  hasExcelBarGeometryConfig,
  isBarLikeChartType,
  seriesConfigForDataSeries,
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
  if (!hasExcelBarGeometryConfig(config)) return undefined;

  const geometry = effectiveBarGeometry(config);
  if (!geometry) return undefined;

  const seriesIndices = barGeometrySeriesIndices(config, chartData);
  if (seriesIndices.length === 0) return undefined;

  const categoryLength =
    geometry.orientation === 'horizontal' ? layout?.plotArea.height : layout?.plotArea.width;
  const categoryPitch =
    categoryLength && chartData.categories.length > 0
      ? categoryLength / chartData.categories.length
      : undefined;
  const offsets =
    categoryPitch !== undefined
      ? seriesIndices.map((seriesIndex, slotIndex) => ({
          seriesIndex,
          offset: excelBarSlotGeometry(categoryPitch, seriesIndices.length, slotIndex, geometry)
            .offset,
        }))
      : undefined;
  const barSize =
    categoryPitch !== undefined
      ? excelBarSlotGeometry(categoryPitch, seriesIndices.length, 0, geometry).size
      : undefined;

  return [
    {
      orientation: geometry.orientation,
      grouping: geometry.grouping,
      sourceGapWidth: geometry.sourceGapWidth,
      sourceOverlap: geometry.sourceOverlap,
      gapWidth: geometry.gapWidth,
      overlap: geometry.overlap,
      gapWidthClamped: geometry.gapWidthClamped,
      overlapClamped: geometry.overlapClamped,
      seriesIndices,
      categoryPitch,
      barSize,
      offsets,
    },
  ];
}

function barGeometrySeriesIndices(config: ChartConfig, chartData: ChartData): number[] {
  return chartData.series
    .map((dataSeries, index) => {
      const seriesConfig = seriesConfigForDataSeries(dataSeries, config.series ?? [], index);
      const seriesType = seriesConfig?.type ?? dataSeries.type ?? config.type;
      return {
        index,
        seriesConfig,
        isBarLike: config.type === 'combo' ? isBarLikeChartType(seriesType) : true,
      };
    })
    .filter(({ isBarLike, seriesConfig }) => isBarLike && !isNoFillNoLineSeriesConfig(seriesConfig))
    .map(({ index }) => index);
}
