import type { ChartError } from '@mog-sdk/contracts/bridges';
import type { AxisType, ChartConfig } from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { normalizeImportedComboChart } from '../../../bridges/compute/chart-import-normalization';
import {
  wireToAxisConfig,
  wireToDataLabelConfig,
  wireToLegendConfig,
  wireChartTypeToConfig,
  wireToSeriesConfigArray,
} from '../chart-type-converters';

/**
 * The sanctioned wire-to-render boundary for chart configuration.
 *
 * ChartFloatingObject is the compute/import wire shape. ChartConfig is the
 * public render contract consumed by @mog/charts. Keep narrowing and defaulting
 * here so resolver/orchestration code never reimplements converter behavior.
 */

/**
 * Normalize wire AxisData to populate legacy aliases that the charts rendering
 * package reads (xAxis/yAxis/secondaryYAxis and per-axis type/show).
 */
export function normalizeAxisForRendering(
  axis: NonNullable<ChartConfig['axis']>,
): ChartConfig['axis'] {
  const normAxis = (a: (typeof axis)['categoryAxis']) =>
    a
      ? { ...a, type: (a.type ?? a.axisType) as AxisType | undefined, show: a.show ?? a.visible }
      : a;
  return {
    ...axis,
    xAxis: normAxis(axis.categoryAxis ?? axis.xAxis),
    yAxis: normAxis(axis.valueAxis ?? axis.yAxis),
    secondaryCategoryAxis: normAxis(axis.secondaryCategoryAxis),
    secondaryYAxis: normAxis(axis.secondaryValueAxis ?? axis.secondaryYAxis),
  };
}

function isNativeMissingChartType(
  chart: Pick<ChartFloatingObject, 'chartType' | 'importStatus'>,
): boolean {
  return (
    (chart.chartType === undefined || chart.chartType === null || chart.chartType === '') &&
    chart.importStatus === undefined
  );
}

export function unsupportedChartTypeError(
  chart: ChartFloatingObject,
  chartId: string = chart.id,
): ChartError | null {
  const normalizedChart = normalizeImportedComboChart(chart);
  const narrowedType = wireChartTypeToConfig(normalizedChart.chartType);
  if (narrowedType.type || isNativeMissingChartType(normalizedChart)) {
    return null;
  }

  return {
    code: 'INVALID_SPEC' as const,
    message: narrowedType.diagnostics[0]?.message ?? 'Imported chart type is not supported',
    chartId,
    details: {
      chartType: normalizedChart.chartType,
      diagnostics: narrowedType.diagnostics,
    },
  };
}

/**
 * Convert a ChartFloatingObject to a ChartConfig for passing to the charts library.
 * Provides defaults for required fields that are optional in the gen type.
 */
export function toChartConfig(chart: ChartFloatingObject): ChartConfig {
  const normalizedChart = normalizeImportedComboChart(chart);
  const narrowedType = wireChartTypeToConfig(normalizedChart.chartType);
  if (!narrowedType.type && !isNativeMissingChartType(normalizedChart)) {
    throw new Error(narrowedType.diagnostics[0]?.message ?? 'Imported chart type is not supported');
  }

  return {
    type: narrowedType.type ?? 'bar',
    anchorRow: normalizedChart.anchor.anchorRow,
    anchorCol: normalizedChart.anchor.anchorCol,
    width: normalizedChart.widthCells ?? normalizedChart.width ?? 4,
    height: normalizedChart.heightCells ?? normalizedChart.height ?? 10,
    dataRange: normalizedChart.dataRange ?? '',
    seriesRange: normalizedChart.seriesRange,
    categoryRange: normalizedChart.categoryRange,
    seriesOrientation: normalizedChart.seriesOrientation as ChartConfig['seriesOrientation'],
    title: normalizedChart.title,
    subtitle: normalizedChart.subtitle,
    // Narrow wire shapes to public *Config at the boundary — see
    // chart-type-converters.ts for why this is not a cast.
    legend: normalizedChart.legend ? wireToLegendConfig(normalizedChart.legend) : undefined,
    axis: normalizedChart.axis
      ? normalizeAxisForRendering(wireToAxisConfig(normalizedChart.axis))
      : undefined,
    colors: normalizedChart.colors,
    series: normalizedChart.series ? wireToSeriesConfigArray(normalizedChart.series) : undefined,
    dataLabels: normalizedChart.dataLabels
      ? wireToDataLabelConfig(normalizedChart.dataLabels)
      : undefined,
    pieSlice: normalizedChart.pieSlice,
    trendline: Array.isArray(normalizedChart.trendline)
      ? normalizedChart.trendline[0]
      : normalizedChart.trendline,
    trendlines: normalizedChart.trendline,
    showLines: normalizedChart.showLines,
    smoothLines: normalizedChart.smoothLines,
    radarFilled: normalizedChart.radarFilled,
    radarMarkers: normalizedChart.radarMarkers,
    waterfall: normalizedChart.waterfall as ChartConfig['waterfall'],
    displayBlanksAs: normalizedChart.displayBlanksAs as ChartConfig['displayBlanksAs'],
    plotVisibleOnly: normalizedChart.plotVisibleOnly,
    gapWidth: normalizedChart.gapWidth,
    overlap: normalizedChart.overlap,
    doughnutHoleSize: normalizedChart.doughnutHoleSize,
    firstSliceAngle: normalizedChart.firstSliceAngle,
    bubbleScale: normalizedChart.bubbleScale,
    bubble3DEffect: normalizedChart.bubble3dEffect,
    splitType: normalizedChart.splitType as ChartConfig['splitType'],
    splitValue: normalizedChart.splitValue,
    categoryLabelLevel: normalizedChart.categoryLabelLevel,
    seriesNameLevel: normalizedChart.seriesNameLevel,
    style: normalizedChart.style,
    chartFormat: normalizedChart.chartFormat as ChartConfig['chartFormat'],
    plotFormat: normalizedChart.plotFormat as ChartConfig['plotFormat'],
    titleFormat: normalizedChart.titleFormat as ChartConfig['titleFormat'],
    subType: normalizedChart.subType as ChartConfig['subType'],
    extra: normalizedChart.ooxml,
  };
}
