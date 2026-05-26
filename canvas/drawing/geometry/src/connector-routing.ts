/**
 * Connector routing algorithms.
 *
 * Pure geometry for routing connection lines between shapes.
 * Supports straight, right-angle bend, cubic Bezier curve, and
 * long-curve routing styles.
 *
 * Zero dependencies beyond contracts.
 */

import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';

// =============================================================================
// Types
// =============================================================================

/**
 * Named connection point positions on a shape's bounding box.
 *
 * - tCtr / bCtr: top / bottom center
 * - midL / midR: middle left / right
 * - ctr: center
 * - tL / tR / bL / bR: corners
 * - auto: closest edge midpoint to the target
 * - radial: edge point in the direction of the target
 */
export type ConnectionPointType =
  | 'tCtr'
  | 'bCtr'
  | 'midL'
  | 'midR'
  | 'ctr'
  | 'tL'
  | 'tR'
  | 'bL'
  | 'bR'
  | 'auto'
  | 'radial';

/** Routing style for the connector path. */
export type RoutingStyle = 'straight' | 'bend' | 'curve' | 'longCurve';

/** Bend point position for right-angle bend routing. */
export type BendPosition = 'beg' | 'def' | 'end';

/** Options for {@link routeConnector}. */
export interface RouteConnectorOptions {
  /** Bend point position (only used when style is 'bend'). Default: 'def'. */
  bendPosition?: BendPosition;
  /** Curve control-point factor (only used when style is 'curve'). Default: 0.33. */
  curveFactor?: number;
  /** Long-curve control-point factor (only used when style is 'longCurve'). Default: 0.5. */
  longCurveFactor?: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Default curve control point factor (fraction of distance between endpoints). */
const DEFAULT_CURVE_FACTOR = 0.33;

/** Long curve control point factor (wider arc). */
const DEFAULT_LONG_CURVE_FACTOR = 0.5;

// =============================================================================
// Connection Point Calculation
// =============================================================================

/**
 * Calculate a connection point on a shape's bounding box.
 *
 * @param bounds - The shape's bounding rectangle.
 * @param pointType - Which point on the shape to connect from/to.
 * @param targetCenter - Center of the other shape (required for 'auto' and 'radial').
 * @returns The calculated connection point.
 */
export function calculateConnectionPoint(
  bounds: BoundingBox,
  pointType: ConnectionPointType,
  targetCenter?: Point2D,
): Point2D {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;

  switch (pointType) {
    case 'tCtr':
      return { x: cx, y };
    case 'bCtr':
      return { x: cx, y: y + height };
    case 'midL':
      return { x, y: cy };
    case 'midR':
      return { x: x + width, y: cy };
    case 'ctr':
      return { x: cx, y: cy };
    case 'tL':
      return { x, y };
    case 'tR':
      return { x: x + width, y };
    case 'bL':
      return { x, y: y + height };
    case 'bR':
      return { x: x + width, y: y + height };
    case 'radial': {
      if (!targetCenter) {
        return { x: cx, y };
      }
      return calculateRadialPoint(bounds, targetCenter);
    }
    case 'auto':
    default: {
      if (!targetCenter) {
        return { x: cx, y: cy };
      }
      return calculateAutoConnectionPoint(bounds, targetCenter);
    }
  }
}

/**
 * Calculate the automatic connection point: the closest edge center
 * to the other shape's center.
 */
function calculateAutoConnectionPoint(bounds: BoundingBox, otherCenter: Point2D): Point2D {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;

  const candidates: Point2D[] = [
    { x: cx, y }, // top center
    { x: cx, y: y + height }, // bottom center
    { x, y: cy }, // middle left
    { x: x + width, y: cy }, // middle right
  ];

  let bestPoint = candidates[0];
  let bestDist = Infinity;

  for (const pt of candidates) {
    const dx = pt.x - otherCenter.x;
    const dy = pt.y - otherCenter.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = pt;
    }
  }

  return bestPoint;
}

/**
 * Calculate a radial connection point on the shape's bounding box edge
 * in the direction of the other shape.
 */
