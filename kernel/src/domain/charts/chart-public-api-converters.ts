/**
 * Public worksheet chart API <-> compute bridge chart conversion.
 *
 * This module owns the boundary between the public contract chart shape and
 * the persisted ChartFloatingObject shape. The worksheet API facade should
 * call these helpers rather than inline mapping details.
 */

import type {
  Chart,
  ChartConfig,
  ChartType,
  HierarchyChartConfig,
  RegionMapConfig,
} from '@mog-sdk/contracts/data/charts';

import { normalizeImportedComboChart } from '../../bridges/compute/chart-import-normalization';
import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import {
  axisConfigToWire,
  boxplotConfigToWire,
  chartFormatStringToWire,
  chartFormatToWire,
  chartStyleContextToWire,
  dataLabelConfigToWire,
  dataTableConfigToWire,
  histogramConfigToWire,
  legendConfigToWire,
  seriesConfigArrayToWire,
  trendlineConfigArrayToWire,
  wireToAxisConfig,
  wireToBoxplotConfig,
  wireToChartFormat,
  wireToChartFormatString,
  wireToChartStyleContext,
  wireToDataLabelConfig,
  wireToDataTableConfig,
  wireToHierarchyChartConfig,
  wireToHistogramConfig,
  wireToLegendConfig,
  wireToRegionMapConfig,
  wireToSeriesConfigArray,
  wireToSizeRepresents,
  wireToTrendlineConfigArray,
} from './chart-type-converters';
import {
  deriveAxisFieldsForRead,
  deriveDataLabelsForRead,
  deriveLegendEntriesForRead,
  deriveSeriesFormatForRead,
  isExplicitDisplayBlanksAs,
  normalizeChartA1RefForRead,
  normalizeSeriesRefsForRead,
  syncAxisFieldsToInternal,
  syncDataLabelsToInternal,
  syncLegendEntriesToInternal,
  syncSeriesFormatToInternal,
} from './chart-api-compatibility';

/** English Metric Units per point (1 pt = 12700 EMU). */
const EMU_PER_PT = 12700;

const UNSUPPORTED_NATIVE_XLSX_CHART_TYPES = new Set<ChartType>(['heatmap', 'violin']);

export type ChartUpdatePayload = Omit<Partial<ChartFloatingObject>, 'anchor' | 'title'> & {
  anchor?: Partial<ChartFloatingObject['anchor']>;
  title?: string | null;
};

function numericField(fields: Record<string, unknown>, key: string): number | undefined {
  const value = fields[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function omitUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => omitUndefinedDeep(item)) as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child !== undefined) out[key] = omitUndefinedDeep(child);
    }
    return out as T;
  }
  return value;
}

export function unsupportedNativeXlsxChartType(
  config: Partial<Pick<ChartConfig, 'type'>>,
): ChartType | undefined {
  return config.type && UNSUPPORTED_NATIVE_XLSX_CHART_TYPES.has(config.type)
    ? config.type
    : undefined;
}

function waterfallConfigToWire(
  waterfall: NonNullable<ChartConfig['waterfall']>,
): NonNullable<ChartFloatingObject['waterfall']> {
  return {
    ...(waterfall.subtotalIndices !== undefined || waterfall.totalIndices !== undefined
      ? { subtotalIndices: waterfall.subtotalIndices ?? waterfall.totalIndices }
      : {}),
    ...(waterfall.showConnectorLines !== undefined
      ? { showConnectorLines: waterfall.showConnectorLines }
      : {}),
  };
}

function waterfallConfigFromWire(waterfall: ChartFloatingObject['waterfall']): Chart['waterfall'] {
  if (!waterfall) return undefined;
  return {
    ...(waterfall.subtotalIndices !== undefined
      ? {
          subtotalIndices: waterfall.subtotalIndices,
          totalIndices: waterfall.subtotalIndices,
        }
      : {}),
    ...(waterfall.showConnectorLines !== undefined
      ? { showConnectorLines: waterfall.showConnectorLines }
      : {}),
  };
}

