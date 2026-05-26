/**
 * Pick Utilities - Point-in-mark testing for chart interactions
 *
 * Pure functions for determining which mark (if any) is at a given position.
 * Used for tooltips, selection, and other mouse interactions.
 *
 * No framework dependencies - pure geometry calculations.
 * Delegates to @mog/geometry for primitive point-in-shape tests.
 */

import {
  pointInArc as geoPointInArc,
  pointInCircle,
  pointInDiamond,
  pointInRect as geoPointInRect,
} from '@mog/geometry';
import type { ArcMark, Mark, PathMark, RectMark, SymbolMark, TextMark } from '../primitives/types';
import { symbolRadius } from './shared';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a pick operation
 */
export interface PickResult {
  /** The mark that was picked */
  mark: Mark;
  /** The data associated with the mark */
  datum: unknown;
  /** Index of the mark in the marks array */
  index: number;
  /** Distance from the query point to the mark center (0 if inside) */
  distance: number;
}

/**
 * Calculate distance between two points
 */
function pointDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

// =============================================================================
// Point-in-Mark Tests
// =============================================================================

/**
 * Test if a point is inside a rectangle mark.
 * Delegates to @mog/geometry pointInRect.
 */
function pointInRect(x: number, y: number, rect: RectMark): boolean {
  return geoPointInRect({ x, y }, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

/**
 * Test if a point is inside a symbol mark.
 * Delegates to @mog/geometry for circle, diamond, and rect primitives.
 */
function pointInSymbol(x: number, y: number, symbol: SymbolMark): boolean {
  const radius = symbolRadius(symbol.size);
  const point = { x, y };
  const center = { x: symbol.x, y: symbol.y };

  switch (symbol.shape) {
    case 'circle':
      return pointInCircle(point, center, radius);

    case 'square': {
      const halfSide = (radius * Math.SQRT2) / 2;
      return geoPointInRect(point, {
        x: symbol.x - halfSide,
        y: symbol.y - halfSide,
        width: halfSide * 2,
        height: halfSide * 2,
      });
    }

    case 'diamond': {
      // The diamond size for pointInDiamond is the full diagonal width.
      // Original: Math.abs(dx) / d + Math.abs(dy) / d <= 1, where d = radius * 1.2
      // pointInDiamond: Math.abs(dx) / halfSize + Math.abs(dy) / halfSize <= 1
      // So halfSize = d = radius * 1.2, meaning size = 2 * radius * 1.2
      return pointInDiamond(point, center, radius * 1.2 * 2);
    }

    case 'triangle-up':
    case 'triangle-down': {
      const h = radius * 1.5;
      const base = radius * 1.5;
      // Simplified bounding box test for triangles
      return geoPointInRect(point, {
        x: symbol.x - base / 2,
        y: symbol.y - h / 2,
        width: base,
        height: h,
      });
    }

    case 'cross': {
      const arm = radius * 0.7;
      const thickness = radius * 0.3;
      // Test if in horizontal or vertical arm
      const inHorizontal = geoPointInRect(point, {
        x: symbol.x - arm,
        y: symbol.y - thickness / 2,
        width: arm * 2,
        height: thickness,
      });
      const inVertical = geoPointInRect(point, {
        x: symbol.x - thickness / 2,
        y: symbol.y - arm,
        width: thickness,
        height: arm * 2,
      });
      return inHorizontal || inVertical;
    }

    default:
      // Default to circular hit test
      return pointInCircle(point, center, radius);
  }
}

/**
 * Test if a point is inside an arc mark.
 * Delegates to @mog/geometry pointInArc.
 * Both use the same angle convention: 0 at top (12 o'clock), clockwise.
 */
function pointInArc(x: number, y: number, arc: ArcMark): boolean {
  return geoPointInArc(
    { x, y },
    { x: arc.x, y: arc.y },
    arc.innerRadius,
    arc.outerRadius,
    arc.startAngle,
    arc.endAngle,
  );
}

/**
 * Test if a point is inside a path mark's bounding box.
 * Parses all numeric coordinates from the SVG path string to compute bounds.
 * This is a bounding-box approximation, not exact path containment.
 */
function pointInPathBounds(x: number, y: number, pathMark: PathMark): boolean {
  // Extract all numbers from the path string (coordinates of all commands)
  const nums = pathMark.path.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!nums || nums.length < 4) return false; // Need at least 2 x,y pairs

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Parse consecutive number pairs as x,y coordinates
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const px = Number(nums[i]);
    const py = Number(nums[i + 1]);
    if (isFinite(px) && isFinite(py)) {
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }

  if (!isFinite(minX)) return false;

  return geoPointInRect({ x, y }, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
}

/**
 * Test if a point is inside a mark
 */
export function pointInMark(x: number, y: number, mark: Mark): boolean {
  switch (mark.type) {
    case 'rect':
      return pointInRect(x, y, mark as RectMark);

    case 'symbol':
      return pointInSymbol(x, y, mark as SymbolMark);

    case 'arc':
      return pointInArc(x, y, mark as ArcMark);

    case 'text': {
      // Text marks are difficult to hit-test accurately without measuring
      // Use a simple bounding box approximation
      const textMark = mark as TextMark;
      const fontSize = textMark.fontSize ?? 12;
      const textWidth = textMark.text.length * fontSize * 0.6; // Rough approximation
      const textHeight = fontSize;

      // Adjust based on alignment
      let offsetX = 0;
      const align = textMark.textAlign ?? 'left';
      if (align === 'center') offsetX = -textWidth / 2;
      else if (align === 'right') offsetX = -textWidth;

      let offsetY = 0;
      const baseline = textMark.textBaseline ?? 'bottom';
      if (baseline === 'middle') offsetY = -textHeight / 2;
      else if (baseline === 'top') offsetY = 0;
      else offsetY = -textHeight; // 'bottom'

      return geoPointInRect(
        { x, y },
        {
          x: mark.x + offsetX,
          y: mark.y + offsetY,
          width: textWidth,
          height: textHeight,
        },
      );
    }

    case 'path':
      return pointInPathBounds(x, y, mark as PathMark);

    default:
      return false;
  }
}

// =============================================================================
// Distance Calculations
// =============================================================================

/**
 * Calculate distance from a point to a mark's center.
 * Uses @mog/geometry distance functions where applicable.
 */
export function distanceToMark(x: number, y: number, mark: Mark): number {
  switch (mark.type) {
    case 'rect': {
      const rectMark = mark as RectMark;
      const cx = rectMark.x + rectMark.width / 2;
      const cy = rectMark.y + rectMark.height / 2;
      return pointDistance(x, y, cx, cy);
    }

    case 'symbol':
      return pointDistance(x, y, mark.x, mark.y);

    case 'arc': {
      // Distance to the center of the arc
      return pointDistance(x, y, mark.x, mark.y);
    }

    case 'text':
      return pointDistance(x, y, mark.x, mark.y);

    case 'path': {
      // For paths, use the starting point from the path string if available
      // PathMark uses SVG path string format, parse the first M command
      const pathMark = mark as PathMark;
      const match = pathMark.path.match(/^M\s*([-\d.]+)[,\s]+([-\d.]+)/i);
      if (match) {
        const px = parseFloat(match[1]);
        const py = parseFloat(match[2]);
        return pointDistance(x, y, px, py);
      }
      return Infinity;
    }

    default:
      return Infinity;
  }
}

/**
 * Calculate the signed distance from a point to a mark.
 * Negative values mean the point is inside the mark.
 */
export function signedDistanceToMark(x: number, y: number, mark: Mark): number {
  if (pointInMark(x, y, mark)) {
    return -distanceToMark(x, y, mark);
  }
  return distanceToMark(x, y, mark);
}

// =============================================================================
// Pick Functions
// =============================================================================

/**
 * Find which mark is directly under the cursor (exact hit).
 * Tests marks in reverse order (top-most first) since later marks are drawn on top.
 *
 * @param marks - Array of marks to test
 * @param x - X coordinate of the query point
 * @param y - Y coordinate of the query point
 * @returns PickResult if a mark is found, null otherwise
 */
export function pickMark(marks: Mark[], x: number, y: number): PickResult | null {
  // Test marks in reverse order (top-most first)
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];

    // Skip non-interactive marks
    if (mark.interactive === false) {
      continue;
    }

    if (pointInMark(x, y, mark)) {
      return {
        mark,
        datum: mark.datum,
        index: i,
        distance: 0,
      };
    }
  }

  return null;
}

