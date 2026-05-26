/**
 * Connection Point Resolution
 *
 * Resolves OOXML preset shape connection points (cxnLst) to pixel-space
 * coordinates given a shape's connection point definitions and bounding box.
 *
 * Connection point data comes from preset-shape-data.json, where each entry
 * has x/y fields referencing guide names (e.g., "hc", "vc", "l", "r", "t", "b",
 * or computed guides like "x1", "y2"). We evaluate the full guide system to
 * resolve these to actual pixel coordinates.
 *
 * Also provides snap-to-nearest logic for connector endpoint snapping.
 *
 * @module @mog/geometry/connection-points
 */

import type { BoundingBox, Point2D } from '@mog-sdk/contracts/geometry';

// =============================================================================
// Types
// =============================================================================

/** A single connection point definition from preset-shape-data.json. */
export interface ConnectionPointDef {
  readonly ang: string;
  readonly x: string;
  readonly y: string;
}

/** Guide definition (adjustment or geometry guide). */
export interface GuideDef {
  readonly name: string;
  readonly fmla: string;
}

/** Shape definition subset needed for connection point resolution. */
export interface ShapeConnectionData {
  readonly avLst: ReadonlyArray<GuideDef>;
  readonly gdLst: ReadonlyArray<GuideDef>;
  readonly cxnLst: ReadonlyArray<ConnectionPointDef>;
}

/** A resolved connection point with its index in the preset's cxnLst. */
export interface ConnectionPointInfo {
  /** Pixel-space position. */
  readonly point: Point2D;
  /** Index in the original cxnLst array. */
  readonly index: number;
}

/** Result of snap-to-nearest calculation. */
export interface SnapResult {
  /** The connection point that the cursor snapped to, or null if none within range. */
  readonly snappedPoint: Point2D | null;
  /** Index of the snapped connection point, or -1 if no snap. */
  readonly snappedIndex: number;
  /** Distance from cursor to the snapped point (Infinity if no snap). */
  readonly distance: number;
}

// =============================================================================
// Built-in OOXML Guide Resolution
// =============================================================================

/**
 * Create built-in OOXML guide variables for a given width/height.
 * (ECMA-376 Section 20.1.9.11)
 */
function createBuiltInGuides(width: number, height: number): Map<string, number> {
  const vars = new Map<string, number>();

  vars.set('w', width);
  vars.set('h', height);
  vars.set('wd2', width / 2);
  vars.set('hd2', height / 2);
  vars.set('wd4', width / 4);
  vars.set('hd4', height / 4);
  vars.set('wd5', width / 5);
  vars.set('hd5', height / 5);
  vars.set('wd6', width / 6);
  vars.set('hd6', height / 6);
  vars.set('wd8', width / 8);
  vars.set('hd8', height / 8);
  vars.set('wd10', width / 10);
  vars.set('hd10', height / 10);
  vars.set('wd12', width / 12);
  vars.set('wd32', width / 32);
  vars.set('hd32', height / 32);
  vars.set('l', 0);
  vars.set('t', 0);
  vars.set('r', width);
  vars.set('b', height);
  vars.set('hc', width / 2);
  vars.set('vc', height / 2);
  vars.set('ss', Math.min(width, height));
  vars.set('ls', Math.max(width, height));
  vars.set('ssd2', Math.min(width, height) / 2);
  vars.set('ssd4', Math.min(width, height) / 4);
  vars.set('ssd6', Math.min(width, height) / 6);
  vars.set('ssd8', Math.min(width, height) / 8);
  vars.set('ssd16', Math.min(width, height) / 16);
  vars.set('ssd32', Math.min(width, height) / 32);

  // OOXML angle constants (60000ths of a degree)
  vars.set('cd2', 10800000);
  vars.set('cd4', 5400000);
  vars.set('cd8', 2700000);
  vars.set('3cd4', 16200000);
  vars.set('3cd8', 8100000);
  vars.set('5cd8', 13500000);
  vars.set('7cd8', 18900000);

  return vars;
}

/**
 * Resolve a guide reference to a numeric value.
 * Tries numeric literal first, then looks up in the guide map.
 */
function resolveGuideRef(ref: string, guideMap: Map<string, number>): number {
  const num = Number(ref);
  if (!isNaN(num)) return num;
  return guideMap.get(ref) ?? 0;
}

// =============================================================================
// Guide Formula Evaluation
// =============================================================================

/**
 * Evaluate a single OOXML guide formula.
 *
 * Supports the common formula operations used in preset shape definitions.
 */