function hierarchyChartConfigToWire(
  hierarchy: HierarchyChartConfig | undefined,
): ChartFloatingObject['hierarchy'] {
  if (!hierarchy) return undefined;
  return {
    rows: hierarchy.rows,
    categoryFormulas: hierarchy.categoryFormulas,
    valueFormula: hierarchy.valueFormula,
    parentLabelLayout: hierarchy.parentLabelLayout,
  };
}

function regionMapConfigToWire(
  regionMap: RegionMapConfig | undefined,
): ChartFloatingObject['regionMap'] {
  if (!regionMap) return undefined;
  return {
    regionFormula: regionMap.regionFormula,
    valueFormula: regionMap.valueFormula,
  };
}

/**
 * Convert contracts ChartConfig to internal ChartFloatingObject.
 */
export function chartConfigToInternal(config: ChartConfig): ChartFloatingObject {
  const now = Date.now();

  // Map exploded types to base type + pieSlice flags.
  let chartType: string = config.type;
  let pieSlice = config.pieSlice;
  if (
    config.type === 'pieExploded' ||
    config.type === 'doughnutExploded' ||
    config.type === 'pie3dExploded'
  ) {
    const baseTypeMap: Record<string, string> = {
      pieExploded: 'pie',
      doughnutExploded: 'doughnut',
      pie3dExploded: 'pie3d',
    };
    chartType = baseTypeMap[config.type] ?? config.type;
    pieSlice = {
      ...(pieSlice ?? {}),
      explosion: pieSlice?.explosion ?? 25,
    };
  }

  const anchor: ChartFloatingObject['anchor'] = {
    anchorRow: config.anchorRow,
    anchorCol: config.anchorCol,
    anchorRowOffsetEmu: 0,
    anchorColOffsetEmu: 0,
    anchorMode: 'oneCell',
  };
  if (config.widthPt != null) {
    anchor.extentCxEmu = config.widthPt * EMU_PER_PT;
  }
  if (config.heightPt != null) {
    anchor.extentCyEmu = config.heightPt * EMU_PER_PT;
  }
  if (config.leftPt != null) {
    anchor.anchorColOffsetEmu = config.leftPt * EMU_PER_PT;
  }
  if (config.topPt != null) {
    anchor.anchorRowOffsetEmu = config.topPt * EMU_PER_PT;
  }

  const axis = config.axis
    ? axisConfigToWire(syncAxisFieldsToInternal(config.axis) as typeof config.axis)
    : undefined;

  const series = config.series
    ? seriesConfigArrayToWire(config.series.map(syncSeriesFormatToInternal))
    : undefined;

  const legend = config.legend
    ? legendConfigToWire(syncLegendEntriesToInternal(config.legend) as typeof config.legend)
    : undefined;

  return omitUndefinedDeep({
    // FloatingObjectCommon fields
    id: (config as { id?: string }).id || `chart-${now}`,
    sheetId: '',
    anchor,
    width: config.width * 80,
    height: config.height * 20,
    zIndex: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: config.name ?? '',
    createdAt: now,
    updatedAt: now,
    // FloatingObjectData discriminator
    type: 'chart',
    // ChartData fields
    chartType,
    subType: config.subType,
    dataRange: config.dataRange,
    seriesRange: config.seriesRange,
    categoryRange: config.categoryRange,
    seriesOrientation: config.seriesOrientation,
    title: config.title ?? undefined,
    subtitle: config.subtitle,
    legend,
    axis,
    colors: config.colors,
    series,
    dataLabels: config.dataLabels
      ? dataLabelConfigToWire(
          syncDataLabelsToInternal(config.dataLabels) as typeof config.dataLabels,
        )
      : undefined,
    pieSlice,
    trendline: trendlineConfigArrayToWire(
      config.trendlines ?? (config.trendline ? [config.trendline] : undefined),
    ),
    showLines: config.showLines,
    smoothLines: config.smoothLines,
    radarFilled: config.radarFilled,
    radarMarkers: config.radarMarkers,
    waterfall: config.waterfall ? waterfallConfigToWire(config.waterfall) : undefined,
    histogram: histogramConfigToWire(config.histogram),
    boxplot: boxplotConfigToWire(config.boxplot),
    hierarchy: hierarchyChartConfigToWire(config.hierarchy),
    regionMap: regionMapConfigToWire(config.regionMap),
    ...(isExplicitDisplayBlanksAs(config.displayBlanksAs)
      ? { displayBlanksAs: config.displayBlanksAs }
      : {}),
    plotVisibleOnly: config.plotVisibleOnly,
    gapWidth: config.gapWidth,
    gapDepth: config.gapDepth,
    overlap: config.overlap,
    doughnutHoleSize: config.doughnutHoleSize,
    firstSliceAngle: config.firstSliceAngle,
    bubbleScale: config.bubbleScale,
    showNegBubbles: config.showNegBubbles,
    sizeRepresents: config.sizeRepresents,
    bubble3dEffect: config.bubble3DEffect,
    splitType: config.splitType,
    splitValue: config.splitValue,
    barShape: config.barShape,
    wireframe: config.wireframe,
    surfaceTopView: config.surfaceTopView,
    colorScheme: config.colorScheme,
    widthCells: config.width,
    heightCells: config.height,
    // rich formatting fields
    style: config.style,
    roundedCorners: config.roundedCorners,
    autoTitleDeleted: config.autoTitleDeleted,
    showDataLabelsOverMax: config.showDataLabelsOverMaximum,
    chartFormat: chartFormatToWire(config.chartFormat),
    plotFormat: chartFormatToWire(config.plotFormat),
    titleFormat: chartFormatToWire(config.titleFormat),
    titleRichText: config.titleRichText?.map(chartFormatStringToWire),
    titleFormula: config.titleFormula,
    dataTable: dataTableConfigToWire(config.dataTable),
    categoryLabelLevel: config.categoryLabelLevel,
    seriesNameLevel: config.seriesNameLevel,
    showAllFieldButtons: config.showAllFieldButtons,
    secondPlotSize: config.secondPlotSize,
    varyByCategories: config.varyByCategories,
    titleHAlign: config.chartTitle?.horizontalAlignment,
    titleVAlign: config.chartTitle?.verticalAlignment,
    titleShowShadow: config.chartTitle?.showShadow,
    pivotOptions: config.pivotOptions,
    pivotProjection: config.pivotProjection,
    chartStyleContext: chartStyleContextToWire(config.chartStyleContext),
    view3d: config.view3d,
    floorFormat: chartFormatToWire(config.floorFormat),
    sideWallFormat: chartFormatToWire(config.sideWallFormat),
    backWallFormat: chartFormatToWire(config.backWallFormat),
  });
}

