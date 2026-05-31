import type { ChartError } from '@mog-sdk/contracts/bridges';
import type { AxisType, ChartConfig, ChartLayoutAuthority } from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import { normalizeImportedComboChart } from '../../../bridges/compute/chart-import-normalization';
import {
  wireToAxisConfig,
  wireToDataLabelConfig,
  wireToLegendConfig,
  wireChartTypeToConfig,
  wireToSeriesConfigArray,
  wireToBoxplotConfig,
  wireToHierarchyChartConfig,
  wireToHistogramConfig,
  wireToRegionMapConfig,
  wireToChartLineSettings,
  wireToUpDownBarsConfig,
  wireToWaterfallConfig,
  wireToManualLayout,
  wireToTrendlineConfigArray,
  wireToSizeRepresents,
  wireToChartFormat,
  wireToChartFormatString,
  wireToDataTableConfig,
  wireToChartStyleContext,
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
  chartType?: ChartConfig['type'],
): ChartConfig['axis'] {
  const normAxis = (a: (typeof axis)['categoryAxis']) =>
    a
      ? { ...a, type: (a.type ?? a.axisType) as AxisType | undefined, show: a.show ?? a.visible }
      : a;
  if (isStandardXYValueAxisPair(axis, chartType)) {
    const xAxis = normAxis(axis.valueAxis);
    const yAxis = normAxis(axis.secondaryValueAxis ?? axis.secondaryYAxis);
    const {
      secondaryValueAxis: _secondaryValueAxis,
      secondaryYAxis: _secondaryYAxis,
      ...rest
    } = axis;
    return {
      ...rest,
      valueAxis: yAxis,
      xAxis,
      yAxis,
    };
  }
  return {
    ...axis,
    xAxis: normAxis(axis.categoryAxis ?? axis.xAxis),
    yAxis: normAxis(axis.valueAxis ?? axis.yAxis),
    secondaryCategoryAxis: normAxis(axis.secondaryCategoryAxis),
    secondaryYAxis: normAxis(axis.secondaryValueAxis ?? axis.secondaryYAxis),
  };
}

