/**
 * Custom geometry support.
 *
 * Handles user-drawn and OOXML custom geometry paths
 * that are not part of the standard preset library.
 *
 * Implements OOXML guide formula evaluation (ECMA-376 Section 20.1.9.11)
 * and conversion from OOXML GeometryPathCommand to internal numeric format.
 */
import { PathOps } from '@mog/geometry';
import type { Path, PathSegment, SubPath } from '@mog-sdk/contracts/geometry';
import type { GeometryGuide, GeometryPath, GeometryPathCommand } from '@mog-sdk/contracts/diagram';

/** A guide value in OOXML custom geometry. */
export interface CustomGuide {
  name: string;
  formula: string;
  value?: number;
}

/** A path definition in OOXML custom geometry. */
export interface CustomPath {
  width?: number;
  height?: number;
  fill?: 'norm' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess' | 'none';
  stroke?: boolean;
  commands: CustomPathCommand[];
}

export type CustomPathCommand =
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'cubicBezTo'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'quadBezTo'; x1: number; y1: number; x: number; y: number }
  | { type: 'arcTo'; rx: number; ry: number; startAngle: number; sweepAngle: number }
  | { type: 'close' };

// =============================================================================
// Guide Formula Evaluator (ECMA-376 Section 20.1.9.11)
// =============================================================================

/**
 * Evaluate OOXML guide formulas and return a map of guide name -> computed value.
 *
 * Guide formulas follow the format: `"operation arg1 arg2 [arg3]"` where args can be:
 * - A number literal
 * - A guide name (reference to a previously computed guide value)
 * - A built-in variable (w, h, wd2, hd2, l, t, r, b, ss, ls)
 *
 * Guides are evaluated in order; each guide can reference any previously computed guide.
 *
 * @param guides - Guide definitions with formula strings
 * @param width - Shape width in EMUs
 * @param height - Shape height in EMUs
 * @returns Map of guide name to computed numeric value
 */
export function evaluateGuides(
  guides: Array<CustomGuide | GeometryGuide>,
  width: number,
  height: number,
): Map<string, number> {
  const vars = new Map<string, number>();

  // Built-in variables (ECMA-376 Section 20.1.9.11)
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
  // OOXML constants for angles in 60000ths of a degree
  vars.set('cd2', 10800000); // 180 degrees
  vars.set('cd4', 5400000); // 90 degrees
  vars.set('cd8', 2700000); // 45 degrees
  vars.set('3cd4', 16200000); // 270 degrees
  vars.set('3cd8', 8100000); // 135 degrees
  vars.set('5cd8', 13500000); // 225 degrees
  vars.set('7cd8', 18900000); // 315 degrees

  /** Resolve a formula argument: number literal or variable name. */
  function resolveArg(arg: string): number {
    const num = Number(arg);
    if (!isNaN(num)) return num;
    return vars.get(arg) ?? 0;
  }

  /** Convert OOXML angle (60000ths of a degree) to radians. */
  function ooxml60kToRad(val: number): number {
    return (val * Math.PI) / (180 * 60000);
  }

  /** Convert radians to OOXML angle (60000ths of a degree). */
  function radToOoxml60k(rad: number): number {
    return (rad * 180 * 60000) / Math.PI;
  }

  for (const guide of guides) {
    const formula = guide.formula.trim();
    const parts = formula.split(/\s+/);
    const op = parts[0];
    const a = parts[1] !== undefined ? resolveArg(parts[1]) : 0;
    const b = parts[2] !== undefined ? resolveArg(parts[2]) : 0;
    const c = parts[3] !== undefined ? resolveArg(parts[3]) : 0;

    let result: number;

    switch (op) {
      case 'val':
        result = a;
        break;
      case '*/':
        // multiply-divide: a * b / c
        result = c !== 0 ? (a * b) / c : 0;
        break;
      case '+-':
        // add-subtract: a + b - c
        result = a + b - c;
        break;
      case '+/':
        // add-divide: (a + b) / c
        result = c !== 0 ? (a + b) / c : 0;
        break;
      case 'sin':
        // a * sin(b) where b is in 60000ths of a degree
        result = a * Math.sin(ooxml60kToRad(b));
        break;
      case 'cos':
        // a * cos(b) where b is in 60000ths of a degree
        result = a * Math.cos(ooxml60kToRad(b));
        break;
      case 'tan':
        // a * tan(b) where b is in 60000ths of a degree
        result = a * Math.tan(ooxml60kToRad(b));
        break;
      case 'at2':
        // atan2 result in 60000ths of a degree
        // ECMA-376: at2 x y -> atan2(y, x) — first formula arg is x, second is y
        result = radToOoxml60k(Math.atan2(b, a));
        break;
      case 'cat2':
        // a * cos(atan2(y, x)) where formula args are: a=scale, b=x, c=y
        result = a * Math.cos(Math.atan2(c, b));
        break;
      case 'sat2':
        // a * sin(atan2(y, x)) where formula args are: a=scale, b=x, c=y
        result = a * Math.sin(Math.atan2(c, b));
        break;
      case '?:':
        // if-else: if a > 0 then b else c
        result = a > 0 ? b : c;
        break;
      case 'min':
        result = Math.min(a, b);
        break;
      case 'max':
        result = Math.max(a, b);
        break;
      case 'abs':
        result = Math.abs(a);
        break;
      case 'sqrt':
        result = Math.sqrt(Math.abs(a));
        break;
      case 'mod':
        // modulus: sqrt(a^2 + b^2 + c^2)
        result = Math.sqrt(a * a + b * b + c * c);
        break;
      case 'pin':
        // clamp: if b < a then a, else if b > c then c, else b
        result = b < a ? a : b > c ? c : b;
        break;
      default:
        // If the guide has a value override (CustomGuide), use it.
        // Otherwise fall back to 0 for unrecognized operations.
        result =
          'value' in guide && (guide as CustomGuide).value != null
            ? (guide as CustomGuide).value!
            : 0;
        break;
    }

    vars.set(guide.name, result);
  }

  return vars;
}