/**
 * Convert partial ChartConfig updates to internal ChartFloatingObject format.
 */
export function chartUpdatesToInternal(updates: Partial<ChartConfig>): ChartUpdatePayload {
  const result: ChartUpdatePayload = {};

  // Map exploded types to base type + pieSlice flags on update.
  if (updates.type !== undefined) {
    const explodedMap: Record<string, string> = {
      pieExploded: 'pie',
      doughnutExploded: 'doughnut',
      pie3dExploded: 'pie3d',
    };
    if (explodedMap[updates.type]) {
      result.chartType = explodedMap[updates.type];
      if (updates.pieSlice === undefined) {
        result.pieSlice = { explosion: 25 } as ChartFloatingObject['pieSlice'];
      }
    } else {
      result.chartType = updates.type;
    }
  }
  if (updates.subType !== undefined) result.subType = updates.subType;
  if (updates.dataRange !== undefined) result.dataRange = updates.dataRange;
  if (updates.seriesRange !== undefined) result.seriesRange = updates.seriesRange;
  if (updates.categoryRange !== undefined) result.categoryRange = updates.categoryRange;
  if (updates.seriesOrientation !== undefined) result.seriesOrientation = updates.seriesOrientation;

  const updAny = updates as Record<string, unknown>;
  const legacyAnchorColOffset = numericField(updAny, 'anchorColOffset');
  const legacyAnchorRowOffset = numericField(updAny, 'anchorRowOffset');
  const hasAnchorUpdate =
    updates.anchorRow !== undefined ||
    updates.anchorCol !== undefined ||
    updates.widthPt !== undefined ||
    updates.heightPt !== undefined ||
    updates.leftPt !== undefined ||
    updates.topPt !== undefined ||
    legacyAnchorColOffset !== undefined ||
    legacyAnchorRowOffset !== undefined;
  if (hasAnchorUpdate) {
    const anchorUpdates: Partial<ChartFloatingObject['anchor']> = {};
    if (updates.anchorRow !== undefined) anchorUpdates.anchorRow = updates.anchorRow;
    if (updates.anchorCol !== undefined) anchorUpdates.anchorCol = updates.anchorCol;
    if (legacyAnchorColOffset !== undefined)
      anchorUpdates.anchorColOffsetEmu = legacyAnchorColOffset;
    if (legacyAnchorRowOffset !== undefined)
      anchorUpdates.anchorRowOffsetEmu = legacyAnchorRowOffset;
    if (updates.leftPt !== undefined)
      anchorUpdates.anchorColOffsetEmu = updates.leftPt * EMU_PER_PT;
    if (updates.topPt !== undefined) anchorUpdates.anchorRowOffsetEmu = updates.topPt * EMU_PER_PT;
    if (updates.widthPt !== undefined) anchorUpdates.extentCxEmu = updates.widthPt * EMU_PER_PT;
    if (updates.heightPt !== undefined) anchorUpdates.extentCyEmu = updates.heightPt * EMU_PER_PT;
    result.anchor = anchorUpdates;
  }
  if (updates.width !== undefined) result.widthCells = updates.width;
  if (updates.height !== undefined) result.heightCells = updates.height;

  if (updates.title !== undefined) result.title = updates.title;
  if (updates.subtitle !== undefined) result.subtitle = updates.subtitle;
  if (updates.legend !== undefined)
    result.legend = legendConfigToWire(
      syncLegendEntriesToInternal(updates.legend) as typeof updates.legend,
    );
  if (updates.axis !== undefined)
    result.axis = axisConfigToWire(syncAxisFieldsToInternal(updates.axis) as typeof updates.axis);
  if (updates.colors !== undefined) result.colors = updates.colors;
  if (updates.series !== undefined)
    result.series = seriesConfigArrayToWire(updates.series.map(syncSeriesFormatToInternal));
  if (updates.dataLabels !== undefined)
    result.dataLabels = dataLabelConfigToWire(
      syncDataLabelsToInternal(updates.dataLabels) as typeof updates.dataLabels,
    );

  if (updates.pieSlice !== undefined) result.pieSlice = updates.pieSlice;
  if (updates.trendlines !== undefined) {
    result.trendline = trendlineConfigArrayToWire(updates.trendlines);
  } else if (updates.trendline !== undefined) {
    result.trendline = trendlineConfigArrayToWire(
      updates.trendline ? [updates.trendline] : undefined,
    );
  }
  if (updates.showLines !== undefined) result.showLines = updates.showLines;
  if (updates.smoothLines !== undefined) result.smoothLines = updates.smoothLines;
  if (updates.radarFilled !== undefined) result.radarFilled = updates.radarFilled;
  if (updates.radarMarkers !== undefined) result.radarMarkers = updates.radarMarkers;
  if (updates.waterfall !== undefined) result.waterfall = waterfallConfigToWire(updates.waterfall);
  if (updates.histogram !== undefined) result.histogram = histogramConfigToWire(updates.histogram);
  if (updates.boxplot !== undefined) result.boxplot = boxplotConfigToWire(updates.boxplot);
  if (updates.hierarchy !== undefined)
    result.hierarchy = hierarchyChartConfigToWire(updates.hierarchy);
  if (updates.regionMap !== undefined) result.regionMap = regionMapConfigToWire(updates.regionMap);

  if (isExplicitDisplayBlanksAs(updates.displayBlanksAs)) {
    result.displayBlanksAs = updates.displayBlanksAs;
  }
  if (updates.plotVisibleOnly !== undefined) result.plotVisibleOnly = updates.plotVisibleOnly;
  if (updates.gapWidth !== undefined) result.gapWidth = updates.gapWidth;
  if (updates.gapDepth !== undefined) result.gapDepth = updates.gapDepth;
  if (updates.overlap !== undefined) result.overlap = updates.overlap;
  if (updates.doughnutHoleSize !== undefined) result.doughnutHoleSize = updates.doughnutHoleSize;
  if (updates.firstSliceAngle !== undefined) result.firstSliceAngle = updates.firstSliceAngle;
  if (updates.bubbleScale !== undefined) result.bubbleScale = updates.bubbleScale;
  if (updates.showNegBubbles !== undefined) result.showNegBubbles = updates.showNegBubbles;
  if (updates.sizeRepresents !== undefined) result.sizeRepresents = updates.sizeRepresents;
  if (updates.bubble3DEffect !== undefined) result.bubble3dEffect = updates.bubble3DEffect;
  if (updates.splitType !== undefined) result.splitType = updates.splitType;
  if (updates.splitValue !== undefined) result.splitValue = updates.splitValue;
  if (updates.barShape !== undefined) result.barShape = updates.barShape;
  if (updates.wireframe !== undefined) result.wireframe = updates.wireframe;
  if (updates.surfaceTopView !== undefined) result.surfaceTopView = updates.surfaceTopView;
  if (updates.colorScheme !== undefined) result.colorScheme = updates.colorScheme;

  if (updates.name !== undefined) result.name = updates.name;

  // rich formatting fields
  if (updates.style !== undefined) result.style = updates.style;
  if (updates.roundedCorners !== undefined) result.roundedCorners = updates.roundedCorners;
  if (updates.autoTitleDeleted !== undefined) result.autoTitleDeleted = updates.autoTitleDeleted;
  if (updates.showDataLabelsOverMaximum !== undefined)
    result.showDataLabelsOverMax = updates.showDataLabelsOverMaximum;
  if (updates.chartFormat !== undefined)
    result.chartFormat = chartFormatToWire(updates.chartFormat);
  if (updates.plotFormat !== undefined) result.plotFormat = chartFormatToWire(updates.plotFormat);
  if (updates.titleFormat !== undefined)
    result.titleFormat = chartFormatToWire(updates.titleFormat);
  if (updates.titleRichText !== undefined)
    result.titleRichText = updates.titleRichText?.map(chartFormatStringToWire);
  if (updates.titleFormula !== undefined) result.titleFormula = updates.titleFormula;
  if (updates.dataTable !== undefined) result.dataTable = dataTableConfigToWire(updates.dataTable);
  if (updates.categoryLabelLevel !== undefined)
    result.categoryLabelLevel = updates.categoryLabelLevel;
  if (updates.seriesNameLevel !== undefined) result.seriesNameLevel = updates.seriesNameLevel;
  if (updates.showAllFieldButtons !== undefined)
    result.showAllFieldButtons = updates.showAllFieldButtons;
  if (updates.secondPlotSize !== undefined) result.secondPlotSize = updates.secondPlotSize;
  if (updates.varyByCategories !== undefined) result.varyByCategories = updates.varyByCategories;
  if (updates.chartTitle) {
    result.titleHAlign = updates.chartTitle.horizontalAlignment;
    result.titleVAlign = updates.chartTitle.verticalAlignment;
    result.titleShowShadow = updates.chartTitle.showShadow;
  }
  if (updates.pivotOptions !== undefined) result.pivotOptions = updates.pivotOptions;
  if (updates.pivotProjection !== undefined) result.pivotProjection = updates.pivotProjection;
  if (updates.chartStyleContext !== undefined)
    result.chartStyleContext = chartStyleContextToWire(updates.chartStyleContext);
  if (updates.view3d !== undefined) result.view3d = updates.view3d;
  if (updates.floorFormat !== undefined)
    result.floorFormat = chartFormatToWire(updates.floorFormat);
  if (updates.sideWallFormat !== undefined)
    result.sideWallFormat = chartFormatToWire(updates.sideWallFormat);
  if (updates.backWallFormat !== undefined)
    result.backWallFormat = chartFormatToWire(updates.backWallFormat);

  return omitUndefinedDeep(result);
}