function isStandardXYValueAxisPair(
  axis: NonNullable<ChartConfig['axis']>,
  chartType: ChartConfig['type'] | undefined,
): boolean {
  if (chartType !== 'scatter' && chartType !== 'bubble') return false;
  if (axis.categoryAxis || axis.xAxis) return false;
  return Boolean(axis.valueAxis && (axis.secondaryValueAxis || axis.secondaryYAxis));
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

type ChartWithLayoutAuthority = ChartFloatingObject & {
  layoutAuthority?: ChartLayoutAuthority;
};
type ChartWithPivotProjection = ChartFloatingObject & {
  pivotProjection?: ChartConfig['pivotProjection'];
};

function renderExtraFromChart(chart: ChartFloatingObject): ChartConfig['extra'] {
  return chart.ooxml || chart.importStatus ? { imported: true } : undefined;
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
  const sizeRepresents = wireToSizeRepresents(normalizedChart.sizeRepresents);
  const layoutAuthority = (normalizedChart as ChartWithLayoutAuthority).layoutAuthority;
  const pivotProjection = (normalizedChart as ChartWithPivotProjection).pivotProjection;
  const widthCells =
    layoutAuthority === 'chartSheet'
      ? undefined
      : (normalizedChart.widthCells ?? normalizedChart.width);
  const heightCells =
    layoutAuthority === 'chartSheet'
      ? undefined
      : (normalizedChart.heightCells ?? normalizedChart.height);

  return {
    type: narrowedType.type ?? 'bar',
    anchorRow: normalizedChart.anchor.anchorRow,
    anchorCol: normalizedChart.anchor.anchorCol,
    width: widthCells ?? 4,
    height: heightCells ?? 10,
    layoutAuthority,
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
      ? normalizeAxisForRendering(wireToAxisConfig(normalizedChart.axis), narrowedType.type)
      : undefined,
    colors: normalizedChart.colors,
    series: normalizedChart.series ? wireToSeriesConfigArray(normalizedChart.series) : undefined,
    dataLabels: normalizedChart.dataLabels
      ? wireToDataLabelConfig(normalizedChart.dataLabels)
      : undefined,
    pieSlice: normalizedChart.pieSlice,
    trendline: wireToTrendlineConfigArray(normalizedChart.trendline)?.[0],
    trendlines: wireToTrendlineConfigArray(normalizedChart.trendline),
    showLines: normalizedChart.showLines,
    smoothLines: normalizedChart.smoothLines,
    radarFilled: normalizedChart.radarFilled,
    radarMarkers: normalizedChart.radarMarkers,
    waterfall: wireToWaterfallConfig(normalizedChart.waterfall),
    histogram: wireToHistogramConfig(normalizedChart.histogram),
    boxplot: wireToBoxplotConfig(normalizedChart.boxplot),
    hierarchy: wireToHierarchyChartConfig(normalizedChart.hierarchy),
    regionMap: wireToRegionMapConfig(normalizedChart.regionMap),
    displayBlanksAs: normalizedChart.displayBlanksAs as ChartConfig['displayBlanksAs'],
    plotVisibleOnly: normalizedChart.plotVisibleOnly,
    gapWidth: normalizedChart.gapWidth,
    gapDepth: normalizedChart.gapDepth,
    overlap: normalizedChart.overlap,
    doughnutHoleSize: normalizedChart.doughnutHoleSize,
    firstSliceAngle: normalizedChart.firstSliceAngle,
    bubbleScale: normalizedChart.bubbleScale,
    showNegBubbles: normalizedChart.showNegBubbles,
    sizeRepresents,
    bubble3DEffect: normalizedChart.bubble3dEffect,
    splitType: normalizedChart.splitType as ChartConfig['splitType'],
    splitValue: normalizedChart.splitValue,
    categoryLabelLevel: normalizedChart.categoryLabelLevel,
    seriesNameLevel: normalizedChart.seriesNameLevel,
    showAllFieldButtons: normalizedChart.showAllFieldButtons,
    secondPlotSize: normalizedChart.secondPlotSize,
    varyByCategories: normalizedChart.varyByCategories,
    pivotOptions: normalizedChart.pivotOptions as ChartConfig['pivotOptions'],
    pivotProjection,
    style: normalizedChart.style,
    roundedCorners: normalizedChart.roundedCorners,
    autoTitleDeleted: normalizedChart.autoTitleDeleted,
    showDataLabelsOverMaximum: normalizedChart.showDataLabelsOverMax,
    chartFormat: wireToChartFormat(normalizedChart.chartFormat),
    plotFormat: wireToChartFormat(normalizedChart.plotFormat),
    titleFormat: wireToChartFormat(normalizedChart.titleFormat),
    titleRichText: normalizedChart.titleRichText?.map(wireToChartFormatString),
    titleFormula: normalizedChart.titleFormula,
    plotLayout: wireToManualLayout(normalizedChart.plotLayout),
    titleLayout: wireToManualLayout(normalizedChart.titleLayout),
    dataTable: wireToDataTableConfig(normalizedChart.dataTable),
    dropLines: wireToChartLineSettings(normalizedChart.dropLines),
    highLowLines: wireToChartLineSettings(normalizedChart.highLowLines),
    seriesLines: wireToChartLineSettings(normalizedChart.seriesLines),
    upDownBars: wireToUpDownBarsConfig(normalizedChart.upDownBars),
    barShape: normalizedChart.barShape as ChartConfig['barShape'],
    heightPt: normalizedChart.heightPt,
    widthPt: normalizedChart.widthPt,
    leftPt: normalizedChart.leftPt,
    topPt: normalizedChart.topPt,
    wireframe: normalizedChart.wireframe,
    surfaceTopView: normalizedChart.surfaceTopView,
    colorScheme: normalizedChart.colorScheme,
    view3d: normalizedChart.view3d,
    floorFormat: wireToChartFormat(normalizedChart.floorFormat),
    sideWallFormat: wireToChartFormat(normalizedChart.sideWallFormat),
    backWallFormat: wireToChartFormat(normalizedChart.backWallFormat),
    subType: normalizedChart.subType as ChartConfig['subType'],
    chartStyleContext: wireToChartStyleContext(normalizedChart.chartStyleContext),
    extra: renderExtraFromChart(normalizedChart),
  };
}
