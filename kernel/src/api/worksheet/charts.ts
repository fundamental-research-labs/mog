/**
 * WorksheetChartsImpl — Implementation of the WorksheetCharts sub-API.
 *
 * Calls domain modules directly (no intermediate operations layer or unwrap).
 * Validation and multi-step logic is inlined here.
 */
import type {
  Chart,
  ChartConfig,
  ChartFormatString,
  ChartImageExporter,
  ChartSeriesDimension,
  ChartType,
  SheetId,
  SingleAxisConfig,
  WorksheetCharts,
} from '@mog-sdk/contracts/api';

import type {
  BoxplotConfig,
  ChartBorder,
  DataLabelConfig,
  DataTableConfig,
  HistogramConfig,
  ImageExportOptions,
  LegendEntryConfig,
  PointFormat,
  SeriesConfig,
  TrendlineConfig,
} from '@mog-sdk/contracts/data/charts';

import type { ChartFloatingObject } from '../../bridges/compute/compute-bridge';
import { normalizeImportedComboChart } from '../../bridges/compute/chart-import-normalization';
import type { DocumentContext } from '../../context';
import type { ChartLayoutSnapshot } from '@mog-sdk/contracts/bridges';
import { parseCellRange, rangeToA1 } from '../internal/utils';
import {
  axisConfigToWire,
  dataLabelConfigToWire,
  legendConfigToWire,
  seriesConfigArrayToWire,
  wireToAxisConfig,
  wireToDataLabelConfig,
  wireToLegendConfig,
  wireToSeriesConfigArray,
} from '../../domain/charts/chart-type-converters';
import { chartNotFound, invalidChartConfig, operationFailed } from '../../errors/api';
import { type CallableDisposable, toDisposable } from '@mog/spreadsheet-utils/disposable';

// =============================================================================
// EMU ↔ Point conversion constants
// =============================================================================

/** English Metric Units per point (1 pt = 12700 EMU) */
const EMU_PER_PT = 12700;
const UNSUPPORTED_NATIVE_XLSX_CHART_TYPES = new Set<ChartType>(['heatmap', 'violin']);

// =============================================================================
// Chart Conversion Helpers
// =============================================================================

type ChartUpdatePayload = Omit<Partial<ChartFloatingObject>, 'anchor' | 'title'> & {
  anchor?: Partial<ChartFloatingObject['anchor']>;
  title?: string | null;
};

