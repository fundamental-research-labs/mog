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

import type { ChannelSpec, ChartSpec, EncodingSpec, Layout, LegendSpec } from './spec';

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
  const titleArea = calculateTitleArea(spec.title, width, margin.top);

  // Adjust top margin for title
  const adjustedMarginTop = titleArea ? titleArea.height + margin.top : margin.top;

  const legendEncoding = legendEncodingForSpec(spec);
  const legendOrient = legendOrientForEncoding(legendEncoding);
  const adjustedMarginBottom =
    legendOrient === 'bottom' ? margin.bottom + DEFAULT_LAYOUT.xAxisLabelSpace + 30 : margin.bottom;

  // Calculate legend area
  const legendArea = calculateLegendArea(legendEncoding, width, height, {
    ...margin,
    bottom: adjustedMarginBottom,
  });

  // Adjust right margin for legend (if legend is on right)
  const adjustedMarginRight =
    legendArea?.x === width - margin.right - (legendArea?.width || 0) - 10
      ? margin.right + (legendArea?.width || 0) + 10
      : margin.right;

  // Calculate plot area
  const plotArea = {
    x: margin.left,
    y: adjustedMarginTop,
    width: Math.max(DEFAULT_LAYOUT.minPlotSize, width - margin.left - adjustedMarginRight),
    height: Math.max(
      DEFAULT_LAYOUT.minPlotSize,
      height - adjustedMarginTop - adjustedMarginBottom,
    ),
  };

  return {
    width,
    height,
    plotArea,
    margin: {
      top: adjustedMarginTop,
      right: adjustedMarginRight,
      bottom: adjustedMarginBottom,
      left: margin.left,
    },
    title: titleArea,
    legend: legendArea,
  };
}

/**
 * Calculate margins based on axes and other elements.
 */
