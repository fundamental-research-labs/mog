/**
 * Chart wire ↔ config converters.
 *
 * ## Why this module exists
 *
 * There are two parallel chart type hierarchies in the codebase:
 *
 * 1. **Wire** (`*Data` in `bridges/compute/compute-types.gen.ts`) — generated
 *    from Rust serde. Enum fields are plain `string` because the Rust-side
 *    enums weren't emitted as literal unions.
 * 2. **Contracts** (`*Config` in `contracts/src/data/charts.ts`) — public API,
 *    hand-written, uses string-literal unions on enum fields.
 *
 * These two hierarchies carry the same runtime data, but the types disagree:
 * a `DataLabelData.position: string | undefined` is *not* assignable to
 * `DataLabelConfig.position: "top" | "bottom" | ... | undefined`. Cast
 * shortcuts (`as DataLabelConfig`, `as unknown as SeriesConfig[]`) silently
 * smuggle unvalidated strings into the public contract.
 *
 * This module provides the **only sanctioned boundary**. The narrowing
 * direction (`wire*ToConfig`) validates each enum string against the
 * contract's literal union and returns `undefined` on violation (dropping
 * the unknown value rather than propagating it). The widening direction
 * (`config*ToWire`) simply re-types — `string-literal → string` is always
 * safe.
 *
 * Outside this module, kernel code MUST NOT import both a `*Data` and a
 * `*Config` type in the same file.
 */

import type {
  AxisData,
  ChartLineData,
  ChartSeriesData,
  DataLabelData,
  LegendData,
  PointFormatData,
  SingleAxisData,
} from '../../bridges/compute/compute-types.gen';

import type {
  AxisConfig,
  ChartLeaderLinesFormat,
  DataLabelConfig,
  LegendConfig,
  MarkerStyle,
  PointFormat,
  SeriesConfig,
  SingleAxisConfig,
} from '@mog-sdk/contracts/data/charts';

// =============================================================================
// Literal-union tables — authoritative allow-lists for narrowing.
//
// Each table mirrors the literal union on the corresponding *Config field in
// contracts/src/data/charts.ts. If the contract adds or removes a value, the
// matching array must be updated — a mismatch here is a silent bug.
// =============================================================================

const DATA_LABEL_POSITIONS = [
  'center',
  'insideEnd',
  'insideBase',
  'outsideEnd',
  'left',
  'right',
  'top',
  'bottom',
  'bestFit',
  'callout',
  'outside',
  'inside',
] as const;
type DataLabelPosition = (typeof DATA_LABEL_POSITIONS)[number];

const TEXT_H_ALIGNMENTS = ['left', 'center', 'right', 'justify', 'distributed'] as const;
type TextHAlignment = (typeof TEXT_H_ALIGNMENTS)[number];

const TEXT_V_ALIGNMENTS = ['top', 'middle', 'bottom', 'justify', 'distributed'] as const;
type TextVAlignment = (typeof TEXT_V_ALIGNMENTS)[number];

const SCALE_TYPES = ['linear', 'logarithmic'] as const;
type ScaleType = (typeof SCALE_TYPES)[number];

const CATEGORY_TYPES = ['automatic', 'textAxis', 'dateAxis'] as const;
type CategoryType = (typeof CATEGORY_TYPES)[number];

const CROSSES_AT = ['automatic', 'max', 'min', 'custom'] as const;
type CrossesAt = (typeof CROSSES_AT)[number];

const MARKER_STYLES = [
  'circle',
  'dash',
  'diamond',
  'dot',
  'none',
  'picture',
  'plus',
  'square',
  'star',
  'triangle',
  'x',
  'auto',
] as const;

/**
 * Narrow a loose wire string into one of the allowed literals, or
 * `undefined` if the wire value is absent or violates the contract.
 *
 * This is the ONLY place the kernel narrows a wire enum. Returning
 * `undefined` on an unknown value drops the bad data rather than
 * crashing — all `*Config` enum fields are optional so this is the
 * safe choice — but a debug-mode assertion is emitted so the drift is
 * visible in development.
 */
