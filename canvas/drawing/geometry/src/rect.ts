/**
 * BoundingBox (rectangle) operations.
 */
import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';

const DEFAULT_EPSILON = 1e-10;

/** Create a bounding box from an array of points. */
export function fromPoints(points: Point2D[]): BoundingBox {
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

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Create a bounding box from two corner points. */
export function fromCorners(topLeft: Point2D, bottomRight: Point2D): BoundingBox {
  return {
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y),
    width: Math.abs(bottomRight.x - topLeft.x),
    height: Math.abs(bottomRight.y - topLeft.y),
  };
}

/** Union of two bounding boxes (smallest box containing both). */
export function union(a: BoundingBox, b: BoundingBox): BoundingBox {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Intersection of two bounding boxes, or null if they don't overlap. */
export function intersection(a: BoundingBox, b: BoundingBox): BoundingBox | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  if (right <= x || bottom <= y) {
    return null;
  }

  return { x, y, width: right - x, height: bottom - y };
}

/** Check if outer fully contains inner. */
export function contains(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** Check if a point is inside the bounding box. */
export function containsPoint(box: BoundingBox, point: Point2D): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** Expand a bounding box by padding on all sides. */
export function expand(box: BoundingBox, padding: number): BoundingBox {
  const rawWidth = box.width + 2 * padding;
  const rawHeight = box.height + 2 * padding;
  // Clamp each dimension independently: if one over-shrinks, collapse only that axis
  const clampedWidth = Math.max(0, rawWidth);
  const clampedHeight = Math.max(0, rawHeight);
  return {
    x: clampedWidth > 0 ? box.x - padding : box.x + box.width / 2,
    y: clampedHeight > 0 ? box.y - padding : box.y + box.height / 2,
    width: clampedWidth,
    height: clampedHeight,
  };
}

/** Get the center point of a bounding box. */
export function center(box: BoundingBox): Point2D {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Compute the area of a bounding box. */
export function area(box: BoundingBox): number {
  return box.width * box.height;
}

/** Check if a bounding box has zero or negative area. */
export function isEmpty(box: BoundingBox): boolean {
  return box.width <= 0 || box.height <= 0;
}

/** Check equality of two bounding boxes within epsilon. */
export function equals(a: BoundingBox, b: BoundingBox, epsilon: number = DEFAULT_EPSILON): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}

/** Get the four corners of a bounding box: [topLeft, topRight, bottomRight, bottomLeft]. */
export function corners(box: BoundingBox): [Point2D, Point2D, Point2D, Point2D] {
  return [
    { x: box.x, y: box.y }, // topLeft
    { x: box.x + box.width, y: box.y }, // topRight
    { x: box.x + box.width, y: box.y + box.height }, // bottomRight
    { x: box.x, y: box.y + box.height }, // bottomLeft
  ];
}

/** Check if two bounding boxes overlap (non-empty intersection). */
export function overlaps(a: BoundingBox, b: BoundingBox): boolean {
  return intersection(a, b) !== null;
}

/** Get the perimeter of a bounding box. */
export function perimeter(box: BoundingBox): number {
  return 2 * (box.width + box.height);
}

/** Inset a bounding box (negative expand). */
export function inset(box: BoundingBox, amount: number): BoundingBox {
  return expand(box, -amount);
}

/** Scale a bounding box from its center. */
export function scaleFromCenter(box: BoundingBox, sx: number, sy: number): BoundingBox {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const newWidth = box.width * sx;
  const newHeight = box.height * sy;
  return {
    x: cx - newWidth / 2,
    y: cy - newHeight / 2,
    width: newWidth,
    height: newHeight,
  };
}
