/**
 * Zoom Utilities - Transform calculations for zoom and pan
 *
 * Pure functions for calculating zoom and pan transformations.
 * Used for chart zooming, panning, and coordinate transformations.
 *
 * No framework dependencies - pure mathematical transformations.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * A 2D affine transform represented as translation + uniform scale.
 *
 * The transform is applied as: transformed = point * k + translation
 */
export interface ZoomTransform {
  /** Translation in X direction */
  x: number;
  /** Translation in Y direction */
  y: number;
  /** Scale factor (1 = no zoom) */
  k: number;
}

/**
 * Limits for zoom transformations
 */
export interface ZoomLimits {
  /** Minimum scale factor (e.g., 0.1 = 10% zoom out) */
  minK?: number;
  /** Maximum scale factor (e.g., 10 = 1000% zoom in) */
  maxK?: number;
}

/**
 * Bounds for pan constraints
 */
export interface PanBounds {
  /** X-axis bounds [min, max] */
  x: [number, number];
  /** Y-axis bounds [min, max] */
  y: [number, number];
}

/**
 * A point in 2D space
 */
export interface Point {
  x: number;
  y: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Identity transform (no zoom, no pan)
 */
export const identityTransform: ZoomTransform = { x: 0, y: 0, k: 1 };

/**
 * Default zoom limits
 */
export const defaultZoomLimits: ZoomLimits = { minK: 0.1, maxK: 10 };

// =============================================================================
// Transform Application
// =============================================================================

/**
 * Apply a zoom transform to a point.
 * Transforms from data coordinates to screen coordinates.
 *
 * @param point - The point to transform
 * @param transform - The zoom transform to apply
 * @returns Transformed point in screen coordinates
 */
export function transformPoint(point: Point, transform: ZoomTransform): Point {
  return {
    x: point.x * transform.k + transform.x,
    y: point.y * transform.k + transform.y,
  };
}

/**
 * Apply the inverse of a zoom transform to a point.
 * Transforms from screen coordinates to data coordinates.
 *
 * @param point - The point to transform (in screen coordinates)
 * @param transform - The zoom transform to invert
 * @returns Transformed point in data coordinates
 */
export function invertPoint(point: Point, transform: ZoomTransform): Point {
  return {
    x: (point.x - transform.x) / transform.k,
    y: (point.y - transform.y) / transform.k,
  };
}

/**
 * Transform a rectangle using a zoom transform.
 *
 * @param rect - Rectangle to transform { x, y, width, height }
 * @param transform - The zoom transform to apply
 * @returns Transformed rectangle
 */
export function transformRect(
  rect: { x: number; y: number; width: number; height: number },
  transform: ZoomTransform,
): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.x * transform.k + transform.x,
    y: rect.y * transform.k + transform.y,
    width: rect.width * transform.k,
    height: rect.height * transform.k,
  };
}

/**
 * Invert a rectangle using a zoom transform.
 *
 * @param rect - Rectangle to invert { x, y, width, height }
 * @param transform - The zoom transform to invert
 * @returns Inverted rectangle
 */
export function invertRect(
  rect: { x: number; y: number; width: number; height: number },
  transform: ZoomTransform,
): { x: number; y: number; width: number; height: number } {
  return {
    x: (rect.x - transform.x) / transform.k,
    y: (rect.y - transform.y) / transform.k,
    width: rect.width / transform.k,
    height: rect.height / transform.k,
  };
}

// =============================================================================
// Zoom Operations
// =============================================================================

/**
 * Calculate new transform for zoom at a specific point.
 * The point remains fixed in screen space during the zoom.
 *
 * @param current - Current zoom transform
 * @param center - Point to zoom around (in screen coordinates)
 * @param scaleFactor - Factor to scale by (e.g., 1.1 = zoom in 10%, 0.9 = zoom out 10%)
 * @param limits - Optional scale limits
 * @returns New zoom transform
 */
export function zoomAt(
  current: ZoomTransform,
  center: Point,
  scaleFactor: number,
  limits?: ZoomLimits,
): ZoomTransform {
  const minK = limits?.minK ?? 0.1;
  const maxK = limits?.maxK ?? 10;

  // Calculate new scale
  const newK = current.k * scaleFactor;
  const clampedK = Math.max(minK, Math.min(maxK, newK));

  // If scale didn't change due to limits, return current transform
  if (clampedK === current.k) {
    return current;
  }

  // Calculate the actual scale factor after clamping
  const actualFactor = clampedK / current.k;

  // Zoom centered on the point:
  // The point should stay at the same screen position
  // newX = center.x - (center.x - current.x) * actualFactor
  return {
    k: clampedK,
    x: center.x - (center.x - current.x) * actualFactor,
    y: center.y - (center.y - current.y) * actualFactor,
  };
}

/**
 * Calculate new transform for zoom by a specific factor.
 * Zooms around the center of the given viewport.
 *
 * @param current - Current zoom transform
 * @param scaleFactor - Factor to scale by
 * @param viewport - Viewport dimensions to center the zoom
 * @param limits - Optional scale limits
 * @returns New zoom transform
 */
