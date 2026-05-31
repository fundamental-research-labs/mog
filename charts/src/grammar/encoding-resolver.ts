/**
 * Encoding Resolver for Chart Grammar
 *
 * Resolves encoding specifications to scales and visual values:
 * - Creates scales from encoding channels
 * - Maps data fields to visual properties
 * - Handles aggregation, binning, and time units
 *
 * Pure functions - no side effects.
 */

import { scaleLinear } from '../primitives/scales/linear';
import type { ChartScale } from '../primitives/scales/types';
import { DEFAULT_CATEGORY_COLORS, interpolateOklab } from '../utils/colors';
import type {
  ChannelSpec,
  DataRow,
  EncodingSpec,
  FieldType,
  Layout,
  ScaleSpec,
  ScaleType,
} from './spec';

// =============================================================================
// Safe Min/Max Helpers (avoid call stack overflow with large arrays)
// =============================================================================

function safeMin(values: number[]): number {
  let min = Infinity;
  for (const v of values) {
    if (v < min) min = v;
  }
  return min;
}

function safeMax(values: number[]): number {
  let max = -Infinity;
  for (const v of values) {
    if (v > max) max = v;
  }
  return max;
}

// =============================================================================
// Typed Extraction Helpers
// =============================================================================

function numericDomainBound(
  domain: unknown[] | string | undefined,
  index: number,
): number | undefined {
  if (!Array.isArray(domain)) return undefined;
  const val = domain[index];
  return typeof val === 'number' ? val : undefined;
}

function extractNumericValues(data: DataRow[], field: string): number[] {
  return data.map((d) => d[field]).filter((v): v is number => typeof v === 'number' && isFinite(v));
}

function stringRange(range: unknown[]): string[] {
  return range.filter((v): v is string => typeof v === 'string');
}

// =============================================================================
// Types
// =============================================================================

/**
 * Scale function type union.
 *
 * ChartScale is a callable interface that accepts unknown and returns
 * number | string, with optional metadata methods (domain, range, bandwidth,
 * ticks, etc.). This eliminates the need for `as any` casts when invoking
 * scales or accessing their methods.
 */
export type AnyScale = ChartScale;

/**
 * Map of scales by channel name.
 */
export interface ScaleMap {
  x?: AnyScale;
  y?: AnyScale;
  color?: AnyScale;
  fill?: AnyScale;
  stroke?: AnyScale;
  size?: AnyScale;
  opacity?: AnyScale;
  shape?: AnyScale;
  theta?: AnyScale;
  radius?: AnyScale;
}

/**
 * Resolved encoding with scale and accessor.
 */
export interface ResolvedEncoding {
  field?: string;
  scale?: AnyScale;
  accessor: (datum: DataRow) => unknown;
  type: FieldType;
}

/**
 * Map of resolved encodings by channel name.
 */
export interface ResolvedEncodings {
  x?: ResolvedEncoding;
  y?: ResolvedEncoding;
  color?: ResolvedEncoding;
  fill?: ResolvedEncoding;
  stroke?: ResolvedEncoding;
  size?: ResolvedEncoding;
  opacity?: ResolvedEncoding;
  shape?: ResolvedEncoding;
  text?: ResolvedEncoding;
  tooltip?: ResolvedEncoding[];
  theta?: ResolvedEncoding;
  radius?: ResolvedEncoding;
  detail?: ResolvedEncoding;
}

// =============================================================================
// Default Color Palettes
// =============================================================================

/**
 * Re-export of the default categorical palette.
 *
 * The canonical constant lives in `utils/colors` so it can be consumed by
 * both chart-config types and grammar code without the `types/` barrel
 * importing back into `grammar/` (cycle).  Kept exported here to preserve
 * the existing public surface (`@mog/charts/grammar`, `algebra`, tests).
 */
export { DEFAULT_CATEGORY_COLORS };

/**
 * Default sequential color ramp.
 */
