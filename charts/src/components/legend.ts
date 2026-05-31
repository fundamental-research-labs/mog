/**
 * Legend Component - Generates legend marks for charts.
 *
 * This component is used by the grammar compiler to generate legend marks
 * from scale and encoding specifications.
 *
 * Pure functions, no framework dependencies.
 */

import type { ChannelSpec, Layout, LegendOrient, LegendSpec } from '../grammar/spec';
import type { ColorScale, OrdinalColorScale } from '../primitives/scales/types';
import type {
  AnyMark as Mark,
  PathMark,
  RectMark,
  SymbolMark,
  SymbolShape,
  TextMark,
} from '../primitives/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Legend mark output - all marks needed to render a legend.
 */
export interface LegendMarks {
  /** Legend title */
  title?: TextMark;
  /** Legend entries (symbol + label pairs) */
  entries: LegendEntry[];
  /** Background rectangle (optional) */
  background?: RectMark;
}

/**
 * A single legend entry (symbol + label).
 */
export interface LegendEntry {
  /** The symbol (colored rect, line, or shape) */
  symbol: SymbolMark | RectMark | PathMark;
  /** The label text */
  label: TextMark;
  /** The data value this entry represents */
  value: unknown;
}

/**
 * Position for legend placement.
 */
export interface LegendPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_LEGEND_CONFIG: Required<
  Pick<
    LegendSpec,
    | 'direction'
    | 'labelFontSize'
    | 'labelColor'
    | 'titleFontSize'
    | 'titleColor'
    | 'symbolSize'
    | 'symbolType'
    | 'padding'
    | 'offset'
  >
> = {
  direction: 'vertical',
  labelFontSize: 11,
  labelColor: '#333333',
  titleFontSize: 12,
  titleColor: '#333333',
  symbolSize: 100,
  symbolType: 'circle',
  padding: 10,
  offset: 10,
};

// Symbol spacing
const SYMBOL_LABEL_GAP = 5;
const ENTRY_GAP_VERTICAL = 18;
const ENTRY_GAP_HORIZONTAL = 80;

// =============================================================================
// Main Legend Generation Function
// =============================================================================

/**
 * Generate legend marks from a channel specification and scale.
 *
 * @param channel - Channel specification with legend config
 * @param scale - The color/size scale for this legend
 * @param layout - Chart layout dimensions
 * @returns All marks needed to render the legend
 */
export function generateLegend(
  channel: ChannelSpec,
  scale: ColorScale | OrdinalColorScale,
  layout: Layout,
): LegendMarks {
  const legendConfig = channel.legend ?? {};
  const config = { ...DEFAULT_LEGEND_CONFIG, ...legendConfig };

  // If legend is null, return empty marks
  if (channel.legend === null) {
    return { entries: [] };
  }

  // Get legend values from scale
  const legendValues = getLegendValues(scale);
  if (legendValues.length === 0) {
    return { entries: [] };
  }

  // Calculate legend position
  const position = calculateLegendPosition(
    legendConfig.orient ?? 'right',
    layout,
    legendValues.length,
    config,
  );

  const marks: LegendMarks = {
    entries: [],
  };

  // Generate title
  const title = config.title ?? channel.title;
  if (title) {
    marks.title = generateLegendTitle(title, position, config);
  }

  // Generate entries
  const titleOffset = title ? config.titleFontSize + 8 : 0;
  marks.entries = generateLegendEntries(
    legendValues,
    scale,
    {
      ...position,
      y: position.y + titleOffset,
    },
    config,
  );

  return marks;
}

// =============================================================================
// Legend Value Generation
// =============================================================================

/**
 * Get values to display in the legend from a scale.
 */
function getLegendValues(
  scale: ColorScale | OrdinalColorScale,
): { value: unknown; color: string }[] {
  if ('domain' in scale && typeof scale.domain === 'function') {
    const domain = scale.domain();

    return domain.map((value) => ({
      value,
      color: scale(value as string),
    }));
  }

  return [];
}

// =============================================================================
// Position Calculation
// =============================================================================

/**
 * Calculate the position for the legend based on orientation.
 */
