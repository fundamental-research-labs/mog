/**
 * Pressure-to-width mapping functions.
 *
 * Maps pen pressure values [0, 1] to stroke widths for rendering.
 * Provides several mapping profiles: default (pen-like), linear,
 * and custom bezier curve.
 *
 * Pure computation: no DOM, no Canvas, no React.
 */
import type { Point2D } from '@mog-sdk/contracts/geometry';
import { MIN_PRESSURE_WIDTH_RATIO } from './stroke';
import type { Stroke } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Convergence tolerance for Newton's method. */
const NEWTON_CONVERGENCE_EPSILON = 1e-6;

/** Maximum iterations for Newton's method. */
const NEWTON_MAX_ITERATIONS = 10;

/** Minimum derivative magnitude for Newton's method step. */
const NEWTON_MIN_DERIVATIVE = 1e-12;

/** Number of monotonicity check samples. */
const MONOTONICITY_SAMPLES = 10;

/** Maximum iterations for bisection fallback. */
const BISECTION_MAX_ITERATIONS = 30;

/** Convergence tolerance for bisection. */
const BISECTION_CONVERGENCE_EPSILON = 1e-6;

// =============================================================================
// Default Pressure Mapping (pen-like feel)
// =============================================================================

/**
 * Default pressure-to-width mapping that simulates a pen tip.
 *
 * Uses a square-root curve for a natural pen feel:
 * - Light pressure (0.1) -> thin line
 * - Medium pressure (0.5) -> ~70% of base width
 * - Full pressure (1.0) -> full base width
 *
 * Clamps the minimum to 10% of base width to prevent invisible lines.
 *
 * @param pressure Normalized pressure [0, 1].
 * @param baseWidth The base stroke width in pixels.
 * @returns The mapped width.
 */
export function defaultPressureToWidth(pressure: number, baseWidth: number): number {
  const clamped = Math.max(0, Math.min(1, pressure));
  // Square root gives a natural pen feel
  const factor = Math.sqrt(clamped);
  // Minimum 10% of base width
  return baseWidth * Math.max(MIN_PRESSURE_WIDTH_RATIO, factor);
}

// =============================================================================
// Linear Mapping
// =============================================================================

/**
 * Linear pressure-to-width mapping.
 *
 * Linearly interpolates between minWidth and maxWidth based on pressure.
 *
 * @param pressure Normalized pressure [0, 1].
 * @param minWidth Minimum stroke width at pressure=0.
 * @param maxWidth Maximum stroke width at pressure=1.
 * @returns The mapped width.
 */
export function linearPressureToWidth(
  pressure: number,
  minWidth: number,
  maxWidth: number,
): number {
  const clamped = Math.max(0, Math.min(1, pressure));
  return minWidth + clamped * (maxWidth - minWidth);
}

// =============================================================================
// Bezier Curve Mapping
// =============================================================================

/**
 * Evaluate a cubic Bezier curve at parameter t.
 * Used internally for the curve mapping.
 */
function evaluateBezier1D(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return mt3 * p0 + 3 * mt2 * t * p1 + 3 * mt * t2 * p2 + t3 * p3;
}

/**
 * Evaluate the derivative of a cubic Bezier at parameter t.
 */
function evaluateBezier1DDerivative(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const mt = 1 - t;
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

/**
 * Check if the x-component of a Bezier curve is monotonically increasing.
 */
function isXMonotonic(p0x: number, p1x: number, p2x: number, p3x: number): boolean {
  for (let i = 0; i <= MONOTONICITY_SAMPLES; i++) {
    const t = i / MONOTONICITY_SAMPLES;
    const dx = evaluateBezier1DDerivative(t, p0x, p1x, p2x, p3x);
    if (dx < -NEWTON_CONVERGENCE_EPSILON) return false;
  }
  return true;
}

/**
 * Find t such that bezierX(t) = target using bisection.
 * Used as a fallback when Newton's method may not converge (non-monotonic curves).
 */
function bisectionSolve(
  target: number,
  p0x: number,
  p1x: number,
  p2x: number,
  p3x: number,
): number {
  let lo = 0;
  let hi = 1;

  for (let i = 0; i < BISECTION_MAX_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const x = evaluateBezier1D(mid, p0x, p1x, p2x, p3x);

    if (Math.abs(x - target) < BISECTION_CONVERGENCE_EPSILON) {
      return mid;
    }

    if (x < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}

/**
 * Custom curve pressure-to-width mapping using a cubic Bezier curve.
 *
 * The curve defines the mapping from pressure (x-axis) to a normalized
 * width factor (y-axis). The curve is defined by 4 control points in
 * the unit square [0,1] x [0,1].
 *
 * Since the input is pressure (not a t parameter), we need to find
 * the t that produces the input pressure on the x-axis, then evaluate
 * the y-axis at that t. Uses Newton's method for monotonic curves,
 * with bisection fallback for non-monotonic curves.
 *
 * @param pressure Normalized pressure [0, 1].
 * @param curve Four control points defining the mapping curve.
 * @param minWidth Minimum width at factor=0.
 * @param maxWidth Maximum width at factor=1.
 * @returns The mapped width.
 */
export function curvePressureToWidth(
  pressure: number,
  curve: [Point2D, Point2D, Point2D, Point2D],
  minWidth: number,
  maxWidth: number,
): number {
  const clamped = Math.max(0, Math.min(1, pressure));

  const [p0, p1, p2, p3] = curve;

  let t: number;

  if (isXMonotonic(p0.x, p1.x, p2.x, p3.x)) {
    // Newton's method - safe for monotonic curves
    t = clamped; // Initial guess

    for (let iter = 0; iter < NEWTON_MAX_ITERATIONS; iter++) {
      const x = evaluateBezier1D(t, p0.x, p1.x, p2.x, p3.x);
      const error = x - clamped;

      if (Math.abs(error) < NEWTON_CONVERGENCE_EPSILON) break;

      const dx = evaluateBezier1DDerivative(t, p0.x, p1.x, p2.x, p3.x);

      if (Math.abs(dx) < NEWTON_MIN_DERIVATIVE) break;
      t -= error / dx;
      t = Math.max(0, Math.min(1, t));
    }
  } else {
    // Non-monotonic curve: fall back to bisection
    t = bisectionSolve(clamped, p0.x, p1.x, p2.x, p3.x);
  }

  // Evaluate y at the found t
  const factor = evaluateBezier1D(t, p0.y, p1.y, p2.y, p3.y);
  const clampedFactor = Math.max(0, Math.min(1, factor));

  return minWidth + clampedFactor * (maxWidth - minWidth);
}

// =============================================================================
// Apply Pressure Profile to Stroke
// =============================================================================

/**
 * Apply a pressure-to-width mapping to all points in a stroke.
 *
 * Returns an array of widths, one per point. Useful for variable-width
 * rendering where each segment has a different width.
 *
 * @param stroke The stroke to apply the mapping to.
 * @param mapper A function that maps pressure [0, 1] to width.
 * @returns Array of widths, same length as stroke.points.
 */
export function applyPressureProfile(
  stroke: Stroke,
  mapper: (pressure: number) => number,
): number[] {
  return stroke.points.map((p) => mapper(p.pressure));
}
