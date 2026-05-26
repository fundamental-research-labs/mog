/**
 * Point2D and Vector2D operations.
 *
 * Pure math - no side effects, no dependencies beyond contracts.
 */
import type { Point2D, Vector2D } from '@mog-sdk/contracts/geometry';

const DEFAULT_EPSILON = 1e-10;

/** Create a zero point/vector. */
export function zero(): Point2D {
  return { x: 0, y: 0 };
}

/** Clone a point. */
export function clone(p: Point2D): Point2D {
  return { x: p.x, y: p.y };
}

/** Add two points/vectors. */
export function add(a: Point2D, b: Point2D): Point2D {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Subtract b from a. */
export function subtract(a: Point2D, b: Point2D): Vector2D {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Scale a point/vector by a scalar. */
export function scale(p: Point2D, s: number): Point2D {
  return { x: p.x * s, y: p.y * s };
}

/** Dot product of two vectors. */
export function dot(a: Vector2D, b: Vector2D): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product (scalar z-component of 3D cross product). */
export function cross(a: Vector2D, b: Vector2D): number {
  return a.x * b.y - a.y * b.x;
}

/** Length (magnitude) of a vector. */
export function length(v: Vector2D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/** Squared length of a vector (avoids sqrt). */
export function lengthSquared(v: Vector2D): number {
  return v.x * v.x + v.y * v.y;
}

/** Normalize a vector to unit length. Returns zero vector if input is zero-length. */
export function normalize(v: Vector2D): Vector2D {
  const len = length(v);
  if (len < DEFAULT_EPSILON) {
    return zero();
  }
  return { x: v.x / len, y: v.y / len };
}

/** Distance between two points. */
export function distance(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance between two points (avoids sqrt). */
export function distanceSquared(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/** Linear interpolation between two points. t=0 returns a, t=1 returns b. */
export function lerp(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/** Angle of a vector in radians (atan2). */
export function angle(v: Vector2D): number {
  return Math.atan2(v.y, v.x);
}

/** Angle between two vectors in radians. */
export function angleBetween(a: Vector2D, b: Vector2D): number {
  const d = dot(a, b);
  const la = length(a);
  const lb = length(b);
  if (la < DEFAULT_EPSILON || lb < DEFAULT_EPSILON) {
    return 0;
  }
  // Clamp to [-1, 1] to handle floating point errors
  const cosAngle = Math.max(-1, Math.min(1, d / (la * lb)));
  return Math.acos(cosAngle);
}

/** Rotate a point by an angle (in radians) around the origin. */
export function rotate(p: Point2D, angleRad: number): Point2D {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  };
}

/** Rotate a point around a center. */
export function rotateAround(p: Point2D, angleRad: number, center: Point2D): Point2D {
  const translated = subtract(p, center);
  const rotated = rotate(translated, angleRad);
  return add(rotated, center);
}

/** Negate a vector. */
export function negate(v: Vector2D): Vector2D {
  return { x: -v.x, y: -v.y };
}

/** Check equality with epsilon tolerance. */
export function equals(a: Point2D, b: Point2D, epsilon: number = DEFAULT_EPSILON): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

/** Create a unit vector from an angle in radians. */
export function fromAngle(angleRad: number): Vector2D {
  return { x: Math.cos(angleRad), y: Math.sin(angleRad) };
}

/** Perpendicular vector (90 degrees counter-clockwise). */
export function perpendicular(v: Vector2D): Vector2D {
  return { x: -v.y, y: v.x };
}

/** Project vector a onto vector b. */
export function project(a: Vector2D, b: Vector2D): Vector2D {
  const bLen2 = lengthSquared(b);
  if (bLen2 < DEFAULT_EPSILON) {
    return zero();
  }
  const scalar = dot(a, b) / bLen2;
  return scale(b, scalar);
}

/**
 * Reflect a vector across a normal.
 * @param v - The vector to reflect.
 * @param normal - Must be a unit vector (length 1). Non-unit normals produce incorrect results.
 */
export function reflect(v: Vector2D, normal: Vector2D): Vector2D {
  const d = dot(v, normal);
  return {
    x: v.x - 2 * d * normal.x,
    y: v.y - 2 * d * normal.y,
  };
}

/** Midpoint of two points. */
export function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