/**
 * Find the closest mark to a point within a maximum distance.
 * Useful for finding marks that are near but not directly under the cursor.
 *
 * @param marks - Array of marks to test
 * @param x - X coordinate of the query point
 * @param y - Y coordinate of the query point
 * @param maxDistance - Maximum distance to consider (default: Infinity)
 * @returns PickResult if a mark is found within maxDistance, null otherwise
 */
export function pickClosestMark(
  marks: Mark[],
  x: number,
  y: number,
  maxDistance: number = Infinity,
): PickResult | null {
  let closest: PickResult | null = null;

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];

    // Skip non-interactive marks
    if (mark.interactive === false) {
      continue;
    }

    const dist = distanceToMark(x, y, mark);

    if (dist < maxDistance && (!closest || dist < closest.distance)) {
      closest = {
        mark,
        datum: mark.datum,
        index: i,
        distance: dist,
      };
    }
  }

  return closest;
}

/**
 * Find all marks that contain the query point.
 * Useful when marks overlap and you need all of them.
 *
 * @param marks - Array of marks to test
 * @param x - X coordinate of the query point
 * @param y - Y coordinate of the query point
 * @returns Array of PickResults for all marks containing the point
 */
export function pickAllMarks(marks: Mark[], x: number, y: number): PickResult[] {
  const results: PickResult[] = [];

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];

    // Skip non-interactive marks
    if (mark.interactive === false) {
      continue;
    }

    if (pointInMark(x, y, mark)) {
      results.push({
        mark,
        datum: mark.datum,
        index: i,
        distance: 0,
      });
    }
  }

  // Return in reverse order (top-most first)
  return results.reverse();
}

/**
 * Find marks within a given radius of a point.
 * Useful for proximity-based selection.
 *
 * @param marks - Array of marks to test
 * @param x - X coordinate of the query point
 * @param y - Y coordinate of the query point
 * @param radius - Search radius
 * @returns Array of PickResults sorted by distance
 */
export function pickMarksInRadius(
  marks: Mark[],
  x: number,
  y: number,
  radius: number,
): PickResult[] {
  const results: PickResult[] = [];

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];

    // Skip non-interactive marks
    if (mark.interactive === false) {
      continue;
    }

    const dist = distanceToMark(x, y, mark);

    if (dist <= radius) {
      results.push({
        mark,
        datum: mark.datum,
        index: i,
        distance: dist,
      });
    }
  }

  // Sort by distance (closest first)
  results.sort((a, b) => a.distance - b.distance);

  return results;
}