export const DEFAULT_SEQUENTIAL_COLORS = [
  '#f7fbff',
  '#deebf7',
  '#c6dbef',
  '#9ecae1',
  '#6baed6',
  '#4292c6',
  '#2171b5',
  '#08519c',
  '#08306b',
];

/**
 * Default shape palette.
 */
export const DEFAULT_SHAPES: Array<
  'circle' | 'square' | 'diamond' | 'cross' | 'triangle-up' | 'triangle-down'
> = ['circle', 'square', 'diamond', 'cross', 'triangle-up', 'triangle-down'];

// =============================================================================
// Scale Creation
// =============================================================================

/**
 * Create scales from encoding specification.
 *
 * @param encoding - Encoding specification
 * @param data - Data rows
 * @param layout - Chart layout
 * @returns Map of scales by channel
 */
export function createScales(
  encoding: EncodingSpec | undefined,
  data: DataRow[],
  layout: Layout,
  markType?: string,
): ScaleMap {
  if (!encoding) {
    return {};
  }

  const scales: ScaleMap = {};

  // X scale
  if (encoding.x) {
    scales.x = createScaleForChannel(
      encoding.x,
      data,
      [layout.plotArea.x, layout.plotArea.x + layout.plotArea.width],
      markType,
    );
  }

  // Y scale (inverted for canvas coordinates)
  if (encoding.y) {
    scales.y = createScaleForChannel(
      encoding.y,
      data,
      [layout.plotArea.y + layout.plotArea.height, layout.plotArea.y],
      markType,
    );
  }

  // Color scale
  if (encoding.color) {
    scales.color = createColorScale(encoding.color, data);
  }

  // Fill scale
  if (encoding.fill) {
    scales.fill = createColorScale(encoding.fill, data);
  }

  // Stroke scale
  if (encoding.stroke) {
    scales.stroke = createColorScale(encoding.stroke, data);
  }

  // Size scale
  if (encoding.size) {
    scales.size = createSizeScale(encoding.size, data);
  }

  // Opacity scale
  if (encoding.opacity) {
    scales.opacity = createOpacityScale(encoding.opacity, data);
  }

  // Shape scale
  if (encoding.shape) {
    scales.shape = createShapeScale(encoding.shape, data);
  }

  // Theta scale (for arc charts)
  if (encoding.theta) {
    scales.theta = createScaleForChannel(encoding.theta, data, [0, Math.PI * 2]);
  }

  // Radius scale (for arc charts)
  if (encoding.radius) {
    const maxRadius = Math.min(layout.plotArea.width, layout.plotArea.height) / 2;
    scales.radius = createScaleForChannel(encoding.radius, data, [0, maxRadius]);
  }

  return scales;
}

/**
 * Create a scale for a position channel.
 */
export function createScaleForChannel(
  channel: ChannelSpec,
  data: DataRow[],
  range: [number, number],
  markType?: string,
): ChartScale {
  const fieldType = channel.type ?? inferFieldType(channel.field, data);
  const scaleType = channel.scale?.type ?? inferScaleType(fieldType);

  // Handle constant value
  if (channel.value !== undefined) {
    const constVal = typeof channel.value === 'number' ? channel.value : String(channel.value);
    return Object.assign((_v: unknown): number | string => constVal, {
      copy: (): ChartScale => createScaleForChannel(channel, data, range, markType),
    });
  }

  // Get field values
  const field = channel.field;
  if (!field) {
    return Object.assign((_v: unknown) => range[0], {
      copy: (): ChartScale => createScaleForChannel(channel, data, range, markType),
    });
  }

  const values = data.map((d) => d[field]);

  // Create scale based on type
  switch (scaleType) {
    case 'linear':
    case 'pow':
    case 'sqrt':
    case 'symlog':
      return createLinearScale(extractNumericValues(data, field), range, channel.scale, markType);

    case 'log':
      return createLogScale(extractNumericValues(data, field), range, channel.scale);

    case 'time':
    case 'utc':
      return createTimeScale(values, range, channel.scale);

    case 'band':
      return createBandScale(values, range, channel.scale);

    case 'point':
      return createPointScale(values, range, channel.scale);

    case 'ordinal':
    default:
      // For ordinal position scales, use band scale
      if (fieldType === 'ordinal' || fieldType === 'nominal') {
        return createBandScale(values, range, channel.scale);
      }
      return createLinearScale(extractNumericValues(data, field), range, channel.scale, markType);
  }
}

