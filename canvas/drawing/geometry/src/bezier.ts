/**
 * Bezier curve operations.
 *
 * Cubic and quadratic Bezier evaluation, splitting, bounding box,
 * arc length, and nearest point computation.
 */
import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';

// ─── Evaluation ──────────────────────────────────────────────────────────────

/** Evaluate a cubic Bezier at parameter t ∈ [0, 1]. */
export function evaluateCubic(
  t: number,
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
  };
}

/** Evaluate a quadratic Bezier at parameter t ∈ [0, 1]. */
export function evaluateQuadratic(t: number, p0: Point2D, p1: Point2D, p2: Point2D): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * p0.x + 2 * mt * t * p1.x + t2 * p2.x,
    y: mt2 * p0.y + 2 * mt * t * p1.y + t2 * p2.y,
  };
}

/** Evaluate the derivative of a cubic Bezier at parameter t. */
export function cubicDerivative(
  t: number,
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
): Point2D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x),
    y: 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y),
  };
}

/** Evaluate the derivative of a quadratic Bezier at parameter t. */
export function quadraticDerivative(t: number, p0: Point2D, p1: Point2D, p2: Point2D): Point2D {
  const mt = 1 - t;
  return {
    x: 2 * mt * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
    y: 2 * mt * (p1.y - p0.y) + 2 * t * (p2.y - p1.y),
  };
}

// ─── Splitting ───────────────────────────────────────────────────────────────

/** Split a cubic Bezier at parameter t, returning two cubic curves (De Casteljau). */
export function splitCubicAt(
  t: number,
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
): [
  { p0: Point2D; p1: Point2D; p2: Point2D; p3: Point2D },
  { p0: Point2D; p1: Point2D; p2: Point2D; p3: Point2D },
] {
  const mt = 1 - t;

  // Level 1
  const p01 = { x: mt * p0.x + t * p1.x, y: mt * p0.y + t * p1.y };
  const p12 = { x: mt * p1.x + t * p2.x, y: mt * p1.y + t * p2.y };
  const p23 = { x: mt * p2.x + t * p3.x, y: mt * p2.y + t * p3.y };

  // Level 2
  const p012 = { x: mt * p01.x + t * p12.x, y: mt * p01.y + t * p12.y };
  const p123 = { x: mt * p12.x + t * p23.x, y: mt * p12.y + t * p23.y };

  // Level 3 (the point on the curve)
  const p0123 = { x: mt * p012.x + t * p123.x, y: mt * p012.y + t * p123.y };

  return [
    { p0, p1: p01, p2: p012, p3: p0123 },
    { p0: p0123, p1: p123, p2: p23, p3 },
  ];
}

/** Split a quadratic Bezier at parameter t, returning two quadratic curves. */
export function splitQuadraticAt(
  t: number,
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
): [{ p0: Point2D; p1: Point2D; p2: Point2D }, { p0: Point2D; p1: Point2D; p2: Point2D }] {
  const mt = 1 - t;

  const p01 = { x: mt * p0.x + t * p1.x, y: mt * p0.y + t * p1.y };
  const p12 = { x: mt * p1.x + t * p2.x, y: mt * p1.y + t * p2.y };
  const p012 = { x: mt * p01.x + t * p12.x, y: mt * p01.y + t * p12.y };

  return [
    { p0, p1: p01, p2: p012 },
    { p0: p012, p1: p12, p2 },
  ];
}

// ─── Bounding Box ────────────────────────────────────────────────────────────

/**
 * Find the roots of a quadratic equation at^2 + bt + c = 0 in [0, 1].
 */
function quadraticRoots(a: number, b: number, c: number): number[] {
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    // Linear: bt + c = 0
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t > 0 && t < 1) roots.push(t);
    }
    return roots;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return roots;
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b + sqrtDisc) / (2 * a);
  const t2 = (-b - sqrtDisc) / (2 * a);
  if (t1 > 0 && t1 < 1) roots.push(t1);
  if (t2 > 0 && t2 < 1) roots.push(t2);
  return roots;
}

