/**
 * Layout Calculator for Chart Grammar
 *
 * Computes the layout dimensions for chart rendering:
 * - Total chart dimensions
 * - Margins for axes, titles, legends
 * - Plot area bounds
 *
 * Pure functions - no side effects.
 */

import type {
  ChannelSpec,
  ChartSpec,
  ConfigSpec,
  EncodingSpec,
  Layout,
  LegendSpec,
  ManualLayoutSpec,
} from './spec';
import {
  buildLegendFlowLayout,
  estimateLegendEntryWidth,
  estimateVerticalLegendHeight,
  isHorizontalLegendOrient,
  legendTitleHeight,
  resolveLegendEntriesForEncoding,
} from './legend-layout';

// =============================================================================
// Types
// =============================================================================

/**
 * Dimensions input for layout calculation.
 */
export interface LayoutDimensions {
  width: number;
  height: number;
}

type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Default layout values.
 */
export const DEFAULT_LAYOUT = {
  width: 600,
  height: 400,
  margin: {
    top: 20,
    right: 20,
    bottom: 40,
    left: 50,
  },
  titleHeight: 30,
  subtitleHeight: 20,
  legendWidth: 130,
  axisLabelSpace: 62,
  xAxisLabelSpace: 18,
  yAxisLabelSpace: 62,
  axisTitleSpace: 25,
  tickLength: 6,
  minPlotSize: 50,
} as const;

const MIN_HORIZONTAL_LEGEND_HEIGHT = 30;
const HORIZONTAL_LEGEND_VERTICAL_PADDING = 12;
const BOTTOM_LEGEND_BOTTOM_PADDING = 8;
const TOP_LEGEND_TOP_PADDING = 8;
const SIDE_LEGEND_GAP = 10;
const DEFAULT_SIDE_LEGEND_HEIGHT = 180;
const DATA_TABLE_TOP_PADDING = 6;

// =============================================================================
// Layout Calculation
// =============================================================================

/**
 * Calculate the layout for a chart.
 *
 * @param spec - Chart specification
 * @param dimensions - Optional explicit dimensions (overrides spec)
 * @returns Computed layout
 */
export function calculateLayout(spec: ChartSpec, dimensions?: LayoutDimensions): Layout {
  // Determine total dimensions
  const width =
    dimensions?.width ?? (typeof spec.width === 'number' ? spec.width : DEFAULT_LAYOUT.width);
  const height =
    dimensions?.height ?? (typeof spec.height === 'number' ? spec.height : DEFAULT_LAYOUT.height);

  // Calculate margins based on spec
  const margin = calculateMargins(spec);

  // Calculate title area
  const autoTitleArea = calculateTitleArea(spec.title, width, margin.top);

  // Adjust top margin for title
  const adjustedMarginTop = autoTitleArea ? autoTitleArea.height + margin.top : margin.top;

  const legendEncoding = legendEncodingForSpec(spec);
  const legendSpec = firstLegendSpec(legendEncoding);
  const legendOrient = legendOrientForEncoding(legendEncoding);
  const legendOverlaysPlot = legendSpec?.overlay === true;
  const layoutHints = spec.config?.layoutHints;
  const dataTableReservedHeight = layoutHints?.dataTable?.height ?? 0;
  const bottomAxisReservedSpace = Math.max(0, margin.bottom - DEFAULT_LAYOUT.margin.bottom);
  const baseAdjustedMarginBottom = margin.bottom + dataTableReservedHeight;

  // Calculate legend area
  const autoLegendArea = calculateLegendArea(legendEncoding, width, height, {
    ...margin,
    top: adjustedMarginTop,
    bottom: baseAdjustedMarginBottom,
  });
  const legendReservation = legendOverlaysPlot
    ? { top: 0, right: 0, bottom: 0, left: 0 }
    : legendReservationForArea(legendOrient, autoLegendArea);
  const adjustedMarginTopWithLegend = adjustedMarginTop + legendReservation.top;
  const adjustedMarginRight = margin.right + legendReservation.right;
  const adjustedMarginBottom = baseAdjustedMarginBottom + legendReservation.bottom;
  const adjustedMarginLeft = margin.left + legendReservation.left;

  // Calculate plot area
  const autoPlotArea = {
    x: adjustedMarginLeft,
    y: adjustedMarginTopWithLegend,
    width: Math.max(DEFAULT_LAYOUT.minPlotSize, width - adjustedMarginLeft - adjustedMarginRight),
    height: Math.max(
      DEFAULT_LAYOUT.minPlotSize,
      height - adjustedMarginTopWithLegend - adjustedMarginBottom,
    ),
  };
  const preferredAutoPlotArea =
    layoutHints?.pieDoughnut?.preferSquareArcPlot === true && !layoutHints.manualPlotArea
      ? squarePlotArea(autoPlotArea)
      : autoPlotArea;
  const chartBounds = { x: 0, y: 0, width, height };
  const plotArea =
    applyManualLayout(
      layoutHints?.manualPlotArea,
      preferredAutoPlotArea,
      chartBounds,
      autoPlotArea,
      {
        minWidth: DEFAULT_LAYOUT.minPlotSize,
        minHeight: DEFAULT_LAYOUT.minPlotSize,
      },
    ) ?? preferredAutoPlotArea;
  const titleArea = applyManualLayout(
    layoutHints?.manualTitle,
    autoTitleArea,
    chartBounds,
    plotArea,
  );
  const legendArea = applyManualLayout(
    layoutHints?.manualLegend,
    autoLegendArea,
    chartBounds,
    plotArea,
  );
  const dataTableArea =
    layoutHints?.dataTable && dataTableReservedHeight > DATA_TABLE_TOP_PADDING
      ? {
          x: plotArea.x,
          y: plotArea.y + plotArea.height + bottomAxisReservedSpace + DATA_TABLE_TOP_PADDING,
          width: plotArea.width,
          height: dataTableReservedHeight - DATA_TABLE_TOP_PADDING,
        }
      : undefined;

  return {
    width,
    height,
    plotArea,
    margin: {
      top: adjustedMarginTopWithLegend,
      right: adjustedMarginRight,
      bottom: adjustedMarginBottom,
      left: adjustedMarginLeft,
    },
    title: titleArea,
    legend: legendArea,
    dataTable: dataTableArea,
  };
}