/**
 * Create a linear scale.
 */
function createLinearScale(
  values: number[],
  range: [number, number],
  scaleSpec?: ScaleSpec | null,
  markType?: string,
): ChartScale {
  const numericValues = values.filter((v) => typeof v === 'number' && !isNaN(v));

  let min =
    numericDomainBound(scaleSpec?.domain, 0) ??
    (numericValues.length > 0 ? safeMin(numericValues) : 0);
  let max =
    numericDomainBound(scaleSpec?.domain, 1) ??
    (numericValues.length > 0 ? safeMax(numericValues) : 1);

  // Handle zero: only default to including zero for bar/area marks (Vega-Lite convention).
  // Other mark types (line, point, etc.) scale to the data range by default.
  const zeroMarks = new Set(['bar', 'area', 'arc']);
  const defaultZero = zeroMarks.has(markType ?? 'bar');
  const includeZero = scaleSpec?.zero ?? defaultZero;
  if (includeZero) {
    if (min > 0) min = 0;
    if (max < 0) max = 0;
  }

  // Handle reverse
  const outputRange = scaleSpec?.reverse ? [range[1], range[0]] : range;

  const innerScale = scaleLinear().domain([min, max]).range(outputRange);

  // Apply nice
  if (scaleSpec?.nice !== false) {
    innerScale.nice(typeof scaleSpec?.nice === 'number' ? scaleSpec.nice : 10);
  }

  // Apply clamp
  if (scaleSpec?.clamp) {
    innerScale.clamp(true);
  }

  // Wrap the ContinuousScale as a ChartScale that accepts unknown
  const chartScale: ChartScale = Object.assign(
    (value: unknown): number => {
      const v = typeof value === 'number' ? value : parseFloat(String(value));
      return innerScale(isNaN(v) ? 0 : v);
    },
    {
      domain: () => innerScale.domain(),
      range: () => innerScale.range(),
      invert: (v: number) => innerScale.invert(v),
      ticks: (count?: number) => innerScale.ticks(count ?? 10),
      tickFormat: (...args: unknown[]) => {
        const fmt = innerScale.tickFormat(
          typeof args[0] === 'number' ? args[0] : undefined,
          typeof args[1] === 'string' ? args[1] : undefined,
        );
        return (n: unknown) => fmt(Number(n));
      },
      nice: (count?: number) => {
        innerScale.nice(count ?? 10);
        return chartScale;
      },
      clamp: (...args: unknown[]) =>
        args.length > 0 && typeof args[0] === 'boolean'
          ? (innerScale.clamp(args[0]), chartScale)
          : innerScale.clamp(),
      copy: () => createLinearScale(values, range, scaleSpec, markType),
    },
  );

  return chartScale;
}

/**
 * Create a logarithmic scale.
 * Filters out non-positive values from the domain since log(x) is undefined for x <= 0.
 */
