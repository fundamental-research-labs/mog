import type { ChartError } from '@mog-sdk/contracts/bridges';
import type {
  AxisType,
  ChartConfig,
  ChartLayoutAuthority,
  SingleAxisConfig,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';
import {
  normalizeImportedComboChart,
  normalizeImportedDisplayBlanksAsValue,
} from '../../../bridges/compute/chart-import-normalization';
import { resolveStoredChartHeightPoints, resolveStoredChartWidthPoints } from '../chart-size-units';
import { isXYValueAxisChartType } from './axis-role';
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
  wireToDirectHexPalette,
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
    const { xAxis, yAxis } = normalizeXYValueAxisPair(
      normAxis(axis.valueAxis),
      normAxis(axis.secondaryValueAxis ?? axis.secondaryYAxis),
    );
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
  const primary = normalizeCategoryValueAxisPairForRendering(
    normAxis(axis.categoryAxis ?? axis.xAxis),
    normAxis(axis.valueAxis ?? axis.yAxis),
    chartType,
  );
  const secondary = normalizeCategoryValueAxisPairForRendering(
    normAxis(axis.secondaryCategoryAxis),
    normAxis(axis.secondaryValueAxis ?? axis.secondaryYAxis),
    chartType,
  );
  return {
    ...axis,
    categoryAxis: primary.categoryAxis,
    valueAxis: primary.valueAxis,
    xAxis: primary.categoryAxis,
    yAxis: primary.valueAxis,
    secondaryCategoryAxis: secondary.categoryAxis,
    secondaryValueAxis: secondary.valueAxis,
    secondaryYAxis: secondary.valueAxis,
  };
}

type AxisOrientation = 'horizontal' | 'vertical';

function normalizeCategoryValueAxisPairForRendering(
  categoryAxis: SingleAxisConfig | undefined,
  valueAxis: SingleAxisConfig | undefined,
  chartType: ChartConfig['type'] | undefined,
): { categoryAxis: SingleAxisConfig | undefined; valueAxis: SingleAxisConfig | undefined } {
  const orientations = cartesianAxisOrientations(chartType);
  if (!orientations) return { categoryAxis, valueAxis };

  const categoryPosition = normalizeAxisPosition(categoryAxis?.position);
  const valuePosition = normalizeAxisPosition(valueAxis?.position);
  const categoryCompatible = isAxisPositionCompatible(categoryPosition, orientations.category);
  const valueCompatible = isAxisPositionCompatible(valuePosition, orientations.value);
  const sharedIncompatiblePosition =
    categoryPosition !== undefined &&
    valuePosition !== undefined &&
    categoryPosition === valuePosition &&
    (!categoryCompatible || !valueCompatible);

  return {
    categoryAxis:
      categoryAxis && (!categoryCompatible || sharedIncompatiblePosition)
        ? hideTickLabels(categoryAxis)
        : categoryAxis,
    valueAxis:
      valueAxis && (!valueCompatible || sharedIncompatiblePosition)
        ? hideTickLabels(valueAxis)
        : valueAxis,
  };
}

function cartesianAxisOrientations(
  chartType: ChartConfig['type'] | undefined,
): { category: AxisOrientation; value: AxisOrientation } | undefined {
  switch (chartType) {
    case 'bar':
    case 'bar3d':
      return { category: 'vertical', value: 'horizontal' };
    case 'column':
    case 'column3d':
    case 'line':
    case 'line3d':
    case 'area':
    case 'area3d':
    case 'stock':
      return { category: 'horizontal', value: 'vertical' };
    default:
      return undefined;
  }
}

function isAxisPositionCompatible(
  position: ReturnType<typeof normalizeAxisPosition>,
  orientation: AxisOrientation,
): boolean {
  if (position === undefined) return true;
  if (orientation === 'horizontal') return position === 'bottom' || position === 'top';
  return position === 'left' || position === 'right';
}

function isStandardXYValueAxisPair(
  axis: NonNullable<ChartConfig['axis']>,
  chartType: ChartConfig['type'] | undefined,
): boolean {
  if (!isXYValueAxisChartType(chartType)) return false;
  if (axis.categoryAxis || axis.xAxis) return false;
  return Boolean(axis.valueAxis && (axis.secondaryValueAxis || axis.secondaryYAxis));
}

function normalizeXYValueAxisPair(
  xAxis: SingleAxisConfig | undefined,
  yAxis: SingleAxisConfig | undefined,
): { xAxis: SingleAxisConfig | undefined; yAxis: SingleAxisConfig | undefined } {
  const xPosition = normalizeAxisPosition(xAxis?.position);
  const yPosition = normalizeAxisPosition(yAxis?.position);
  const xCompatible = xPosition === undefined || xPosition === 'bottom' || xPosition === 'top';
  const yCompatible = yPosition === undefined || yPosition === 'left' || yPosition === 'right';
  const sharedIncompatiblePosition =
    xPosition !== undefined && yPosition !== undefined && xPosition === yPosition && !xCompatible;

  return {
    xAxis: xAxis && !xCompatible ? hideTickLabels(xAxis) : xAxis,
    yAxis: yAxis && (!yCompatible || sharedIncompatiblePosition) ? hideTickLabels(yAxis) : yAxis,
  };
}