function squarePlotArea(rect: LayoutRect): LayoutRect {
  const size = Math.max(DEFAULT_LAYOUT.minPlotSize, Math.min(rect.width, rect.height));
  return {
    x: rect.x + Math.max(0, (rect.width - size) / 2),
    y: rect.y + Math.max(0, (rect.height - size) / 2),
    width: size,
    height: size,
  };
}

function applyManualLayout(
  manualLayout: ManualLayoutSpec | undefined,
  baseRect: LayoutRect | undefined,
  chartBounds: LayoutRect,
  innerTarget: LayoutRect,
  options: { minWidth?: number; minHeight?: number } = {},
): LayoutRect | undefined {
  if (!baseRect) return undefined;
  if (!manualLayout) return baseRect;

  const target = manualLayout.layoutTarget === 'inner' ? innerTarget : chartBounds;
  const x = manualCoordinate(
    manualLayout.x,
    manualLayout.xMode,
    target.x,
    target.width,
    baseRect.x,
  );
  const y = manualCoordinate(
    manualLayout.y,
    manualLayout.yMode,
    target.y,
    target.height,
    baseRect.y,
  );
  const width = manualDimension(
    manualLayout.w,
    manualLayout.wMode,
    target.x,
    target.width,
    x,
    baseRect.width,
  );
  const height = manualDimension(
    manualLayout.h,
    manualLayout.hMode,
    target.y,
    target.height,
    y,
    baseRect.height,
  );

  return clampRectToBounds(
    { x, y, width, height },
    chartBounds,
    finiteManualValue(manualLayout.w) === undefined ? options.minWidth : undefined,
    finiteManualValue(manualLayout.h) === undefined ? options.minHeight : undefined,
  );
}

function manualCoordinate(
  value: number | undefined,
  mode: ManualLayoutSpec['xMode'] | undefined,
  targetOrigin: number,
  targetSize: number,
  fallback: number,
): number {
  const finite = finiteManualValue(value);
  if (finite === undefined) return fallback;
  if (mode === 'edge') {
    return targetOrigin + finite * targetSize;
  }
  return fallback + finite * targetSize;
}

function manualDimension(
  value: number | undefined,
  mode: ManualLayoutSpec['wMode'] | undefined,
  targetOrigin: number,
  targetSize: number,
  start: number,
  fallback: number,
): number {
  const finite = finiteManualValue(value);
  if (finite === undefined) return fallback;
  if (mode === 'edge') {
    return targetOrigin + finite * targetSize - start;
  }
  return targetSize * finite;
}

