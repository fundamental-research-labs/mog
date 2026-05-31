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
  BoxplotConfigData,
  ChartLineData,
  ChartSeriesData,
  DataLabelData,
  ErrorBarData,
  HierarchyChartConfigData,
  HistogramConfigData,
  LegendData,
  PointFormatData,
  RegionMapConfigData,
  SingleAxisData,
  TrendlineData,
  WaterfallOptions,
} from '../../bridges/compute/compute-types.gen';

import type {
  AxisConfig,
  BoxplotConfig,
  ChartLeaderLinesFormat,
  ChartLineFormat,
  ChartLineSettings,
  ChartType,
  DataLabelConfig,
  ErrorBarConfig,
  HierarchyChartConfig,
  HistogramConfig,
  LegendConfig,
  ManualLayout,
  MarkerStyle,
  PointFormat,
  RegionMapConfig,
  SeriesConfig,
  SingleAxisConfig,
  TrendlineConfig,
  UpDownBarsConfig,
  WaterfallConfig,
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

const MANUAL_LAYOUT_TARGETS = ['inner', 'outer'] as const;
type ManualLayoutTarget = (typeof MANUAL_LAYOUT_TARGETS)[number];

const MANUAL_LAYOUT_MODES = ['edge', 'factor'] as const;
type ManualLayoutMode = (typeof MANUAL_LAYOUT_MODES)[number];

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

const CHART_TYPES = [
  'bar',
  'column',
  'line',
  'area',
  'pie',
  'doughnut',
  'scatter',
  'bubble',
  'combo',
  'radar',
  'stock',
  'funnel',
  'waterfall',
  'surface',
  'surface3d',
  'ofPie',
  'bar3d',
  'column3d',
  'line3d',
  'pie3d',
  'area3d',
  'histogram',
  'boxplot',
  'heatmap',
  'violin',
  'pareto',
  'treemap',
  'sunburst',
  'regionMap',
  'pieExploded',
  'pie3dExploded',
  'doughnutExploded',
  'bubble3DEffect',
  'surfaceWireframe',
  'surfaceTopView',
  'surfaceTopViewWireframe',
  'lineMarkers',
  'lineMarkersStacked',
  'lineMarkersStacked100',
  'cylinderColClustered',
  'cylinderColStacked',
  'cylinderColStacked100',
  'cylinderBarClustered',
  'cylinderBarStacked',
  'cylinderBarStacked100',
  'cylinderCol',
  'coneColClustered',
  'coneColStacked',
  'coneColStacked100',
  'coneBarClustered',
  'coneBarStacked',
  'coneBarStacked100',
  'coneCol',
  'pyramidColClustered',
  'pyramidColStacked',
  'pyramidColStacked100',
  'pyramidBarClustered',
  'pyramidBarStacked',
  'pyramidBarStacked100',
  'pyramidCol',
] as const satisfies readonly ChartType[];

export type ChartTypeNarrowingDiagnostic = {
  code: 'acceptedChartTypeAlias' | 'unsupportedChartType';
  message: string;
  rawType: string;
  canonicalType?: ChartType;
};

export type WireChartTypeToConfigResult =
  | { type: ChartType; diagnostics: ChartTypeNarrowingDiagnostic[] }
  | { type: undefined; diagnostics: ChartTypeNarrowingDiagnostic[] };

const CHART_TYPE_ALIASES: Record<string, ChartType> = {
  bar3D: 'bar3d',
  column3D: 'column3d',
  line3D: 'line3d',
  pie3D: 'pie3d',
  area3D: 'area3d',
  surface3D: 'surface3d',
  boxWhisker: 'boxplot',
  paretoLine: 'pareto',
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Convert a loose wire manual-layout value to the public chart contract. */
export function wireToManualLayout(layout: unknown): ManualLayout | undefined {
  if (!isRecord(layout)) return undefined;

  return {
    layoutTarget: narrowEnum<ManualLayoutTarget>(
      typeof layout.layoutTarget === 'string' ? layout.layoutTarget : undefined,
      MANUAL_LAYOUT_TARGETS,
      'ManualLayout.layoutTarget',
    ),
    xMode: narrowEnum<ManualLayoutMode>(
      typeof layout.xMode === 'string' ? layout.xMode : undefined,
      MANUAL_LAYOUT_MODES,
      'ManualLayout.xMode',
    ),
    yMode: narrowEnum<ManualLayoutMode>(
      typeof layout.yMode === 'string' ? layout.yMode : undefined,
      MANUAL_LAYOUT_MODES,
      'ManualLayout.yMode',
    ),
    wMode: narrowEnum<ManualLayoutMode>(
      typeof layout.wMode === 'string' ? layout.wMode : undefined,
      MANUAL_LAYOUT_MODES,
      'ManualLayout.wMode',
    ),
    hMode: narrowEnum<ManualLayoutMode>(
      typeof layout.hMode === 'string' ? layout.hMode : undefined,
      MANUAL_LAYOUT_MODES,
      'ManualLayout.hMode',
    ),
    x: optionalNumber(layout.x),
    y: optionalNumber(layout.y),
    w: optionalNumber(layout.w),
    h: optionalNumber(layout.h),
    extLst: typeof layout.extLst === 'string' ? layout.extLst : undefined,
  };
}

export function wireChartTypeToConfig(
  value: string | null | undefined,
): WireChartTypeToConfigResult {
  const rawType = value?.trim();
  if (!rawType) return { type: undefined, diagnostics: [] };

  if ((CHART_TYPES as readonly string[]).includes(rawType)) {
    return { type: rawType as ChartType, diagnostics: [] };
  }

  const alias = CHART_TYPE_ALIASES[rawType];
  if (alias) {
    return {
      type: alias,
      diagnostics: [
        {
          code: 'acceptedChartTypeAlias',
          message: `Imported chart type "${rawType}" was canonicalized to "${alias}"`,
          rawType,
          canonicalType: alias,
        },
      ],
    };
  }

  return {
    type: undefined,
    diagnostics: [
      {
        code: 'unsupportedChartType',
        message: `Imported chart type "${rawType}" is not supported`,
        rawType,
      },
    ],
  };
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
    layout: wireToManualLayout(w.layout),
    shadow: w.shadow,
    showShadow: w.showShadow,
  };
}

/** Convert a wire ChartLineData to the contract ChartLineFormat. */
export function wireToChartLineFormat(w: ChartLineData): ChartLineFormat {
  // Wire `color` is `string | { theme, tint_shade? }`; contract is
  // `string | { theme, tintShade? }`. Snake→camel rename on theme variant.
  let color: ChartLineFormat['color'];
  if (typeof w.color === 'string') {
    color = w.color;
  } else if (w.color && typeof w.color === 'object') {
    const t = w.color as { theme: string; tint_shade?: number };
    color = { theme: t.theme, tintShade: t.tint_shade };
  }
  return {
    color,
    width: w.width,
    dashStyle: w.dashStyle,
    transparency: w.transparency,
    noFill: w.noFill,
  };
}

/** Convert a wire ChartLineData to the contract ChartLeaderLinesFormat. */
export function wireToLeaderLinesFormat(w: ChartLineData): ChartLeaderLinesFormat {
  return { format: wireToChartLineFormat(w) };
}

/** Convert a wire DataLabelData to the contract DataLabelConfig. */
export function wireToDataLabelConfig(w: DataLabelData): DataLabelConfig {
  return {
    show: w.show,
    delete: w.delete,
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
    layout: wireToManualLayout(w.layout),
  };
}

/** Convert a wire TrendlineData to the contract TrendlineConfig. */
export function wireToTrendlineConfig(w: TrendlineData): TrendlineConfig {
  return {
    show: w.show,
    type: w.type,
    color: w.color,
    lineWidth: w.lineWidth,
    order: w.order,
    period: w.period,
    forward: w.forward,
    backward: w.backward,
    intercept: w.intercept,
    displayEquation: w.displayEquation,
    displayRSquared: w.displayRSquared,
    name: w.name,
    lineFormat: w.lineFormat ? wireToChartLineFormat(w.lineFormat) : undefined,
    label: w.label
      ? {
          text: w.label.text,
          format: w.label.format,
          numberFormat: w.label.numberFormat,
          layout: wireToManualLayout(w.label.layout),
        }
      : undefined,
  };
}

export function wireToTrendlineConfigArray(
  trendlines: TrendlineData[] | undefined,
): TrendlineConfig[] | undefined {
  return trendlines?.map(wireToTrendlineConfig);
}

/** Convert a wire PointFormatData to the contract PointFormat. */
export function wireToPointFormat(w: PointFormatData): PointFormat {
  return {
    idx: w.idx,
    invertIfNegative: w.invertIfNegative,
    explosion: w.explosion,
    bubble3d: w.bubble3d,
    bubble3D: w.bubble3d,
    fill: w.fill,
    border: w.border,
    lineFormat: w.lineFormat ? wireToChartLineFormat(w.lineFormat) : undefined,
    dataLabel: w.dataLabel ? wireToDataLabelConfig(w.dataLabel) : undefined,
    visualFormat: w.visualFormat,
    markerBackgroundColor: w.markerBackgroundColor,
    markerForegroundColor: w.markerForegroundColor,
    markerSize: w.markerSize,
    markerStyle: narrowEnum<MarkerStyle>(w.markerStyle, MARKER_STYLES, 'Point.markerStyle'),
  };
}

export function wireToErrorBarConfig(w: ErrorBarData): ErrorBarConfig {
  return {
    visible: w.visible,
    direction: w.direction,
    barType: w.barType,
    valueType: w.valueType,
    value: w.value,
    noEndCap: w.noEndCap,
    lineFormat: w.lineFormat ? wireToChartLineFormat(w.lineFormat) : undefined,
    plusSource: w.plusSource,
    minusSource: w.minusSource,
  };
}

export function wireToChartLineSettings(
  w: { visible?: boolean; format?: ChartLineData } | undefined,
): ChartLineSettings | undefined {
  if (!w) return undefined;
  return {
    visible: w.visible,
    format: w.format ? wireToChartLineFormat(w.format) : undefined,
  };
}

export function wireToUpDownBarsConfig(
  w: { gapWidth?: number; upFormat?: unknown; downFormat?: unknown } | undefined,
): UpDownBarsConfig | undefined {
  if (!w) return undefined;
  return {
    gapWidth: w.gapWidth,
    upFormat: w.upFormat as UpDownBarsConfig['upFormat'],
    downFormat: w.downFormat as UpDownBarsConfig['downFormat'],
  };
}

export function wireToWaterfallConfig(w: WaterfallOptions | undefined): WaterfallConfig | undefined {
  if (!w) return undefined;
  return {
    subtotalIndices: w.subtotalIndices,
    totalIndices: w.subtotalIndices,
    showConnectorLines: w.showConnectorLines,
  };
}

export function wireToHistogramConfig(w: HistogramConfigData | undefined): HistogramConfig | undefined {
  if (!w) return undefined;
  return {
    binCount: w.binCount,
    binWidth: w.binWidth,
    overflowBin: w.overflowBin,
    overflowBinValue: w.overflowBinValue,
    underflowBin: w.underflowBin,
    underflowBinValue: w.underflowBinValue,
  };
}

export function wireToBoxplotConfig(w: BoxplotConfigData | undefined): BoxplotConfig | undefined {
  if (!w) return undefined;
  return {
    showOutlierPoints: w.showOutlierPoints,
    showOutliers: w.showOutlierPoints,
    showMeanMarkers: w.showMeanMarkers,
    showMean: w.showMeanMarkers,
    showMeanLine: w.showMeanLine,
    quartileMethod: w.quartileMethod,
  };
}

export function wireToHierarchyChartConfig(
  w: HierarchyChartConfigData | undefined,
): HierarchyChartConfig | undefined {
  if (!w) return undefined;
  return {
    rows: w.rows,
    categoryFormulas: w.categoryFormulas,
    valueFormula: w.valueFormula,
    parentLabelLayout: w.parentLabelLayout,
  };
}

export function wireToRegionMapConfig(w: RegionMapConfigData | undefined): RegionMapConfig | undefined {
  if (!w) return undefined;
  return {
    regionFormula: w.regionFormula,
    valueFormula: w.valueFormula,
  };
}

/** Convert a wire ChartSeriesData to the contract SeriesConfig. */
export function wireToSeriesConfig(w: ChartSeriesData): SeriesConfig {
  const config: SeriesConfig = {
    name: w.name,
    // SeriesConfig.type is an unrestricted string on the contract side —
    // chart-type strings are validated at the chart level, not here.
    type: w.type,
    color: w.color,
    values: w.values,
    valueCache: w.valueCache,
    categories: w.categories,
    categoryCache: w.categoryCache,
    categoryLevels: w.categoryLevels,
    categoryLabelFormat: w.categoryLabelFormat,
    bubbleSize: w.bubbleSize,
    bubbleSizeCache: w.bubbleSizeCache,
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
    trendlines: wireToTrendlineConfigArray(w.trendlines),
    errorBars: w.errorBars ? wireToErrorBarConfig(w.errorBars) : undefined,
    xErrorBars: w.xErrorBars ? wireToErrorBarConfig(w.xErrorBars) : undefined,
    yErrorBars: w.yErrorBars ? wireToErrorBarConfig(w.yErrorBars) : undefined,
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
    binOptions: undefined,
    boxwhiskerOptions: undefined,
  };
  return config;
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
    visible: c.visible ?? c.show,
    overlay: c.overlay,
    format: c.format,
    entries: c.entries,
    customX: c.customX,
    customY: c.customY,
    shadow: c.shadow,
    showShadow: c.showShadow,
  };
}

