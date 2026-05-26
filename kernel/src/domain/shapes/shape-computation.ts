/**
 * Shape computation — pure functions for computing shapes via @mog/shape-engine.
 *
 * Extracted from FloatingObjectBridge to enable direct use without bridge instantiation.
 * All functions are stateless except for the module-level BoundedCache.
 */

import { BoundedCache } from '@mog/geometry';
import {
  createDrawingObject,
  getDefaultAdjustments,
  isValidShapeType,
  type ShapeAdjustment,
  type ShapeVisualProperties,
} from '@mog/shape-engine';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';

// ---------------------------------------------------------------------------
// Module-level cache (replaces the instance field on FloatingObjectBridge)
// ---------------------------------------------------------------------------

const shapeCache = new BoundedCache<string, DrawingObject>(500);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a color string that may be a theme reference.
 *
 * Concrete values (starting with '#' or 'rgb') pass through unchanged.
 * Everything else is treated as a theme reference and resolved via the
 * optional callback. Falls back to the original string when resolution
 * fails or the callback is not provided.
 */
function resolveColorValue(
  color: string | undefined,
  resolveThemeColor?: (themeColor: string) => string | null,
): string | undefined {
  if (!color) return color;
  // Already a concrete color -- pass through
  if (color.startsWith('#') || color.startsWith('rgb')) return color;
  // Attempt theme resolution
  const resolved = resolveThemeColor?.(color);
  return resolved ?? color;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a shape as a DrawingObject using @mog/shape-engine.
 *
 * @param shapeType   - Shape preset name (e.g., 'rect', 'ellipse', 'roundRect')
 * @param width       - Shape width in pixels
 * @param height      - Shape height in pixels
 * @param adjustments - Optional adjustment values for the shape
 * @param options     - Optional rendering options (fill, stroke)
 * @param resolveThemeColor - Optional callback to resolve theme color references
 * @returns A DrawingObject, or null if the shape type is invalid
 */
export function computeShape(
  shapeType: string,
  width: number,
  height: number,
  adjustments?: Record<string, number>,
  options?: {
    fill?: { type?: string; color?: string; opacity?: number };
    stroke?: { color?: string; width?: number };
  },
  resolveThemeColor?: (themeColor: string) => string | null,
): DrawingObject | null {
  // Validate shape type
  if (!isValidShapeType(shapeType)) {
    return null;
  }

  // Convert Record<string, number> to ShapeAdjustment[] for engine compatibility
  const adjArray: ShapeAdjustment[] = adjustments
    ? Object.entries(adjustments).map(([name, value]) => ({ name, value }))
    : getDefaultAdjustments(shapeType);

  // Resolve theme color references to concrete hex values before
  // building the cache key and visual properties.
  const resolvedFillColor = resolveColorValue(options?.fill?.color, resolveThemeColor);
  const resolvedStrokeColor = resolveColorValue(options?.stroke?.color, resolveThemeColor);

  // Build resolved options for cache key (so the key reflects resolved colors)
  const resolvedOptions = options
    ? {
        fill: options.fill ? { ...options.fill, color: resolvedFillColor } : undefined,
        stroke: options.stroke ? { ...options.stroke, color: resolvedStrokeColor } : undefined,
      }
    : undefined;

  // Check cache
  const cacheKey = `${shapeType}:${width}:${height}:${JSON.stringify(adjArray)}:${JSON.stringify(resolvedOptions ?? {})}`;
  const cached = shapeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Build visual properties for the DrawingObject using resolved colors
  const visual: ShapeVisualProperties | undefined = resolvedOptions
    ? {
        fill: resolvedOptions.fill
          ? {
              type: 'solid' as const,
              color: resolvedFillColor ?? '#000000',
              opacity: resolvedOptions.fill.opacity,
            }
          : undefined,
        stroke: resolvedOptions.stroke
          ? {
              color: resolvedStrokeColor ?? '#000000',
              width: resolvedOptions.stroke.width ?? 1,
            }
          : undefined,
      }
    : undefined;

  // Create DrawingObject via shape-engine
  const result = createDrawingObject(shapeType, width, height, adjArray, visual);

  // Cache the result
  shapeCache.set(cacheKey, result);

  return result;
}

/**
 * Check if a shape type is valid.
 */
export function isValidShape(shapeType: string): boolean {
  return isValidShapeType(shapeType);
}

/**
 * Get default adjustments for a shape type.
 */
export function getShapeDefaults(shapeType: string): ShapeAdjustment[] {
  return getDefaultAdjustments(shapeType);
}

/**
 * Clear the shape computation cache. Useful for testing or cleanup.
 */
export function clearShapeCache(): void {
  shapeCache.clear();
}
