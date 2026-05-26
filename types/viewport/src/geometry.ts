/**
 * @mog-sdk/contracts/geometry
 *
 * 2D geometry primitives used by all floating object engines
 * (shapes, equations, text-effects, ink, drawing).
 *
 * Pure type definitions - no runtime code.
 */

// ─── Point and Vector ────────────────────────────────────────────────────────

/** A point in 2D space. */
export interface Point2D {
  x: number;
  y: number;
}

/** A 2D vector (same shape as Point2D but different semantics). */
export interface Vector2D {
  x: number;
  y: number;
}

// ─── Bounding Box ────────────────────────────────────────────────────────────

/** Axis-aligned bounding box defined by top-left corner + dimensions. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Affine Transform ────────────────────────────────────────────────────────

/**
 * 2D affine transform represented as a 3x3 matrix:
 *
 *   | a  c  tx |
 *   | b  d  ty |
 *   | 0  0  1  |
 *
 * Applies as: x' = a*x + c*y + tx, y' = b*x + d*y + ty
 */
export interface AffineTransform {
  a: number;
  b: number; // scale x, skew y
  c: number;
  d: number; // skew x, scale y
  tx: number;
  ty: number; // translate x, y
}

// ─── Path Types ──────────────────────────────────────────────────────────────

/** Move the pen to (x, y) without drawing. */
export interface MoveTo {
  type: 'M';
  x: number;
  y: number;
}

/** Draw a straight line to (x, y). */
export interface LineTo {
  type: 'L';
  x: number;
  y: number;
}

/** Draw a cubic Bezier curve to (x, y) with control points (x1, y1) and (x2, y2). */
export interface CurveTo {
  type: 'C';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x: number;
  y: number;
}

/** Draw a quadratic Bezier curve to (x, y) with control point (x1, y1). */
export interface QuadraticTo {
  type: 'Q';
  x1: number;
  y1: number;
  x: number;
  y: number;
}

/** Close the current subpath by drawing a line back to the start. */
export interface ClosePath {
  type: 'Z';
}

/** A single segment in a path. */
export type PathSegment = MoveTo | LineTo | CurveTo | QuadraticTo | ClosePath;

/** A single subpath within a compound path. */
export interface SubPath {
  segments: PathSegment[];
  closed: boolean;
}

/** A geometric path composed of segments. */
export interface Path {
  segments: PathSegment[];
  closed: boolean;
  subPaths?: SubPath[]; // Per-subpath closed tracking for compound paths
}