export function zoomBy(
  current: ZoomTransform,
  scaleFactor: number,
  viewport: { width: number; height: number },
  limits?: ZoomLimits,
): ZoomTransform {
  const center: Point = {
    x: viewport.width / 2,
    y: viewport.height / 2,
  };
  return zoomAt(current, center, scaleFactor, limits);
}

/**
 * Calculate new transform to zoom to a specific scale level.
 *
 * @param current - Current zoom transform
 * @param targetK - Target scale factor
 * @param center - Point to zoom around
 * @param limits - Optional scale limits
 * @returns New zoom transform
 */
export function zoomTo(
  current: ZoomTransform,
  targetK: number,
  center: Point,
  limits?: ZoomLimits,
): ZoomTransform {
  const scaleFactor = targetK / current.k;
  return zoomAt(current, center, scaleFactor, limits);
}

/**
 * Calculate new transform to fit a rectangle in the viewport.
 *
 * @param rect - Rectangle to fit (in data coordinates)
 * @param viewport - Viewport dimensions
 * @param padding - Optional padding around the rectangle (default: 20)
 * @returns New zoom transform that fits the rectangle in the viewport
 */
export function zoomToFit(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  padding: number = 20,
): ZoomTransform {
  const availableWidth = viewport.width - padding * 2;
  const availableHeight = viewport.height - padding * 2;

  // Calculate scale to fit
  const scaleX = availableWidth / rect.width;
  const scaleY = availableHeight / rect.height;
  const k = Math.min(scaleX, scaleY);

  // Calculate translation to center
  const scaledWidth = rect.width * k;
  const scaledHeight = rect.height * k;
  const x = (viewport.width - scaledWidth) / 2 - rect.x * k;
  const y = (viewport.height - scaledHeight) / 2 - rect.y * k;

  return { x, y, k };
}

// =============================================================================
// Pan Operations
// =============================================================================

/**
 * Calculate new transform for pan by a delta.
 *
 * @param current - Current zoom transform
 * @param dx - Change in X position (in screen coordinates)
 * @param dy - Change in Y position (in screen coordinates)
 * @param bounds - Optional bounds to constrain panning
 * @returns New zoom transform
 */
export function pan(
  current: ZoomTransform,
  dx: number,
  dy: number,
  bounds?: PanBounds,
): ZoomTransform {
  let newX = current.x + dx;
  let newY = current.y + dy;

  // Constrain to bounds if provided
  if (bounds) {
    newX = Math.max(bounds.x[0], Math.min(bounds.x[1], newX));
    newY = Math.max(bounds.y[0], Math.min(bounds.y[1], newY));
  }

  return { ...current, x: newX, y: newY };
}

/**
 * Calculate new transform to pan to a specific position.
 *
 * @param current - Current zoom transform
 * @param x - Target X translation
 * @param y - Target Y translation
 * @param bounds - Optional bounds to constrain panning
 * @returns New zoom transform
 */
export function panTo(
  current: ZoomTransform,
  x: number,
  y: number,
  bounds?: PanBounds,
): ZoomTransform {
  let newX = x;
  let newY = y;

  // Constrain to bounds if provided
  if (bounds) {
    newX = Math.max(bounds.x[0], Math.min(bounds.x[1], newX));
    newY = Math.max(bounds.y[0], Math.min(bounds.y[1], newY));
  }

  return { ...current, x: newX, y: newY };
}

/**
 * Calculate new transform to center a point in the viewport.
 *
 * @param current - Current zoom transform
 * @param point - Point to center (in data coordinates)
 * @param viewport - Viewport dimensions
 * @returns New zoom transform
 */
export function centerOn(
  current: ZoomTransform,
  point: Point,
  viewport: { width: number; height: number },
): ZoomTransform {
  return {
    ...current,
    x: viewport.width / 2 - point.x * current.k,
    y: viewport.height / 2 - point.y * current.k,
  };
}

// =============================================================================
// Reset and Utility Operations
// =============================================================================

/**
 * Reset zoom to identity transform.
 *
 * @returns Identity zoom transform
 */
export function resetZoom(): ZoomTransform {
  return { ...identityTransform };
}

/**
 * Check if a transform equals identity.
 *
 * @param transform - Transform to check
 * @returns True if the transform is identity
 */
export function isIdentity(transform: ZoomTransform): boolean {
  return transform.x === 0 && transform.y === 0 && transform.k === 1;
}

/**
 * Interpolate between two transforms.
 * Useful for animated zoom transitions.
 *
 * @param from - Starting transform
 * @param to - Ending transform
 * @param t - Interpolation parameter (0 = from, 1 = to)
 * @returns Interpolated transform
 */
export function interpolateTransform(
  from: ZoomTransform,
  to: ZoomTransform,
  t: number,
): ZoomTransform {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    k: from.k + (to.k - from.k) * t,
  };
}

