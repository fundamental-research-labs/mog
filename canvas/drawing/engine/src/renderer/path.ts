/**
 * Path rendering primitives.
 *
 * Replays Path segments as Canvas2D drawing commands and builds Path2D
 * objects for hit testing. These are leaf-level primitives consumed by
 * Canvas/SVG orchestrators.
 */
import { PathOps } from '@mog/geometry';
import type { Path, PathSegment } from '@mog-sdk/contracts/geometry';

// ─── Segment Replay ─────────────────────────────────────────────────────────

/**
 * Replay a single PathSegment as a Canvas2D drawing command.
 */
function replaySegment(seg: PathSegment, ctx: CanvasRenderingContext2D): void {
  switch (seg.type) {
    case 'M':
      ctx.moveTo(seg.x, seg.y);
      break;
    case 'L':
      ctx.lineTo(seg.x, seg.y);
      break;
    case 'C':
      ctx.bezierCurveTo(seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y);
      break;
    case 'Q':
      ctx.quadraticCurveTo(seg.x1, seg.y1, seg.x, seg.y);
      break;
    case 'Z':
      ctx.closePath();
      break;
  }
}

/**
 * Replay a Path's segments as Canvas2D drawing commands.
 * Does NOT call beginPath/closePath/fill/stroke -- caller manages those.
 */
export function replayPathToCanvas(path: Path, ctx: CanvasRenderingContext2D): void {
  for (const seg of path.segments) {
    replaySegment(seg, ctx);
  }

  // Also handle subPaths if present
  if (path.subPaths) {
    for (const subPath of path.subPaths) {
      for (const seg of subPath.segments) {
        replaySegment(seg, ctx);
      }
    }
  }
}

// ─── Path2D Construction ────────────────────────────────────────────────────

/**
 * Build a Path2D from a Path, for use with ctx.isPointInPath() hit testing.
 * Uses geometry's pathToSvgString for construction.
 */
export function pathToPath2D(path: Path): Path2D {
  const svgString = PathOps.pathToSvgString(path);
  return new Path2D(svgString);
}

// ─── Bounding Box ───────────────────────────────────────────────────────────

/**
 * Collect all x/y coordinates from a list of segments (endpoints + control points).
 */
function collectSegmentCoords(segments: PathSegment[], xs: number[], ys: number[]): void {
  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
      case 'L':
        xs.push(seg.x);
        ys.push(seg.y);
        break;
      case 'C':
        xs.push(seg.x1, seg.x2, seg.x);
        ys.push(seg.y1, seg.y2, seg.y);
        break;
      case 'Q':
        xs.push(seg.x1, seg.x);
        ys.push(seg.y1, seg.y);
        break;
      case 'Z':
        // No coordinates
        break;
    }
  }
}

/**
 * Compute axis-aligned bounding box of a Path by scanning all segment
 * endpoints and control points.
 *
 * For cubic (C) and quadratic (Q) segments, control points are included
 * in the bounds calculation. This is conservative (the true tight bounds
 * could be smaller) but simple and sufficient for hit-test culling.
 */
export function computePathBounds(path: Path): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];

  collectSegmentCoords(path.segments, xs, ys);

  if (path.subPaths) {
    for (const subPath of path.subPaths) {
      collectSegmentCoords(subPath.segments, xs, ys);
    }
  }

  if (xs.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