function finiteManualValue(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampRectToBounds(
  rect: LayoutRect,
  bounds: LayoutRect,
  minWidth = 1,
  minHeight = 1,
): LayoutRect {
  const width = clampSize(rect.width, bounds.width, minWidth);
  const height = clampSize(rect.height, bounds.height, minHeight);
  return {
    x: clampNumber(rect.x, bounds.x, bounds.x + bounds.width - width),
    y: clampNumber(rect.y, bounds.y, bounds.y + bounds.height - height),
    width,
    height,
  };
}

function clampSize(value: number, max: number, min: number): number {
  const finite = Number.isFinite(value) ? value : min;
  return Math.min(Math.max(finite, Math.min(min, max)), max);
}

function clampNumber(value: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? value : min;
  return Math.min(Math.max(finite, min), Math.max(min, max));
}

/**
 * Calculate margins based on axes and other elements.
 */
function calculateMargins(spec: ChartSpec): Layout['margin'] {
  const margin: Layout['margin'] = { ...DEFAULT_LAYOUT.margin };
  const encodings = collectEncodings(spec);
  const layoutHints = spec.config?.layoutHints;
  const paddingSides: Layout['margin'] = { top: 0, right: 0, bottom: 0, left: 0 };
  let bottomPadding = 0;

  // Handle padding from config
  if (spec.config?.padding) {
    const padding = spec.config.padding;
    if (typeof padding === 'number') {
      margin.top += padding;
      margin.right += padding;
      margin.bottom += padding;
      margin.left += padding;
      paddingSides.top += padding;
      paddingSides.right += padding;
      paddingSides.bottom += padding;
      paddingSides.left += padding;
      bottomPadding += padding;
    } else {
      const top = padding.top ?? 0;
      const right = padding.right ?? 0;
      const bottom = padding.bottom ?? 0;
      const left = padding.left ?? 0;
      margin.top += top;
      margin.right += right;
      margin.bottom += bottom;
      margin.left += left;
      paddingSides.top += top;
      paddingSides.right += right;
      paddingSides.bottom += bottom;
      paddingSides.left += left;
      bottomPadding += bottom;
    }
  }

  if (layoutHints?.axisReservations) {
    applyAxisReservations(margin, layoutHints.axisReservations, paddingSides);
    return margin;
  }

  const xAxes = collectChannelAxes(encodings, 'x');
  for (const { axis, channel } of xAxes) {
    const side = axis?.orient === 'top' ? 'top' : 'bottom';
    const labelsInsidePlot = axisLabelsInsidePlot('x', channel, axis, layoutHints);
    if (axis?.labels !== false && !labelsInsidePlot) {
      margin[side] += DEFAULT_LAYOUT.xAxisLabelSpace;
    }
    if ((axis?.title || channel.title) && !labelsInsidePlot) {
      margin[side] += DEFAULT_LAYOUT.axisTitleSpace;
    }
    if (axis?.labelAngle && Math.abs(axis.labelAngle) > 45) {
      margin[side] += 20;
    }
  }

  const yAxisSides = new Set<'left' | 'right'>();
  const yAxisTitles = new Set<'left' | 'right'>();
  const yAxes = collectChannelAxes(encodings, 'y');
  for (const { axis, channel } of yAxes) {
    const side = axis?.orient === 'right' ? 'right' : 'left';
    yAxisSides.add(side);
    if ((axis?.title || channel.title) && !axisLabelsInsidePlot('y', channel, axis, layoutHints)) {
      yAxisTitles.add(side);
    }
  }

  for (const side of yAxisSides) {
    // Add space for labels
    const hasLabels = encodings.some((encoding) => {
      const axes = axisEntriesForChannel(encoding.y);
      return axes.some((axis) => {
        const axisSide = axis?.orient === 'right' ? 'right' : 'left';
        const labelsInsidePlot = axisLabelsInsidePlot('y', encoding.y!, axis, layoutHints);
        return axisSide === side && axis?.labels !== false && !labelsInsidePlot;
      });
    });
    if (hasLabels) {
      if (side === 'right') {
        margin.right +=
          layoutHints?.rightYAxisLabelWidth ??
          layoutHints?.yAxisLabelWidth ??
          DEFAULT_LAYOUT.yAxisLabelSpace;
      } else {
        margin.left +=
          layoutHints?.leftYAxisLabelWidth ??
          layoutHints?.yAxisLabelWidth ??
          DEFAULT_LAYOUT.yAxisLabelSpace;
      }
    }
    // Add space for title
    if (yAxisTitles.has(side)) {
      if (side === 'right') {
        margin.right += DEFAULT_LAYOUT.axisTitleSpace;
      } else {
        margin.left += DEFAULT_LAYOUT.axisTitleSpace;
      }
    }
  }

  if (layoutHints?.bottomMargin !== undefined) {
    margin.bottom = layoutHints.bottomMargin + bottomPadding;
  }

  return margin;
}

function applyAxisReservations(
  margin: Layout['margin'],
  reservations: NonNullable<ConfigSpec['layoutHints']>['axisReservations'],
  paddingSides: Layout['margin'],
): void {
  if (!reservations) return;

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = finiteReservation(reservations[side]);
    if (value === undefined) continue;
    margin[side] = Math.max(
      DEFAULT_LAYOUT.margin[side] + paddingSides[side],
      value + paddingSides[side],
    );
  }
}