/**
 * Compose two transforms: result = apply(a, apply(b, point))
 *
 * @param a - Outer transform (applied second)
 * @param b - Inner transform (applied first)
 * @returns Composed transform
 */
export function composeTransforms(a: ZoomTransform, b: ZoomTransform): ZoomTransform {
  return {
    k: a.k * b.k,
    x: a.x + a.k * b.x,
    y: a.y + a.k * b.y,
  };
}

/**
 * Invert a transform: result = apply(inverse, apply(transform, point)) = point
 *
 * @param transform - Transform to invert
 * @returns Inverted transform
 */
export function invertTransform(transform: ZoomTransform): ZoomTransform {
  const invK = 1 / transform.k;
  return {
    k: invK,
    x: -transform.x * invK,
    y: -transform.y * invK,
  };
}

// =============================================================================
// Scale Integration
// =============================================================================

/**
 * Interface for a scale that can be copied and have its range modified.
 * This matches the pattern used by continuous scales.
 */
interface RescalableScale {
  range(): [number, number];
  copy(): RescalableScale;
}

/**
 * Rescale a continuous scale's X axis with a zoom transform.
 * Returns a new scale with the transformed range.
 *
 * @param scale - The scale to rescale
 * @param transform - The zoom transform
 * @returns New scale with transformed range
 */
export function rescaleX<T extends RescalableScale>(scale: T, transform: ZoomTransform): T {
  const [r0, r1] = scale.range();
  const newRange: [number, number] = [
    transform.k * r0 + transform.x,
    transform.k * r1 + transform.x,
  ];

  const copy = scale.copy() as T & { range(values: [number, number]): T };
  return copy.range(newRange);
}

/**
 * Rescale a continuous scale's Y axis with a zoom transform.
 * Returns a new scale with the transformed range.
 *
 * @param scale - The scale to rescale
 * @param transform - The zoom transform
 * @returns New scale with transformed range
 */
export function rescaleY<T extends RescalableScale>(scale: T, transform: ZoomTransform): T {
  const [r0, r1] = scale.range();
  const newRange: [number, number] = [
    transform.k * r0 + transform.y,
    transform.k * r1 + transform.y,
  ];

  const copy = scale.copy() as T & { range(values: [number, number]): T };
  return copy.range(newRange);
}

// =============================================================================
// Wheel Zoom Helpers
// =============================================================================

/**
 * Calculate zoom scale factor from a wheel delta.
 * Normalizes across different browser wheel implementations.
 *
 * @param wheelDelta - The wheel delta (typically event.deltaY)
 * @param sensitivity - Zoom sensitivity (default: 0.002)
 * @returns Scale factor to use with zoomAt
 */
export function wheelDeltaToScaleFactor(wheelDelta: number, sensitivity: number = 0.002): number {
  // Normalize wheel delta
  // deltaY > 0 means scrolling down/away from user = zoom out
  // deltaY < 0 means scrolling up/toward user = zoom in
  return Math.pow(2, -wheelDelta * sensitivity);
}

/**
 * Calculate zoom scale factor from a pinch gesture scale.
 *
 * @param pinchScale - The gesture scale (1 = no change, >1 = zoom in, <1 = zoom out)
 * @returns Scale factor to use with zoomAt
 */
export function pinchScaleToScaleFactor(pinchScale: number): number {
  return pinchScale;
}

// =============================================================================
// Constraint Utilities
// =============================================================================

/**
 * Constrain a transform to zoom limits.
 *
 * @param transform - Transform to constrain
 * @param limits - Zoom limits
 * @returns Constrained transform
 */
export function constrainScale(transform: ZoomTransform, limits: ZoomLimits): ZoomTransform {
  const minK = limits.minK ?? 0.1;
  const maxK = limits.maxK ?? 10;
  const clampedK = Math.max(minK, Math.min(maxK, transform.k));

  if (clampedK === transform.k) {
    return transform;
  }

  return { ...transform, k: clampedK };
}

/**
 * Constrain a transform to pan bounds.
 *
 * @param transform - Transform to constrain
 * @param bounds - Pan bounds
 * @returns Constrained transform
 */
export function constrainPan(transform: ZoomTransform, bounds: PanBounds): ZoomTransform {
  const newX = Math.max(bounds.x[0], Math.min(bounds.x[1], transform.x));
  const newY = Math.max(bounds.y[0], Math.min(bounds.y[1], transform.y));

  if (newX === transform.x && newY === transform.y) {
    return transform;
  }

  return { ...transform, x: newX, y: newY };
}

/**
 * Constrain a transform to both zoom limits and pan bounds.
 *
 * @param transform - Transform to constrain
 * @param limits - Zoom limits
 * @param bounds - Pan bounds
 * @returns Constrained transform
 */
export function constrainTransform(
  transform: ZoomTransform,
  limits?: ZoomLimits,
  bounds?: PanBounds,
): ZoomTransform {
  let result = transform;

  if (limits) {
    result = constrainScale(result, limits);
  }

  if (bounds) {
    result = constrainPan(result, bounds);
  }

  return result;
}