function createLogScale(
  values: number[],
  range: [number, number],
  scaleSpec?: ScaleSpec | null,
): ChartScale {
  // Filter non-positive values for log scale domain computation
  const numericValues = values.filter((v) => typeof v === 'number' && v > 0);

  const min =
    numericDomainBound(scaleSpec?.domain, 0) ??
    (numericValues.length > 0 ? safeMin(numericValues) : 1);
  const max =
    numericDomainBound(scaleSpec?.domain, 1) ??
    (numericValues.length > 0 ? safeMax(numericValues) : 10);

  // Clamp domain bounds to positive values to prevent NaN from log(0) or log(negative)
  const safeMinDomain = min > 0 ? min : Number.EPSILON;
  const safeMaxDomain = max > 0 ? max : 10;

  // For log scale, create a custom implementation
  const base = scaleSpec?.base ?? 10;
  const logMin = Math.log(safeMinDomain) / Math.log(base);
  const logMax = Math.log(safeMaxDomain) / Math.log(base);

  // Create a linear scale in log space
  const linearScale = scaleLinear().domain([logMin, logMax]).range(range);

  const logScale: ChartScale = Object.assign(
    (value: unknown): number => {
      const v = typeof value === 'number' ? value : parseFloat(String(value));
      if (v <= 0 || isNaN(v)) return range[0];
      const logValue = Math.log(v) / Math.log(base);
      return linearScale(logValue);
    },
    {
      domain: () => [safeMinDomain, safeMaxDomain],
      range: () => [...range],
      invert: (y: number) => Math.pow(base, linearScale.invert(y)),
      ticks: (count?: number) => linearScale.ticks(count).map((t) => Math.pow(base, t)),
      tickFormat: () => (d: unknown) => String(d),
      nice: () => logScale,
      clamp: () => false,
      copy: () => createLogScale(values, range, scaleSpec),
    },
  );

  return logScale;
}

/**
 * Create a time scale.
 */
function createTimeScale(
  values: unknown[],
  range: [number, number],
  scaleSpec?: ScaleSpec | null,
): ChartScale {
  const timestamps = values
    .map((v) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime()))
    .filter((t) => !isNaN(t));

  const min =
    numericDomainBound(scaleSpec?.domain, 0) ?? (timestamps.length > 0 ? safeMin(timestamps) : 0);
  const max =
    numericDomainBound(scaleSpec?.domain, 1) ?? (timestamps.length > 0 ? safeMax(timestamps) : 1);

  const innerScale = scaleLinear().domain([min, max]).range(range);

  if (scaleSpec?.nice !== false) {
    innerScale.nice();
  }

  const timeScale: ChartScale = Object.assign(
    (value: unknown): number => {
      let ts: number;
      if (typeof value === 'number') {
        ts = value;
      } else if (value instanceof Date) {
        ts = value.getTime();
      } else {
        ts = new Date(String(value)).getTime();
      }
      if (isNaN(ts)) return range[0]; // fallback for invalid dates
      return innerScale(ts);
    },
    {
      domain: () => innerScale.domain().map((ts: number) => new Date(ts)),
      range: () => innerScale.range(),
      invert: (v: number) => innerScale.invert(v),
      ticks: (count?: number) => innerScale.ticks(count ?? 10),
      tickFormat: (...args: unknown[]) => {
        const fmt = innerScale.tickFormat(
          typeof args[0] === 'number' ? args[0] : undefined,
          typeof args[1] === 'string' ? args[1] : undefined,
        );
        return (n: unknown) => fmt(Number(n));
      },
      nice: (count?: number) => {
        innerScale.nice(count ?? 10);
        return timeScale;
      },
      clamp: (...args: unknown[]) =>
        args.length > 0 && typeof args[0] === 'boolean'
          ? (innerScale.clamp(args[0]), timeScale)
          : innerScale.clamp(),
      copy: () => createTimeScale(values, range, scaleSpec),
    },
  );

  return timeScale;
}

/**
 * Create a band scale for categorical data.
 */