function narrowEnum<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fieldName: string,
): T | undefined {
  if (value == null) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  // Unknown wire string — drop rather than smuggle into the public contract.
  // A louder signal (warning or throw) can be wired in later; dropping matches
  // the field's `?: T` shape which already allows undefined.
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(
      `[chart-type-converters] dropping unknown ${fieldName}="${value}" — not in allowed set`,
    );
  }
  return undefined;
}

// =============================================================================
// Wire → Config (narrowing — validates enum strings against contract unions)
// =============================================================================

/** Convert a wire SingleAxisData to the contract SingleAxisConfig. */
export function wireToSingleAxisConfig(w: SingleAxisData): SingleAxisConfig {
  return {
    // structural fields (no narrowing needed)
    title: w.title,
    visible: w.visible,
    min: w.min,
    max: w.max,
    axisType: w.axisType,
    gridLines: w.gridLines,
    minorGridLines: w.minorGridLines,
    majorUnit: w.majorUnit,
    minorUnit: w.minorUnit,
    tickMarks: w.tickMarks,
    minorTickMarks: w.minorTickMarks,
    numberFormat: w.numberFormat,
    reverse: w.reverse,
    position: w.position,
    logBase: w.logBase,
    displayUnit: w.displayUnit,
    format: w.format,
    titleFormat: w.titleFormat,
    gridlineFormat: w.gridlineFormat,
    minorGridlineFormat: w.minorGridlineFormat,
    crossBetween: w.crossBetween,
    tickLabelPosition: w.tickLabelPosition,
    baseTimeUnit: w.baseTimeUnit,
    majorTimeUnit: w.majorTimeUnit,
    minorTimeUnit: w.minorTimeUnit,
    customDisplayUnit: w.customDisplayUnit,
    displayUnitLabel: w.displayUnitLabel,
    labelAlignment: w.labelAlignment,
    labelOffset: w.labelOffset,
    noMultiLevelLabels: w.noMultiLevelLabels,
    titleVisible: w.titleVisible,
    tickLabelSpacing: w.tickLabelSpacing,
    tickMarkSpacing: w.tickMarkSpacing,
    linkNumberFormat: w.linkNumberFormat,
    isBetweenCategories: w.isBetweenCategories,
    textOrientation: w.textOrientation,
    alignment: w.alignment,
    // narrowed enums — return undefined for unknown wire values
    scaleType: narrowEnum<ScaleType>(w.scaleType, SCALE_TYPES, 'SingleAxis.scaleType'),
    categoryType: narrowEnum<CategoryType>(
      w.categoryType,
      CATEGORY_TYPES,
      'SingleAxis.categoryType',
    ),
    crossesAt: narrowEnum<CrossesAt>(w.crossesAt, CROSSES_AT, 'SingleAxis.crossesAt'),
    crossesAtValue: w.crossesAtValue,
  };
}

/** Convert a wire AxisData to the contract AxisConfig. */
export function wireToAxisConfig(w: AxisData): AxisConfig {
  return {
    categoryAxis: w.categoryAxis ? wireToSingleAxisConfig(w.categoryAxis) : undefined,
    valueAxis: w.valueAxis ? wireToSingleAxisConfig(w.valueAxis) : undefined,
    secondaryCategoryAxis: w.secondaryCategoryAxis
      ? wireToSingleAxisConfig(w.secondaryCategoryAxis)
      : undefined,
    secondaryValueAxis: w.secondaryValueAxis
      ? wireToSingleAxisConfig(w.secondaryValueAxis)
      : undefined,
    seriesAxis: w.seriesAxis ? wireToSingleAxisConfig(w.seriesAxis) : undefined,
  };
}

/** Convert a wire LegendData to the contract LegendConfig. */
export function wireToLegendConfig(w: LegendData): LegendConfig {
  const visible = w.visible === true || w.show === true;
  return {
    show: visible,
    position: w.position,
    visible,
    overlay: w.overlay,
    format: w.format,
    entries: w.entries,
    customX: w.customX,
    customY: w.customY,
    shadow: w.shadow,
    showShadow: w.showShadow,
  };
}