function finiteReservation(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.ceil(value))
    : undefined;
}

function collectChannelAxes(
  encodings: EncodingSpec[],
  channelName: 'x' | 'y',
): Array<{ channel: ChannelSpec; axis: ChannelSpec['axis'] }> {
  const axes: Array<{ channel: ChannelSpec; axis: ChannelSpec['axis'] }> = [];
  for (const encoding of encodings) {
    const channel = encoding[channelName];
    if (!channel) continue;
    for (const axis of axisEntriesForChannel(channel)) {
      axes.push({ channel, axis });
    }
  }
  return axes;
}

function axisEntriesForChannel(channel: ChannelSpec | undefined): Array<ChannelSpec['axis']> {
  if (!channel) return [];
  const axes: Array<ChannelSpec['axis']> = [];
  if (channel.axis !== null) axes.push(channel.axis);
  if (channel.secondaryAxis !== null && channel.secondaryAxis !== undefined) {
    axes.push(channel.secondaryAxis);
  }
  return axes;
}

function axisLabelsInsidePlot(
  channelName: 'x' | 'y',
  channel: ChannelSpec,
  axis: ChannelSpec['axis'],
  layoutHints: ConfigSpec['layoutHints'] | undefined,
): boolean {
  if (channel.type === 'quantitative') return false;
  if (axis === null) return false;
  if (axis?.labelPosition && axis.labelPosition !== 'nextTo') return false;
  return channelName === 'x'
    ? layoutHints?.xAxisLabelsInsidePlot === true
    : layoutHints?.yAxisLabelsInsidePlot === true;
}

/**
 * Calculate title area dimensions.
 */
function calculateTitleArea(
  title: ChartSpec['title'],
  width: number,
  marginTop: number,
): Layout['title'] | undefined {
  if (!title) {
    return undefined;
  }

  const titleSpec = typeof title === 'string' ? { text: title } : title;
  const fontSize = titleSpec.fontSize ?? 16;
  const height = fontSize + (titleSpec.subtitle ? (titleSpec.subtitleFontSize ?? 12) + 5 : 0) + 30;

  return {
    x: 0,
    y: marginTop,
    width,
    height,
  };
}

/**
 * Calculate legend area dimensions.
 */