export function calculateLegendPosition(
  orient: LegendOrient,
  layout: Layout,
  entryCount: number,
  config: typeof DEFAULT_LEGEND_CONFIG,
): LegendPosition {
  const { plotArea } = layout;
  const { padding, offset } = config;

  // Estimate legend size
  const isVertical = config.direction === 'vertical';
  const entryHeight = ENTRY_GAP_VERTICAL;
  const entryWidth = ENTRY_GAP_HORIZONTAL;

  const legendHeight = isVertical
    ? entryCount * entryHeight + padding * 2
    : entryHeight + padding * 2;
  const legendWidth = isVertical ? entryWidth + padding * 2 : entryCount * entryWidth + padding * 2;

  let x: number, y: number;

  switch (orient) {
    case 'right':
      x = plotArea.x + plotArea.width + offset;
      y = plotArea.y;
      break;
    case 'left':
      x = plotArea.x - legendWidth - offset;
      y = plotArea.y;
      break;
    case 'top':
      x = plotArea.x + plotArea.width / 2 - legendWidth / 2;
      y = plotArea.y - legendHeight - offset;
      break;
    case 'bottom':
      x = plotArea.x + plotArea.width / 2 - legendWidth / 2;
      y = plotArea.y + plotArea.height + offset;
      break;
    case 'top-left':
      x = plotArea.x + offset;
      y = plotArea.y + offset;
      break;
    case 'top-right':
      x = plotArea.x + plotArea.width - legendWidth - offset;
      y = plotArea.y + offset;
      break;
    case 'bottom-left':
      x = plotArea.x + offset;
      y = plotArea.y + plotArea.height - legendHeight - offset;
      break;
    case 'bottom-right':
      x = plotArea.x + plotArea.width - legendWidth - offset;
      y = plotArea.y + plotArea.height - legendHeight - offset;
      break;
    case 'none':
    default:
      // Hide legend by placing off-screen
      x = -1000;
      y = -1000;
      break;
  }

  return { x, y, width: legendWidth, height: legendHeight };
}

// =============================================================================
// Mark Generation Functions
// =============================================================================

/**
 * Generate the legend title mark.
 */
function generateLegendTitle(
  title: string,
  position: LegendPosition,
  config: typeof DEFAULT_LEGEND_CONFIG,
): TextMark {
  return {
    type: 'text',
    x: position.x + config.padding,
    y: position.y + config.padding,
    text: title,
    fontSize: config.titleFontSize,
    fontFamily: 'sans-serif',
    fontWeight: 'bold',
    textAlign: 'left',
    textBaseline: 'top',
    style: {
      fill: config.titleColor,
    },
  };
}

/**
 * Generate legend entry marks.
 */
function generateLegendEntries(
  values: { value: unknown; color: string }[],
  _scale: ColorScale | OrdinalColorScale,
  position: LegendPosition,
  config: typeof DEFAULT_LEGEND_CONFIG,
): LegendEntry[] {
  const entries: LegendEntry[] = [];
  const isVertical = config.direction === 'vertical';

  for (let i = 0; i < values.length; i++) {
    const { value, color } = values[i];

    // Calculate position for this entry
    const entryX = isVertical
      ? position.x + config.padding
      : position.x + config.padding + i * ENTRY_GAP_HORIZONTAL;
    const entryY = isVertical
      ? position.y + config.padding + i * ENTRY_GAP_VERTICAL
      : position.y + config.padding;

    // Create symbol
    const symbol = createLegendSymbol(
      entryX,
      entryY + 8, // Center vertically with text
      color,
      config.symbolType,
      config.symbolSize,
    );

    // Create label
    const label: TextMark = {
      type: 'text',
      x: entryX + Math.sqrt(config.symbolSize / Math.PI) + SYMBOL_LABEL_GAP + 5,
      y: entryY + 8,
      text: String(value),
      fontSize: config.labelFontSize,
      fontFamily: 'sans-serif',
      textAlign: 'left',
      textBaseline: 'middle',
      style: {
        fill: config.labelColor,
      },
      datum: value,
    };

    entries.push({ symbol, label, value });
  }

  return entries;
}

/**
 * Create a legend symbol mark.
 */
