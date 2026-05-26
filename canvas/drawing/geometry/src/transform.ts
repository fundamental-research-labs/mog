/**
 * High-level transform builders.
 *
 * Build common 2D transforms and compose/decompose them.
 */
import type { AffineTransform, Point2D } from '@mog-sdk/contracts/geometry';
import { fromValues, identity, multiply } from './matrix';

/** Create a translation transform. */
export function translate(tx: number, ty: number): AffineTransform {
  return fromValues(1, 0, 0, 1, tx, ty);
}

/** Create a rotation transform (angle in radians, counter-clockwise). */
export function rotate(angleRad: number): AffineTransform {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return fromValues(cos, sin, -sin, cos, 0, 0);
}

/** Create a rotation transform around a specific center point. */
export function rotateAround(angleRad: number, center: Point2D): AffineTransform {
  return compose(translate(center.x, center.y), rotate(angleRad), translate(-center.x, -center.y));
}

/** Create a scale transform. */
export function scale(sx: number, sy: number): AffineTransform {
  return fromValues(sx, 0, 0, sy, 0, 0);
}

/** Create a scale transform around a specific center point. */
export function scaleAround(sx: number, sy: number, center: Point2D): AffineTransform {
  return compose(translate(center.x, center.y), scale(sx, sy), translate(-center.x, -center.y));
}

/** Create a horizontal skew transform (angle in radians). */
export function skewX(angleRad: number): AffineTransform {
  return fromValues(1, 0, Math.tan(angleRad), 1, 0, 0);
}

/** Create a vertical skew transform (angle in radians). */
export function skewY(angleRad: number): AffineTransform {
  return fromValues(1, Math.tan(angleRad), 0, 1, 0, 0);
}

/**
 * Compose N transforms. Applied right-to-left:
 * compose(A, B, C) = A * B * C, meaning C is applied first.
 */
export function compose(...transforms: AffineTransform[]): AffineTransform {
  if (transforms.length === 0) return identity();
  let result = transforms[0];
  for (let i = 1; i < transforms.length; i++) {
    result = multiply(result, transforms[i]);
  }
  return result;
}

/** Result of decomposing an affine transform. */
export interface DecomposeResult {
  translation: { tx: number; ty: number };
  rotation: number; // radians
  scale: { sx: number; sy: number };
  skew: number; // radians (skew along X axis)
}

/**
 * Decompose a matrix into translation, rotation, scale, and skew.
 *
 * Uses the QR decomposition approach:
 * M = T * R * Skew * S
 *
 * Note: decomposition is not unique; this follows the SVG/CSS convention.
 */
export function decompose(m: AffineTransform): DecomposeResult {
  // Translation is directly from tx, ty
  const translation = { tx: m.tx, ty: m.ty };

  // The 2x2 linear part: [a c; b d]
  // Decompose via QR-like approach

  // Rotation angle
  const rotation = Math.atan2(m.b, m.a);

  // sx is the length of the first column
  const sx = Math.sqrt(m.a * m.a + m.b * m.b);

  // Compute the inverse rotation to extract skew
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);

  // Unrotated matrix components
  const ua = m.a * cos - m.b * sin;
  const uc = m.c * cos - m.d * sin;

  // Skew
  const skew = sx !== 0 ? Math.atan2(uc, ua) : 0;

  // sy via determinant / sx (more robust)
  const det = m.a * m.d - m.b * m.c;
  const computedSy = sx !== 0 ? det / sx : 0;

  return {
    translation,
    rotation,
    scale: { sx, sy: computedSy },
    skew,
  };
}

/** Create a flip transform (horizontal: flipX, vertical: flipY). */
export function flipX(): AffineTransform {
  return scale(-1, 1);
}

export function flipY(): AffineTransform {
  return scale(1, -1);
}