function calculateLegendArea(
  encoding: EncodingSpec | undefined,
  width: number,
  height: number,
  margin: Layout['margin'],
): Layout['legend'] | undefined {
  // Check if legend is needed
  const needsLegend =
    channelContributesLegend(encoding?.color) ||
    channelContributesLegend(encoding?.fill) ||
    channelContributesLegend(encoding?.shape) ||
    channelContributesLegend(encoding?.size);

  if (!needsLegend) {
    return undefined;
  }

  // Get legend config from encoding - check each channel that needs legend
  const colorLegend = encoding?.color?.legend;
  const fillLegend = encoding?.fill?.legend;
  const shapeLegend = encoding?.shape?.legend;
  const sizeLegend = encoding?.size?.legend;

  // Find first defined (non-null, non-undefined) legend spec for configuration
  const legendSpec =
    colorLegend !== null && colorLegend !== undefined
      ? colorLegend
      : fillLegend !== null && fillLegend !== undefined
        ? fillLegend
        : shapeLegend !== null && shapeLegend !== undefined
          ? shapeLegend
          : sizeLegend !== null && sizeLegend !== undefined
            ? sizeLegend
            : undefined;

  const orient = legendSpec?.orient ?? 'right';
  const horizontalLegendWidth = Math.max(1, width - margin.left - margin.right);
  const legendWidth = isHorizontalLegendOrient(orient)
    ? horizontalLegendWidth
    : estimateLegendWidth(encoding, legendSpec);
  const legendHeight = estimateLegendHeight(encoding, legendSpec, legendWidth);
  const centeredLegendY = Math.max(margin.top + 10, height / 2 - legendHeight / 2);

  // Position based on orientation
  switch (orient) {
    case 'right':
      return {
        x: width - margin.right - legendWidth - 10,
        y: centeredLegendY,
        width: legendWidth,
        height: legendHeight,
      };
    case 'left':
      return {
        x: SIDE_LEGEND_GAP,
        y: centeredLegendY,
        width: legendWidth,
        height: legendHeight,
      };
    case 'top':
      return {
        x: margin.left,
        y: margin.top + 10,
        width: horizontalLegendWidth,
        height: legendHeight,
      };
    case 'bottom':
      return {
        x: margin.left,
        y: Math.max(margin.top, height - legendHeight - BOTTOM_LEGEND_BOTTOM_PADDING),
        width: horizontalLegendWidth,
        height: legendHeight,
      };
    case 'top-right':
      return {
        x: width - margin.right - legendWidth - SIDE_LEGEND_GAP,
        y: margin.top + 10,
        width: legendWidth,
        height: legendHeight,
      };
    case 'top-left':
      return {
        x: margin.left + 10,
        y: margin.top + 10,
        width: legendWidth,
        height: legendHeight,
      };
    case 'bottom-right':
      return {
        x: width - margin.right - legendWidth - 10,
        y: height - margin.bottom - legendHeight - 10,
        width: legendWidth,
        height: legendHeight,
      };
    case 'bottom-left':
      return {
        x: margin.left + 10,
        y: height - margin.bottom - legendHeight - 10,
        width: legendWidth,
        height: legendHeight,
      };
    case 'none':
      return undefined;
    default:
      return {
        x: width - margin.right - legendWidth - 10,
        y: centeredLegendY,
        width: legendWidth,
        height: legendHeight,
      };
  }
}

function legendReservationForArea(
  orient: LegendSpec['orient'],
  area: Layout['legend'] | undefined,
): Layout['margin'] {
  const reservation = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!area || orient === 'none') return reservation;

  switch (orient) {
    case 'left':
      reservation.left = area.width + SIDE_LEGEND_GAP;
      break;
    case 'right':
      reservation.right = area.width + SIDE_LEGEND_GAP;
      break;
    case 'top':
      reservation.top = area.height + TOP_LEGEND_TOP_PADDING;
      break;
    case 'bottom':
      reservation.bottom =
        DEFAULT_LAYOUT.xAxisLabelSpace + area.height + BOTTOM_LEGEND_BOTTOM_PADDING;
      break;
    case 'top-right':
      reservation.right = area.width + SIDE_LEGEND_GAP;
      break;
    default:
      break;
  }

  return reservation;
}

function estimateLegendWidth(
  encoding: EncodingSpec | undefined,
  legendSpec: LegendSpec | undefined,
): number {
  const entries = resolveLegendEntriesForEncoding(encoding, legendSpec);
  if (entries.length === 0) return DEFAULT_LAYOUT.legendWidth;

  const maxEntryWidth = entries.reduce(
    (max, entry) => Math.max(max, estimateLegendEntryWidth(entry, legendSpec)),
    0,
  );
  return Math.max(DEFAULT_LAYOUT.legendWidth, Math.ceil(maxEntryWidth + 20));
}