// =============================================================================
// OOXML Path Command Resolver
// =============================================================================

/**
 * Convert OOXML GeometryPathCommand[] to internal CustomPathCommand[].
 *
 * OOXML path commands use string coordinates that may reference guide names.
 * This resolver converts them to numeric coordinates using the guide map.
 *
 * @param commands - OOXML geometry path commands with string coordinates
 * @param guideMap - Map of guide name to computed numeric value
 * @returns Internal numeric path commands
 */
export function resolveOoxmlPath(
  commands: GeometryPathCommand[],
  guideMap: Map<string, number>,
): CustomPathCommand[] {
  /** Resolve a string coordinate: number literal or guide name. */
  function resolveCoord(coord: string): number {
    const num = Number(coord);
    if (!isNaN(num)) return num;
    return guideMap.get(coord) ?? 0;
  }

  return commands.map((cmd): CustomPathCommand => {
    switch (cmd.type) {
      case 'moveTo':
        return { type: 'moveTo', x: resolveCoord(cmd.x), y: resolveCoord(cmd.y) };
      case 'lineTo':
        return { type: 'lineTo', x: resolveCoord(cmd.x), y: resolveCoord(cmd.y) };
      case 'cubicBezTo':
        return {
          type: 'cubicBezTo',
          x1: resolveCoord(cmd.x1),
          y1: resolveCoord(cmd.y1),
          x2: resolveCoord(cmd.x2),
          y2: resolveCoord(cmd.y2),
          // OOXML uses x3/y3 for the endpoint; map to internal x/y
          x: resolveCoord(cmd.x3),
          y: resolveCoord(cmd.y3),
        };
      case 'quadBezTo':
        return {
          type: 'quadBezTo',
          x1: resolveCoord(cmd.x1),
          y1: resolveCoord(cmd.y1),
          // OOXML uses x2/y2 for the endpoint; map to internal x/y
          x: resolveCoord(cmd.x2),
          y: resolveCoord(cmd.y2),
        };
      case 'arcTo':
        return {
          type: 'arcTo',
          // OOXML uses wR/hR for radii, stAng/swAng for angles
          rx: resolveCoord(cmd.wR),
          ry: resolveCoord(cmd.hR),
          startAngle: resolveCoord(cmd.stAng),
          sweepAngle: resolveCoord(cmd.swAng),
        };
      case 'close':
        return { type: 'close' };
    }
  });
}

