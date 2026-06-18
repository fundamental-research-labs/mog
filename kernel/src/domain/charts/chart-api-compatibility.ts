/**
 * Compatibility normalization for the public worksheet chart API.
 *
 * These helpers reconcile legacy/OfficeJS-facing field names with the internal
 * chart model. They are pure boundary logic: no worksheet context, no bridge
 * calls, and no API facade state.
 */

import type { ChartConfig, ChartColor, ChartType, SeriesConfig } from '@mog-sdk/contracts/data/charts';
import { parseCellRange, quoteSheetName, toA1 } from '@mog/spreadsheet-utils/a1';

type AnyAxisConfig = Record<string, unknown>;

function isDegreeTextRotation(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 90;
}

/**
 * Derive OfficeJS-compatible axis fields on read.
 * E.g., scaleType = 'logarithmic' when axisType === 'log', isBetweenCategories from crossBetween.
 */
export function deriveAxisFieldsForRead(axis: unknown): typeof axis {
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
    // textOrientation is a degree rotation field. OOXML vertical text mode is
    // carried separately as format.textVerticalType and large Excel sentinel
    // values like -1000 are not label rotation degrees.
    const fmt = s.format as AnyAxisConfig | undefined;
    if (isDegreeTextRotation(fmt?.textRotation)) {
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
    seriesAxis: deriveOne(axisObj.seriesAxis),
    xAxis: deriveOne(axisObj.xAxis),
    yAxis: deriveOne(axisObj.yAxis),
    secondaryYAxis: deriveOne(axisObj.secondaryYAxis),
  };
}

/**
 * Sync OfficeJS axis fields to internal storage on write.
 * E.g., scaleType 'logarithmic' -> axisType 'log'.
 */
export function syncAxisFieldsToInternal(axis: unknown): typeof axis {
  if (!axis || typeof axis !== 'object') return axis;
  const axisObj = axis as Record<string, unknown>;
  const syncOne = (single: unknown): unknown => {
    if (!single || typeof single !== 'object') return single;
    const s = { ...(single as AnyAxisConfig) };
    // scaleType -> axisType
    if (s.scaleType === 'logarithmic') {
      s.axisType = 'log';
    } else if (s.scaleType === 'linear' && s.axisType == null) {
      s.axisType = 'value';
    }
    // isBetweenCategories -> crossBetween
    if (s.isBetweenCategories === true) {
      s.crossBetween = 'between';
    } else if (s.isBetweenCategories === false) {
      s.crossBetween = 'midCat';
    }
    // textOrientation -> format.textRotation only for true degree rotations.
    if (isDegreeTextRotation(s.textOrientation)) {
      const fmt = (s.format ?? {}) as AnyAxisConfig;
      s.format = { ...fmt, textRotation: s.textOrientation };
    }
    // alignment -> labelAlignment
    if (s.alignment != null) {
      s.labelAlignment = s.alignment;
    }
    // crossesAt -> position-based mapping
    if (s.crossesAt === 'maximum') {
      s.position = 'max';
    } else if (s.crossesAt === 'minimum') {
      s.position = 'min';
    } else if (s.crossesAt === 'automatic') {
      // default crossing - no explicit position needed
    }
    // crossesAtValue -> direct numeric crossing
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
    seriesAxis: syncOne(axisObj.seriesAxis),
    xAxis: syncOne(axisObj.xAxis),
    yAxis: syncOne(axisObj.yAxis),
    secondaryYAxis: syncOne(axisObj.secondaryYAxis),
  };
}

const LINE_COLOR_SERIES_TYPES = new Set<string>([
  'line',
  'line3d',
  'line3D',
  'lineMarkers',
  'lineMarkersStacked',
  'lineMarkersStacked100',
  'radar',
  'scatter',
  'stock',
]);

function seriesColorPrefersLine(series: SeriesConfig, chartType?: ChartType | string): boolean {
  const effectiveType = typeof series.type === 'string' ? series.type : chartType;
  return typeof effectiveType === 'string' && LINE_COLOR_SERIES_TYPES.has(effectiveType);
}

function directColorString(color: ChartColor | undefined): string | undefined {
  return typeof color === 'string' ? color : undefined;
}

