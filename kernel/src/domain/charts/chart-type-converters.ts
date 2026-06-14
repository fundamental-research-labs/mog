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
 * Outside this boundary and its focused converter submodules, kernel code MUST
 * NOT import both a `*Data` and a `*Config` type in the same file.
 */

import type { ChartSeriesData } from '../../bridges/compute/compute-types.gen';

import type { SeriesConfig } from '@mog-sdk/contracts/data/charts';

import {
  chartColorToWire,
  chartFormatToWire,
  wireToChartColor,
  wireToChartFormat,
} from './chart-format-converters';

import {
  dataLabelConfigToWire,
  errorBarConfigToWire,
  pointFormatToWire,
  trendlineConfigArrayToWire,
  wireToDataLabelConfig,
  wireToErrorBarConfig,
  wireToPointFormat,
  wireToTrendlineConfigArray,
} from './chart-annotation-converters';

import {
  boxplotConfigToWire,
  histogramConfigToWire,
  wireToBoxplotConfig,
  wireToHistogramConfig,
} from './chart-option-converters';

export {
  wireChartTypeToConfig,
  wireToSizeRepresents,
  type ChartTypeNarrowingDiagnostic,
  type WireChartTypeToConfigResult,
} from './chart-kind-converters';

export { legendConfigToWire, wireToLegendConfig } from './chart-legend-converters';

export {
  boxplotConfigToWire,
  histogramConfigToWire,
  upDownBarsConfigToWire,
  wireToBoxplotConfig,
  wireToHierarchyChartConfig,
  wireToHistogramConfig,
  wireToRegionMapConfig,
  wireToUpDownBarsConfig,
  wireToWaterfallConfig,
} from './chart-option-converters';

export {
  axisConfigToWire,
  singleAxisConfigToWire,
  wireToAxisConfig,
  wireToManualLayout,
  wireToSingleAxisConfig,
} from './chart-axis-converters';

export {
  chartColorToWire,
  chartFillToWire,
  chartFontToWire,
  chartFormatStringToWire,
  chartFormatToWire,
  chartLineFormatToWire,
  chartShadowToWire,
  chartStyleContextToWire,
  dataTableConfigToWire,
  leaderLinesFormatToWire,
  wireToChartColor,
  wireToChartFill,
  wireToChartFont,
  wireToChartFormat,
  wireToChartFormatString,
  wireToChartLineFormat,
  wireToChartLineSettings,
  wireToChartShadow,
  wireToChartStyleContext,
  wireToDataTableConfig,
  wireToLeaderLinesFormat,
} from './chart-format-converters';

export {
  dataLabelConfigToWire,
  errorBarConfigToWire,
  pointFormatToWire,
  trendlineConfigArrayToWire,
  trendlineConfigToWire,
  wireToDataLabelConfig,
  wireToErrorBarConfig,
  wireToPointFormat,
  wireToTrendlineConfig,
  wireToTrendlineConfigArray,
} from './chart-annotation-converters';

// =============================================================================
// Wire → Config (narrowing — validates enum strings against contract unions)
// =============================================================================