function estimateLegendHeight(
  encoding: EncodingSpec | undefined,
  legendSpec: LegendSpec | undefined,
  availableWidth: number = DEFAULT_LAYOUT.legendWidth,
): number {
  const orient = legendSpec?.orient ?? 'right';
  const entries = resolveLegendEntriesForEncoding(encoding, legendSpec);
  if (isHorizontalLegendOrient(orient)) {
    const flow = buildLegendFlowLayout({ entries, legendSpec, availableWidth });
    return Math.max(
      MIN_HORIZONTAL_LEGEND_HEIGHT,
      Math.ceil(
        legendTitleHeight(legendSpec) +
          flow.contentHeight +
          HORIZONTAL_LEGEND_VERTICAL_PADDING,
      ),
    );
  }
  if (entries.length === 0) return DEFAULT_SIDE_LEGEND_HEIGHT;
  return estimateVerticalLegendHeight(entries, legendSpec);
}

function collectEncodings(spec: ChartSpec): EncodingSpec[] {
  return [
    spec.encoding,
    ...(Array.isArray(spec.layer) ? spec.layer.map((layer) => layer.encoding) : []),
  ].filter((encoding): encoding is EncodingSpec => Boolean(encoding));
}

function hasLegendChannel(encoding: EncodingSpec | undefined): boolean {
  return Boolean(
    channelContributesLegend(encoding?.color) ||
    channelContributesLegend(encoding?.fill) ||
    channelContributesLegend(encoding?.shape) ||
    channelContributesLegend(encoding?.size),
  );
}

function mergeLegendEncoding(encodings: EncodingSpec[]): EncodingSpec | undefined {
  const merged: EncodingSpec = {};
  for (const encoding of encodings) {
    if (!merged.color && channelContributesLegend(encoding.color)) merged.color = encoding.color;
    if (!merged.fill && channelContributesLegend(encoding.fill)) merged.fill = encoding.fill;
    if (!merged.shape && channelContributesLegend(encoding.shape)) merged.shape = encoding.shape;
    if (!merged.size && channelContributesLegend(encoding.size)) merged.size = encoding.size;
  }
  return hasLegendChannel(merged) ? merged : undefined;
}

function channelContributesLegend(channel: ChannelSpec | undefined): boolean {
  return Boolean(channel?.field && channel.legend !== null);
}

function legendEncodingForSpec(spec: ChartSpec): EncodingSpec | undefined {
  if (hasLegendChannel(spec.encoding)) return spec.encoding;
  return mergeLegendEncoding(collectEncodings(spec));
}

function firstLegendSpec(encoding: EncodingSpec | undefined): LegendSpec | undefined {
  const legends = [
    encoding?.color?.legend,
    encoding?.fill?.legend,
    encoding?.shape?.legend,
    encoding?.size?.legend,
  ];
  return legends.find((legend): legend is LegendSpec => legend !== null && legend !== undefined);
}

function legendOrientForEncoding(encoding: EncodingSpec | undefined): LegendSpec['orient'] {
  return firstLegendSpec(encoding)?.orient ?? 'right';
}

// =============================================================================
// Layout Utilities
// =============================================================================

/**
 * Get the chart area bounds (alias for plotArea).
 */
export function getChartArea(layout: Layout): Layout['plotArea'] {
  return layout.plotArea;
}

/**
 * Check if a point is within the plot area.
 */
export function isInPlotArea(layout: Layout, x: number, y: number): boolean {
  const { plotArea } = layout;
  return (
    x >= plotArea.x &&
    x <= plotArea.x + plotArea.width &&
    y >= plotArea.y &&
    y <= plotArea.y + plotArea.height
  );
}

/**
 * Clamp a value to the plot area bounds.
 */
export function clampToPlotArea(layout: Layout, x: number, y: number): { x: number; y: number } {
  const { plotArea } = layout;
  return {
    x: Math.max(plotArea.x, Math.min(plotArea.x + plotArea.width, x)),
    y: Math.max(plotArea.y, Math.min(plotArea.y + plotArea.height, y)),
  };
}

/**
 * Get the X axis range (pixel coordinates).
 */
export function getXRange(layout: Layout): [number, number] {
  return [layout.plotArea.x, layout.plotArea.x + layout.plotArea.width];
}

/**
 * Get the Y axis range (pixel coordinates).
 * Note: Y is inverted (0 at top in canvas).
 */
export function getYRange(layout: Layout): [number, number] {
  return [layout.plotArea.y + layout.plotArea.height, layout.plotArea.y];
}

/**
 * Compute inner dimensions (width/height of the plot area).
 */
export function getInnerDimensions(layout: Layout): { width: number; height: number } {
  return {
    width: layout.plotArea.width,
    height: layout.plotArea.height,
  };
}