/** Convert a wire ChartLineData to the contract ChartLeaderLinesFormat. */
export function wireToLeaderLinesFormat(w: ChartLineData): ChartLeaderLinesFormat {
  // ChartLeaderLinesFormat wraps a ChartLineFormat under `format`.
  // Wire `color` is `string | { theme, tint_shade? }`; contract is
  // `string | { theme, tintShade? }`. Snake→camel rename on theme variant.
  let color: ChartLeaderLinesFormat['format']['color'];
  if (typeof w.color === 'string') {
    color = w.color;
  } else if (w.color && typeof w.color === 'object') {
    const t = w.color as { theme: string; tint_shade?: number };
    color = { theme: t.theme, tintShade: t.tint_shade };
  }
  return {
    format: {
      color,
      width: w.width,
      dashStyle: w.dashStyle,
      transparency: w.transparency,
    },
  };
}

/** Convert a wire DataLabelData to the contract DataLabelConfig. */
export function wireToDataLabelConfig(w: DataLabelData): DataLabelConfig {
  return {
    show: w.show,
    position: narrowEnum<DataLabelPosition>(w.position, DATA_LABEL_POSITIONS, 'DataLabel.position'),
    format: w.format,
    showValue: w.showValue,
    showCategoryName: w.showCategoryName,
    showSeriesName: w.showSeriesName,
    showPercentage: w.showPercentage,
    showBubbleSize: w.showBubbleSize,
    showLegendKey: w.showLegendKey,
    separator: w.separator,
    showLeaderLines: w.showLeaderLines,
    text: w.text,
    visualFormat: w.visualFormat,
    numberFormat: w.numberFormat,
    textOrientation: w.textOrientation,
    richText: w.richText,
    autoText: w.autoText,
    horizontalAlignment: narrowEnum<TextHAlignment>(
      w.horizontalAlignment,
      TEXT_H_ALIGNMENTS,
      'DataLabel.horizontalAlignment',
    ),
    verticalAlignment: narrowEnum<TextVAlignment>(
      w.verticalAlignment,
      TEXT_V_ALIGNMENTS,
      'DataLabel.verticalAlignment',
    ),
    linkNumberFormat: w.linkNumberFormat,
    geometricShapeType: w.geometricShapeType,
    formula: w.formula,
    leaderLinesFormat: w.leaderLinesFormat
      ? wireToLeaderLinesFormat(w.leaderLinesFormat)
      : undefined,
  };
}

/** Convert a wire PointFormatData to the contract PointFormat. */
export function wireToPointFormat(w: PointFormatData): PointFormat {
  return {
    idx: w.idx,
    fill: w.fill,
    border: w.border,
    dataLabel: w.dataLabel ? wireToDataLabelConfig(w.dataLabel) : undefined,
    visualFormat: w.visualFormat,
    markerBackgroundColor: w.markerBackgroundColor,
    markerForegroundColor: w.markerForegroundColor,
    markerSize: w.markerSize,
    markerStyle: narrowEnum<MarkerStyle>(w.markerStyle, MARKER_STYLES, 'Point.markerStyle'),
  };
}

/** Convert a wire ChartSeriesData to the contract SeriesConfig. */
export function wireToSeriesConfig(w: ChartSeriesData): SeriesConfig {
  return {
    name: w.name,
    // SeriesConfig.type is an unrestricted string on the contract side —
    // chart-type strings are validated at the chart level, not here.
    type: w.type,
    color: w.color,
    values: w.values,
    categories: w.categories,
    bubbleSize: w.bubbleSize,
    smooth: w.smooth,
    explosion: w.explosion,
    invertIfNegative: w.invertIfNegative,
    yAxisIndex: w.yAxisIndex,
    showMarkers: w.showMarkers,
    markerSize: w.markerSize,
    // SeriesConfig.markerStyle is an unrestricted string on the contract;
    // per-point `PointFormat.markerStyle` is the narrowed one.
    markerStyle: w.markerStyle,
    lineWidth: w.lineWidth,
    points: w.points?.map(wireToPointFormat),
    dataLabels: w.dataLabels ? wireToDataLabelConfig(w.dataLabels) : undefined,
    trendlines: w.trendlines,
    errorBars: w.errorBars,
    xErrorBars: w.xErrorBars,
    yErrorBars: w.yErrorBars,
    idx: w.idx,
    order: w.order,
    format: w.format,
    barShape: w.barShape,
    invertColor: w.invertColor,
    markerBackgroundColor: w.markerBackgroundColor,
    markerForegroundColor: w.markerForegroundColor,
    filtered: w.filtered,
    showShadow: w.showShadow,
    showConnectorLines: w.showConnectorLines,
    leaderLineFormat: w.leaderLineFormat,
    showLeaderLines: w.showLeaderLines,
  };
}