/** Convert contract ChartLineFormat to wire ChartLineData. */
export function chartLineFormatToWire(c: ChartLineFormat): ChartLineData {
  // Contract color is `string | { theme, tintShade? }`; wire is
  // `string | { theme, tint_shade? }`. Re-emit with snake-case.
  let color: ChartLineData['color'];
  if (typeof c.color === 'string') {
    color = c.color;
  } else if (c.color && typeof c.color === 'object') {
    color = { theme: c.color.theme, tint_shade: c.color.tintShade };
  }
  return {
    color,
    width: c.width,
    dashStyle: c.dashStyle,
    transparency: c.transparency,
    noFill: c.noFill,
  };
}

/** Convert contract ChartLeaderLinesFormat to wire ChartLineData. */
export function leaderLinesFormatToWire(c: ChartLeaderLinesFormat): ChartLineData {
  return chartLineFormatToWire(c.format);
}

/** Convert contract DataLabelConfig to wire DataLabelData. */
export function dataLabelConfigToWire(c: DataLabelConfig): DataLabelData {
  return {
    show: c.show ?? false,
    delete: c.delete,
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
    layout: c.layout as DataLabelData['layout'],
  };
}

/** Convert contract PointFormat to wire PointFormatData. */
export function pointFormatToWire(c: PointFormat): PointFormatData {
  return {
    idx: c.idx,
    invertIfNegative: c.invertIfNegative,
    explosion: c.explosion,
    bubble3d: c.bubble3d ?? c.bubble3D,
    fill: c.fill,
    border: c.border,
    lineFormat: c.lineFormat ? chartLineFormatToWire(c.lineFormat) : undefined,
    dataLabel: c.dataLabel ? dataLabelConfigToWire(c.dataLabel) : undefined,
    visualFormat: c.visualFormat,
    markerBackgroundColor: c.markerBackgroundColor,
    markerForegroundColor: c.markerForegroundColor,
    markerSize: c.markerSize,
    markerStyle: c.markerStyle,
  };
}