function createBandScale(
  values: unknown[],
  range: [number, number],
  scaleSpec?: ScaleSpec | null,
): ChartScale {
  const domainValues = Array.isArray(scaleSpec?.domain)
    ? scaleSpec.domain.map(String)
    : [...new Set(values.map(String))];
  const uniqueValues = scaleSpec?.reverse ? [...domainValues].reverse() : domainValues;
  const padding = scaleSpec?.padding ?? 0.1;
  const paddingInner = scaleSpec?.paddingInner ?? padding;
  const paddingOuter = scaleSpec?.paddingOuter ?? padding;

  const n = uniqueValues.length;

  // Band scales always place items from the lower pixel value toward the
  // higher pixel value (left-to-right or top-to-bottom). This correctly
  // handles reversed Y-axis ranges like [320, 20].
  const rangeStart = Math.min(range[0], range[1]);
  const absExtent = Math.abs(range[1] - range[0]);

  // Calculate band width
  const totalPadding = paddingOuter * 2 + paddingInner * (n - 1);
  const availableSpace = absExtent * (1 - totalPadding / (n + totalPadding));
  const bandwidth = n > 0 ? availableSpace / n : 0;
  const step =
    n > 1 ? absExtent / (n + totalPadding / (1 - totalPadding / (n + totalPadding))) : bandwidth;

  const bandScale: ChartScale = Object.assign(
    (value: unknown): number => {
      const index = uniqueValues.indexOf(String(value));
      if (index === -1) return rangeStart;
      const start = rangeStart + paddingOuter * step + index * step;
      return start;
    },
    {
      domain: () => uniqueValues,
      range: () => [rangeStart, rangeStart + absExtent],
      bandwidth: () => bandwidth,
      step: () => step,
      padding: (...args: unknown[]) =>
        args.length > 0 && typeof args[0] === 'number' ? bandScale : padding,
      paddingInner: (...args: unknown[]) =>
        args.length > 0 && typeof args[0] === 'number' ? bandScale : paddingInner,
      paddingOuter: (...args: unknown[]) =>
        args.length > 0 && typeof args[0] === 'number' ? bandScale : paddingOuter,
      align: () => 0.5,
      round: () => false,
      copy: () => createBandScale(values, range, scaleSpec),
    },
  );

  return bandScale;
}

/**
 * Create a point scale for categorical data (no bandwidth).
 */
function createPointScale(
  values: unknown[],
  range: [number, number],
  scaleSpec?: ScaleSpec | null,
): ChartScale {
  const domainValues = Array.isArray(scaleSpec?.domain)
    ? scaleSpec.domain.map(String)
    : [...new Set(values.map(String))];
  const uniqueValues = scaleSpec?.reverse ? [...domainValues].reverse() : domainValues;
  const padding = scaleSpec?.padding ?? 0.5;

  // Point scales always place items from the lower pixel value toward the
  // higher pixel value, handling reversed ranges correctly.
  const rangeStart = Math.min(range[0], range[1]);
  const absExtent = Math.abs(range[1] - range[0]);
  const n = uniqueValues.length;
  const step = n > 1 ? absExtent / (n - 1 + padding * 2) : 0;

  const pointScale: ChartScale = Object.assign(
    (value: unknown): number => {
      const index = uniqueValues.indexOf(String(value));
      if (index === -1) return rangeStart + absExtent / 2;
      return rangeStart + padding * step + index * step;
    },
    {
      domain: () => uniqueValues,
      range: () => [rangeStart, rangeStart + absExtent],
      bandwidth: () => 0,
      step: () => step,
      padding: () => padding,
      paddingInner: () => 1,
      paddingOuter: () => padding,
      align: () => 0.5,
      round: () => false,
      copy: () => createPointScale(values, range, scaleSpec),
    },
  );

  return pointScale;
}

/**
 * Create a color scale.
 */