/** Convert an array of wire ChartSeriesData to SeriesConfig[]. */
export function wireToSeriesConfigArray(w: ChartSeriesData[]): SeriesConfig[] {
  return w.map(wireToSeriesConfig);
}

// =============================================================================
// Config → Wire (widening — string-literal unions → plain strings is trivial)
// =============================================================================

/** Convert contract SingleAxisConfig to wire SingleAxisData. */
export function singleAxisConfigToWire(c: SingleAxisConfig): SingleAxisData {
  return {
    title: c.title,
    visible: c.visible,
    min: c.min,
    max: c.max,
    axisType: c.axisType,
    gridLines: c.gridLines,
    minorGridLines: c.minorGridLines,
    majorUnit: c.majorUnit,
    minorUnit: c.minorUnit,
    tickMarks: c.tickMarks,
    minorTickMarks: c.minorTickMarks,
    numberFormat: c.numberFormat,
    reverse: c.reverse,
    position: c.position,
    logBase: c.logBase,
    displayUnit: c.displayUnit,
    format: c.format,
    titleFormat: c.titleFormat,
    gridlineFormat: c.gridlineFormat,
    minorGridlineFormat: c.minorGridlineFormat,
    crossBetween: c.crossBetween,
    tickLabelPosition: c.tickLabelPosition,
    baseTimeUnit: c.baseTimeUnit,
    majorTimeUnit: c.majorTimeUnit,
    minorTimeUnit: c.minorTimeUnit,
    customDisplayUnit: c.customDisplayUnit,
    displayUnitLabel: c.displayUnitLabel,
    labelAlignment: c.labelAlignment,
    labelOffset: c.labelOffset,
    noMultiLevelLabels: c.noMultiLevelLabels,
    titleVisible: c.titleVisible,
    tickLabelSpacing: c.tickLabelSpacing,
    tickMarkSpacing: c.tickMarkSpacing,
    linkNumberFormat: c.linkNumberFormat,
    // literal → string: widen
    scaleType: c.scaleType,
    categoryType: c.categoryType,
    crossesAt: c.crossesAt,
    crossesAtValue: c.crossesAtValue,
    isBetweenCategories: c.isBetweenCategories,
    textOrientation: c.textOrientation,
    alignment: c.alignment,
  };
}

/** Convert contract AxisConfig to wire AxisData. */
export function axisConfigToWire(c: AxisConfig): AxisData {
  return {
    categoryAxis: c.categoryAxis ? singleAxisConfigToWire(c.categoryAxis) : undefined,
    valueAxis: c.valueAxis ? singleAxisConfigToWire(c.valueAxis) : undefined,
    secondaryCategoryAxis: c.secondaryCategoryAxis
      ? singleAxisConfigToWire(c.secondaryCategoryAxis)
      : undefined,
    secondaryValueAxis: c.secondaryValueAxis
      ? singleAxisConfigToWire(c.secondaryValueAxis)
      : undefined,
    seriesAxis: c.seriesAxis ? singleAxisConfigToWire(c.seriesAxis) : undefined,
  };
}

/** Convert contract LegendConfig to wire LegendData. */
export function legendConfigToWire(c: LegendConfig): LegendData {
  return {
    show: c.show,
    position: c.position,
    visible: c.visible,
    overlay: c.overlay,
    format: c.format,
    entries: c.entries,
    customX: c.customX,
    customY: c.customY,
    shadow: c.shadow,
    showShadow: c.showShadow,
  };
}

