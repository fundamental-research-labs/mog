/**
 * Axis Component - Generates axis marks (ticks, labels, gridlines).
 *
 * This component is used by the grammar compiler to generate axis marks
 * from scale and axis specifications.
 *
 * Pure functions, no framework dependencies.
 */

import type { AxisOrient, AxisSpec, ChannelSpec, Layout } from '../grammar/spec';
import type { BandScale, ContinuousScale } from '../primitives/scales/types';
import type { AnyMark as Mark, PathMark, TextMark } from '../primitives/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Axis mark output - all marks needed to render an axis.
 */
export interface AxisMarks {
  /** Domain line */
  domain?: PathMark;
  /** Tick marks (small lines) */
  ticks: PathMark[];
  /** Tick labels */
  labels: TextMark[];
  /** Axis title */
  title?: TextMark;
  /** Grid lines */
  gridLines?: PathMark[];
}

/**
 * Scale type for axis generation.
 */
export type AxisScale = ContinuousScale | BandScale;

/**
 * Tick value with position.
 */
interface TickValue {
  value: unknown;
  position: number;
  label: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_AXIS_CONFIG = {
  labels: true,
  ticks: true,
  tickSize: 5,
  tickWidth: 1,
  tickColor: '#888888',
  labelFontSize: 11,
  labelColor: '#333333',
  labelPadding: 3,
  labelAngle: 0,
  titleFontSize: 12,
  titleColor: '#333333',
  titlePadding: 10,
  grid: false,
  gridColor: '#e0e0e0',
  gridOpacity: 1,
  gridDash: undefined as number[] | undefined,
  domain: true,
  domainColor: '#888888',
  domainWidth: 1,
  title: undefined as string | undefined,
};

type AxisConfig = typeof DEFAULT_AXIS_CONFIG;

// =============================================================================
// Main Axis Generation Function
// =============================================================================

/**
 * Generate axis marks from a channel specification and scale.
 *
 * @param channel - Channel specification with axis config
 * @param scale - The scale for this axis
 * @param orient - Axis orientation
 * @param layout - Chart layout dimensions
 * @returns All marks needed to render the axis
 */
export function generateAxis(
  channel: ChannelSpec,
  scale: AxisScale,
  orient: AxisOrient,
  layout: Layout,
): AxisMarks {
  // If axis is null, return empty marks
  if (channel.axis === null) {
    return { ticks: [], labels: [] };
  }

  const axisConfig: Partial<AxisSpec> = channel.axis ?? {};
  // Handle null vs undefined for title - convert null to undefined for compatibility
  const mergedConfig = { ...DEFAULT_AXIS_CONFIG, ...axisConfig };
  const config: AxisConfig = {
    ...mergedConfig,
    title: mergedConfig.title === null ? undefined : mergedConfig.title,
  };

  // Get tick values from scale
  const tickValues = getTickValues(scale, axisConfig.tickCount);

  // Generate marks based on orientation
  const marks: AxisMarks = {
    ticks: [],
    labels: [],
  };

  // Generate domain line
  if (config.domain) {
    marks.domain = generateDomainLine(orient, layout, config);
  }

  // Generate ticks and labels
  for (const tick of tickValues) {
    if (config.ticks) {
      marks.ticks.push(generateTickMark(tick, orient, layout, config));
    }
    if (config.labels) {
      marks.labels.push(generateTickLabel(tick, orient, layout, config));
    }
  }

  // Generate grid lines
  if (config.grid) {
    marks.gridLines = tickValues.map((tick) => generateGridLine(tick, orient, layout, config));
  }

  // Generate title
  const title = config.title ?? channel.title;
  if (title) {
    marks.title = generateAxisTitle(title, orient, layout, config);
  }

  return marks;
}

// =============================================================================
// Tick Value Generation
// =============================================================================

/**
 * Get tick values from a scale.
 */
function getTickValues(scale: AxisScale, tickCount?: number): TickValue[] {
  // Check if it's a continuous scale with ticks method
  if ('ticks' in scale && typeof scale.ticks === 'function') {
    const continuousScale = scale as ContinuousScale;
    const values = continuousScale.ticks(tickCount ?? 10);
    const formatter = continuousScale.tickFormat
      ? continuousScale.tickFormat(tickCount ?? 10)
      : String;

    return values.map((value) => ({
      value,
      position: continuousScale(value),
      label: formatter(value),
    }));
  }

  // Band scale - use domain values
  if ('domain' in scale && typeof scale.domain === 'function') {
    const bandScale = scale as BandScale;
    const domain = bandScale.domain();
    const bandwidth = 'bandwidth' in bandScale ? bandScale.bandwidth() : 0;

    return domain.map((value: string) => ({
      value,
      position: bandScale(value) + bandwidth / 2,
      label: String(value),
    }));
  }

  return [];
}

// =============================================================================
// Mark Generation Functions
// =============================================================================

/**
 * Generate the domain line mark.
 */
function generateDomainLine(orient: AxisOrient, layout: Layout, config: AxisConfig): PathMark {
  const { plotArea } = layout;
  let path: string;

  switch (orient) {
    case 'bottom':
      path = `M${plotArea.x},${plotArea.y + plotArea.height} L${plotArea.x + plotArea.width},${plotArea.y + plotArea.height}`;
      break;
    case 'top':
      path = `M${plotArea.x},${plotArea.y} L${plotArea.x + plotArea.width},${plotArea.y}`;
      break;
    case 'left':
      path = `M${plotArea.x},${plotArea.y} L${plotArea.x},${plotArea.y + plotArea.height}`;
      break;
    case 'right':
      path = `M${plotArea.x + plotArea.width},${plotArea.y} L${plotArea.x + plotArea.width},${plotArea.y + plotArea.height}`;
      break;
  }

  return {
    type: 'path',
    x: 0,
    y: 0,
    path,
    style: {
      stroke: config.domainColor,
      strokeWidth: config.domainWidth,
    },
  };
}

/**
 * Generate a tick mark.
 */
function generateTickMark(
  tick: TickValue,
  orient: AxisOrient,
  layout: Layout,
  config: AxisConfig,
): PathMark {
  const { plotArea } = layout;
  const pos = tick.position;
  let path: string;

  switch (orient) {
    case 'bottom': {
      const y = plotArea.y + plotArea.height;
      path = `M${plotArea.x + pos},${y} L${plotArea.x + pos},${y + config.tickSize}`;
      break;
    }
    case 'top': {
      const y = plotArea.y;
      path = `M${plotArea.x + pos},${y} L${plotArea.x + pos},${y - config.tickSize}`;
      break;
    }
    case 'left': {
      const x = plotArea.x;
      path = `M${x},${plotArea.y + pos} L${x - config.tickSize},${plotArea.y + pos}`;
      break;
    }
    case 'right': {
      const x = plotArea.x + plotArea.width;
      path = `M${x},${plotArea.y + pos} L${x + config.tickSize},${plotArea.y + pos}`;
      break;
    }
  }

  return {
    type: 'path',
    x: 0,
    y: 0,
    path,
    style: {
      stroke: config.tickColor,
      strokeWidth: config.tickWidth,
    },
  };
}

/**
 * Generate a tick label.
 */
function generateTickLabel(
  tick: TickValue,
  orient: AxisOrient,
  layout: Layout,
  config: AxisConfig,
): TextMark {
  const { plotArea } = layout;
  const pos = tick.position;
  let x: number, y: number;
  let textAlign: 'left' | 'center' | 'right';
  let textBaseline: 'top' | 'middle' | 'bottom';

  switch (orient) {
    case 'bottom':
      x = plotArea.x + pos;
      y = plotArea.y + plotArea.height + config.tickSize + config.labelPadding;
      textAlign = 'center';
      textBaseline = 'top';
      break;
    case 'top':
      x = plotArea.x + pos;
      y = plotArea.y - config.tickSize - config.labelPadding;
      textAlign = 'center';
      textBaseline = 'bottom';
      break;
    case 'left':
      x = plotArea.x - config.tickSize - config.labelPadding;
      y = plotArea.y + pos;
      textAlign = 'right';
      textBaseline = 'middle';
      break;
    case 'right':
      x = plotArea.x + plotArea.width + config.tickSize + config.labelPadding;
      y = plotArea.y + pos;
      textAlign = 'left';
      textBaseline = 'middle';
      break;
  }

  return {
    type: 'text',
    x,
    y,
    text: tick.label,
    fontSize: config.labelFontSize,
    fontFamily: 'sans-serif',
    textAlign,
    textBaseline,
    rotation: config.labelAngle ? (config.labelAngle * Math.PI) / 180 : undefined,
    style: {
      fill: config.labelColor,
    },
    datum: tick.value,
  };
}

/**
 * Generate a grid line.
 */
function generateGridLine(
  tick: TickValue,
  orient: AxisOrient,
  layout: Layout,
  config: AxisConfig,
): PathMark {
  const { plotArea } = layout;
  const pos = tick.position;
  let path: string;

  switch (orient) {
    case 'bottom':
    case 'top': {
      // Vertical grid line
      path = `M${plotArea.x + pos},${plotArea.y} L${plotArea.x + pos},${plotArea.y + plotArea.height}`;
      break;
    }
    case 'left':
    case 'right': {
      // Horizontal grid line
      path = `M${plotArea.x},${plotArea.y + pos} L${plotArea.x + plotArea.width},${plotArea.y + pos}`;
      break;
    }
  }

  return {
    type: 'path',
    x: 0,
    y: 0,
    path,
    style: {
      stroke: config.gridColor,
      strokeWidth: 1,
      opacity: config.gridOpacity,
    },
  };
}

/**
 * Generate the axis title.
 */
function generateAxisTitle(
  title: string,
  orient: AxisOrient,
  layout: Layout,
  config: AxisConfig,
): TextMark {
  const { plotArea } = layout;
  let x: number, y: number;
  const textAlign: 'left' | 'center' | 'right' = 'center';
  let textBaseline: 'top' | 'middle' | 'bottom' = 'middle';
  let rotation: number | undefined;

  switch (orient) {
    case 'bottom':
      x = plotArea.x + plotArea.width / 2;
      y =
        plotArea.y +
        plotArea.height +
        config.tickSize +
        config.labelPadding +
        config.labelFontSize +
        config.titlePadding;
      textBaseline = 'top';
      break;
    case 'top':
      x = plotArea.x + plotArea.width / 2;
      y =
        plotArea.y -
        config.tickSize -
        config.labelPadding -
        config.labelFontSize -
        config.titlePadding;
      textBaseline = 'bottom';
      break;
    case 'left':
      x = plotArea.x - config.tickSize - config.labelPadding - 30 - config.titlePadding;
      y = plotArea.y + plotArea.height / 2;
      rotation = -Math.PI / 2;
      break;
    case 'right':
      x =
        plotArea.x +
        plotArea.width +
        config.tickSize +
        config.labelPadding +
        30 +
        config.titlePadding;
      y = plotArea.y + plotArea.height / 2;
      rotation = Math.PI / 2;
      break;
  }

  return {
    type: 'text',
    x,
    y,
    text: title,
    fontSize: config.titleFontSize,
    fontFamily: 'sans-serif',
    fontWeight: 'bold',
    textAlign,
    textBaseline,
    rotation,
    style: {
      fill: config.titleColor,
    },
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Determine axis orientation from channel type.
 */
export function getAxisOrient(channel: 'x' | 'y', spec?: AxisSpec): AxisOrient {
  if (spec?.orient) {
    return spec.orient;
  }
  return channel === 'x' ? 'bottom' : 'left';
}

/**
 * Calculate required space for an axis.
 */
export function calculateAxisSpace(_orient: AxisOrient, config: Partial<AxisSpec>): number {
  const c = { ...DEFAULT_AXIS_CONFIG, ...config };
  let space = 0;

  if (c.ticks) {
    space += c.tickSize;
  }
  if (c.labels) {
    space += c.labelPadding + c.labelFontSize;
  }
  if (config.title) {
    space += c.titlePadding + c.titleFontSize;
  }

  return space;
}

/**
 * Flatten axis marks into a single mark array.
 */
export function flattenAxisMarks(axis: AxisMarks): Mark[] {
  const marks: Mark[] = [];

  if (axis.domain) {
    marks.push(axis.domain);
  }

  if (axis.gridLines) {
    marks.push(...axis.gridLines);
  }

  marks.push(...axis.ticks);
  marks.push(...axis.labels);

  if (axis.title) {
    marks.push(axis.title);
  }

  return marks;
}
