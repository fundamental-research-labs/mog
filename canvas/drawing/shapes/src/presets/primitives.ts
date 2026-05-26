/**
 * Shared geometry primitives for shape preset generators.
 *
 * Extracts common patterns (ellipse, polygon, star) into reusable functions
 * so preset files don't duplicate geometry logic.
 */
import { PathOps } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import { KAPPA } from './constants';

/**
 * Compute a point on an ellipse at a given angle.
 */
export function ellipsePoint(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number,
): { x: number; y: number } {
  return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
}

/**
 * Create a full ellipse path using cubic Bezier approximation (KAPPA).
 */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): Path {
  const b = PathOps.createPath();
  b.moveTo(cx + rx, cy);
  b.curveTo(cx + rx, cy + ry * KAPPA, cx + rx * KAPPA, cy + ry, cx, cy + ry);
  b.curveTo(cx - rx * KAPPA, cy + ry, cx - rx, cy + ry * KAPPA, cx - rx, cy);
  b.curveTo(cx - rx, cy - ry * KAPPA, cx - rx * KAPPA, cy - ry, cx, cy - ry);
  b.curveTo(cx + rx * KAPPA, cy - ry, cx + rx, cy - ry * KAPPA, cx + rx, cy);
  b.closePath();
  return b.toPath();
}

/**
 * Create a regular polygon with n sides inscribed in an ellipse.
 */
export function regularPolygon(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n: number,
  startAngle: number = -Math.PI / 2,
): Path {
  const b = PathOps.createPath();
  for (let i = 0; i < n; i++) {
    const angle = startAngle + (2 * Math.PI * i) / n;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    if (i === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  }
  b.closePath();
  return b.toPath();
}

/**
 * Create a star path with alternating outer and inner radii.
 *
 * Supports independent rx/ry for both outer and inner ellipses.
 */
export function starPath(
  cx: number,
  cy: number,
  outerRx: number,
  outerRy: number,
  innerRx: number,
  innerRy: number,
  points: number,
): Path {
  const b = PathOps.createPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = -Math.PI / 2 + (Math.PI * i) / points;
    const rx = i % 2 === 0 ? outerRx : innerRx;
    const ry = i % 2 === 0 ? outerRy : innerRy;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    if (i === 0) b.moveTo(x, y);
    else b.lineTo(x, y);
  }
  b.closePath();
  return b.toPath();
}