/** Convert contract ChartLeaderLinesFormat to wire ChartLineData. */
export function leaderLinesFormatToWire(c: ChartLeaderLinesFormat): ChartLineData {
  // Contract color is `string | { theme, tintShade? }`; wire is
  // `string | { theme, tint_shade? }`. Re-emit with snake-case.
  let color: ChartLineData['color'];
  if (typeof c.format.color === 'string') {
    color = c.format.color;
  } else if (c.format.color && typeof c.format.color === 'object') {
    color = { theme: c.format.color.theme, tint_shade: c.format.color.tintShade };
  }
  return {
    color,
    width: c.format.width,
    dashStyle: c.format.dashStyle,
    transparency: c.format.transparency,
  };
}

/** Convert contract DataLabelConfig to wire DataLabelData. */
export function dataLabelConfigToWire(c: DataLabelConfig): DataLabelData {
  return {
    show: c.show,
    position: c.position,
    format: c.format,
    showValue: c.showValue,
    showCategoryName: c.showCategoryName,
    showSeriesName: c.showSeriesName,
    showPercentage: c.showPercentage,
    showBubbleSize: c.showBubbleSize,
    showLegendKey: c.showLegendKey,
    separator: c.separator,
    showLeaderLines: c.showLeaderLines,
    text: c.text,
    visualFormat: c.visualFormat,
    numberFormat: c.numberFormat,
    textOrientation: c.textOrientation,
    richText: c.richText,
    autoText: c.autoText,
    horizontalAlignment: c.horizontalAlignment,
    verticalAlignment: c.verticalAlignment,
    linkNumberFormat: c.linkNumberFormat,
    geometricShapeType: c.geometricShapeType,
    formula: c.formula,
    leaderLinesFormat: c.leaderLinesFormat
      ? leaderLinesFormatToWire(c.leaderLinesFormat)
      : undefined,
  };
}

/** Convert contract PointFormat to wire PointFormatData. */
export function pointFormatToWire(c: PointFormat): PointFormatData {
  return {
    idx: c.idx,
    fill: c.fill,
    border: c.border,
    dataLabel: c.dataLabel ? dataLabelConfigToWire(c.dataLabel) : undefined,
    visualFormat: c.visualFormat,
    markerBackgroundColor: c.markerBackgroundColor,
    markerForegroundColor: c.markerForegroundColor,
    markerSize: c.markerSize,
    markerStyle: c.markerStyle,
  };
}

/** Convert contract SeriesConfig to wire ChartSeriesData. */
export function seriesConfigToWire(c: SeriesConfig): ChartSeriesData {
  return {
    name: c.name,
    type: c.type,
    color: c.color,
    values: c.values,
    categories: c.categories,
    bubbleSize: c.bubbleSize,
    smooth: c.smooth,
    explosion: c.explosion,
    invertIfNegative: c.invertIfNegative,
    yAxisIndex: c.yAxisIndex,
    showMarkers: c.showMarkers,
    markerSize: c.markerSize,
    markerStyle: c.markerStyle,
    lineWidth: c.lineWidth,
    points: c.points?.map(pointFormatToWire),
    dataLabels: c.dataLabels ? dataLabelConfigToWire(c.dataLabels) : undefined,
    trendlines: c.trendlines,
    errorBars: c.errorBars,
    xErrorBars: c.xErrorBars,
    yErrorBars: c.yErrorBars,
    idx: c.idx,
    order: c.order,
    format: c.format,
    barShape: c.barShape,
    invertColor: c.invertColor,
    markerBackgroundColor: c.markerBackgroundColor,
    markerForegroundColor: c.markerForegroundColor,
    filtered: c.filtered,
    showShadow: c.showShadow,
    showConnectorLines: c.showConnectorLines,
    leaderLineFormat: c.leaderLineFormat,
    showLeaderLines: c.showLeaderLines,
  };
}

/** Convert contract SeriesConfig[] to wire ChartSeriesData[]. */
export function seriesConfigArrayToWire(c: SeriesConfig[]): ChartSeriesData[] {
  return c.map(seriesConfigToWire);
}