/**
 * Convert internal ChartFloatingObject to the public Chart type from contracts.
 */
export function serializedChartToChart(rawChart: ChartFloatingObject): Chart {
  const chart = normalizeImportedComboChart(rawChart);
  // Detect exploded pie variants on read.
  let reportedType: string =
    chart.chartType && chart.chartType !== 'undefined' ? chart.chartType : 'column';
  const pieSlice = chart.pieSlice as Record<string, unknown> | undefined;
  const explosion = pieSlice?.explosion as number | undefined;
  if (explosion != null && explosion > 0) {
    const explodedTypeMap: Record<string, string> = {
      pie: 'pieExploded',
      doughnut: 'doughnutExploded',
      pie3d: 'pie3dExploded',
    };
    if (explodedTypeMap[reportedType]) {
      reportedType = explodedTypeMap[reportedType];
    }
  }

  const anchor = chart.anchor;
  const heightPt = anchor.extentCyEmu != null ? anchor.extentCyEmu / EMU_PER_PT : undefined;
  const widthPt = anchor.extentCxEmu != null ? anchor.extentCxEmu / EMU_PER_PT : undefined;
  const leftPt =
    anchor.anchorColOffsetEmu != null ? anchor.anchorColOffsetEmu / EMU_PER_PT : undefined;
  const topPt =
    anchor.anchorRowOffsetEmu != null ? anchor.anchorRowOffsetEmu / EMU_PER_PT : undefined;

  const axisConfig = chart.axis ? wireToAxisConfig(chart.axis) : undefined;
  const seriesConfigs = chart.series ? wireToSeriesConfigArray(chart.series) : undefined;
  const legendConfig = chart.legend ? wireToLegendConfig(chart.legend) : undefined;
  const dataLabelsConfig = chart.dataLabels ? wireToDataLabelConfig(chart.dataLabels) : undefined;

  const axis = axisConfig ? (deriveAxisFieldsForRead(axisConfig) as typeof axisConfig) : undefined;

  const series = seriesConfigs?.map((s) =>
    normalizeSeriesRefsForRead(deriveSeriesFormatForRead(s)),
  );

  const legend = legendConfig
    ? (deriveLegendEntriesForRead(legendConfig) as typeof legendConfig)
    : undefined;

  const result: Chart = {
    id: chart.id,
    sheetId: chart.sheetId ?? '',
    type: reportedType as Chart['type'],
    subType: chart.subType as Chart['subType'],
    dataRange: normalizeChartA1RefForRead(chart.dataRange) ?? '',
    seriesRange: normalizeChartA1RefForRead(chart.seriesRange),
    categoryRange: normalizeChartA1RefForRead(chart.categoryRange),
    seriesOrientation: chart.seriesOrientation as Chart['seriesOrientation'],
    anchorRow: anchor.anchorRow,
    anchorCol: anchor.anchorCol,
    width: chart.widthCells ?? chart.width ?? 8,
    height: chart.heightCells ?? chart.height ?? 15,
    title: chart.title && chart.title !== 'undefined' ? chart.title : undefined,
    subtitle: chart.subtitle && chart.subtitle !== 'undefined' ? chart.subtitle : undefined,
    legend,
    axis,
    colors: chart.colors,
    series,
    dataLabels: dataLabelsConfig
      ? (deriveDataLabelsForRead(dataLabelsConfig) as Chart['dataLabels'])
      : undefined,
    pieSlice: chart.pieSlice,
    trendline: wireToTrendlineConfigArray(chart.trendline)?.[0],
    trendlines: wireToTrendlineConfigArray(chart.trendline),
    showLines: chart.showLines,
    smoothLines: chart.smoothLines,
    radarFilled: chart.radarFilled,
    radarMarkers: chart.radarMarkers,
    waterfall: waterfallConfigFromWire(chart.waterfall),
    histogram: wireToHistogramConfig(chart.histogram),
    boxplot: wireToBoxplotConfig(chart.boxplot),
    hierarchy: wireToHierarchyChartConfig(chart.hierarchy),
    regionMap: wireToRegionMapConfig(chart.regionMap),
    ...(isExplicitDisplayBlanksAs(chart.displayBlanksAs)
      ? { displayBlanksAs: chart.displayBlanksAs }
      : {}),
    plotVisibleOnly: chart.plotVisibleOnly,
    gapWidth: chart.gapWidth,
    gapDepth: chart.gapDepth,
    overlap: chart.overlap,
    doughnutHoleSize: chart.doughnutHoleSize,
    firstSliceAngle: chart.firstSliceAngle,
    bubbleScale: chart.bubbleScale,
    showNegBubbles: chart.showNegBubbles,
    sizeRepresents: wireToSizeRepresents(chart.sizeRepresents),
    bubble3DEffect: chart.bubble3dEffect,
    splitType: chart.splitType as Chart['splitType'],
    splitValue: chart.splitValue,
    barShape: chart.barShape as Chart['barShape'],
    wireframe: chart.wireframe,
    surfaceTopView: chart.surfaceTopView,
    colorScheme: chart.colorScheme,
    name: chart.name || undefined,
    // rich formatting fields
    style: chart.style,
    roundedCorners: chart.roundedCorners,
    autoTitleDeleted: chart.autoTitleDeleted,
    showDataLabelsOverMaximum: chart.showDataLabelsOverMax,
    chartFormat: wireToChartFormat(chart.chartFormat),
    plotFormat: wireToChartFormat(chart.plotFormat),
    titleFormat: wireToChartFormat(chart.titleFormat),
    titleRichText: chart.titleRichText?.map(wireToChartFormatString),
    titleFormula: chart.titleFormula,
    dataTable: wireToDataTableConfig(chart.dataTable),
    categoryLabelLevel: chart.categoryLabelLevel,
    seriesNameLevel: chart.seriesNameLevel,
    showAllFieldButtons: chart.showAllFieldButtons,
    secondPlotSize: chart.secondPlotSize,
    varyByCategories: chart.varyByCategories,
    chartTitle: {
      ...(chart.titleHAlign
        ? {
            horizontalAlignment: chart.titleHAlign as Chart['chartTitle'] extends {
              horizontalAlignment?: infer U;
            }
              ? U
              : never,
          }
        : {}),
      ...(chart.titleVAlign
        ? {
            verticalAlignment: chart.titleVAlign as Chart['chartTitle'] extends {
              verticalAlignment?: infer U;
            }
              ? U
              : never,
          }
        : {}),
      ...(chart.titleShowShadow != null ? { showShadow: chart.titleShowShadow } : {}),
    } as Chart['chartTitle'],
    pivotOptions: chart.pivotOptions as Chart['pivotOptions'],
    pivotProjection: chart.pivotProjection as Chart['pivotProjection'],
    chartStyleContext: wireToChartStyleContext(chart.chartStyleContext),
    view3d: chart.view3d,
    floorFormat: wireToChartFormat(chart.floorFormat),
    sideWallFormat: wireToChartFormat(chart.sideWallFormat),
    backWallFormat: wireToChartFormat(chart.backWallFormat),
    createdAt: chart.createdAt,
    updatedAt: chart.updatedAt,
  };

  if (heightPt !== undefined) result.heightPt = heightPt;
  if (widthPt !== undefined) result.widthPt = widthPt;
  if (leftPt !== undefined) result.leftPt = leftPt;
  if (topPt !== undefined) result.topPt = topPt;

  return result;
}