/** Convert a wire ChartSeriesData to the contract SeriesConfig. */
export function wireToSeriesConfig(w: ChartSeriesData): SeriesConfig {
  const config: SeriesConfig = {
    name: w.name,
    nameRef: w.nameRef,
    // SeriesConfig.type is an unrestricted string on the contract side —
    // chart-type strings are validated at the chart level, not here.
    type: w.type,
    color: w.color,
    stockRole: w.stockRole,
    values: w.values,
    valueCache: w.valueCache,
    valueSourceKind: w.valueSourceKind,
    categories: w.categories,
    xRole: w.xRole,
    categoryCache: w.categoryCache,
    categorySourceKind: w.categorySourceKind,
    categoryLevels: w.categoryLevels,
    categoryLabelFormat: w.categoryLabelFormat,
    bubbleSize: w.bubbleSize,
    bubbleSizeCache: w.bubbleSizeCache,
    bubbleSizeSourceKind: w.bubbleSizeSourceKind,
    smooth: w.smooth,
    showLines: w.showLines,
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
    format: wireToChartFormat(w.format),
    barShape: w.barShape,
    invertColor: wireToChartColor(w.invertColor),
    markerBackgroundColor: wireToChartColor(w.markerBackgroundColor),
    markerForegroundColor: wireToChartColor(w.markerForegroundColor),
    filtered: w.filtered,
    sourceSeriesIndex: w.sourceSeriesIndex,
    sourceSeriesKey: w.sourceSeriesKey,
    visibleOrder: w.visibleOrder,
    pivotSeriesKey: w.pivotSeriesKey,
    pivotDataFieldIndex: w.pivotDataFieldIndex,
    projectionAuthority: w.projectionAuthority,
    projectionDiagnostics: w.projectionDiagnostics,
    showShadow: w.showShadow,
    showConnectorLines: w.showConnectorLines,
    leaderLineFormat: wireToChartFormat(w.leaderLineFormat),
    showLeaderLines: w.showLeaderLines,
    binOptions: wireToHistogramConfig(w.binOptions),
    boxwhiskerOptions: wireToBoxplotConfig(w.boxwhiskerOptions),
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

/** Convert contract SeriesConfig to wire ChartSeriesData. */
export function seriesConfigToWire(c: SeriesConfig): ChartSeriesData {
  return omitUndefinedDeep({
    name: c.name,
    nameRef: c.nameRef,
    type: c.type,
    color: c.color,
    stockRole: c.stockRole,
    values: c.values,
    valueCache: c.valueCache,
    valueSourceKind: c.valueSourceKind,
    categories: c.categories,
    xRole: c.xRole,
    categoryCache: c.categoryCache,
    categorySourceKind: c.categorySourceKind,
    categoryLevels: c.categoryLevels,
    categoryLabelFormat: c.categoryLabelFormat,
    bubbleSize: c.bubbleSize,
    bubbleSizeCache: c.bubbleSizeCache,
    bubbleSizeSourceKind: c.bubbleSizeSourceKind,
    smooth: c.smooth,
    showLines: c.showLines,
    explosion: c.explosion,
    invertIfNegative: c.invertIfNegative,
    yAxisIndex: c.yAxisIndex,
    showMarkers: c.showMarkers,
    markerSize: c.markerSize,
    markerStyle: c.markerStyle,
    lineWidth: c.lineWidth,
    points: c.points?.map(pointFormatToWire),
    dataLabels: c.dataLabels ? dataLabelConfigToWire(c.dataLabels) : undefined,
    trendlines: trendlineConfigArrayToWire(c.trendlines),
    errorBars: c.errorBars ? errorBarConfigToWire(c.errorBars) : undefined,
    xErrorBars: c.xErrorBars ? errorBarConfigToWire(c.xErrorBars) : undefined,
    yErrorBars: c.yErrorBars ? errorBarConfigToWire(c.yErrorBars) : undefined,
    idx: c.idx,
    order: c.order,
    format: chartFormatToWire(c.format),
    barShape: c.barShape,
    invertColor: chartColorToWire(c.invertColor),
    markerBackgroundColor: chartColorToWire(c.markerBackgroundColor),
    markerForegroundColor: chartColorToWire(c.markerForegroundColor),
    filtered: c.filtered,
    sourceSeriesIndex: c.sourceSeriesIndex,
    sourceSeriesKey: c.sourceSeriesKey,
    visibleOrder: c.visibleOrder,
    pivotSeriesKey: c.pivotSeriesKey,
    pivotDataFieldIndex: c.pivotDataFieldIndex,
    projectionAuthority: c.projectionAuthority,
    projectionDiagnostics: c.projectionDiagnostics,
    showShadow: c.showShadow,
    showConnectorLines: c.showConnectorLines,
    leaderLineFormat: chartFormatToWire(c.leaderLineFormat),
    showLeaderLines: c.showLeaderLines,
    binOptions: histogramConfigToWire(c.binOptions),
    boxwhiskerOptions: boxplotConfigToWire(c.boxwhiskerOptions),
  });
}

/** Convert contract SeriesConfig[] to wire ChartSeriesData[]. */
export function seriesConfigArrayToWire(c: SeriesConfig[]): ChartSeriesData[] {
  return c.map(seriesConfigToWire);
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