export function createColorScale(channel: ChannelSpec, data: DataRow[]): ChartScale {
  // Handle constant value
  if (channel.value !== undefined) {
    const colorValue = String(channel.value);
    const scale: ChartScale = Object.assign((_value: unknown) => colorValue, {
      domain: () => [],
      range: () => [colorValue],
      copy: (): ChartScale => scale,
    });
    return scale;
  }

  const field = channel.field;
  if (!field) {
    const scale: ChartScale = Object.assign((_value: unknown) => DEFAULT_CATEGORY_COLORS[0], {
      domain: () => [],
      range: () => DEFAULT_CATEGORY_COLORS,
      copy: (): ChartScale => scale,
    });
    return scale;
  }

  const values = data.map((d) => d[field]);
  const fieldType = channel.type ?? inferFieldType(field, data);

  if (fieldType === 'quantitative') {
    // Sequential color scale
    return createSequentialColorScale(extractNumericValues(data, field), channel.scale);
  } else {
    // Categorical color scale
    return createCategoricalColorScale(values, channel.scale);
  }
}

/**
 * Create a sequential color scale for quantitative data.
 */
function createSequentialColorScale(values: number[], scaleSpec?: ScaleSpec | null): ChartScale {
  const numericValues = values.filter((v) => typeof v === 'number' && !isNaN(v));
  const min =
    numericDomainBound(scaleSpec?.domain, 0) ??
    (numericValues.length > 0 ? safeMin(numericValues) : 0);
  const max =
    numericDomainBound(scaleSpec?.domain, 1) ??
    (numericValues.length > 0 ? safeMax(numericValues) : 1);
  const colors =
    (scaleSpec?.range ? stringRange(scaleSpec.range) : undefined) ?? DEFAULT_SEQUENTIAL_COLORS;

  const colorScale: ChartScale = Object.assign(
    (value: unknown): string => {
      const v = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(v)) return colors[0];

      const t = max !== min ? (v - min) / (max - min) : 0.5;
      const clampedT = Math.max(0, Math.min(1, t));
      const index = Math.floor(clampedT * (colors.length - 1));

      // Interpolate between colors
      const colorIndex = Math.min(index, colors.length - 2);
      const localT = clampedT * (colors.length - 1) - colorIndex;

      return interpolateColor(colors[colorIndex], colors[colorIndex + 1], localT);
    },
    {
      domain: () => [min, max],
      range: () => colors,
      copy: () => createSequentialColorScale(values, scaleSpec),
    },
  );

  return colorScale;
}

/**
 * Create a categorical color scale.
 */
function createCategoricalColorScale(values: unknown[], scaleSpec?: ScaleSpec | null): ChartScale {
  const uniqueValues = Array.isArray(scaleSpec?.domain)
    ? scaleSpec.domain.map(String)
    : [...new Set(values.map(String))];
  const colors =
    (scaleSpec?.range ? stringRange(scaleSpec.range) : undefined) ?? DEFAULT_CATEGORY_COLORS;

  const colorScale: ChartScale = Object.assign(
    (value: unknown): string => {
      const index = uniqueValues.indexOf(String(value));
      if (index === -1) return colors[0];
      return colors[index % colors.length];
    },
    {
      domain: () => uniqueValues,
      range: () => colors,
      copy: () => createCategoricalColorScale(values, scaleSpec),
    },
  );

  return colorScale;
}

/**
 * Create a size scale.
 */
function createSizeScale(channel: ChannelSpec, data: DataRow[]): ChartScale {
  // Handle constant value
  if (channel.value !== undefined) {
    const constVal = typeof channel.value === 'number' ? channel.value : String(channel.value);
    return Object.assign((_v: unknown): number | string => constVal, {});
  }

  const field = channel.field;
  if (!field) {
    return Object.assign((_v: unknown): number | string => 64, {});
  }

  const values = extractNumericValues(data, field);
  const max = values.length > 0 ? safeMax(values) : 1;

  // Size range is symbol area in pixels.
  const minSize = numericDomainBound(channel.scale?.range, 0) ?? 0;
  const maxSize = numericDomainBound(channel.scale?.range, 1) ?? 400;

  // Proportional mapping: size = value * (maxSize / maxValue)
  // This ensures size(a)/size(b) = a/b for all positive values,
  // which is the standard bubble chart encoding (area proportional to value).
  const scaleFactor = max > 0 ? maxSize / max : 1;

  return Object.assign((value: unknown): number => {
    const v = typeof value === 'number' ? value : parseFloat(String(value));
    if (!isFinite(v) || v <= 0) return minSize;
    // Use pure linear mapping for positive values to preserve proportionality.
    // Do NOT clamp to a minimum -- the linear relationship must hold exactly
    // so that size(a)/size(b) = a/b for any pair of positive values.
    return v * scaleFactor;
  }, {});
}