function calculateRadialPoint(bounds: BoundingBox, otherCenter: Point2D): Point2D {
  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;

  const dx = otherCenter.x - cx;
  const dy = otherCenter.y - cy;

  if (dx === 0 && dy === 0) {
    return { x: cx, y };
  }

  const halfW = width / 2;
  const halfH = height / 2;

  const scaleX = halfW > 0 ? Math.abs(halfW / dx) : Infinity;
  const scaleY = halfH > 0 ? Math.abs(halfH / dy) : Infinity;
  const scale = Math.min(
    scaleX === Infinity ? Infinity : scaleX,
    scaleY === Infinity ? Infinity : scaleY,
  );

  if (!isFinite(scale)) {
    return { x: cx, y };
  }

  return {
    x: cx + dx * scale,
    y: cy + dy * scale,
  };
}

// =============================================================================
// Routing Functions
// =============================================================================

/**
 * Route a straight connection between two points.
 *
 * @returns A 2-point array [start, end].
 */
export function routeStraight(start: Point2D, end: Point2D): Point2D[] {
  return [start, end];
}

/**
 * Route a right-angle bend connection.
 *
 * @param start - Start point.
 * @param end - End point.
 * @param bendPt - Where to place the bend ('beg', 'def', or 'end').
 * @returns A 3-point (beg/end) or 4-point (def) array.
 */
export function routeBend(start: Point2D, end: Point2D, bendPt: BendPosition = 'def'): Point2D[] {
  let bendX: number;
  let bendY: number;

  switch (bendPt) {
    case 'beg':
      // Bend near the beginning: go vertical first, then horizontal
      bendX = start.x;
      bendY = end.y;
      break;
    case 'end':
      // Bend near the end: go horizontal first, then vertical
      bendX = end.x;
      bendY = start.y;
      break;
    case 'def':
    default:
      // Default: bend at midpoint - go horizontal to midpoint, then vertical
      bendX = (start.x + end.x) / 2;
      bendY = start.y;
      return [start, { x: bendX, y: start.y }, { x: bendX, y: end.y }, end];
  }

  return [start, { x: bendX, y: bendY }, end];
}

/**
 * Route a curve connection using cubic Bezier control points.
 *
 * @param start - Start point.
 * @param end - End point.
 * @param factor - Control point distance factor. Default: 0.33.
 * @returns A 4-point array [start, cp1, cp2, end] for a cubic Bezier.
 */
export function routeCurve(
  start: Point2D,
  end: Point2D,
  factor: number = DEFAULT_CURVE_FACTOR,
): Point2D[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  // Perpendicular offset for the control points
  const perpX = -dy * factor;
  const perpY = dx * factor;

  const cp1: Point2D = {
    x: start.x + dx * factor + perpX * 0.1,
    y: start.y + dy * factor + perpY * 0.1,
  };
  const cp2: Point2D = {
    x: end.x - dx * factor - perpX * 0.1,
    y: end.y - dy * factor - perpY * 0.1,
  };

  return [start, cp1, cp2, end];
}

/**
 * Route a long-curve connection (wider arc than standard curve).
 *
 * @param start - Start point.
 * @param end - End point.
 * @param factor - Control point distance factor. Default: 0.5.
 * @returns A 4-point array [start, cp1, cp2, end] for a cubic Bezier.
 */
export function routeLongCurve(
  start: Point2D,
  end: Point2D,
  factor: number = DEFAULT_LONG_CURVE_FACTOR,
): Point2D[] {
  return routeCurve(start, end, factor);
}

// =============================================================================
// Unified Routing Entry Point
// =============================================================================

/**
 * Route a connector between two points using the specified style.
 *
 * @param start - Start point.
 * @param end - End point.
 * @param style - Routing style.
 * @param options - Additional options (bend position, curve factors).
 * @returns Array of points defining the connector path.
 */
export function routeConnector(
  start: Point2D,
  end: Point2D,
  style: RoutingStyle,
  options?: RouteConnectorOptions,
): Point2D[] {
  switch (style) {
    case 'bend':
      return routeBend(start, end, options?.bendPosition ?? 'def');
    case 'curve':
      return routeCurve(start, end, options?.curveFactor ?? DEFAULT_CURVE_FACTOR);
    case 'longCurve':
      return routeLongCurve(start, end, options?.longCurveFactor ?? DEFAULT_LONG_CURVE_FACTOR);
    case 'straight':
    default:
      return routeStraight(start, end);
  }
}
