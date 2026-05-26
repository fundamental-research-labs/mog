/**
 * Universal Color Resolution for Charts Package
 *
 * Replaces the 5-line scale-lookup-with-fallback pattern repeated 10+ times
 * across mark generators in compiler.ts with a single, well-tested module.
 *
 * Fallback chain:
 *   1. If colorValue is present and a scale is available, invoke the scale
 *   2. Otherwise, use markSpec.color
 *   3. Otherwise, use markSpec.fill (or markSpec.stroke for line marks)
 *   4. Otherwise, cycle through default category colors by index
 *
 * All functions are pure (no side effects).
 */

import { DEFAULT_CATEGORY_COLORS } from '../grammar/encoding-resolver';
import type { ChartScale } from '../primitives/scales/types';

// Re-export for convenience so consumers can import from one place.
export { DEFAULT_CATEGORY_COLORS } from '../grammar/encoding-resolver';

/**
 * Options for color resolution.
 */
export interface ColorResolveOptions {
  /** The color/fill scale (from scales.color or scales.fill) */
  colorScale?: ChartScale;
  /** Fallback fill scale (for marks that check scales.fill too) */
  fillScale?: ChartScale;
  /** The color value from encoding accessor (encodings.color?.accessor(datum)) */
  colorValue?: unknown;
  /** MarkSpec color (markSpec.color) */
  markColor?: string;
  /** MarkSpec fill (markSpec.fill) */
  markFill?: string;
  /** MarkSpec stroke (markSpec.stroke) -- used as fallback for line marks */
  markStroke?: string;
  /** Index for default color cycling (usually i or marks.length) */
  index: number;
  /** Default colors array (defaults to DEFAULT_CATEGORY_COLORS) */
  defaults?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a color value is "present" -- not null, not undefined,
 * and not the empty string.  This matches the strictest check used in
 * compiler.ts (point marks: `colorValue != null && colorValue !== ''`).
 */
function hasValue(value: unknown): boolean {
  return value != null && value !== '';
}

/**
 * Attempt to invoke a scale, returning the result as a string.
 * Returns undefined if the scale is not provided or the scale itself
 * returns null / undefined.
 */
function tryScale(scale: ChartScale | undefined, value: unknown): string | undefined {
  if (!scale) return undefined;
  const result = scale(value);
  if (result == null) return undefined;
  return String(result);
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a color value using the standard fallback chain:
 *   1. If colorValue exists and a scale is available, invoke the scale
 *   2. Otherwise, use markSpec.color
 *   3. Otherwise, use markSpec.fill (or markSpec.stroke for line marks)
 *   4. Otherwise, cycle through default category colors by index
 *
 * This replaces the 5-line pattern repeated in every mark generator.
 *
 * @param options - Color resolution options
 * @returns Resolved color string
 */
export function resolveColor(options: ColorResolveOptions): string {
  const {
    colorScale,
    fillScale,
    colorValue,
    markColor,
    markFill,
    markStroke,
    index,
    defaults = DEFAULT_CATEGORY_COLORS,
  } = options;

  // Step 1: try scale resolution when a value is present
  if (hasValue(colorValue)) {
    // Try the primary color scale first, then the fallback fill scale
    const scaled = tryScale(colorScale, colorValue) ?? tryScale(fillScale, colorValue);
    if (scaled !== undefined) return scaled;
  }

  // Step 2: markSpec.color
  if (markColor !== undefined) return markColor;

  // Step 3: markSpec.fill or markSpec.stroke (whichever is provided)
  if (markFill !== undefined) return markFill;
  if (markStroke !== undefined) return markStroke;

  // Step 4: cycle through defaults
  return defaults[index % defaults.length];
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/**
 * Resolve fill color (for marks like bar, area, arc, point).
 * Fallback chain: scale -> markSpec.color -> markSpec.fill -> defaults[index]
 *
 * Convenience wrapper around resolveColor.
 */
export function resolveFillColor(
  colorScale: ChartScale | undefined,
  colorValue: unknown,
  markColor: string | undefined,
  markFill: string | undefined,
  index: number,
): string {
  return resolveColor({
    colorScale,
    colorValue,
    markColor,
    markFill,
    index,
  });
}

/**
 * Resolve stroke color (for marks like line).
 * Fallback chain: scale -> markSpec.color -> markSpec.stroke -> defaults[index]
 *
 * Convenience wrapper around resolveColor.
 */
export function resolveStrokeColor(
  colorScale: ChartScale | undefined,
  colorValue: unknown,
  markColor: string | undefined,
  markStroke: string | undefined,
  index: number,
): string {
  return resolveColor({
    colorScale,
    colorValue,
    markColor,
    markStroke,
    index,
  });
}