/** Compute the tight bounding box of a cubic Bezier. */
export function cubicBoundingBox(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D): BoundingBox {
  // Start with endpoints
  let minX = Math.min(p0.x, p3.x);
  let maxX = Math.max(p0.x, p3.x);
  let minY = Math.min(p0.y, p3.y);
  let maxY = Math.max(p0.y, p3.y);

  // Find extrema by solving derivative = 0
  // Derivative coefficients for x: at^2 + bt + c
  const ax = -3 * p0.x + 9 * p1.x - 9 * p2.x + 3 * p3.x;
  const bx = 6 * p0.x - 12 * p1.x + 6 * p2.x;
  const cx = -3 * p0.x + 3 * p1.x;

  for (const t of quadraticRoots(ax, bx, cx)) {
    const pt = evaluateCubic(t, p0, p1, p2, p3);
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
  }

  const ay = -3 * p0.y + 9 * p1.y - 9 * p2.y + 3 * p3.y;
  const by = 6 * p0.y - 12 * p1.y + 6 * p2.y;
  const cy = -3 * p0.y + 3 * p1.y;

  for (const t of quadraticRoots(ay, by, cy)) {
    const pt = evaluateCubic(t, p0, p1, p2, p3);
    minY = Math.min(minY, pt.y);
    maxY = Math.max(maxY, pt.y);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Compute the tight bounding box of a quadratic Bezier. */
export function quadraticBoundingBox(p0: Point2D, p1: Point2D, p2: Point2D): BoundingBox {
  let minX = Math.min(p0.x, p2.x);
  let maxX = Math.max(p0.x, p2.x);
  let minY = Math.min(p0.y, p2.y);
  let maxY = Math.max(p0.y, p2.y);

  // For quadratic: derivative is linear at + b
  // x: 2(1-t)(p1.x - p0.x) + 2t(p2.x - p1.x) = 0
  // => t = (p0.x - p1.x) / (p0.x - 2*p1.x + p2.x)
  const denomX = p0.x - 2 * p1.x + p2.x;
  if (Math.abs(denomX) > 1e-12) {
    const tx = (p0.x - p1.x) / denomX;
    if (tx > 0 && tx < 1) {
      const pt = evaluateQuadratic(tx, p0, p1, p2);
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
    }
  }

  const denomY = p0.y - 2 * p1.y + p2.y;
  if (Math.abs(denomY) > 1e-12) {
    const ty = (p0.y - p1.y) / denomY;
    if (ty > 0 && ty < 1) {
      const pt = evaluateQuadratic(ty, p0, p1, p2);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ─── Arc Length ──────────────────────────────────────────────────────────────

/**
 * Approximate the arc length of a cubic Bezier using Simpson's 1/3 rule.
 * @param segments Number of segments for integration (higher = more accurate). Must be even; rounded up if odd.
 */
export function cubicLength(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  segments: number = 20,
): number {
  segments = Math.max(2, segments); // At least 2 segments to avoid division by zero
  segments += segments % 2; // Simpson's rule requires even number of segments

  let totalLength = 0;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const d = cubicDerivative(t, p0, p1, p2, p3);
    const speed = Math.sqrt(d.x * d.x + d.y * d.y);

    if (i === 0 || i === segments) {
      totalLength += speed;
    } else if (i % 2 === 1) {
      totalLength += 4 * speed;
    } else {
      totalLength += 2 * speed;
    }
  }

  return (totalLength * (1 / segments)) / 3;
}

/**
 * Approximate the arc length of a quadratic Bezier.
 */
export function quadraticLength(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  segments: number = 20,
): number {
  segments = Math.max(2, segments); // At least 2 segments to avoid division by zero
  segments += segments % 2; // Simpson's rule requires even number of segments

  let totalLength = 0;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const d = quadraticDerivative(t, p0, p1, p2);
    const speed = Math.sqrt(d.x * d.x + d.y * d.y);

    if (i === 0 || i === segments) {
      totalLength += speed;
    } else if (i % 2 === 1) {
      totalLength += 4 * speed;
    } else {
      totalLength += 2 * speed;
    }
  }

  return (totalLength * (1 / segments)) / 3;
}

// ─── Nearest Point ───────────────────────────────────────────────────────────

/** Find the nearest point on a cubic Bezier to a given point (using sampling + refinement). */
export function nearestPointOnCubic(
  point: Point2D,
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  sampleCount: number = 50,
): { t: number; point: Point2D; distance: number } {
  // Step 1: coarse sampling
  let bestT = 0;
  let bestDist = Infinity;
  let bestPt = p0;

  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const pt = evaluateCubic(t, p0, p1, p2, p3);
    const dx = pt.x - point.x;
    const dy = pt.y - point.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
      bestPt = pt;
    }
  }

  // Step 2: binary refinement around best t
  let lo = Math.max(0, bestT - 1 / sampleCount);
  let hi = Math.min(1, bestT + 1 / sampleCount);

  for (let iter = 0; iter < 20; iter++) {
    const mid1 = lo + (hi - lo) / 3;
    const mid2 = hi - (hi - lo) / 3;

    const pt1 = evaluateCubic(mid1, p0, p1, p2, p3);
    const pt2 = evaluateCubic(mid2, p0, p1, p2, p3);

    const d1 = (pt1.x - point.x) ** 2 + (pt1.y - point.y) ** 2;
    const d2 = (pt2.x - point.x) ** 2 + (pt2.y - point.y) ** 2;

    if (d1 < d2) {
      hi = mid2;
      if (d1 < bestDist) {
        bestDist = d1;
        bestT = mid1;
        bestPt = pt1;
      }
    } else {
      lo = mid1;
      if (d2 < bestDist) {
        bestDist = d2;
        bestT = mid2;
        bestPt = pt2;
      }
    }
  }

  return { t: bestT, point: bestPt, distance: Math.sqrt(bestDist) };
}

/** Find the nearest point on a quadratic Bezier to a given point. */
export function nearestPointOnQuadratic(
  point: Point2D,
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  sampleCount: number = 50,
): { t: number; point: Point2D; distance: number } {
  let bestT = 0;
  let bestDist = Infinity;
  let bestPt = p0;

  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const pt = evaluateQuadratic(t, p0, p1, p2);
    const dx = pt.x - point.x;
    const dy = pt.y - point.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
      bestPt = pt;
    }
  }

  let lo = Math.max(0, bestT - 1 / sampleCount);
  let hi = Math.min(1, bestT + 1 / sampleCount);

  for (let iter = 0; iter < 20; iter++) {
    const mid1 = lo + (hi - lo) / 3;
    const mid2 = hi - (hi - lo) / 3;

    const pt1 = evaluateQuadratic(mid1, p0, p1, p2);
    const pt2 = evaluateQuadratic(mid2, p0, p1, p2);

    const d1 = (pt1.x - point.x) ** 2 + (pt1.y - point.y) ** 2;
    const d2 = (pt2.x - point.x) ** 2 + (pt2.y - point.y) ** 2;

    if (d1 < d2) {
      hi = mid2;
      if (d1 < bestDist) {
        bestDist = d1;
        bestT = mid1;
        bestPt = pt1;
      }
    } else {
      lo = mid1;
      if (d2 < bestDist) {
        bestDist = d2;
        bestT = mid2;
        bestPt = pt2;
      }
    }
  }

  return { t: bestT, point: bestPt, distance: Math.sqrt(bestDist) };
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/** Convert a quadratic Bezier to a cubic Bezier (exact, no loss). */
export function quadraticToCubic(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
): { p0: Point2D; p1: Point2D; p2: Point2D; p3: Point2D } {
  // CP1 = P0 + 2/3 * (P1 - P0)
  // CP2 = P2 + 2/3 * (P1 - P2)
  return {
    p0,
    p1: {
      x: p0.x + (2 / 3) * (p1.x - p0.x),
      y: p0.y + (2 / 3) * (p1.y - p0.y),
    },
    p2: {
      x: p2.x + (2 / 3) * (p1.x - p2.x),
      y: p2.y + (2 / 3) * (p1.y - p2.y),
    },
    p3: p2,
  };
}
