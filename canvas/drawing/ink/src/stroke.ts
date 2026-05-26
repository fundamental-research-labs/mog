/**
 * Stroke creation, smoothing, and simplification.
 *
 * Pure computation: no DOM, no Canvas, no React.
 * Depends only on geometry types from contracts.
 */
import type { BoundingBox, Path, Point2D } from '@mog-sdk/contracts/geometry';
import type { StrokeId } from '@mog-sdk/contracts/ink';
import { pointToSegmentDistSq } from './intersection';
import type { Stroke, StrokePoint } from './types';

// Re-export shared ink types so downstream imports of `./stroke` keep working.
// Canonical definitions live in `./types` to break the stroke ↔ intersection cycle.
export type { Stroke, StrokePoint } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Tolerance below which a segment length is considered degenerate (zero-length). */
const DEGENERATE_SEGMENT_EPSILON = 1e-12;

/** Default normal direction when all segments are degenerate. */
const DEFAULT_NORMAL: Point2D = { x: 1, y: 0 };

/** Kappa constant for cubic Bezier circle approximation (4*(sqrt(2)-1)/3). */
const BEZIER_CIRCLE_KAPPA = 0.5522847498;

/** Minimum pressure-to-width ratio (prevents invisible lines). */
export const MIN_PRESSURE_WIDTH_RATIO = 0.1;

// =============================================================================
// Bounding Box
// =============================================================================

/**
 * Compute the bounding box for a set of stroke points,
 * expanded by half the stroke width on all sides.
 */
export function strokeBoundingBox(points: readonly StrokePoint[], width: number): BoundingBox {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const half = width / 2;
  return {
    x: minX - half,
    y: minY - half,
    width: maxX - minX + width,
    height: maxY - minY + width,
  };
}

// =============================================================================
// Stroke Creation
// =============================================================================

/**
 * Create a stroke from raw input points.
 *
 * Input validation:
 * - Filters out points with NaN/Infinity coordinates
 * - Clamps pressure values to [0, 1]
 * - Clamps opacity to [0, 1]
 * - Throws on width <= 0
 * - Throws on empty color string
 * - Throws on zero valid points after filtering
 *
 * @param points Raw input points.
 * @param options Stroke options including required `id`.
 */
export function createStroke(
  points: readonly StrokePoint[],
  options: {
    color: string;
    width: number;
    opacity?: number;
    id: StrokeId;
  },
): Stroke {
  // Validate width
  if (options.width <= 0) {
    throw new Error(`Stroke width must be > 0, got ${options.width}`);
  }

  // Validate color
  if (!options.color || options.color.trim() === '') {
    throw new Error('Stroke color must not be empty');
  }

  const id = options.id;

  // Clamp opacity
  const rawOpacity = options.opacity ?? 1;
  const opacity = Math.max(0, Math.min(1, rawOpacity));

  // Filter out NaN/Infinity points and clamp pressure
  const validPoints: StrokePoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      continue; // Skip NaN/Infinity points
    }
    validPoints.push({
      x: p.x,
      y: p.y,
      pressure: Math.max(0, Math.min(1, Number.isFinite(p.pressure) ? p.pressure : 0.5)),
      timestamp: p.timestamp,
    });
  }

  if (validPoints.length === 0) {
    throw new Error('Stroke must have at least one valid point after filtering NaN/Infinity');
  }

  const bounds = strokeBoundingBox(validPoints, options.width);

  return {
    id,
    points: validPoints,
    color: options.color,
    width: options.width,
    opacity,
    bounds,
  };
}

// =============================================================================
// Smoothing: Moving Average
// =============================================================================

/**
 * Smooth a stroke using a simple moving average.
 *
 * The factor controls the window size: higher factor = more smoothing.
 * Uses a simple (unweighted) moving average with window size = 2 * factor + 1.
 * Preserves the first and last points exactly.
 *
 * @param points Input stroke points.
 * @param factor Smoothing window half-size (default 2). Must be >= 1. Rounded to integer.
 * @returns New array of smoothed points (same length), with copied point objects.
 */
