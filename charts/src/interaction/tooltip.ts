/**
 * Tooltip Utilities - Hit test to data point lookup for tooltips
 *
 * Pure functions for finding tooltip data at a given position.
 * Combines hit testing with data extraction and formatting.
 *
 * No framework dependencies - pure data transformations.
 */

import { getArcCentroid } from '../primitives/marks/arc';
import type { AnyMark, ArcMark, Mark, RectMark } from '../primitives/types';
import { pickClosestMark, pickMark } from './pick';
import type { DataRow } from './shared';
export type { DataRow } from './shared';

// =============================================================================
// Types
// =============================================================================

/**
 * Encoding specification for a channel
 */
export interface ChannelSpec {
  field: string;
  type?: 'quantitative' | 'ordinal' | 'nominal' | 'temporal';
  title?: string;
  format?: string;
  aggregate?: string;
}

/**
 * Encoding specification for the chart
 */
export interface EncodingSpec {
  x?: ChannelSpec;
  y?: ChannelSpec;
  color?: ChannelSpec;
  size?: ChannelSpec;
  shape?: ChannelSpec;
  opacity?: ChannelSpec;
  text?: ChannelSpec;
  theta?: ChannelSpec;
  radius?: ChannelSpec;
  tooltip?: ChannelSpec | ChannelSpec[];
}

/**
 * Simplified chart spec for tooltip extraction
 */
export interface ChartSpec {
  encoding?: EncodingSpec;
  [key: string]: unknown;
}

/**
 * A tooltip field with name, raw value, and formatted string
 */
export interface TooltipField {
  /** Display name for the field */
  name: string;
  /** Raw value from the data */
  value: unknown;
  /** Formatted string representation */
  formatted: string;
}

/**
 * Complete tooltip data for a data point
 */
export interface TooltipData {
  /** The original data row */
  datum: DataRow;
  /** The mark that was hit */
  mark: Mark;
  /** Position for tooltip placement (mark center) */
  position: { x: number; y: number };
  /** Extracted and formatted fields for display */
  fields: TooltipField[];
}

/**
 * Options for tooltip lookup
 */
export interface TooltipOptions {
  /** Maximum distance to consider for nearby marks (default: 10) */
  radius?: number;
  /** Whether to use closest mark if no exact hit (default: true) */
  useClosest?: boolean;
}

// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Format a number with the given format specifier.
 * Supports basic d3-style format specifiers.
 *
 * @param value - The number to format
 * @param format - Format specifier string (e.g., ".2f", ",", "$,.2f")
 * @returns Formatted string
 */
export function formatNumber(value: number, format?: string): string {
  if (!format) {
    return value.toLocaleString();
  }

  // Parse format specifier
  // Basic support for common patterns: .Nf (fixed), .N% (percent), , (thousands), $ (currency)
  const formatRegex = /^(\$)?([,])?\.?(\d+)?([%f])?$/;
  const match = format.match(formatRegex);

  if (!match) {
    // Fallback to locale string
    return value.toLocaleString();
  }

  const [, currency, thousands, precisionStr, type] = match;
  const precision = precisionStr ? parseInt(precisionStr, 10) : undefined;

  let result: string;

  if (type === '%') {
    // Percentage
    result = (value * 100).toFixed(precision ?? 0) + '%';
  } else if (precision !== undefined) {
    // Fixed decimal
    result = value.toFixed(precision);
  } else {
    result = value.toString();
  }

  // Add thousands separator
  if (thousands) {
    const parts = result.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    result = parts.join('.');
  }

  // Add currency prefix
  if (currency) {
    result = '$' + result;
  }

  return result;
}

/**
 * Format a date with the given format specifier.
 *
 * @param value - The date to format
 * @param format - Format specifier string
 * @returns Formatted string
 */