export function errorBarConfigToWire(c: ErrorBarConfig): ErrorBarConfig {
  return {
    visible: c.visible,
    direction: c.direction,
    barType: c.barType,
    valueType: c.valueType,
    value: c.value,
    noEndCap: c.noEndCap,
    lineFormat: c.lineFormat ? chartLineFormatToWire(c.lineFormat) : undefined,
    plusSource: c.plusSource,
    minusSource: c.minusSource,
  };
}

/** Convert contract SeriesConfig to wire ChartSeriesData. */
export function seriesConfigToWire(c: SeriesConfig): ChartSeriesData {
  return {
    name: c.name,
    type: c.type,
    color: c.color,
    values: c.values,
    valueCache: c.valueCache,
    categories: c.categories,
    categoryCache: c.categoryCache,
    categoryLevels: c.categoryLevels,
    categoryLabelFormat: c.categoryLabelFormat,
    bubbleSize: c.bubbleSize,
    bubbleSizeCache: c.bubbleSizeCache,
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
    errorBars: c.errorBars ? errorBarConfigToWire(c.errorBars) : undefined,
    xErrorBars: c.xErrorBars ? errorBarConfigToWire(c.xErrorBars) : undefined,
    yErrorBars: c.yErrorBars ? errorBarConfigToWire(c.yErrorBars) : undefined,
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