export function smoothStroke(points: readonly StrokePoint[], factor: number = 2): StrokePoint[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  if (factor < 1) factor = 1;
  factor = Math.round(factor);

  const result: StrokePoint[] = new Array(points.length);

  // Preserve endpoints (copied)
  result[0] = { ...points[0] };
  result[points.length - 1] = { ...points[points.length - 1] };

  for (let i = 1; i < points.length - 1; i++) {
    const windowStart = Math.max(0, i - factor);
    const windowEnd = Math.min(points.length - 1, i + factor);
    const windowSize = windowEnd - windowStart + 1;

    let sumX = 0;
    let sumY = 0;
    let sumPressure = 0;

    for (let j = windowStart; j <= windowEnd; j++) {
      sumX += points[j].x;
      sumY += points[j].y;
      sumPressure += points[j].pressure;
    }

    result[i] = {
      x: sumX / windowSize,
      y: sumY / windowSize,
      pressure: sumPressure / windowSize,
      timestamp: points[i].timestamp,
    };
  }

  return result;
}

// =============================================================================
// Simplification: Ramer-Douglas-Peucker
// =============================================================================

/**
 * Simplify a stroke using the Ramer-Douglas-Peucker algorithm.
 *
 * Reduces the number of points while preserving the shape within
 * the given tolerance (maximum perpendicular distance).
 *
 * @param points Input stroke points.
 * @param tolerance Maximum distance tolerance (default 1.0 pixel).
 * @returns Simplified array of copied points.
 */
export function simplifyStroke(
  points: readonly StrokePoint[],
  tolerance: number = 1.0,
): StrokePoint[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  if (tolerance <= 0) return points.map((p) => ({ ...p }));

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  rdpIterative(points, 0, points.length - 1, tolerance * tolerance, keep);

  const result: StrokePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      result.push({ ...points[i] });
    }
  }

  return result;
}

/**
 * Iterative helper for Ramer-Douglas-Peucker.
 * Uses an explicit stack to avoid stack overflow on long strokes (10K+ points).
 * Uses squared tolerance to avoid sqrt in the hot path.
 */
function rdpIterative(
  points: readonly StrokePoint[],
  startIdx: number,
  endIdx: number,
  toleranceSq: number,
  keep: Uint8Array,
): void {
  const stack: [number, number][] = [[startIdx, endIdx]];

  while (stack.length > 0) {
    const [start, end] = stack.pop()!;

    if (end - start < 2) continue;

    let maxDistSq = 0;
    let maxIdx = start;

    const ax = points[start].x;
    const ay = points[start].y;
    const bx = points[end].x;
    const by = points[end].y;

    for (let i = start + 1; i < end; i++) {
      const distSq = pointToSegmentDistSq(points[i].x, points[i].y, ax, ay, bx, by);
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        maxIdx = i;
      }
    }

    if (maxDistSq > toleranceSq) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }
}

// =============================================================================
// Stroke to Path Conversion
// =============================================================================

/**
 * Find a valid (non-degenerate) normal at the given point index.
 *
 * When consecutive points are identical, the tangent is zero and the normal
 * is undefined. This function scans outward for the nearest non-degenerate
 * segment, falling back to DEFAULT_NORMAL (1, 0) if all segments are degenerate.
 */
function findNormalAt(points: readonly StrokePoint[], index: number): { nx: number; ny: number } {
  const n = points.length;

  // Try forward direction
  for (let i = index; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > DEGENERATE_SEGMENT_EPSILON) {
      const len = Math.sqrt(lenSq);
      return { nx: -dy / len, ny: dx / len };
    }
  }

  // Try backward direction
  for (let i = index; i > 0; i--) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq > DEGENERATE_SEGMENT_EPSILON) {
      const len = Math.sqrt(lenSq);
      return { nx: -dy / len, ny: dx / len };
    }
  }

  // All segments degenerate - use default
  return { nx: DEFAULT_NORMAL.x, ny: DEFAULT_NORMAL.y };
}