function hideTickLabels(axis: SingleAxisConfig): SingleAxisConfig {
  return axis.tickLabelPosition === 'none' ? axis : { ...axis, tickLabelPosition: 'none' };
}

function normalizeAxisPosition(
  position: SingleAxisConfig['position'] | undefined,
): 'bottom' | 'top' | 'left' | 'right' | undefined {
  switch (position?.toLowerCase()) {
    case 'b':
    case 'bottom':
      return 'bottom';
    case 't':
    case 'top':
      return 'top';
    case 'l':
    case 'left':
      return 'left';
    case 'r':
    case 'right':
      return 'right';
    default:
      return undefined;
  }
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
type ChartRenderExtra = {
  imported: true;
  sourceDialect: 'ooxml' | 'ooxml-chart-ex';
  isChartEx?: boolean;
  sourceChartType?: string;
  sourceFamily?: string;
  chartGroupTypes?: string[];
  standardChartProvenance?: {
    projectionSchemaVersion?: number;
    hasProjectionFingerprint?: boolean;
    relationshipCount?: number;
    auxiliaryPathCount?: number;
  };
};

function renderExtraFromChart(chart: ChartFloatingObject): ChartConfig['extra'] {
  const ooxml = recordValue(chart.ooxml);
  if (!ooxml && !chart.importStatus) return undefined;

  const sourceChartType = stringValue(chart.chartType);
  const chartGroupTypes = chartGroupTypesFromChart(chart);
  const sourceFamily = sourceFamilyFromMetadata(sourceChartType, chartGroupTypes);
  const standardChartProvenance = standardChartProvenanceSnapshot(ooxml?.standardChartProvenance);

  return {
    imported: true,
    sourceDialect: ooxml?.isChartEx === true ? 'ooxml-chart-ex' : 'ooxml',
    ...(ooxml?.isChartEx === true ? { isChartEx: true } : {}),
    ...(sourceChartType ? { sourceChartType } : {}),
    ...(sourceFamily ? { sourceFamily } : {}),
    ...(chartGroupTypes.length > 0 ? { chartGroupTypes } : {}),
    ...(standardChartProvenance ? { standardChartProvenance } : {}),
  } satisfies ChartRenderExtra;
}

function chartGroupTypesFromChart(chart: ChartFloatingObject): string[] {
  const groups = (chart as { rt?: { chartGroupsMeta?: unknown } }).rt?.chartGroupsMeta;
  if (!Array.isArray(groups)) return [];
  const types = groups
    .map((group) => stringValue(recordValue(group)?.chartType))
    .filter((value): value is string => value !== undefined);
  return Array.from(new Set(types));
}

function sourceFamilyFromMetadata(
  sourceChartType: string | undefined,
  chartGroupTypes: readonly string[],
): string | undefined {
  if (sourceChartType) return sourceChartType;
  if (chartGroupTypes.length === 1) return chartGroupTypes[0];
  if (chartGroupTypes.length > 1) return 'combo';
  return undefined;
}

function standardChartProvenanceSnapshot(
  value: unknown,
): ChartRenderExtra['standardChartProvenance'] | undefined {
  const record = recordValue(value);
  if (!record) return undefined;

  const snapshot: NonNullable<ChartRenderExtra['standardChartProvenance']> = {};
  const projectionSchemaVersion = numberValue(record.projectionSchemaVersion);
  if (projectionSchemaVersion !== undefined) {
    snapshot.projectionSchemaVersion = projectionSchemaVersion;
  }
  const projectionFingerprint = stringValue(record.projectionFingerprint);
  if (projectionFingerprint !== undefined) {
    snapshot.hasProjectionFingerprint = true;
  }
  if (Array.isArray(record.relationships)) {
    snapshot.relationshipCount = record.relationships.length;
  }
  if (Array.isArray(record.auxiliaryPaths)) {
    snapshot.auxiliaryPathCount = record.auxiliaryPaths.length;
  }

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
  const displayBlanksAs = normalizeImportedDisplayBlanksAsValue(normalizedChart.displayBlanksAs) as
    | ChartConfig['displayBlanksAs']
    | undefined;
  const widthPt = resolveStoredChartWidthPoints(normalizedChart) ?? 480;
  const heightPt = resolveStoredChartHeightPoints(normalizedChart) ?? 225;

  return {
    type: narrowedType.type ?? 'bar',
    anchorRow: normalizedChart.anchor.anchorRow,
    anchorCol: normalizedChart.anchor.anchorCol,
    width: widthPt,
    height: heightPt,
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
    colors: wireToDirectHexPalette(normalizedChart.colors),
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
    ...(displayBlanksAs ? { displayBlanksAs } : {}),
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
    stockSourceComposition: (
      normalizedChart as {
        stockSourceComposition?: ChartConfig['stockSourceComposition'];
      }
    ).stockSourceComposition,
    barShape: normalizedChart.barShape as ChartConfig['barShape'],
    heightPt,
    widthPt,
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
