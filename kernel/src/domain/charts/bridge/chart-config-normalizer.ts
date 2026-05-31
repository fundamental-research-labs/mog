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
  wireToBoxplotConfig,
  wireToHierarchyChartConfig,
  wireToHistogramConfig,
  wireToRegionMapConfig,
  wireToChartLineSettings,
  wireToUpDownBarsConfig,
  wireToWaterfallConfig,
  wireToManualLayout,
  wireToTrendlineConfigArray,
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

type ChartColorMapOverrideConfig = NonNullable<
  NonNullable<ChartConfig['chartStyleContext']>['colorMapOverride']
>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function colorMappingValue(mapping: Record<string, unknown>, field: string): string | undefined {
  const snakeField = field === 'folHlink' ? 'fol_hlink' : field;
  const value = mapping[field] ?? mapping[snakeField];
  return typeof value === 'string' ? value : undefined;
}

function chartColorMapOverrideFromSerialized(
  value: unknown,
): ChartColorMapOverrideConfig | undefined {
  if (
    value === 'MasterClrMapping' ||
    value === 'masterClrMapping' ||
    value === 'master' ||
    value === 'Master'
  ) {
    return { type: 'master' };
  }

  const record = asRecord(value);
  if (!record) return undefined;

  const kind = record.kind ?? record.type;
  if (kind === 'master' || kind === 'Master') return { type: 'master' };
  if ('MasterClrMapping' in record || 'masterClrMapping' in record) return { type: 'master' };

  const rawMapping =
    asRecord(record.OverrideClrMapping) ??
    asRecord(record.overrideClrMapping) ??
    asRecord(record.Override) ??
    asRecord(record.override) ??
    asRecord(record.mapping) ??
    record;

  const mappingFields = [
    'bg1',
    'tx1',
    'bg2',
    'tx2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
    'hlink',
    'folHlink',
  ] as const;
  const mapping: Record<string, string> = {};
  for (const field of mappingFields) {
    const mappedValue = colorMappingValue(rawMapping, field);
    if (mappedValue) mapping[field] = mappedValue;
  }

  return Object.keys(mapping).length > 0 ? { type: 'override', mapping } : undefined;
}

function chartStyleContextFromOoxml(
  ooxml: ChartFloatingObject['ooxml'],
): ChartConfig['chartStyleContext'] | undefined {
  const definition = asRecord(ooxml?.definition);
  const colorMapOverride = chartColorMapOverrideFromSerialized(
    definition?.clr_map_ovr ?? definition?.clrMapOvr,
  );
  return colorMapOverride ? { colorMapOverride } : undefined;
}

function wireToChartStyleContext(
  context: ChartFloatingObject['chartStyleContext'],
): ChartConfig['chartStyleContext'] | undefined {
  return context as ChartConfig['chartStyleContext'] | undefined;
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
  const sizeRepresents =
    normalizedChart.sizeRepresents === 'area' || normalizedChart.sizeRepresents === 'w'
      ? normalizedChart.sizeRepresents
      : undefined;

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
    style: normalizedChart.style,
    roundedCorners: normalizedChart.roundedCorners,
    autoTitleDeleted: normalizedChart.autoTitleDeleted,
    showDataLabelsOverMaximum: normalizedChart.showDataLabelsOverMax,
    chartFormat: normalizedChart.chartFormat as ChartConfig['chartFormat'],
    plotFormat: normalizedChart.plotFormat as ChartConfig['plotFormat'],
    titleFormat: normalizedChart.titleFormat as ChartConfig['titleFormat'],
    titleRichText: normalizedChart.titleRichText as ChartConfig['titleRichText'],
    titleFormula: normalizedChart.titleFormula,
    plotLayout: wireToManualLayout(normalizedChart.plotLayout),
    titleLayout: wireToManualLayout(normalizedChart.titleLayout),
    dataTable: normalizedChart.dataTable as ChartConfig['dataTable'],
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
    floorFormat: normalizedChart.floorFormat as ChartConfig['floorFormat'],
    sideWallFormat: normalizedChart.sideWallFormat as ChartConfig['sideWallFormat'],
    backWallFormat: normalizedChart.backWallFormat as ChartConfig['backWallFormat'],
    subType: normalizedChart.subType as ChartConfig['subType'],
    chartStyleContext:
      wireToChartStyleContext(normalizedChart.chartStyleContext) ??
      chartStyleContextFromOoxml(normalizedChart.ooxml),
    extra: normalizedChart.ooxml,
  };
}