/**
 * Convert a stroke to a Path with variable width segments using pressure data.
 *
 * Creates an outline path by offsetting left and right of the center line
 * by the pressure-mapped width at each point.
 *
 * @param stroke The stroke to convert.
 * @param pressureToWidth Optional mapping function from pressure to width.
 *   Defaults to using stroke.width directly scaled by pressure.
 * @returns A Path representing the stroke outline.
 */
export function strokeToPath(stroke: Stroke, pressureToWidth?: (pressure: number) => number): Path {
  const { points, width } = stroke;

  if (points.length === 0) {
    return { segments: [], closed: false };
  }

  if (points.length === 1) {
    // Single point: draw a proper circle using cubic Bezier arcs
    const p = points[0];
    const mapper =
      pressureToWidth ?? ((pr: number) => width * Math.max(MIN_PRESSURE_WIDTH_RATIO, pr));
    const r = mapper(p.pressure) / 2;
    const k = BEZIER_CIRCLE_KAPPA * r;

    return {
      segments: [
        { type: 'M', x: p.x - r, y: p.y },
        { type: 'C', x1: p.x - r, y1: p.y - k, x2: p.x - k, y2: p.y - r, x: p.x, y: p.y - r },
        { type: 'C', x1: p.x + k, y1: p.y - r, x2: p.x + r, y2: p.y - k, x: p.x + r, y: p.y },
        { type: 'C', x1: p.x + r, y1: p.y + k, x2: p.x + k, y2: p.y + r, x: p.x, y: p.y + r },
        { type: 'C', x1: p.x - k, y1: p.y + r, x2: p.x - r, y2: p.y + k, x: p.x - r, y: p.y },
        { type: 'Z' },
      ],
      closed: true,
    };
  }

  const mapper =
    pressureToWidth ?? ((pr: number) => width * Math.max(MIN_PRESSURE_WIDTH_RATIO, pr));

  // Build left and right offset points
  const leftSide: Point2D[] = [];
  const rightSide: Point2D[] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const halfW = mapper(p.pressure) / 2;

    // Compute normal direction using the robust finder
    let nx: number, ny: number;
    if (i === 0) {
      const normal = findNormalAt(points, 0);
      nx = normal.nx;
      ny = normal.ny;
    } else if (i === points.length - 1) {
      const normal = findNormalAt(points, i - 1);
      nx = normal.nx;
      ny = normal.ny;
    } else {
      // Use tangent from prev to next
      const prev = points[i - 1];
      const next = points[i + 1];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const lenSq = dx * dx + dy * dy;

      if (lenSq > DEGENERATE_SEGMENT_EPSILON) {
        const len = Math.sqrt(lenSq);
        nx = -dy / len;
        ny = dx / len;
      } else {
        // Degenerate: use robust fallback
        const normal = findNormalAt(points, i);
        nx = normal.nx;
        ny = normal.ny;
      }
    }

    leftSide.push({ x: p.x + nx * halfW, y: p.y + ny * halfW });
    rightSide.push({ x: p.x - nx * halfW, y: p.y - ny * halfW });
  }

  // Build path: left side forward, then right side backward
  const segments: Path['segments'] = [];
  segments.push({ type: 'M', x: leftSide[0].x, y: leftSide[0].y });

  for (let i = 1; i < leftSide.length; i++) {
    segments.push({ type: 'L', x: leftSide[i].x, y: leftSide[i].y });
  }

  for (let i = rightSide.length - 1; i >= 0; i--) {
    segments.push({ type: 'L', x: rightSide[i].x, y: rightSide[i].y });
  }

  segments.push({ type: 'Z' });

  return { segments, closed: true };
}

/**
 * Convert a stroke to a simple polyline path (constant width, center line only).
 */
export function strokeToPolyline(stroke: Stroke): Path {
  const { points } = stroke;

  if (points.length === 0) {
    return { segments: [], closed: false };
  }

  const segments: Path['segments'] = [];
  segments.push({ type: 'M', x: points[0].x, y: points[0].y });

  for (let i = 1; i < points.length; i++) {
    segments.push({ type: 'L', x: points[i].x, y: points[i].y });
  }

  return { segments, closed: false };
}