/**
 * Create an opacity scale.
 */
function createOpacityScale(channel: ChannelSpec, data: DataRow[]): ChartScale {
  // Handle constant value
  if (channel.value !== undefined) {
    const constVal = typeof channel.value === 'number' ? channel.value : String(channel.value);
    return Object.assign((_v: unknown): number | string => constVal, {});
  }

  const field = channel.field;
  if (!field) {
    return Object.assign((_v: unknown): number | string => 1, {});
  }

  const values = extractNumericValues(data, field);
  const min = numericDomainBound(channel.scale?.domain, 0) ?? (values.length > 0 ? safeMin(values) : 0);
  const max = numericDomainBound(channel.scale?.domain, 1) ?? (values.length > 0 ? safeMax(values) : 1);
  const rangeStart = numericDomainBound(channel.scale?.range, 0) ?? 0.3;
  const rangeEnd = numericDomainBound(channel.scale?.range, 1) ?? 1;

  return Object.assign((value: unknown): number => {
    const v = typeof value === 'number' ? value : parseFloat(String(value));
    if (isNaN(v)) return rangeStart;
    const t = max !== min ? (v - min) / (max - min) : 0.5;
    const clampedT = Math.max(0, Math.min(1, t));
    return rangeStart + clampedT * (rangeEnd - rangeStart);
  }, {});
}

/**
 * Create a shape scale.
 */
function createShapeScale(channel: ChannelSpec, data: DataRow[]): ChartScale {
  // Handle constant value
  if (channel.value !== undefined) {
    const constVal = typeof channel.value === 'number' ? channel.value : String(channel.value);
    return Object.assign((_v: unknown): number | string => constVal, {});
  }

  const field = channel.field;
  if (!field) {
    return Object.assign((_v: unknown): number | string => 'circle', {});
  }

  const values = data.map((d) => d[field]);
  const uniqueValues = [...new Set(values.map(String))];

  return Object.assign((value: unknown): string => {
    const index = uniqueValues.indexOf(String(value));
    if (index === -1) return DEFAULT_SHAPES[0];
    return DEFAULT_SHAPES[index % DEFAULT_SHAPES.length];
  }, {});
}

// =============================================================================
// Encoding Resolution
// =============================================================================

/**
 * Resolve encoding specification to accessor and scale.
 */
export function resolveEncoding(
  channel: ChannelSpec,
  data: DataRow[],
  scale?: AnyScale,
): ResolvedEncoding {
  const fieldType = channel.type ?? inferFieldType(channel.field, data);

  // Create accessor
  const accessor = createAccessor(channel);

  return {
    field: channel.field,
    scale,
    accessor,
    type: fieldType,
  };
}

/**
 * Resolve all encodings.
 */