function evaluateFormula(fmla: string, vars: Map<string, number>): number {
  const parts = fmla.trim().split(/\s+/);
  const op = parts[0];

  const resolve = (s: string): number => {
    const n = Number(s);
    if (!isNaN(n)) return n;
    return vars.get(s) ?? 0;
  };

  switch (op) {
    case 'val':
      return resolve(parts[1]);
    case '*/': {
      const a = resolve(parts[1]);
      const b = resolve(parts[2]);
      const c = resolve(parts[3]);
      return c === 0 ? 0 : (a * b) / c;
    }
    case '+-': {
      const a = resolve(parts[1]);
      const b = resolve(parts[2]);
      const c = resolve(parts[3]);
      return a + b - c;
    }
    case '+/': {
      const a = resolve(parts[1]);
      const b = resolve(parts[2]);
      const c = resolve(parts[3]);
      return c === 0 ? 0 : (a + b) / c;
    }
    case '?:': {
      const a = resolve(parts[1]);
      const b = resolve(parts[2]);
      const c = resolve(parts[3]);
      return a > 0 ? b : c;
    }
    case 'min':
      return Math.min(resolve(parts[1]), resolve(parts[2]));
    case 'max':
      return Math.max(resolve(parts[1]), resolve(parts[2]));
    case 'abs':
      return Math.abs(resolve(parts[1]));
    case 'sqrt':
      return Math.sqrt(Math.max(0, resolve(parts[1])));
    case 'at2': {
      const x = resolve(parts[1]);
      const y = resolve(parts[2]);
      return (Math.atan2(y, x) * 10800000) / Math.PI;
    }
    case 'sin': {
      const val = resolve(parts[1]);
      const ang = resolve(parts[2]);
      return val * Math.sin((ang * Math.PI) / 10800000);
    }
    case 'cos': {
      const val = resolve(parts[1]);
      const ang = resolve(parts[2]);
      return val * Math.cos((ang * Math.PI) / 10800000);
    }
    case 'tan': {
      const val = resolve(parts[1]);
      const ang = resolve(parts[2]);
      return val * Math.tan((ang * Math.PI) / 10800000);
    }
    case 'cat2': {
      const x = resolve(parts[1]);
      const y = resolve(parts[2]);
      const z = resolve(parts[3]);
      return x * Math.cos(Math.atan2(z, y));
    }
    case 'sat2': {
      const x = resolve(parts[1]);
      const y = resolve(parts[2]);
      const z = resolve(parts[3]);
      return x * Math.sin(Math.atan2(z, y));
    }
    case 'mod': {
      const a = resolve(parts[1]);
      const b = resolve(parts[2]);
      const c = resolve(parts[3]);
      return Math.sqrt(a * a + b * b + c * c);
    }
    case 'pin': {
      const a = resolve(parts[1]);
      const b = resolve(parts[2]);
      const c = resolve(parts[3]);
      return Math.max(a, Math.min(b, c));
    }
    default:
      return 0;
  }
}

/**
 * Evaluate all guides (adjustment defaults + geometry) for a shape at given dimensions.
 */
function evaluateShapeGuides(
  data: ShapeConnectionData,
  width: number,
  height: number,
): Map<string, number> {
  const vars = createBuiltInGuides(width, height);

  // Evaluate adjustment guides (using their default values)
  for (const av of data.avLst) {
    vars.set(av.name, evaluateFormula(av.fmla, vars));
  }

  // Evaluate geometry guides (order matters -- each may reference previous ones)
  for (const gd of data.gdLst) {
    vars.set(gd.name, evaluateFormula(gd.fmla, vars));
  }

  return vars;
}

// =============================================================================
// Connection Point Resolution
// =============================================================================

/**
 * Resolve connection points from shape connection data to pixel-space positions.
 *
 * @param data - The shape's connection point data (avLst, gdLst, cxnLst).
 * @param bounds - The shape's bounding box in pixel coordinates.
 * @returns Array of resolved connection points in absolute pixel coordinates.
 */
export function resolveConnectionPoints(data: ShapeConnectionData, bounds: BoundingBox): Point2D[] {
  if (data.cxnLst.length === 0) return [];

  const guideMap = evaluateShapeGuides(data, bounds.width, bounds.height);

  return data.cxnLst.map((cxn) => ({
    x: bounds.x + resolveGuideRef(cxn.x, guideMap),
    y: bounds.y + resolveGuideRef(cxn.y, guideMap),
  }));
}

/**
 * Resolve connection points with index metadata.
 *
 * Same as resolveConnectionPoints but returns ConnectionPointInfo objects
 * that include the index of each point in the cxnLst, useful for
 * identifying which connection point was snapped to.
 */
export function resolveConnectionPointsWithInfo(
  data: ShapeConnectionData,
  bounds: BoundingBox,
): ConnectionPointInfo[] {
  if (data.cxnLst.length === 0) return [];

  const guideMap = evaluateShapeGuides(data, bounds.width, bounds.height);

  return data.cxnLst.map((cxn, index) => ({
    point: {
      x: bounds.x + resolveGuideRef(cxn.x, guideMap),
      y: bounds.y + resolveGuideRef(cxn.y, guideMap),
    },
    index,
  }));
}

// =============================================================================
// Snap-to-Nearest Logic
// =============================================================================

/** Default snap radius in CSS pixels. */
export const DEFAULT_SNAP_RADIUS = 15;

/**
 * Find the nearest connection point to a cursor position within a snap radius.
 *
 * @param cursorPos - The current cursor position in pixel space.
 * @param connectionPoints - Array of connection point positions.
 * @param snapRadius - Maximum distance in pixels for snapping (default: 15).
 * @returns SnapResult with the snapped point (or null if none in range).
 */
export function snapToNearestConnectionPoint(
  cursorPos: Point2D,
  connectionPoints: ReadonlyArray<Point2D>,
  snapRadius: number = DEFAULT_SNAP_RADIUS,
): SnapResult {
  let bestDist = Infinity;
  let bestIndex = -1;
  let bestPoint: Point2D | null = null;

  const snapRadiusSq = snapRadius * snapRadius;

  for (let i = 0; i < connectionPoints.length; i++) {
    const pt = connectionPoints[i];
    const dx = pt.x - cursorPos.x;
    const dy = pt.y - cursorPos.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDist && distSq <= snapRadiusSq) {
      bestDist = distSq;
      bestIndex = i;
      bestPoint = pt;
    }
  }

  return {
    snappedPoint: bestPoint,
    snappedIndex: bestIndex,
    distance: bestPoint ? Math.sqrt(bestDist) : Infinity,
  };
}