function legacyColorFromSeriesFormat(
  series: SeriesConfig,
  chartType?: ChartType | string,
): string | undefined {
  const fill = series.format?.fill;
  const fillColor =
    fill && typeof fill === 'object' && 'type' in fill && fill.type === 'solid'
      ? directColorString(fill.color)
      : undefined;
  const lineColor = directColorString(series.format?.line?.color);
  const hasLineRenderedTraits =
    lineColor !== undefined &&
    fillColor === undefined &&
    (series.showLines === true || series.showMarkers === true);

  return seriesColorPrefersLine(series, chartType) || hasLineRenderedTraits
    ? (lineColor ?? fillColor)
    : fillColor;
}

/**
 * On read: derive legacy `color` and `lineWidth` from `format`.
 *
 * `series.color` is a public compatibility alias over the dominant series
 * color. Fill-backed chart families read it from solid fill; line-backed
 * families read it from line color, falling back to fill for legacy files that
 * stored line-family colors there.
 */
export function deriveSeriesFormatForRead(
  series: SeriesConfig,
  chartType?: ChartType | string,
): SeriesConfig {
  if (!series) return series;
  const result = { ...series };
  // D1: If `format` carries the family-appropriate dominant color and
  // `series.color` is not set, populate the legacy public alias.
  const color = legacyColorFromSeriesFormat(series, chartType);
  if (color && !series.color) {
    result.color = color;
  }
  // D2: If format.line.width is set and series.lineWidth is not, populate lineWidth
  if (series.format?.line?.width != null && series.lineWidth == null) {
    result.lineWidth = series.format.line.width;
  }
  return result;
}

function rangeToPublicA1(range: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  sheetName?: string | null;
}): string {
  const ref = `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`;
  return range.sheetName ? `${quoteSheetName(range.sheetName)}!${ref}` : ref;
}

/**
 * Public chart read APIs expose parseable A1 refs, while internal chart
 * storage/export preserves imported OOXML-style refs with absolute markers.
 */
export function normalizeChartA1RefForRead(ref: string | undefined): string | undefined {
  if (!ref) return ref;
  const parsed = parseCellRange(ref);
  if (!parsed) return ref;
  return rangeToPublicA1(parsed);
}

export function normalizeSeriesRefsForRead(series: SeriesConfig): SeriesConfig {
  return {
    ...series,
    values: normalizeChartA1RefForRead(series.values),
    categories: normalizeChartA1RefForRead(series.categories),
    bubbleSize: normalizeChartA1RefForRead(series.bubbleSize),
  };
}

/**
 * On write: if legacy `color` is set and `format` is not, store in `color`.
 * If `format` carries the family-appropriate dominant color, ensure color
 * stays in sync for backward-compatible readers.
 */
export function syncSeriesFormatToInternal(
  series: SeriesConfig,
  chartType?: ChartType | string,
): SeriesConfig {
  if (!series) return series;
  const result = { ...series };
  // D1: If color is set on write, keep it as-is. Otherwise sync from format.
  const color = legacyColorFromSeriesFormat(series, chartType);
  if (color && !series.color) {
    result.color = color;
  }
  // D2: If lineWidth is set on write and format.line is not, keep lineWidth as-is
  // If format.line.width is set, also sync lineWidth
  if (series.format?.line?.width != null && series.lineWidth == null) {
    result.lineWidth = series.format.line.width;
  }
  return result;
}

/**
 * On read: derive `visible = !(entry.delete ?? false)` for each legend entry.
 */
export function deriveLegendEntriesForRead(legend: unknown): typeof legend {
  if (!legend || typeof legend !== 'object') return legend;
  const legendObj = legend as Record<string, unknown>;

  // Reconcile show <-> visible: if either is true, both should be true.
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
 * On write: sync `show <-> visible` and `delete = !visible` for each legend entry.
 */
export function syncLegendEntriesToInternal(legend: unknown): typeof legend {
  if (!legend || typeof legend !== 'object') return legend;
  const legendObj = legend as Record<string, unknown>;

  // Reconcile show <-> visible on write
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
 *   Rust canonical -> legacy alias
 *   showCategoryName -> showCategory
 *   showPercentage   -> showPercent
 */
export function deriveDataLabelsForRead(dataLabels: unknown): typeof dataLabels {
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
 *   showCategory -> showCategoryName
 *   showPercent  -> showPercentage
 */
export function syncDataLabelsToInternal(dataLabels: unknown): typeof dataLabels {
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

export function isExplicitDisplayBlanksAs(
  value: unknown,
): value is NonNullable<ChartConfig['displayBlanksAs']> {
  return value === 'gap' || value === 'span' || value === 'zero';
}