function calculateMargins(spec: ChartSpec): Layout['margin'] {
  const margin: Layout['margin'] = { ...DEFAULT_LAYOUT.margin };
  const encodings = collectEncodings(spec);
  const layoutHints = spec.config?.layoutHints;
  let bottomPadding = 0;

  // Handle padding from config
  if (spec.config?.padding) {
    const padding = spec.config.padding;
    if (typeof padding === 'number') {
      margin.top += padding;
      margin.right += padding;
      margin.bottom += padding;
      margin.left += padding;
      bottomPadding += padding;
    } else {
      margin.top += padding.top ?? 0;
      margin.right += padding.right ?? 0;
      margin.bottom += padding.bottom ?? 0;
      margin.left += padding.left ?? 0;
      bottomPadding += padding.bottom ?? 0;
    }
  }

  const xAxisEncoding = encodings.find((encoding) => encoding.x && encoding.x.axis !== null);
  if (xAxisEncoding?.x) {
    const xAxis = xAxisEncoding.x.axis;
    // Add space for labels
    if (xAxis?.labels !== false) {
      margin.bottom += DEFAULT_LAYOUT.xAxisLabelSpace;
    }
    // Add space for title
    if (xAxis?.title || xAxisEncoding.x.title) {
      margin.bottom += DEFAULT_LAYOUT.axisTitleSpace;
    }
    // Handle rotated labels
    if (xAxis?.labelAngle && Math.abs(xAxis.labelAngle) > 45) {
      margin.bottom += 20;
    }
  }

  const yAxisSides = new Set<'left' | 'right'>();
  const yAxisTitles = new Set<'left' | 'right'>();
  for (const encoding of encodings) {
    if (!encoding.y || encoding.y.axis === null) continue;
    const yAxis = encoding.y.axis;
    const side = yAxis?.orient === 'right' ? 'right' : 'left';
    yAxisSides.add(side);
    if (yAxis?.title || encoding.y.title) {
      yAxisTitles.add(side);
    }
  }

  for (const side of yAxisSides) {
    // Add space for labels
    const hasLabels = encodings.some((encoding) => {
      const yAxis = encoding.y?.axis;
      const axisSide = yAxis?.orient === 'right' ? 'right' : 'left';
      return encoding.y && yAxis !== null && axisSide === side && yAxis?.labels !== false;
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
    encoding?.color?.field ||
    encoding?.fill?.field ||
    encoding?.shape?.field ||
    encoding?.size?.field;

  if (!needsLegend) {
    return undefined;
  }

  // Get legend config from encoding - check each channel that needs legend
  const colorLegend = encoding?.color?.legend;
  const fillLegend = encoding?.fill?.legend;
  const shapeLegend = encoding?.shape?.legend;
  const sizeLegend = encoding?.size?.legend;

  // Check if any legend is explicitly hidden (null)
  // If any channel that contributes to legend has legend: null, hide the legend
  if (encoding?.color?.field && colorLegend === null) {
    return undefined;
  }
  if (encoding?.fill?.field && fillLegend === null) {
    return undefined;
  }
  if (encoding?.shape?.field && shapeLegend === null) {
    return undefined;
  }
  if (encoding?.size?.field && sizeLegend === null) {
    return undefined;
  }

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
  const legendWidth = estimateLegendWidth(encoding, legendSpec);
  const legendHeight = 180; // Estimated, depends on items
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
        x: margin.left + 10,
        y: margin.top + 10,
        width: legendWidth,
        height: legendHeight,
      };
    case 'top':
      return {
        x: margin.left,
        y: margin.top + 10,
        width: width - margin.left - margin.right,
        height: 30,
      };
    case 'bottom':
      return {
        x: margin.left,
        y: height - margin.bottom + 8,
        width: width - margin.left - margin.right,
        height: 30,
      };
    case 'top-right':
      return {
        x: width - margin.right - legendWidth - 10,
        y: centeredLegendY,
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

function estimateLegendWidth(
  encoding: EncodingSpec | undefined,
  legendSpec: LegendSpec | undefined,
): number {
  const labels = legendDomainLabels(
    encoding?.color ?? encoding?.fill ?? encoding?.shape ?? encoding?.size,
  );
  if (labels.length === 0) return DEFAULT_LAYOUT.legendWidth;

  const labelFontSize = legendSpec?.labelFontSize ?? 11;
  const symbolSize = legendSpec?.symbolSize ?? 10;
  const maxLabelWidth = labels.reduce(
    (max, label) => Math.max(max, label.length * labelFontSize * 0.6),
    0,
  );
  return Math.max(DEFAULT_LAYOUT.legendWidth, Math.ceil(symbolSize + 6 + maxLabelWidth + 20));
}

function legendDomainLabels(channel: ChannelSpec | undefined): string[] {
  const domain = channel?.scale && Array.isArray(channel.scale.domain) ? channel.scale.domain : [];
  return domain.map((value) => String(value));
}

function collectEncodings(spec: ChartSpec): EncodingSpec[] {
  return [
    spec.encoding,
    ...(Array.isArray(spec.layer) ? spec.layer.map((layer) => layer.encoding) : []),
  ].filter((encoding): encoding is EncodingSpec => Boolean(encoding));
}

function hasLegendChannel(encoding: EncodingSpec | undefined): boolean {
  return Boolean(
    encoding?.color?.field ||
      encoding?.fill?.field ||
      encoding?.shape?.field ||
      encoding?.size?.field,
  );
}

function mergeLegendEncoding(encodings: EncodingSpec[]): EncodingSpec | undefined {
  const merged: EncodingSpec = {};
  for (const encoding of encodings) {
    if (!merged.color && encoding.color) merged.color = encoding.color;
    if (!merged.fill && encoding.fill) merged.fill = encoding.fill;
    if (!merged.shape && encoding.shape) merged.shape = encoding.shape;
    if (!merged.size && encoding.size) merged.size = encoding.size;
  }
  return hasLegendChannel(merged) ? merged : undefined;
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
