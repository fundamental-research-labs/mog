/**
 * 3x3 affine transform matrix operations.
 *
 * Matrix layout:
 *   | a  c  tx |
 *   | b  d  ty |
 *   | 0  0  1  |
 *
 * Point transformation: x' = a*x + c*y + tx, y' = b*x + d*y + ty
 */
import type { AffineTransform, Point2D } from '@mog-sdk/contracts/geometry';

/** The identity transform (does nothing). */
export function identity(): AffineTransform {
  return { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
}

/** Create a transform from individual values. */
export function fromValues(
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
): AffineTransform {
  return { a, b, c, d, tx, ty };
}

/**
 * Multiply two transforms: result = A * B
 * This composes transforms so that B is applied first, then A.
 */
export function multiply(A: AffineTransform, B: AffineTransform): AffineTransform {
  return {
    a: A.a * B.a + A.c * B.b,
    b: A.b * B.a + A.d * B.b,
    c: A.a * B.c + A.c * B.d,
    d: A.b * B.c + A.d * B.d,
    tx: A.a * B.tx + A.c * B.ty + A.tx,
    ty: A.b * B.tx + A.d * B.ty + A.ty,
  };
}

/** Compute the determinant of the 2x2 linear part. */
export function determinant(m: AffineTransform): number {
  return m.a * m.d - m.b * m.c;
}

/**
 * Invert a transform. Returns null if the matrix is singular (det ≈ 0).
 */
export function invert(m: AffineTransform): AffineTransform | null {
  const det = determinant(m);
  if (Math.abs(det) < 1e-12) {
    return null;
  }
  const invDet = 1 / det;
  return {
    a: m.d * invDet,
    b: -m.b * invDet,
    c: -m.c * invDet,
    d: m.a * invDet,
    tx: (m.c * m.ty - m.d * m.tx) * invDet,
    ty: (m.b * m.tx - m.a * m.ty) * invDet,
  };
}

/** Transform a single point. */
export function transformPoint(m: AffineTransform, p: Point2D): Point2D {
  return {
    x: m.a * p.x + m.c * p.y + m.tx,
    y: m.b * p.x + m.d * p.y + m.ty,
  };
}

/** Transform an array of points. */
export function transformPoints(m: AffineTransform, points: Point2D[]): Point2D[] {
  return points.map((p) => transformPoint(m, p));
}

/** Check if a matrix is the identity (within epsilon). */
export function isIdentity(m: AffineTransform, epsilon: number = 1e-10): boolean {
  return (
    Math.abs(m.a - 1) < epsilon &&
    Math.abs(m.b) < epsilon &&
    Math.abs(m.c) < epsilon &&
    Math.abs(m.d - 1) < epsilon &&
    Math.abs(m.tx) < epsilon &&
    Math.abs(m.ty) < epsilon
  );
}

/** Check equality of two matrices within epsilon. */
export function equals(a: AffineTransform, b: AffineTransform, epsilon: number = 1e-10): boolean {
  return (
    Math.abs(a.a - b.a) < epsilon &&
    Math.abs(a.b - b.b) < epsilon &&
    Math.abs(a.c - b.c) < epsilon &&
    Math.abs(a.d - b.d) < epsilon &&
    Math.abs(a.tx - b.tx) < epsilon &&
    Math.abs(a.ty - b.ty) < epsilon
  );
}