export function formatDate(value: Date | number | string, format?: string): string {
  const date = value instanceof Date ? value : new Date(value);

  if (isNaN(date.getTime())) {
    return String(value);
  }

  if (!format) {
    return date.toLocaleDateString();
  }

  // Basic format support
  // %Y = 4-digit year, %m = month, %d = day, %H = hour, %M = minute, %S = second
  return format
    .replace(/%Y/g, date.getFullYear().toString())
    .replace(/%m/g, String(date.getMonth() + 1).padStart(2, '0'))
    .replace(/%d/g, String(date.getDate()).padStart(2, '0'))
    .replace(/%H/g, String(date.getHours()).padStart(2, '0'))
    .replace(/%M/g, String(date.getMinutes()).padStart(2, '0'))
    .replace(/%S/g, String(date.getSeconds()).padStart(2, '0'))
    .replace(/%B/g, date.toLocaleString('default', { month: 'long' }))
    .replace(/%b/g, date.toLocaleString('default', { month: 'short' }))
    .replace(/%A/g, date.toLocaleString('default', { weekday: 'long' }))
    .replace(/%a/g, date.toLocaleString('default', { weekday: 'short' }));
}

/**
 * Format a value based on its type and optional format specifier.
 *
 * @param value - The value to format
 * @param format - Format specifier string
 * @param type - Data type hint
 * @returns Formatted string
 */
export function formatValue(value: unknown, format?: string, type?: string): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return formatNumber(value, format);
  }

  if (value instanceof Date || type === 'temporal') {
    return formatDate(value as Date | number | string, format);
  }

  return String(value);
}

// =============================================================================
// Field Extraction
// =============================================================================

/**
 * Extract tooltip fields from a data row based on encoding spec.
 *
 * @param datum - The data row
 * @param encoding - The chart encoding specification
 * @returns Array of tooltip fields
 */
export function extractTooltipFields(datum: DataRow, encoding?: EncodingSpec): TooltipField[] {
  const fields: TooltipField[] = [];
  const addedFields = new Set<string>();

  if (!encoding) {
    // No encoding - show all properties from datum
    for (const [key, value] of Object.entries(datum)) {
      fields.push({
        name: key,
        value,
        formatted: formatValue(value),
      });
    }
    return fields;
  }

  // Process standard encoding channels
  const channels: (keyof EncodingSpec)[] = ['x', 'y', 'color', 'size', 'shape', 'theta', 'radius'];

  for (const channel of channels) {
    const spec = encoding[channel] as ChannelSpec | undefined;
    if (spec && 'field' in spec && !addedFields.has(spec.field)) {
      const value = datum[spec.field];
      fields.push({
        name: spec.title || spec.field,
        value,
        formatted: formatValue(value, spec.format, spec.type),
      });
      addedFields.add(spec.field);
    }
  }

  // Process tooltip-specific fields
  if (encoding.tooltip) {
    const tooltipSpecs = Array.isArray(encoding.tooltip) ? encoding.tooltip : [encoding.tooltip];

    for (const spec of tooltipSpecs) {
      if (!addedFields.has(spec.field)) {
        const value = datum[spec.field];
        fields.push({
          name: spec.title || spec.field,
          value,
          formatted: formatValue(value, spec.format, spec.type),
        });
        addedFields.add(spec.field);
      }
    }
  }

  return fields;
}

// =============================================================================
// Mark Position Extraction
// =============================================================================

/**
 * Get the center position of a mark for tooltip placement.
 *
 * @param mark - The mark to get position from
 * @returns Position object with x and y coordinates
 */
export function getMarkPosition(mark: AnyMark): { x: number; y: number } {
  switch (mark.type) {
    case 'rect': {
      const rectMark = mark as RectMark;
      return {
        x: rectMark.x + rectMark.width / 2,
        y: rectMark.y + rectMark.height / 2,
      };
    }

    case 'arc': {
      // Delegate to getArcCentroid which correctly applies the -PI/2 offset
      // to convert from "0 at top, clockwise" to standard math angles
      return getArcCentroid(mark as ArcMark);
    }

    case 'symbol':
    case 'text':
      return { x: mark.x, y: mark.y };

    case 'path':
      // Path marks use a path string; return the mark's position
      // Parsing the path string to find the first point would be expensive
      return { x: mark.x, y: mark.y };

    default:
      return { x: 0, y: 0 };
  }
}