export function resolveEncodings(
  encoding: EncodingSpec | undefined,
  data: DataRow[],
  scales: ScaleMap,
): ResolvedEncodings {
  if (!encoding) {
    return {};
  }

  const resolved: ResolvedEncodings = {};

  if (encoding.x) {
    resolved.x = resolveEncoding(encoding.x, data, scales.x);
  }
  if (encoding.y) {
    resolved.y = resolveEncoding(encoding.y, data, scales.y);
  }
  if (encoding.color) {
    resolved.color = resolveEncoding(encoding.color, data, scales.color);
  }
  if (encoding.fill) {
    resolved.fill = resolveEncoding(encoding.fill, data, scales.fill);
  }
  if (encoding.stroke) {
    resolved.stroke = resolveEncoding(encoding.stroke, data, scales.stroke);
  }
  if (encoding.size) {
    resolved.size = resolveEncoding(encoding.size, data, scales.size);
  }
  if (encoding.opacity) {
    resolved.opacity = resolveEncoding(encoding.opacity, data, scales.opacity);
  }
  if (encoding.shape) {
    resolved.shape = resolveEncoding(encoding.shape, data, scales.shape);
  }
  if (encoding.text) {
    resolved.text = resolveEncoding(encoding.text, data);
  }
  if (encoding.theta) {
    resolved.theta = resolveEncoding(encoding.theta, data, scales.theta);
  }
  if (encoding.radius) {
    resolved.radius = resolveEncoding(encoding.radius, data, scales.radius);
  }

  // Handle tooltip (can be array)
  if (encoding.tooltip) {
    if (Array.isArray(encoding.tooltip)) {
      resolved.tooltip = encoding.tooltip.map((t) => resolveEncoding(t, data));
    } else {
      resolved.tooltip = [resolveEncoding(encoding.tooltip, data)];
    }
  }

  // Handle detail (for grouping without color)
  if (encoding.detail) {
    if (!Array.isArray(encoding.detail)) {
      resolved.detail = resolveEncoding(encoding.detail, data);
    }
  }

  return resolved;
}

/**
 * Create a data accessor function for a channel.
 */
function createAccessor(channel: ChannelSpec): (datum: DataRow) => unknown {
  // Constant value
  if (channel.value !== undefined) {
    return () => channel.value;
  }

  const field = channel.field;
  if (!field) {
    return () => undefined;
  }

  return (datum: DataRow) => datum[field];
}

// =============================================================================
// Type Inference
// =============================================================================

/**
 * Infer field type from data.
 */
export function inferFieldType(field: string | undefined, data: DataRow[]): FieldType {
  if (!field || data.length === 0) {
    return 'nominal';
  }

  // Sample first non-null value
  let sampleValue: unknown;
  for (const row of data) {
    if (row[field] !== null && row[field] !== undefined) {
      sampleValue = row[field];
      break;
    }
  }

  if (sampleValue === undefined) {
    return 'nominal';
  }

  // Check type
  if (typeof sampleValue === 'number') {
    return 'quantitative';
  }

  if (sampleValue instanceof Date) {
    return 'temporal';
  }

  // Check if string is a date
  if (typeof sampleValue === 'string') {
    const dateValue = new Date(sampleValue);
    if (!isNaN(dateValue.getTime()) && sampleValue.includes('-')) {
      return 'temporal';
    }
  }

  // Check if values are ordered (ordinal) or not (nominal)
  const uniqueValues = new Set(data.map((d) => d[field]));
  if (uniqueValues.size <= 20) {
    // Could be ordinal if there's an implicit order
    return 'ordinal';
  }

  return 'nominal';
}

/**
 * Infer scale type from field type.
 */
export function inferScaleType(fieldType: FieldType): ScaleType {
  switch (fieldType) {
    case 'quantitative':
      return 'linear';
    case 'temporal':
      return 'time';
    case 'ordinal':
      return 'band';
    case 'nominal':
    default:
      return 'band';
  }
}

// =============================================================================
// Color Utilities
// =============================================================================

/**
 * Interpolate between two colors in perceptually uniform OKLab space.
 * Delegates to utils/colors.ts interpolateOklab for consistent color math.
 * Falls back to the first color if interpolation fails (e.g., non-hex input).
 */
function interpolateColor(color1: string, color2: string, t: number): string {
  return interpolateOklab(color1, color2, t) ?? color1;
}