/**
 * Convert OOXML GeometryPath[] to internal CustomPath[] using a guide map.
 *
 * Convenience function that resolves an entire OOXML path list at once.
 *
 * @param ooxmlPaths - OOXML geometry paths with string coordinates
 * @param guideMap - Map of guide name to computed numeric value
 * @returns Internal custom paths with numeric coordinates
 */
export function resolveOoxmlPaths(
  ooxmlPaths: GeometryPath[],
  guideMap: Map<string, number>,
): CustomPath[] {
  return ooxmlPaths.map((p) => ({
    width: p.w,
    height: p.h,
    fill: p.fill,
    stroke: p.stroke,
    commands: resolveOoxmlPath(p.commands, guideMap),
  }));
}

// =============================================================================
// SVG Path Parsing
// =============================================================================

/**
 * Parse an SVG-style path data string into a Path.
 * Delegates to the geometry package's SVG path parser.
 */
export function parseCustomGeometry(pathData: string): Path {
  return PathOps.parseSvgPath(pathData);
}

// =============================================================================
// Core Path Conversion
// =============================================================================

/** Options for customGeometryToPath. */
export interface CustomGeometryOptions {
  /** Shape width in EMUs (used for guide formula evaluation). */
  width?: number;
  /** Shape height in EMUs (used for guide formula evaluation). */
  height?: number;
  /** Target width to scale output coordinates to. If omitted, normalizes to [0,1]. */
  targetWidth?: number;
  /** Target height to scale output coordinates to. If omitted, normalizes to [0,1]. */
  targetHeight?: number;
}

/**
 * Convert OOXML custom geometry guides and paths into a Path.
 *
 * Guide formulas are fully evaluated using the shape width/height, allowing
 * path coordinates to reference computed guide values.
 *
 * @param guides - Guide definitions with formulas
 * @param paths - Path definitions with commands
 * @param options - Optional shape dimensions and target scaling
 * @returns Combined Path
 */