// =============================================================================
// Main Tooltip Functions
// =============================================================================

/**
 * Find the data point at the given position and return tooltip data.
 *
 * @param marks - Array of marks to search
 * @param x - X coordinate of the query point
 * @param y - Y coordinate of the query point
 * @param spec - Chart specification for encoding info
 * @param options - Options for tooltip lookup
 * @returns TooltipData if a data point is found, null otherwise
 */
export function findTooltipData(
  marks: Mark[],
  x: number,
  y: number,
  spec: ChartSpec,
  options?: TooltipOptions,
): TooltipData | null {
  const radius = options?.radius ?? 10;
  const useClosest = options?.useClosest ?? true;

  // First try exact hit
  let result = pickMark(marks, x, y);

  // Fall back to closest mark within radius
  if (!result && useClosest) {
    result = pickClosestMark(marks, x, y, radius);
  }

  if (!result) {
    return null;
  }

  const datum = result.mark.datum as DataRow;
  if (!datum) {
    return null;
  }

  // Extract fields from encoding
  const fields = extractTooltipFields(datum, spec.encoding);

  return {
    datum,
    mark: result.mark,
    position: getMarkPosition(result.mark as AnyMark),
    fields,
  };
}

/**
 * Find multiple data points near the given position.
 * Useful for overlapping marks or multi-series tooltips.
 *
 * @param marks - Array of marks to search
 * @param x - X coordinate of the query point
 * @param y - Y coordinate of the query point
 * @param spec - Chart specification for encoding info
 * @param radius - Search radius (default: 10)
 * @returns Array of TooltipData for all nearby data points
 */
export function findAllTooltipData(
  marks: Mark[],
  x: number,
  y: number,
  spec: ChartSpec,
  radius: number = 10,
): TooltipData[] {
  const results: TooltipData[] = [];

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];

    // Skip non-interactive marks
    if (mark.interactive === false) {
      continue;
    }

    const datum = mark.datum as DataRow;
    if (!datum) {
      continue;
    }

    // Calculate distance
    const pos = getMarkPosition(mark as AnyMark);
    const dist = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));

    if (dist <= radius) {
      const fields = extractTooltipFields(datum, spec.encoding);
      results.push({
        datum,
        mark,
        position: pos,
        fields,
      });
    }
  }

  // Sort by distance
  results.sort((a, b) => {
    const distA = Math.sqrt(Math.pow(x - a.position.x, 2) + Math.pow(y - a.position.y, 2));
    const distB = Math.sqrt(Math.pow(x - b.position.x, 2) + Math.pow(y - b.position.y, 2));
    return distA - distB;
  });

  return results;
}

/**
 * Format tooltip data as an HTML string for display.
 *
 * @param tooltipData - The tooltip data to format
 * @returns HTML string representation
 */
export function formatTooltipHtml(tooltipData: TooltipData): string {
  const rows = tooltipData.fields.map(
    (field) =>
      `<tr><td style="font-weight:bold">${escapeHtml(field.name)}:</td><td>${escapeHtml(field.formatted)}</td></tr>`,
  );

  return `<table style="border-collapse:collapse">${rows.join('')}</table>`;
}

/**
 * Format tooltip data as a plain text string.
 *
 * @param tooltipData - The tooltip data to format
 * @returns Plain text representation
 */
export function formatTooltipText(tooltipData: TooltipData): string {
  return tooltipData.fields.map((field) => `${field.name}: ${field.formatted}`).join('\n');
}

/**
 * Clamp tooltip position to stay within chart bounds.
 */
export function clampTooltipPosition(
  position: { x: number; y: number },
  tooltipWidth: number,
  tooltipHeight: number,
  chartWidth: number,
  chartHeight: number,
  padding: number = 8,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(position.x, padding), chartWidth - tooltipWidth - padding),
    y: Math.min(Math.max(position.y, padding), chartHeight - tooltipHeight - padding),
  };
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