function createLegendSymbol(
  x: number,
  y: number,
  color: string,
  symbolType: LegendSpec['symbolType'],
  size: number,
): SymbolMark | RectMark | PathMark {
  if (symbolType === 'line') {
    const side = Math.sqrt(size);
    const length = side * 2.8;
    return {
      type: 'path',
      x: 0,
      y: 0,
      path: `M${x - length / 2},${y} L${x + length / 2},${y}`,
      style: {
        stroke: color,
        strokeWidth: 2,
      },
    };
  }

  if (symbolType === 'square' || symbolType === 'area') {
    const side = Math.sqrt(size);
    const width = symbolType === 'area' ? side * 2.8 : side;
    return {
      type: 'rect',
      x: x - width / 2,
      y: y - side / 2,
      width,
      height: side,
      style: {
        fill: color,
      },
    };
  }

  // Default to symbol mark
  return {
    type: 'symbol',
    x,
    y,
    size,
    shape: (symbolType ?? 'circle') as SymbolShape,
    style: {
      fill: color,
    },
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculate the space required for a legend.
 */
export function calculateLegendSpace(
  _orient: LegendOrient,
  entryCount: number,
  config: Partial<LegendSpec>,
): { width: number; height: number } {
  const c = { ...DEFAULT_LEGEND_CONFIG, ...config };
  const isVertical = c.direction === 'vertical';

  const entryHeight = ENTRY_GAP_VERTICAL;
  const entryWidth = ENTRY_GAP_HORIZONTAL;

  const height = isVertical
    ? entryCount * entryHeight + c.padding * 2
    : entryHeight + c.padding * 2;
  const width = isVertical ? entryWidth + c.padding * 2 : entryCount * entryWidth + c.padding * 2;

  // Add title space
  let totalHeight = height;
  const totalWidth = width;
  if (config.title) {
    totalHeight += c.titleFontSize + 8;
  }

  return { width: totalWidth, height: totalHeight };
}

/**
 * Flatten legend marks into a single mark array.
 */
export function flattenLegendMarks(legend: LegendMarks): Mark[] {
  const marks: Mark[] = [];

  if (legend.background) {
    marks.push(legend.background);
  }

  if (legend.title) {
    marks.push(legend.title);
  }

  for (const entry of legend.entries) {
    marks.push(entry.symbol);
    marks.push(entry.label);
  }

  return marks;
}

/**
 * Create a gradient legend for continuous color scales.
 */
export function generateGradientLegend(
  channel: ChannelSpec,
  scale: ColorScale,
  layout: Layout,
  domain: [number, number],
): Mark[] {
  const legendConfig = channel.legend ?? {};
  const config = { ...DEFAULT_LEGEND_CONFIG, ...legendConfig };

  if (channel.legend === null) {
    return [];
  }

  const position = calculateLegendPosition(
    legendConfig.orient ?? 'right',
    layout,
    5, // Approximate entry count
    config,
  );

  const marks: Mark[] = [];
  const gradientWidth = 15;
  const gradientHeight = 100;

  // Create gradient as multiple thin rectangles
  const steps = 20;
  const stepHeight = gradientHeight / steps;

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const value = domain[0] + t * (domain[1] - domain[0]);
    const color = scale(value);

    marks.push({
      type: 'rect',
      x: position.x + config.padding,
      y: position.y + config.padding + (steps - 1 - i) * stepHeight,
      width: gradientWidth,
      height: stepHeight + 1, // Slight overlap to avoid gaps
      style: {
        fill: color,
      },
    });
  }

  // Add labels at min and max
  const labelX = position.x + config.padding + gradientWidth + 5;

  marks.push({
    type: 'text',
    x: labelX,
    y: position.y + config.padding,
    text: String(domain[1]),
    fontSize: config.labelFontSize,
    fontFamily: 'sans-serif',
    textAlign: 'left',
    textBaseline: 'top',
    style: {
      fill: config.labelColor,
    },
  });

  marks.push({
    type: 'text',
    x: labelX,
    y: position.y + config.padding + gradientHeight,
    text: String(domain[0]),
    fontSize: config.labelFontSize,
    fontFamily: 'sans-serif',
    textAlign: 'left',
    textBaseline: 'bottom',
    style: {
      fill: config.labelColor,
    },
  });

  return marks;
}