export function customGeometryToPath(
  guides: CustomGuide[],
  paths: CustomPath[],
  options?: CustomGeometryOptions,
): Path {
  const shapeWidth = options?.width ?? 1;
  const shapeHeight = options?.height ?? 1;

  // ISSUE 1 FIX: Evaluate guide formulas instead of just using static values.
  evaluateGuides(guides, shapeWidth, shapeHeight);

  const allSegments: PathSegment[] = [];
  let currentX = 0;
  let currentY = 0;

  for (const p of paths) {
    // Determine the coordinate space for this path.
    // If targetWidth/targetHeight are provided, scale to those dimensions.
    // Otherwise, normalize to [0,1] by dividing by path dimensions (backward compatible).
    const pathW = p.width ?? shapeWidth;
    const pathH = p.height ?? shapeHeight;

    let scaleX: number;
    let scaleY: number;

    if (options?.targetWidth != null && options?.targetHeight != null) {
      // ISSUE 4 FIX: Scale to target dimensions
      scaleX = pathW !== 0 ? options.targetWidth / pathW : 1;
      scaleY = pathH !== 0 ? options.targetHeight / pathH : 1;
    } else {
      // Backward compatible: normalize to [0,1]
      scaleX = pathW !== 0 ? 1 / pathW : 1;
      scaleY = pathH !== 0 ? 1 / pathH : 1;
    }

    for (const cmd of p.commands) {
      switch (cmd.type) {
        case 'moveTo':
          allSegments.push({ type: 'M', x: cmd.x * scaleX, y: cmd.y * scaleY });
          currentX = cmd.x * scaleX;
          currentY = cmd.y * scaleY;
          break;
        case 'lineTo':
          allSegments.push({ type: 'L', x: cmd.x * scaleX, y: cmd.y * scaleY });
          currentX = cmd.x * scaleX;
          currentY = cmd.y * scaleY;
          break;
        case 'cubicBezTo':
          allSegments.push({
            type: 'C',
            x1: cmd.x1 * scaleX,
            y1: cmd.y1 * scaleY,
            x2: cmd.x2 * scaleX,
            y2: cmd.y2 * scaleY,
            x: cmd.x * scaleX,
            y: cmd.y * scaleY,
          });
          currentX = cmd.x * scaleX;
          currentY = cmd.y * scaleY;
          break;
        case 'quadBezTo':
          allSegments.push({
            type: 'Q',
            x1: cmd.x1 * scaleX,
            y1: cmd.y1 * scaleY,
            x: cmd.x * scaleX,
            y: cmd.y * scaleY,
          });
          currentX = cmd.x * scaleX;
          currentY = cmd.y * scaleY;
          break;
        case 'arcTo': {
          // OOXML angles are in 60000ths of a degree
          const startVisual = (cmd.startAngle * Math.PI) / (180 * 60000);
          const sweepVisual = (cmd.sweepAngle * Math.PI) / (180 * 60000);
          const rx = cmd.rx * scaleX;
          const ry = cmd.ry * scaleY;

          if (rx === 0 || ry === 0) {
            // Degenerate ellipse — nothing to draw
            break;
          }

          // OOXML arcTo angles are "visual" (geometric) angles — the actual
          // angle of the ray from ellipse center to the point on the ellipse.
          // The parametric form x=rx*cos(t), y=ry*sin(t) uses a different angle t.
          // Convert: parametric t = atan2(rx*sin(visual), ry*cos(visual)).
          // For circles (rx=ry) this is an identity.
          const startT = Math.atan2(rx * Math.sin(startVisual), ry * Math.cos(startVisual));
          const endVisual = startVisual + sweepVisual;
          const endT = Math.atan2(rx * Math.sin(endVisual), ry * Math.cos(endVisual));

          // Compute arc center from current point at parametric angle startT
          const cx = currentX - rx * Math.cos(startT);
          const cy = currentY - ry * Math.sin(startT);

          // Compute parametric sweep, preserving direction of visual sweep
          let paramSweep = endT - startT;
          if (sweepVisual > 0 && paramSweep < 0) paramSweep += 2 * Math.PI;
          else if (sweepVisual < 0 && paramSweep > 0) paramSweep -= 2 * Math.PI;

          // Approximate the arc with cubic Bezier segments (at most 90 degrees each)
          const numSegments = Math.max(1, Math.ceil(Math.abs(paramSweep) / (Math.PI / 2)));
          const segmentSweep = paramSweep / numSegments;

          let angle = startT;
          for (let s = 0; s < numSegments; s++) {
            const nextAngle = angle + segmentSweep;

            // Standard arc-to-cubic-bezier approximation
            // See: http://www.tinaja.com/glib/ellipse4.pdf
            const alpha = (4 / 3) * Math.tan(segmentSweep / 4);

            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            const cosB = Math.cos(nextAngle);
            const sinB = Math.sin(nextAngle);

            const p1x = cx + rx * (cosA - alpha * sinA);
            const p1y = cy + ry * (sinA + alpha * cosA);
            const p2x = cx + rx * (cosB + alpha * sinB);
            const p2y = cy + ry * (sinB - alpha * cosB);
            const p3x = cx + rx * cosB;
            const p3y = cy + ry * sinB;

            allSegments.push({
              type: 'C',
              x1: p1x,
              y1: p1y,
              x2: p2x,
              y2: p2y,
              x: p3x,
              y: p3y,
            });

            angle = nextAngle;
            currentX = p3x;
            currentY = p3y;
          }
          break;
        }
        case 'close':
          allSegments.push({ type: 'Z' });
          break;
      }
    }
  }

  // ISSUE 3 FIX: Determine `closed` based on whether the last segment is a close command,
  // rather than setting it to true the first time any close is encountered.
  const closed = allSegments.length > 0 && allSegments[allSegments.length - 1].type === 'Z';

  // Build per-subpath closed tracking for compound paths
  const subPaths: SubPath[] = [];
  let currentSubPathSegments: PathSegment[] = [];

  for (const segment of allSegments) {
    if (segment.type === 'M' && currentSubPathSegments.length > 0) {
      const subClosed =
        currentSubPathSegments.length > 0 &&
        currentSubPathSegments[currentSubPathSegments.length - 1].type === 'Z';
      subPaths.push({ segments: currentSubPathSegments, closed: subClosed });
      currentSubPathSegments = [];
    }
    currentSubPathSegments.push(segment);
  }

  if (currentSubPathSegments.length > 0) {
    const subClosed = currentSubPathSegments[currentSubPathSegments.length - 1].type === 'Z';
    subPaths.push({ segments: currentSubPathSegments, closed: subClosed });
  }

  return { segments: allSegments, closed, subPaths };
}