function numericField(fields: Record<string, unknown>, key: string): number | undefined {
  const value = fields[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function assertSupportedNativeXlsxChartConfig(config: Partial<Pick<ChartConfig, 'type'>>): void {
  if (config.type && UNSUPPORTED_NATIVE_XLSX_CHART_TYPES.has(config.type)) {
    throw invalidChartConfig(
      `Chart type "${config.type}" is not supported because it has no native Excel XLSX chart representation`,
    );
  }
}

// =============================================================================
// Group C: Axis Field Mapping Helpers
// =============================================================================

type AnyAxisConfig = Record<string, unknown>;

/**
 * Derive OfficeJS-compatible axis fields on read.
 * E.g., scaleType = 'logarithmic' when axisType === 'log', isBetweenCategories from crossBetween.
 */
function deriveAxisFieldsForRead(axis: unknown): typeof axis {
  if (!axis || typeof axis !== 'object') return axis;
  const axisObj = axis as Record<string, unknown>;
  const deriveOne = (single: unknown): unknown => {
    if (!single || typeof single !== 'object') return single;
    const s = single as AnyAxisConfig;
    const derived: AnyAxisConfig = { ...s };
    // scaleType: 'logarithmic' | 'linear'
    if (s.axisType === 'log') {
      derived.scaleType = 'logarithmic';
    } else if (s.axisType === 'value' || s.axisType === 'category' || s.axisType === 'time') {
      derived.scaleType = 'linear';
    }
    // categoryType mirrors axisType for category axes
    if (s.axisType) {
      derived.categoryType = s.axisType;
    }
    // isBetweenCategories from crossBetween
    if (s.crossBetween === 'between') {
      derived.isBetweenCategories = true;
    } else if (s.crossBetween === 'midCat') {
      derived.isBetweenCategories = false;
    }
    // textOrientation from format.textRotation
    const fmt = s.format as AnyAxisConfig | undefined;
    if (fmt?.textRotation != null) {
      derived.textOrientation = fmt.textRotation;
    }
    // alignment from labelAlignment
    if (s.labelAlignment != null) {
      derived.alignment = s.labelAlignment;
    }
    // crossesAt from position-based crossing (min/max/autoZero)
    if (s.crossesAt == null && s.position != null) {
      if (s.position === 'max') derived.crossesAt = 'maximum';
      else if (s.position === 'min') derived.crossesAt = 'minimum';
      else derived.crossesAt = 'automatic';
    }
    return derived;
  };
  return {
    ...axisObj,
    categoryAxis: deriveOne(axisObj.categoryAxis),
    valueAxis: deriveOne(axisObj.valueAxis),
    secondaryCategoryAxis: deriveOne(axisObj.secondaryCategoryAxis),
    secondaryValueAxis: deriveOne(axisObj.secondaryValueAxis),
    xAxis: deriveOne(axisObj.xAxis),
    yAxis: deriveOne(axisObj.yAxis),
    secondaryYAxis: deriveOne(axisObj.secondaryYAxis),
  };
}

/**
 * Sync OfficeJS axis fields to internal storage on write.
 * E.g., scaleType 'logarithmic' → axisType 'log'.
 */
function syncAxisFieldsToInternal(axis: unknown): typeof axis {
  if (!axis || typeof axis !== 'object') return axis;
  const axisObj = axis as Record<string, unknown>;
  const syncOne = (single: unknown): unknown => {
    if (!single || typeof single !== 'object') return single;
    const s = { ...(single as AnyAxisConfig) };
    // scaleType → axisType
    if (s.scaleType === 'logarithmic') {
      s.axisType = 'log';
    } else if (s.scaleType === 'linear' && s.axisType == null) {
      s.axisType = 'value';
    }
    // isBetweenCategories → crossBetween
    if (s.isBetweenCategories === true) {
      s.crossBetween = 'between';
    } else if (s.isBetweenCategories === false) {
      s.crossBetween = 'midCat';
    }
    // textOrientation → format.textRotation
    if (s.textOrientation != null) {
      const fmt = (s.format ?? {}) as AnyAxisConfig;
      s.format = { ...fmt, textRotation: s.textOrientation };
    }
    // alignment → labelAlignment
    if (s.alignment != null) {
      s.labelAlignment = s.alignment;
    }
    // crossesAt → position-based mapping
    if (s.crossesAt === 'maximum') {
      s.position = 'max';
    } else if (s.crossesAt === 'minimum') {
      s.position = 'min';
    } else if (s.crossesAt === 'automatic') {
      // default crossing — no explicit position needed
    }
    // crossesAtValue → direct numeric crossing
    if (s.crossesAtValue != null) {
      s.crosses = s.crossesAtValue;
    }
    return s;
  };
  return {
    ...axisObj,
    categoryAxis: syncOne(axisObj.categoryAxis),
    valueAxis: syncOne(axisObj.valueAxis),
    secondaryCategoryAxis: syncOne(axisObj.secondaryCategoryAxis),
    secondaryValueAxis: syncOne(axisObj.secondaryValueAxis),
    xAxis: syncOne(axisObj.xAxis),
    yAxis: syncOne(axisObj.yAxis),
    secondaryYAxis: syncOne(axisObj.secondaryYAxis),
  };
}

// =============================================================================
// Group D: Series Format Backward Compatibility Helpers
// =============================================================================

/**
 * On read: derive legacy `color` and `lineWidth` from `format.fill` and `format.line.width`.
 */
function deriveSeriesFormatForRead(series: SeriesConfig): SeriesConfig {
  if (!series) return series;
  const result = { ...series };
  // D1: If format.fill is solid with a color and series.color is not set, populate color
  const fill = series.format?.fill;
  if (fill && typeof fill === 'object' && 'type' in fill && fill.type === 'solid') {
    const solidFill = fill as { type: 'solid'; color: unknown };
    if (solidFill.color && !series.color) {
      result.color = typeof solidFill.color === 'string' ? solidFill.color : undefined;
    }
  }
  // D2: If format.line.width is set and series.lineWidth is not, populate lineWidth
  if (series.format?.line?.width != null && series.lineWidth == null) {
    result.lineWidth = series.format.line.width;
  }
  return result;
}

/**
 * Public chart read APIs expose parseable A1 refs, while internal chart
 * storage/export preserves imported OOXML-style refs with absolute markers.
 */
function normalizeChartA1RefForRead(ref: string | undefined): string | undefined {
  if (!ref) return ref;
  const parsed = parseCellRange(ref);
  if (!parsed) return ref;
  return parsed.sheetName ? rangeToA1(parsed, true, parsed.sheetName) : rangeToA1(parsed);
}

function normalizeSeriesRefsForRead(series: SeriesConfig): SeriesConfig {
  return {
    ...series,
    values: normalizeChartA1RefForRead(series.values),
    categories: normalizeChartA1RefForRead(series.categories),
    bubbleSize: normalizeChartA1RefForRead(series.bubbleSize),
  };
}

/**
 * On write: if legacy `color` is set and `format` is not, store in `color`.
 * If `format.fill` is set, ensure color stays in sync.
 */
function syncSeriesFormatToInternal(series: SeriesConfig): SeriesConfig {
  if (!series) return series;
  const result = { ...series };
  // D1: If color is set on write and format.fill is not, keep color as-is (backward compat)
  // If format.fill is solid, also sync color from it for backward compat readers
  const fill = series.format?.fill;
  if (fill && typeof fill === 'object' && 'type' in fill && fill.type === 'solid') {
    const solidFill = fill as { type: 'solid'; color: unknown };
    if (solidFill.color && !series.color) {
      result.color = typeof solidFill.color === 'string' ? solidFill.color : undefined;
    }
  }
  // D2: If lineWidth is set on write and format.line is not, keep lineWidth as-is
  // If format.line.width is set, also sync lineWidth
  if (series.format?.line?.width != null && series.lineWidth == null) {
    result.lineWidth = series.format.line.width;
  }
  return result;
}

// =============================================================================
// Group K: Legend Entry Visible/Delete Reconciliation Helpers
// =============================================================================

/**
 * On read: derive `visible = !(entry.delete ?? false)` for each legend entry.
 */
function deriveLegendEntriesForRead(legend: unknown): typeof legend {
  if (!legend || typeof legend !== 'object') return legend;
  const legendObj = legend as Record<string, unknown>;

  // Reconcile show ↔ visible: if either is true, both should be true.
  const show = legendObj.show as boolean | undefined;
  const visible = legendObj.visible as boolean | undefined;
  const reconciledVisible = visible === true || show === true;
  const reconciledShow = reconciledVisible;

  const entries = legendObj.entries as Array<Record<string, unknown>> | undefined;
  const reconciledEntries = entries?.map((entry) => ({
    ...entry,
    visible: !(entry.delete ?? false),
  }));

  return {
    ...legendObj,
    show: reconciledShow,
    visible: reconciledVisible,
    ...(reconciledEntries ? { entries: reconciledEntries } : {}),
  };
}

/**
 * On write: sync `show ↔ visible` and `delete = !visible` for each legend entry.
 */
function syncLegendEntriesToInternal(legend: unknown): typeof legend {
  if (!legend || typeof legend !== 'object') return legend;
  const legendObj = legend as Record<string, unknown>;

  // Reconcile show ↔ visible on write
  const show = legendObj.show as boolean | undefined;
  const visible = legendObj.visible as boolean | undefined;
  const synced: Record<string, unknown> = { ...legendObj };
  if (visible !== undefined && show === undefined) {
    synced.show = visible;
  } else if (show !== undefined && visible === undefined) {
    synced.visible = show;
  }

  const entries = synced.entries as Array<Record<string, unknown>> | undefined;
  if (entries) {
    synced.entries = entries.map((entry) => {
      const result = { ...entry };
      if (entry.visible !== undefined) {
        result.delete = !entry.visible;
      }
      return result;
    });
  }
  return synced;
}

/**
 * On read: populate legacy alias fields for dataLabels so both old and new
 * consumers get the field they expect.
 *   Rust canonical → legacy alias
 *   showCategoryName → showCategory
 *   showPercentage   → showPercent
 */
function deriveDataLabelsForRead(dataLabels: unknown): typeof dataLabels {
  if (!dataLabels || typeof dataLabels !== 'object') return dataLabels;
  const dl = dataLabels as Record<string, unknown>;
  const result = { ...dl };
  if (result.showCategoryName !== undefined && result.showCategory === undefined) {
    result.showCategory = result.showCategoryName;
  }
  if (result.showPercentage !== undefined && result.showPercent === undefined) {
    result.showPercent = result.showPercentage;
  }
  return result;
}

/**
 * On write: normalize legacy alias fields for dataLabels into canonical names.
 *   showCategory → showCategoryName
 *   showPercent  → showPercentage
 */
function syncDataLabelsToInternal(dataLabels: unknown): typeof dataLabels {
  if (!dataLabels || typeof dataLabels !== 'object') return dataLabels;
  const dl = dataLabels as Record<string, unknown>;
  const result = { ...dl };
  if (result.showCategory !== undefined) {
    if (result.showCategoryName === undefined) result.showCategoryName = result.showCategory;
    delete result.showCategory;
  }
  if (result.showPercent !== undefined) {
    if (result.showPercentage === undefined) result.showPercentage = result.showPercent;
    delete result.showPercent;
  }
  return result;
}

/**
 * Convert contracts ChartConfig to internal ChartFloatingObject.
 */
function chartConfigToInternal(config: ChartConfig): ChartFloatingObject {
  const now = Date.now();

  // Group B2: Map exploded types to base type + pieSlice flags
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
    // Store explodeAll in ooxml extra since the wire type doesn't have it
  }

  // Group A: If point-based dimensions are provided, compute EMU extents
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

  // Group C: Sync OfficeJS axis fields to internal storage on write, then
  // widen the *Config literal unions to the loose *Data wire shape.
  const axis = config.axis
    ? axisConfigToWire(syncAxisFieldsToInternal(config.axis) as typeof config.axis)
    : undefined;

  // Group D: Series format backward compatibility on write, then widen.
  const series = config.series
    ? seriesConfigArrayToWire(config.series.map(syncSeriesFormatToInternal))
    : undefined;

  // Group K: Legend entry visible → delete reconciliation on write, then widen.
  const legend = config.legend
    ? legendConfigToWire(syncLegendEntriesToInternal(config.legend) as typeof config.legend)
    : undefined;

  return {
    // FloatingObjectCommon fields
    id: (config as { id?: string }).id || `chart-${now}`,
    sheetId: '',
    anchor,
    width: config.width * 80, // approximate pixel width
    height: config.height * 20, // approximate pixel height
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
    trendline: config.trendlines ?? (config.trendline ? [config.trendline] : undefined),
    showLines: config.showLines,
    smoothLines: config.smoothLines,
    radarFilled: config.radarFilled,
    radarMarkers: config.radarMarkers,
    waterfall: config.waterfall,
    displayBlanksAs: config.displayBlanksAs,
    plotVisibleOnly: config.plotVisibleOnly,
    gapWidth: config.gapWidth,
    overlap: config.overlap,
    doughnutHoleSize: config.doughnutHoleSize,
    firstSliceAngle: config.firstSliceAngle,
    bubbleScale: config.bubbleScale,
    splitType: config.splitType,
    splitValue: config.splitValue,
    widthCells: config.width,
    heightCells: config.height,
    // rich formatting fields
    style: config.style,
    roundedCorners: config.roundedCorners,
    autoTitleDeleted: config.autoTitleDeleted,
    showDataLabelsOverMax: config.showDataLabelsOverMaximum,
    chartFormat: config.chartFormat,
    plotFormat: config.plotFormat,
    titleFormat: config.titleFormat,
    titleRichText: config.titleRichText,
    titleFormula: config.titleFormula,
    dataTable: config.dataTable,
    categoryLabelLevel: config.categoryLabelLevel,
    seriesNameLevel: config.seriesNameLevel,
    showAllFieldButtons: config.showAllFieldButtons,
    secondPlotSize: config.secondPlotSize,
    varyByCategories: config.varyByCategories,
    titleHAlign: config.chartTitle?.horizontalAlignment,
    titleVAlign: config.chartTitle?.verticalAlignment,
    titleShowShadow: config.chartTitle?.showShadow,
    pivotOptions: config.pivotOptions,
  };
}

/**
 * Convert partial ChartConfig updates to internal ChartFloatingObject format.
 */
function chartUpdatesToInternal(updates: Partial<ChartConfig>): ChartUpdatePayload {
  const result: ChartUpdatePayload = {};

  // Group B2: Map exploded types to base type + pieSlice flags on update
  if (updates.type !== undefined) {
    const explodedMap: Record<string, string> = {
      pieExploded: 'pie',
      doughnutExploded: 'doughnut',
      pie3dExploded: 'pie3d',
    };
    if (explodedMap[updates.type]) {
      result.chartType = explodedMap[updates.type];
      // Auto-set pieSlice explosion if not already being updated
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

  // Group A: Point-based position fields → EMU extents
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
  // Group K: Legend entry visible → delete reconciliation on write, then widen.
  if (updates.legend !== undefined)
    result.legend = legendConfigToWire(
      syncLegendEntriesToInternal(updates.legend) as typeof updates.legend,
    );
  // Group C: Axis field sync on write, then widen.
  if (updates.axis !== undefined)
    result.axis = axisConfigToWire(syncAxisFieldsToInternal(updates.axis) as typeof updates.axis);
  if (updates.colors !== undefined) result.colors = updates.colors;
  // Group D: Series format backward compatibility on write, then widen.
  if (updates.series !== undefined)
    result.series = seriesConfigArrayToWire(updates.series.map(syncSeriesFormatToInternal));
  if (updates.dataLabels !== undefined)
    result.dataLabels = dataLabelConfigToWire(
      syncDataLabelsToInternal(updates.dataLabels) as typeof updates.dataLabels,
    );

  if (updates.pieSlice !== undefined) result.pieSlice = updates.pieSlice;
  if (updates.trendlines !== undefined) {
    result.trendline = updates.trendlines;
  } else if (updates.trendline !== undefined) {
    result.trendline = updates.trendline ? [updates.trendline] : undefined;
  }
  if (updates.showLines !== undefined) result.showLines = updates.showLines;
  if (updates.smoothLines !== undefined) result.smoothLines = updates.smoothLines;
  if (updates.radarFilled !== undefined) result.radarFilled = updates.radarFilled;
  if (updates.radarMarkers !== undefined) result.radarMarkers = updates.radarMarkers;
  if (updates.waterfall !== undefined) result.waterfall = updates.waterfall;

  if (updates.displayBlanksAs !== undefined) result.displayBlanksAs = updates.displayBlanksAs;
  if (updates.plotVisibleOnly !== undefined) result.plotVisibleOnly = updates.plotVisibleOnly;
  if (updates.gapWidth !== undefined) result.gapWidth = updates.gapWidth;
  if (updates.overlap !== undefined) result.overlap = updates.overlap;
  if (updates.doughnutHoleSize !== undefined) result.doughnutHoleSize = updates.doughnutHoleSize;
  if (updates.firstSliceAngle !== undefined) result.firstSliceAngle = updates.firstSliceAngle;
  if (updates.bubbleScale !== undefined) result.bubbleScale = updates.bubbleScale;
  if (updates.splitType !== undefined) result.splitType = updates.splitType;
  if (updates.splitValue !== undefined) result.splitValue = updates.splitValue;

  if (updates.name !== undefined) result.name = updates.name;

  // rich formatting fields
  if (updates.style !== undefined) result.style = updates.style;
  if (updates.roundedCorners !== undefined) result.roundedCorners = updates.roundedCorners;
  if (updates.autoTitleDeleted !== undefined) result.autoTitleDeleted = updates.autoTitleDeleted;
  if (updates.showDataLabelsOverMaximum !== undefined)
    result.showDataLabelsOverMax = updates.showDataLabelsOverMaximum;
  if (updates.chartFormat !== undefined) result.chartFormat = updates.chartFormat;
  if (updates.plotFormat !== undefined) result.plotFormat = updates.plotFormat;
  if (updates.titleFormat !== undefined) result.titleFormat = updates.titleFormat;
  if (updates.titleRichText !== undefined) result.titleRichText = updates.titleRichText;
  if (updates.titleFormula !== undefined) result.titleFormula = updates.titleFormula;
  if (updates.dataTable !== undefined) result.dataTable = updates.dataTable;
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

  return result;
}

/**
 * Convert internal ChartFloatingObject to the public Chart type from contracts.
 */
function serializedChartToChart(rawChart: ChartFloatingObject): Chart {
  const chart = normalizeImportedComboChart(rawChart);
  // Group B2: Detect exploded pie variants on read.
  // If the internal type is 'pie'/'doughnut'/'pie3d' and the pieSlice indicates
  // full explosion (explosion > 0 on all slices or explicit flag), report as exploded type.
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

  // Group A: Derive point-based dimensions from EMU values if available
  const anchor = chart.anchor;
  const heightPt = anchor.extentCyEmu != null ? anchor.extentCyEmu / EMU_PER_PT : undefined;
  const widthPt = anchor.extentCxEmu != null ? anchor.extentCxEmu / EMU_PER_PT : undefined;
  // leftPt/topPt derive from anchor offsets (EMU)
  const leftPt =
    anchor.anchorColOffsetEmu != null ? anchor.anchorColOffsetEmu / EMU_PER_PT : undefined;
  const topPt =
    anchor.anchorRowOffsetEmu != null ? anchor.anchorRowOffsetEmu / EMU_PER_PT : undefined;

  // Narrow wire shapes to public *Config types at the boundary, then apply
  // the read-side derivations which operate on the narrowed Config shapes.
  const axisConfig = chart.axis ? wireToAxisConfig(chart.axis) : undefined;
  const seriesConfigs = chart.series ? wireToSeriesConfigArray(chart.series) : undefined;
  const legendConfig = chart.legend ? wireToLegendConfig(chart.legend) : undefined;
  const dataLabelsConfig = chart.dataLabels ? wireToDataLabelConfig(chart.dataLabels) : undefined;

  // Group C: Derive OfficeJS-compatible axis fields on read
  const axis = axisConfig ? (deriveAxisFieldsForRead(axisConfig) as typeof axisConfig) : undefined;

  // Group D: Series format backward compatibility on read
  const series = seriesConfigs?.map((s) =>
    normalizeSeriesRefsForRead(deriveSeriesFormatForRead(s)),
  );

  // Group K: Legend entry visible ↔ delete reconciliation on read
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
    trendline: Array.isArray(chart.trendline) ? chart.trendline[0] : chart.trendline,
    trendlines: chart.trendline,
    showLines: chart.showLines,
    smoothLines: chart.smoothLines,
    radarFilled: chart.radarFilled,
    radarMarkers: chart.radarMarkers,
    waterfall: chart.waterfall as Chart['waterfall'],
    displayBlanksAs: chart.displayBlanksAs as Chart['displayBlanksAs'],
    plotVisibleOnly: chart.plotVisibleOnly,
    gapWidth: chart.gapWidth,
    overlap: chart.overlap,
    doughnutHoleSize: chart.doughnutHoleSize,
    firstSliceAngle: chart.firstSliceAngle,
    bubbleScale: chart.bubbleScale,
    splitType: chart.splitType as Chart['splitType'],
    splitValue: chart.splitValue,
    name: chart.name || undefined,
    // rich formatting fields
    style: chart.style,
    roundedCorners: chart.roundedCorners,
    autoTitleDeleted: chart.autoTitleDeleted,
    showDataLabelsOverMaximum: chart.showDataLabelsOverMax,
    chartFormat: chart.chartFormat as Chart['chartFormat'],
    plotFormat: chart.plotFormat as Chart['plotFormat'],
    titleFormat: chart.titleFormat as Chart['titleFormat'],
    titleRichText: chart.titleRichText,
    titleFormula: chart.titleFormula,
    dataTable: chart.dataTable as Chart['dataTable'],
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
    createdAt: chart.createdAt,
    updatedAt: chart.updatedAt,
  };

  // Group A: Attach point-based dimension fields
  if (heightPt !== undefined) result.heightPt = heightPt;
  if (widthPt !== undefined) result.widthPt = widthPt;
  if (leftPt !== undefined) result.leftPt = leftPt;
  if (topPt !== undefined) result.topPt = topPt;

  return result;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Get a chart as the public Chart type, throwing chartNotFound if absent.
 */
async function requireChart(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<Chart> {
  const raw = (await ctx.computeBridge.getChart(sheetId, chartId)) as ChartFloatingObject | null;
  if (!raw) throw chartNotFound(chartId);
  return serializedChartToChart(raw);
}

/**
 * Get a chart and its mutable series array, throwing chartNotFound if absent.
 */
async function requireChartWithSeries(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
): Promise<{ chart: Chart; series: SeriesConfig[] }> {
  const chart = await requireChart(ctx, sheetId, chartId);
  const series = [...(chart.series ?? [])];
  return { chart, series };
}

/**
 * Validate + apply a chart update via the domain layer.
 * Throws on failure (no OperationResult).
 */
async function applyUpdate(
  ctx: DocumentContext,
  sheetId: SheetId,
  chartId: string,
  updates: Partial<ChartConfig>,
): Promise<void> {
  // Ensure chart exists
  const existing = (await ctx.computeBridge.getChart(
    sheetId,
    chartId,
  )) as ChartFloatingObject | null;
  if (!existing) throw chartNotFound(chartId);
  const internalUpdates = chartUpdatesToInternal(updates);
  // Merge partial anchor with existing anchor so the Rust bridge receives a
  // complete anchor object (it doesn't handle partial anchor merges).
  if (internalUpdates.anchor && existing.anchor) {
    internalUpdates.anchor = { ...existing.anchor, ...internalUpdates.anchor };
  }
  await ctx.computeBridge.updateChart(sheetId, chartId, internalUpdates);
}

/**
 * Ensure a series has a points array of at least the required length.
 */
function ensurePointsArray(series: SeriesConfig, minLength: number): PointFormat[] {
  const points = [...(series.points ?? [])];
  while (points.length <= minLength) {
    points.push({ idx: points.length });
  }
  // Ensure every point has idx matching its position
  for (let i = 0; i < points.length; i++) {
    points[i].idx = i;
  }
  return points;
}

// =============================================================================
// Implementation
// =============================================================================

export class WorksheetChartsImpl implements WorksheetCharts {
  /** Monotonic counter to ensure unique chart IDs within the same millisecond. */
  private static _idCounter = 0;

  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
    private readonly exporter?: ChartImageExporter | null,
  ) {}

  // ===========================================================================
  // Core CRUD (Wave 1)
  // ===========================================================================

  async add(config: ChartConfig): Promise<Chart> {
    if (!config.type) throw invalidChartConfig('type is required');
    assertSupportedNativeXlsxChartConfig(config);
    const hasSeriesValues = config.series?.some((s) => s.values);
    if (!config.dataRange && !hasSeriesValues)
      throw invalidChartConfig('dataRange is required when series[].values are not provided');

    // Generate a stable ID once and pass it through the entire pipeline.
    // If the caller already provided an ID (e.g., via config), preserve it.
    // Use a counter suffix to avoid duplicate IDs when multiple charts are
    // created within the same millisecond.
    const chartId =
      (config as { id?: string }).id || `chart-${Date.now()}-${WorksheetChartsImpl._idCounter++}`;
    const configWithId = { ...config, id: chartId } as ChartConfig;
    const internalConfig = chartConfigToInternal(configWithId);
    const result = await this.ctx.computeBridge.createChart(this.sheetId, internalConfig);
    // Extract the actual chart ID assigned by the Rust engine (may differ from our generated ID)
    const change = result?.floatingObjectChanges?.[0];
    const actualId = change?.objectId ?? change?.data?.id ?? chartId;

    // Read back the full chart entity.
    const full = await this.get(actualId);
    if (full) return full;

    // Fallback: return minimal chart from config if read-back fails.
    return {
      id: actualId,
      type: config.type,
      subType: config.subType,
      name: config.name ?? '',
      dataRange: config.dataRange ?? '',
      series: config.series ?? [],
      anchorRow: config.anchorRow ?? 0,
      anchorCol: config.anchorCol ?? 0,
      width: config.width ?? 480,
      height: config.height ?? 300,
    } as Chart;
  }

  async get(chartId: string): Promise<Chart | null> {
    const raw = (await this.ctx.computeBridge.getChart(
      this.sheetId,
      chartId,
    )) as ChartFloatingObject | null;
    return raw ? serializedChartToChart(raw) : null;
  }

  async update(chartId: string, updates: Partial<ChartConfig>): Promise<void> {
    assertSupportedNativeXlsxChartConfig(updates);
    await applyUpdate(this.ctx, this.sheetId, chartId, updates);
  }

  async updateRaw(chartId: string, fields: Record<string, unknown>): Promise<void> {
    await this.ctx.computeBridge.updateChart(this.sheetId, chartId, fields);
  }

  async remove(chartId: string): Promise<void> {
    const existing = (await this.ctx.computeBridge.getChart(
      this.sheetId,
      chartId,
    )) as ChartFloatingObject | null;
    if (!existing) throw chartNotFound(chartId);
    await this.ctx.computeBridge.deleteChart(this.sheetId, chartId);
  }

  async list(): Promise<Chart[]> {
    const charts = (await this.ctx.computeBridge.getAllCharts(
      this.sheetId,
    )) as ChartFloatingObject[];
    return charts.map(serializedChartToChart);
  }

  async clear(): Promise<void> {
    const charts = await this.list();
    for (const chart of charts) {
      await this.remove(chart.id);
    }
  }

  // ===========================================================================
  // Group A: Simple Convenience Methods (2a-2f)
  // ===========================================================================

  async duplicate(chartId: string): Promise<string> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);

    const { id: _id, sheetId: _sheetId, createdAt: _ca, updatedAt: _ua, ...configFields } = chart;
    const config: ChartConfig = {
      ...configFields,
      anchorRow: configFields.anchorRow + 2,
    };

    // Re-use add() which validates and creates
    const newChart = await this.add(config);
    return newChart.id;
  }

  async exportImage(chartId: string, options?: ImageExportOptions): Promise<string> {
    const raw = (await this.ctx.computeBridge.getChart(
      this.sheetId,
      chartId,
    )) as ChartFloatingObject | null;
    if (!raw) throw chartNotFound(chartId);

    if (this.exporter) {
      const dataUrl = await this.exporter.exportImage(this.sheetId, chartId, options);
      if (dataUrl) return dataUrl;
      throw operationFailed('exportChartImage', 'Exporter returned null');
    }

    throw operationFailed('exportChartImage', 'Not implemented in headless mode');
  }

  async setDataRange(chartId: string, range: string): Promise<void> {
    await applyUpdate(this.ctx, this.sheetId, chartId, { dataRange: range });
  }

  async setType(chartId: string, type: ChartType, subType?: string): Promise<void> {
    await applyUpdate(this.ctx, this.sheetId, chartId, {
      type,
      subType: subType as ChartConfig['subType'],
    });
  }

  async has(chartId: string): Promise<boolean> {
    return (await this.get(chartId)) !== null;
  }

  async getCount(): Promise<number> {
    const charts = (await this.ctx.computeBridge.getAllCharts(
      this.sheetId,
    )) as ChartFloatingObject[];
    return charts.length;
  }

  async getByName(name: string): Promise<Chart | null> {
    const charts = await this.list();
    return charts.find((c) => c.name === name) ?? null;
  }

  // ===========================================================================
  // Group B: Z-Order Methods (2g)
  // ===========================================================================

  async bringToFront(chartId: string): Promise<void> {
    await this.ctx.computeBridge.bringChartToFront(this.sheetId, chartId);
  }

  async sendToBack(chartId: string): Promise<void> {
    await this.ctx.computeBridge.sendChartToBack(this.sheetId, chartId);
  }

  async bringForward(chartId: string): Promise<void> {
    await this.ctx.computeBridge.bringChartForward(this.sheetId, chartId);
  }

  async sendBackward(chartId: string): Promise<void> {
    await this.ctx.computeBridge.sendChartBackward(this.sheetId, chartId);
  }

  // ===========================================================================
  // Group C: Table-Linking Methods (2h)
  // ===========================================================================

  async linkToTable(chartId: string, tableId: string): Promise<void> {
    await this.ctx.computeBridge.linkChartToTable(this.sheetId, chartId, tableId);
  }

  async unlinkFromTable(chartId: string): Promise<void> {
    await this.ctx.computeBridge.unlinkChartFromTable(this.sheetId, chartId);
  }

  async isLinkedToTable(chartId: string): Promise<boolean> {
    return this.ctx.computeBridge.isChartLinkedToTable(this.sheetId, chartId);
  }

  // ===========================================================================
  // Group D: Series Methods (2i)
  // ===========================================================================

  async addSeries(chartId: string, config: SeriesConfig): Promise<number> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    series.push(config);
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
    return series.length - 1;
  }

  async removeSeries(chartId: string, index: number): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (index < 0 || index >= series.length) {
      throw operationFailed(
        'removeChartSeries',
        `Series index ${index} out of range (0-${series.length - 1})`,
      );
    }
    series.splice(index, 1);
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async getSeries(chartId: string, index: number): Promise<SeriesConfig> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (index < 0 || index >= series.length) {
      throw operationFailed(
        'getChartSeries',
        `Series index ${index} out of range (0-${series.length - 1})`,
      );
    }
    return series[index];
  }

  async updateSeries(
    chartId: string,
    index: number,
    updates: Partial<SeriesConfig>,
  ): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (index < 0 || index >= series.length) {
      throw operationFailed(
        'updateChartSeries',
        `Series index ${index} out of range (0-${series.length - 1})`,
      );
    }
    series[index] = { ...series[index], ...updates };
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async getSeriesCount(chartId: string): Promise<number> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    return series.length;
  }

  async reorderSeries(chartId: string, fromIndex: number, toIndex: number): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (fromIndex < 0 || fromIndex >= series.length) {
      throw operationFailed(
        'reorderChartSeries',
        `fromIndex ${fromIndex} out of range (0-${series.length - 1})`,
      );
    }
    if (toIndex < 0 || toIndex >= series.length) {
      throw operationFailed(
        'reorderChartSeries',
        `toIndex ${toIndex} out of range (0-${series.length - 1})`,
      );
    }
    const [item] = series.splice(fromIndex, 1);
    series.splice(toIndex, 0, item);
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async setSeriesValues(chartId: string, index: number, range: string): Promise<void> {
    await this.updateSeries(chartId, index, { values: range });
  }

  async setSeriesCategories(chartId: string, index: number, range: string): Promise<void> {
    await this.updateSeries(chartId, index, { categories: range });
  }

  // ===========================================================================
  // Group E: Point Formatting (2j)
  // ===========================================================================

  async formatPoint(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    format: { fill?: string; border?: ChartBorder },
  ): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'formatChartPoint',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }

    const points = ensurePointsArray(series[seriesIndex], pointIndex);
    points[pointIndex] = { ...points[pointIndex], ...format };
    series[seriesIndex] = { ...series[seriesIndex], points };

    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async setPointDataLabel(
    chartId: string,
    seriesIndex: number,
    pointIndex: number,
    config: DataLabelConfig,
  ): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'setChartPointDataLabel',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }

    const points = ensurePointsArray(series[seriesIndex], pointIndex);
    points[pointIndex] = { ...points[pointIndex], dataLabel: config };
    series[seriesIndex] = { ...series[seriesIndex], points };

    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  // ===========================================================================
  // Group F: Trendline CRUD Methods
  // ===========================================================================

  async addTrendline(
    chartId: string,
    seriesIndex: number,
    trendline: TrendlineConfig,
  ): Promise<number> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'addTrendline',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    const trendlines = [...(series[seriesIndex].trendlines ?? [])];
    trendlines.push(trendline);
    series[seriesIndex] = { ...series[seriesIndex], trendlines };
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
    return trendlines.length - 1;
  }

  async removeTrendline(
    chartId: string,
    seriesIndex: number,
    trendlineIndex: number,
  ): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'removeTrendline',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    const trendlines = [...(series[seriesIndex].trendlines ?? [])];
    if (trendlineIndex < 0 || trendlineIndex >= trendlines.length) {
      throw operationFailed(
        'removeTrendline',
        `Trendline index ${trendlineIndex} out of range (0-${trendlines.length - 1})`,
      );
    }
    trendlines.splice(trendlineIndex, 1);
    series[seriesIndex] = { ...series[seriesIndex], trendlines };
    await applyUpdate(this.ctx, this.sheetId, chartId, { series });
  }

  async getTrendline(
    chartId: string,
    seriesIndex: number,
    trendlineIndex: number,
  ): Promise<TrendlineConfig | null> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getTrendline',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    const trendlines = series[seriesIndex].trendlines ?? [];
    if (trendlineIndex < 0 || trendlineIndex >= trendlines.length) return null;
    return trendlines[trendlineIndex] ?? null;
  }

  async getTrendlineCount(chartId: string, seriesIndex: number): Promise<number> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getTrendlineCount',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    return (series[seriesIndex].trendlines ?? []).length;
  }

  // ===========================================================================
  // Group I: Data Table Method
  // ===========================================================================

  async getDataTable(chartId: string): Promise<DataTableConfig | null> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);
    if (!chart.dataTable) return null;
    // Map showKeys ↔ showLegendKey for OfficeJS compatibility
    const dt = chart.dataTable;
    return {
      ...dt,
      showLegendKey: dt.showKeys,
    } as DataTableConfig & { showLegendKey?: boolean };
  }

  // ===========================================================================
  // Group J: Convenience Methods
  // ===========================================================================

  async getItemAt(index: number): Promise<Chart | null> {
    const all = await this.list();
    return all[index] ?? null;
  }

  async setBubbleSizes(chartId: string, seriesIndex: number, range: string): Promise<void> {
    await this.updateSeries(chartId, seriesIndex, { bubbleSize: range });
  }

  // ===========================================================================
  // Group D2: Per-Series Statistical Options
  // ===========================================================================

  async getSeriesBinOptions(chartId: string, seriesIndex: number): Promise<HistogramConfig | null> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getSeriesBinOptions',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    return series[seriesIndex].binOptions ?? null;
  }

  async setSeriesBinOptions(
    chartId: string,
    seriesIndex: number,
    options: HistogramConfig,
  ): Promise<void> {
    await this.updateSeries(chartId, seriesIndex, { binOptions: options });
  }

  async getSeriesBoxwhiskerOptions(
    chartId: string,
    seriesIndex: number,
  ): Promise<BoxplotConfig | null> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getSeriesBoxwhiskerOptions',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    return series[seriesIndex].boxwhiskerOptions ?? null;
  }

  async setSeriesBoxwhiskerOptions(
    chartId: string,
    seriesIndex: number,
    options: BoxplotConfig,
  ): Promise<void> {
    await this.updateSeries(chartId, seriesIndex, { boxwhiskerOptions: options });
  }

  // ===========================================================================
  // Group M: Collection Events
  // ===========================================================================

  /**
   * Register a handler for chart activation events.
   * Wired to EventBus 'chart:selected' events, filtered by sheetId.
   */
  onActivated(handler: (event: { chartId: string }) => void): CallableDisposable {
    const unsub = this.ctx.eventBus.on('chart:selected', (event: any) => {
      if (event.sheetId && event.sheetId !== this.sheetId) return;
      handler({ chartId: event.chartId });
    });
    return toDisposable(unsub);
  }

  /**
   * Register a handler for chart deactivation events.
   * Wired to EventBus 'chart:deselected' events, filtered by sheetId.
   */
  onDeactivated(handler: (event: { chartId: string }) => void): CallableDisposable {
    const unsub = this.ctx.eventBus.on('chart:deselected', (event: any) => {
      if (event.sheetId && event.sheetId !== this.sheetId) return;
      handler({ chartId: event.chartId });
    });
    return toDisposable(unsub);
  }

  // ===========================================================================
  // Layout Retrieval Methods
  // ===========================================================================

  /**
   * Get the plot area layout for a chart.
   * Delegates to ChartBridge.getLayout() and returns the plotArea sub-object.
   */
  async getPlotAreaLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.plotArea) return null;
    return layout.plotArea;
  }

  /**
   * Get the legend layout for a chart.
   * Delegates to ChartBridge.getLayout() and returns the legend sub-object.
   */
  async getLegendLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.legend) return null;
    return layout.legend;
  }

  /**
   * Get the title layout for a chart.
   * Delegates to ChartBridge.getLayout() and returns the title sub-object.
   */
  async getTitleLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.title) return null;
    return layout.title;
  }

  /**
   * Get the data label layout for a chart.
   * Delegates to ChartBridge.getLayout() and returns the dataLabels sub-object.
   */
  async getDataLabelLayout(
    chartId: string,
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    const layout = await this.getChartLayout(chartId);
    if (!layout?.dataLabels) return null;
    return layout.dataLabels;
  }

  /**
   * Internal helper: get the full chart layout snapshot from the chart bridge.
   *
   * Uses `IChartBridge.getLayout()` directly — no concrete-class cast needed
   * now that the interface returns `ChartLayoutSnapshot` (the narrower cached
   * snapshot, not the richer `ChartLayout` used by the charts library).
   */
  private async getChartLayout(chartId: string): Promise<ChartLayoutSnapshot | null> {
    const bridge = this.ctx.charts;
    if (!bridge || typeof bridge.getLayout !== 'function') {
      return null;
    }
    return bridge.getLayout(this.sheetId, chartId);
  }

  // ===========================================================================
  // Axis Methods
  // ===========================================================================

  async getAxisItem(
    chartId: string,
    type: 'category' | 'value' | 'series',
    group: 'primary' | 'secondary',
  ): Promise<SingleAxisConfig | null> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);
    const axis = chart.axis;
    if (!axis) return null;

    if (type === 'series') {
      return axis.seriesAxis ?? null;
    }

    if (group === 'primary') {
      if (type === 'category') return axis.categoryAxis ?? null;
      if (type === 'value') return axis.valueAxis ?? null;
    } else {
      if (type === 'category') return axis.secondaryCategoryAxis ?? null;
      if (type === 'value') return axis.secondaryValueAxis ?? null;
    }

    return null;
  }

  async setAxisTitle(
    chartId: string,
    axisType: 'category' | 'value',
    formula: string,
  ): Promise<void> {
    const chart = await requireChart(this.ctx, this.sheetId, chartId);
    const axis = { ...(chart.axis ?? {}) };

    if (axisType === 'category') {
      axis.categoryAxis = { ...(axis.categoryAxis ?? { visible: true }), title: formula };
    } else {
      axis.valueAxis = { ...(axis.valueAxis ?? { visible: true }), title: formula };
    }

    await applyUpdate(this.ctx, this.sheetId, chartId, { axis });
  }

  async setCategoryNames(chartId: string, range: string): Promise<void> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    const updatedSeries = series.map((s) => ({ ...s, categories: range }));
    await applyUpdate(this.ctx, this.sheetId, chartId, { series: updatedSeries });
  }

  // ===========================================================================
  // Series Dimension Methods
  // ===========================================================================

  async getSeriesDimensionValues(
    chartId: string,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<(string | number)[]> {
    const sourceString = await this.getSeriesDimensionDataSourceString(
      chartId,
      seriesIndex,
      dimension,
    );
    if (!sourceString) return [];

    const sourceType = await this.getSeriesDimensionDataSourceType(chartId, seriesIndex, dimension);

    if (sourceType === 'range') {
      // Parse the range reference and read cell values from the compute bridge
      const rangeRef = await this.ctx.computeBridge.parseRangeRef(sourceString);
      if (!rangeRef) return [];

      // A1RangeRef has { start: A1CellRef, end: A1CellRef, sheetName: string | null }
      // A1CellRef has { row: number, col: number, rowAbsolute: boolean, colAbsolute: boolean }
      const startRow = rangeRef.start.row;
      const startCol = rangeRef.start.col;
      const endRow = rangeRef.end.row;
      const endCol = rangeRef.end.col;

      // Use sheetName to resolve sheetId if present, otherwise use current sheet
      // Note: sheetName resolution would require a sheet name->id lookup;
      // for now we use the current sheet as the most common case
      const sheetId = this.sheetId;

      const values2d = await this.ctx.computeBridge.getRangeValues2d(
        sheetId,
        startRow,
        startCol,
        endRow,
        endCol,
      );

      // Flatten 2D values into a 1D array, filtering out nulls and errors
      const result: (string | number)[] = [];
      for (const row of values2d) {
        for (const cell of row) {
          if (typeof cell === 'string' || typeof cell === 'number') {
            result.push(cell);
          }
        }
      }
      return result;
    }

    // Literal: parse comma-separated or JSON-encoded values
    try {
      const parsed = JSON.parse(sourceString);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (v): v is string | number => typeof v === 'string' || typeof v === 'number',
        );
      }
    } catch {
      // Not JSON — try comma-separated
    }

    // Comma-separated literal values
    return sourceString
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        const num = Number(s);
        return isNaN(num) ? s : num;
      });
  }

  async getSeriesDimensionDataSourceString(
    chartId: string,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<string> {
    const { series } = await requireChartWithSeries(this.ctx, this.sheetId, chartId);
    if (seriesIndex < 0 || seriesIndex >= series.length) {
      throw operationFailed(
        'getSeriesDimensionDataSourceString',
        `Series index ${seriesIndex} out of range (0-${series.length - 1})`,
      );
    }
    const s = series[seriesIndex];
    switch (dimension) {
      case 'categories':
        return s.categories ?? '';
      case 'values':
        return s.values ?? '';
      case 'bubbleSizes':
        return s.bubbleSize ?? '';
      default:
        return '';
    }
  }

  async getSeriesDimensionDataSourceType(
    chartId: string,
    seriesIndex: number,
    dimension: ChartSeriesDimension,
  ): Promise<string> {
    const sourceString = await this.getSeriesDimensionDataSourceString(
      chartId,
      seriesIndex,
      dimension,
    );
    if (!sourceString) return 'literal';
    // If it looks like a cell range (contains sheet reference or A1 notation), it's a range
    if (/[A-Z]+\d+/i.test(sourceString) || sourceString.includes('!')) return 'range';
    return 'formula';
  }

  // ===========================================================================
  // Data Label Methods
  // ===========================================================================

  async getDataLabelSubstring(
    _chartId: string,
    _seriesIndex: number,
    _pointIndex: number,
    _start: number,
    _length: number,
  ): Promise<ChartFormatString> {
    // Stub: requires rich text model for data labels.
    return { text: '' };
  }

  async setDataLabelHeight(
    _chartId: string,
    _seriesIndex: number,
    _pointIndex: number,
    _value: number,
  ): Promise<void> {
    // Stub: layout dimensions interact with the render engine.
    throw operationFailed('setDataLabelHeight', 'Not implemented');
  }

  async setDataLabelWidth(
    _chartId: string,
    _seriesIndex: number,
    _pointIndex: number,
    _value: number,
  ): Promise<void> {
    // Stub: layout dimensions interact with the render engine.
    throw operationFailed('setDataLabelWidth', 'Not implemented');
  }

  async getDataLabelTailAnchor(
    _chartId: string,
    _seriesIndex: number,
    _pointIndex: number,
  ): Promise<{ row: number; col: number }> {
    // Stub: requires render engine layout data.
    return { row: 0, col: 0 };
  }

  // ===========================================================================
  // Title Methods
  // ===========================================================================

  async setTitleFormula(chartId: string, formula: string): Promise<void> {
    // Store formula as title text. Display value resolution requires compute bridge.
    await applyUpdate(this.ctx, this.sheetId, chartId, { title: formula });
  }

  async getTitleSubstring(
    _chartId: string,
    _start: number,
    _length: number,
  ): Promise<ChartFormatString> {
    // Stub: requires rich text model for titles.
    return { text: '' };
  }

  // ===========================================================================
  // Chart Activation
  // ===========================================================================

  async activate(chartId: string): Promise<void> {
    // Verify chart exists
    const raw = (await this.ctx.computeBridge.getChart(
      this.sheetId,
      chartId,
    )) as ChartFloatingObject | null;
    if (!raw) throw chartNotFound(chartId);

    // Emit activation event. Shell layer handles scroll/focus.
    this.ctx.eventBus.emit({
      type: 'chart:selected',
      sheetId: this.sheetId,
      chartId,
    } as never);
  }
}
