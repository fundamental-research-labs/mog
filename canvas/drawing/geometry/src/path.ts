/**
 * Path operations.
 *
 * Path builder, SVG path parsing/serialization, path metrics,
 * and path transformation.
 */
import type {
  AffineTransform,
  BoundingBox,
  Path,
  PathSegment,
  Point2D,
  SubPath,
  Vector2D,
} from '@mog-sdk/contracts/geometry';
import {
  cubicBoundingBox,
  cubicDerivative,
  cubicLength,
  evaluateCubic,
  evaluateQuadratic,
  quadraticBoundingBox,
  quadraticDerivative,
  quadraticLength,
} from './bezier';
import { transformPoint } from './matrix';
import * as Rect from './rect';

// ─── Path Builder ────────────────────────────────────────────────────────────

export interface PathBuilder {
  moveTo(x: number, y: number): PathBuilder;
  lineTo(x: number, y: number): PathBuilder;
  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): PathBuilder;
  quadTo(x1: number, y1: number, x: number, y: number): PathBuilder;
  closePath(): PathBuilder;
  toPath(): Path;
}

/** Create a path builder. */
export function createPath(): PathBuilder {
  const segments: PathSegment[] = [];

  const builder: PathBuilder = {
    moveTo(x: number, y: number) {
      segments.push({ type: 'M', x, y });
      return builder;
    },
    lineTo(x: number, y: number) {
      segments.push({ type: 'L', x, y });
      return builder;
    },
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
      segments.push({ type: 'C', x1, y1, x2, y2, x, y });
      return builder;
    },
    quadTo(x1: number, y1: number, x: number, y: number) {
      segments.push({ type: 'Q', x1, y1, x, y });
      return builder;
    },
    closePath() {
      segments.push({ type: 'Z' });
      return builder;
    },
    toPath() {
      const closed = segments.length > 0 && segments[segments.length - 1].type === 'Z';
      return { segments: [...segments], closed };
    },
  };

  return builder;
}

// ─── SVG Path Parsing ────────────────────────────────────────────────────────

/**
 * Parse an SVG path data string into a Path.
 * Supports: M, L, C, Q, Z (uppercase = absolute only).
 * Also supports lowercase relative commands: m, l, c, q, z.
 */
export function parseSvgPath(d: string): Path {
  const segments: PathSegment[] = [];

  // Tokenize: split into commands and numbers
  const tokens: string[] = [];
  // Match command letters or numbers (including negative, decimal)
  const regex = /([MLCQZHVSTAmlcqzhvsta])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(d)) !== null) {
    tokens.push(match[0]);
  }

  let i = 0;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  // Track last control points for smooth curve commands (S/T)
  let lastCubicX2 = 0;
  let lastCubicY2 = 0;
  let lastCmd = '';
  let lastQuadX1 = 0;
  let lastQuadY1 = 0;

  function nextNum(): number {
    if (i >= tokens.length) return 0;
    return parseFloat(tokens[i++]);
  }

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (/^[MLCQZHVSTAmlcqzhvsta]$/.test(cmd)) {
      i++;
      switch (cmd) {
        case 'M': {
          const x = nextNum();
          const y = nextNum();
          segments.push({ type: 'M', x, y });
          currentX = x;
          currentY = y;
          startX = x;
          startY = y;
          lastCmd = 'M';
          // Subsequent coordinate pairs are treated as implicit LineTo
          while (i < tokens.length && /^[-.\d]/.test(tokens[i])) {
            const lx = nextNum();
            const ly = nextNum();
            segments.push({ type: 'L', x: lx, y: ly });
            currentX = lx;
            currentY = ly;
            lastCmd = 'L';
          }
          break;
        }
        case 'm': {
          const dx = nextNum();
          const dy = nextNum();
          const x = currentX + dx;
          const y = currentY + dy;
          segments.push({ type: 'M', x, y });
          currentX = x;
          currentY = y;
          startX = x;
          startY = y;
          lastCmd = 'm';
          while (i < tokens.length && /^[-.\d]/.test(tokens[i])) {
            const dlx = nextNum();
            const dly = nextNum();
            const lx = currentX + dlx;
            const ly = currentY + dly;
            segments.push({ type: 'L', x: lx, y: ly });
            currentX = lx;
            currentY = ly;
            lastCmd = 'l';
          }
          break;
        }
        case 'L': {
          do {
            const x = nextNum();
            const y = nextNum();
            segments.push({ type: 'L', x, y });
            currentX = x;
            currentY = y;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'L';
          break;
        }
        case 'l': {
          do {
            const dx = nextNum();
            const dy = nextNum();
            const x = currentX + dx;
            const y = currentY + dy;
            segments.push({ type: 'L', x, y });
            currentX = x;
            currentY = y;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'l';
          break;
        }
        case 'C': {
          do {
            const x1 = nextNum();
            const y1 = nextNum();
            const x2 = nextNum();
            const y2 = nextNum();
            const x = nextNum();
            const y = nextNum();
            segments.push({ type: 'C', x1, y1, x2, y2, x, y });
            lastCubicX2 = x2;
            lastCubicY2 = y2;
            currentX = x;
            currentY = y;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'C';
          break;
        }
        case 'c': {
          do {
            const dx1 = nextNum();
            const dy1 = nextNum();
            const dx2 = nextNum();
            const dy2 = nextNum();
            const dx = nextNum();
            const dy = nextNum();
            const x2 = currentX + dx2;
            const y2 = currentY + dy2;
            segments.push({
              type: 'C',
              x1: currentX + dx1,
              y1: currentY + dy1,
              x2,
              y2,
              x: currentX + dx,
              y: currentY + dy,
            });
            lastCubicX2 = x2;
            lastCubicY2 = y2;
            currentX += dx;
            currentY += dy;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'c';
          break;
        }
        case 'Q': {
          do {
            const x1 = nextNum();
            const y1 = nextNum();
            const x = nextNum();
            const y = nextNum();
            segments.push({ type: 'Q', x1, y1, x, y });
            lastQuadX1 = x1;
            lastQuadY1 = y1;
            currentX = x;
            currentY = y;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'Q';
          break;
        }
        case 'q': {
          do {
            const dx1 = nextNum();
            const dy1 = nextNum();
            const dx = nextNum();
            const dy = nextNum();
            const x1 = currentX + dx1;
            const y1 = currentY + dy1;
            segments.push({
              type: 'Q',
              x1,
              y1,
              x: currentX + dx,
              y: currentY + dy,
            });
            lastQuadX1 = x1;
            lastQuadY1 = y1;
            currentX += dx;
            currentY += dy;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'q';
          break;
        }
        case 'H': {
          do {
            const x = nextNum();
            segments.push({ type: 'L', x, y: currentY });
            currentX = x;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'H';
          break;
        }
        case 'h': {
          do {
            const dx = nextNum();
            const x = currentX + dx;
            segments.push({ type: 'L', x, y: currentY });
            currentX = x;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'h';
          break;
        }
        case 'V': {
          do {
            const y = nextNum();
            segments.push({ type: 'L', x: currentX, y });
            currentY = y;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'V';
          break;
        }
        case 'v': {
          do {
            const dy = nextNum();
            const y = currentY + dy;
            segments.push({ type: 'L', x: currentX, y });
            currentY = y;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'v';
          break;
        }
        case 'Z':
        case 'z':
          segments.push({ type: 'Z' });
          currentX = startX;
          currentY = startY;
          lastCmd = 'Z';
          break;
        case 'S': {
          do {
            // Reflect previous cubic control point across current point
            let x1: number;
            let y1: number;
            if (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's') {
              x1 = 2 * currentX - lastCubicX2;
              y1 = 2 * currentY - lastCubicY2;
            } else {
              x1 = currentX;
              y1 = currentY;
            }
            const x2 = nextNum();
            const y2 = nextNum();
            const x = nextNum();
            const y = nextNum();
            segments.push({ type: 'C', x1, y1, x2, y2, x, y });
            lastCubicX2 = x2;
            lastCubicY2 = y2;
            currentX = x;
            currentY = y;
            lastCmd = 'S';
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          break;
        }
        case 's': {
          do {
            let x1: number;
            let y1: number;
            if (lastCmd === 'C' || lastCmd === 'c' || lastCmd === 'S' || lastCmd === 's') {
              x1 = 2 * currentX - lastCubicX2;
              y1 = 2 * currentY - lastCubicY2;
            } else {
              x1 = currentX;
              y1 = currentY;
            }
            const dx2 = nextNum();
            const dy2 = nextNum();
            const dx = nextNum();
            const dy = nextNum();
            const x2 = currentX + dx2;
            const y2 = currentY + dy2;
            const x = currentX + dx;
            const y = currentY + dy;
            segments.push({ type: 'C', x1, y1, x2, y2, x, y });
            lastCubicX2 = x2;
            lastCubicY2 = y2;
            currentX = x;
            currentY = y;
            lastCmd = 's';
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          break;
        }
        case 'T': {
          do {
            let x1: number;
            let y1: number;
            if (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't') {
              x1 = 2 * currentX - lastQuadX1;
              y1 = 2 * currentY - lastQuadY1;
            } else {
              x1 = currentX;
              y1 = currentY;
            }
            const x = nextNum();
            const y = nextNum();
            segments.push({ type: 'Q', x1, y1, x, y });
            lastQuadX1 = x1;
            lastQuadY1 = y1;
            currentX = x;
            currentY = y;
            lastCmd = 'T';
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          break;
        }
        case 't': {
          do {
            let x1: number;
            let y1: number;
            if (lastCmd === 'Q' || lastCmd === 'q' || lastCmd === 'T' || lastCmd === 't') {
              x1 = 2 * currentX - lastQuadX1;
              y1 = 2 * currentY - lastQuadY1;
            } else {
              x1 = currentX;
              y1 = currentY;
            }
            const dx = nextNum();
            const dy = nextNum();
            const x = currentX + dx;
            const y = currentY + dy;
            segments.push({ type: 'Q', x1, y1, x, y });
            lastQuadX1 = x1;
            lastQuadY1 = y1;
            currentX = x;
            currentY = y;
            lastCmd = 't';
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          break;
        }
        case 'A': {
          // Arc: consume 7 parameters per segment (rx, ry, x-rotation, large-arc, sweep, x, y).
          // Full arc-to-bezier conversion is not yet implemented; emit a lineTo to the
          // endpoint so that position state stays correct for subsequent commands.
          do {
            nextNum(); // rx
            nextNum(); // ry
            nextNum(); // x-rotation
            nextNum(); // large-arc-flag
            nextNum(); // sweep-flag
            const x = nextNum();
            const y = nextNum();
            segments.push({ type: 'L', x, y });
            currentX = x;
            currentY = y;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'A';
          break;
        }
        case 'a': {
          // Relative arc: same 7 parameters, endpoint is relative.
          do {
            nextNum(); // rx
            nextNum(); // ry
            nextNum(); // x-rotation
            nextNum(); // large-arc-flag
            nextNum(); // sweep-flag
            const dx = nextNum();
            const dy = nextNum();
            const x = currentX + dx;
            const y = currentY + dy;
            segments.push({ type: 'L', x, y });
            currentX = x;
            currentY = y;
          } while (i < tokens.length && /^[-.\d]/.test(tokens[i]));
          lastCmd = 'a';
          break;
        }
      }
    } else {
      // Skip unknown token
      i++;
    }
  }

  const closed = segments.length > 0 && segments[segments.length - 1].type === 'Z';
  return { segments, closed };
}

/** Convert a Path to an SVG path data string. */
export function pathToSvgString(path: Path): string {
  return path.segments
    .map((seg) => {
      switch (seg.type) {
        case 'M':
          return `M ${seg.x} ${seg.y}`;
        case 'L':
          return `L ${seg.x} ${seg.y}`;
        case 'C':
          return `C ${seg.x1} ${seg.y1} ${seg.x2} ${seg.y2} ${seg.x} ${seg.y}`;
        case 'Q':
          return `Q ${seg.x1} ${seg.y1} ${seg.x} ${seg.y}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}

// ─── Path Metrics ────────────────────────────────────────────────────────────

/** Compute the bounding box of a path. */
export function pathBoundingBox(path: Path): BoundingBox {
  if (path.segments.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let result: BoundingBox | null = null;

  for (const seg of path.segments) {
    switch (seg.type) {
      case 'M': {
        const ptBox: BoundingBox = { x: seg.x, y: seg.y, width: 0, height: 0 };
        result = result ? Rect.union(result, ptBox) : ptBox;
        currentX = seg.x;
        currentY = seg.y;
        startX = seg.x;
        startY = seg.y;
        break;
      }
      case 'L': {
        const lineBox: BoundingBox = {
          x: Math.min(currentX, seg.x),
          y: Math.min(currentY, seg.y),
          width: Math.abs(seg.x - currentX),
          height: Math.abs(seg.y - currentY),
        };
        result = result ? Rect.union(result, lineBox) : lineBox;
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'C': {
        const cBox = cubicBoundingBox(
          { x: currentX, y: currentY },
          { x: seg.x1, y: seg.y1 },
          { x: seg.x2, y: seg.y2 },
          { x: seg.x, y: seg.y },
        );
        result = result ? Rect.union(result, cBox) : cBox;
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'Q': {
        const qBox = quadraticBoundingBox(
          { x: currentX, y: currentY },
          { x: seg.x1, y: seg.y1 },
          { x: seg.x, y: seg.y },
        );
        result = result ? Rect.union(result, qBox) : qBox;
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'Z': {
        // Close path draws an implicit line from current point back to start
        const lineBox: BoundingBox = {
          x: Math.min(currentX, startX),
          y: Math.min(currentY, startY),
          width: Math.abs(startX - currentX),
          height: Math.abs(startY - currentY),
        };
        result = result ? Rect.union(result, lineBox) : lineBox;
        currentX = startX;
        currentY = startY;
        break;
      }
    }
  }

  return result || { x: 0, y: 0, width: 0, height: 0 };
}

/** Compute the total arc length of a path. */
export function pathLength(path: Path): number {
  let total = 0;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  for (const seg of path.segments) {
    switch (seg.type) {
      case 'M':
        currentX = seg.x;
        currentY = seg.y;
        startX = seg.x;
        startY = seg.y;
        break;
      case 'L': {
        const dx = seg.x - currentX;
        const dy = seg.y - currentY;
        total += Math.sqrt(dx * dx + dy * dy);
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'C': {
        total += cubicLength(
          { x: currentX, y: currentY },
          { x: seg.x1, y: seg.y1 },
          { x: seg.x2, y: seg.y2 },
          { x: seg.x, y: seg.y },
        );
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'Q': {
        total += quadraticLength(
          { x: currentX, y: currentY },
          { x: seg.x1, y: seg.y1 },
          { x: seg.x, y: seg.y },
        );
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'Z': {
        const dx = startX - currentX;
        const dy = startY - currentY;
        total += Math.sqrt(dx * dx + dy * dy);
        currentX = startX;
        currentY = startY;
        break;
      }
    }
  }

  return total;
}

/** Get the point and tangent at a given arc length along the path. */
export function pointAtLength(
  path: Path,
  targetLength: number,
): { point: Point2D; tangent: Vector2D } {
  let accumulated = 0;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  if (path.segments.length === 0) {
    return { point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  }

  for (const seg of path.segments) {
    switch (seg.type) {
      case 'M':
        currentX = seg.x;
        currentY = seg.y;
        startX = seg.x;
        startY = seg.y;
        break;
      case 'L': {
        const dx = seg.x - currentX;
        const dy = seg.y - currentY;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        if (accumulated + segLen >= targetLength && segLen > 0) {
          const t = (targetLength - accumulated) / segLen;
          return {
            point: { x: currentX + dx * t, y: currentY + dy * t },
            tangent: segLen > 0 ? { x: dx / segLen, y: dy / segLen } : { x: 1, y: 0 },
          };
        }
        accumulated += segLen;
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'C': {
        const p0 = { x: currentX, y: currentY };
        const p1 = { x: seg.x1, y: seg.y1 };
        const p2 = { x: seg.x2, y: seg.y2 };
        const p3 = { x: seg.x, y: seg.y };
        const segLen = cubicLength(p0, p1, p2, p3);
        if (accumulated + segLen >= targetLength) {
          // Binary search for the parameter t
          const remaining = targetLength - accumulated;
          let lo = 0;
          let hi = 1;
          for (let iter = 0; iter < 30; iter++) {
            const mid = (lo + hi) / 2;
            // Approximate: use sub-sampling
            let subLen = 0;
            const steps = 20;
            for (let j = 0; j < steps; j++) {
              const t1 = (j / steps) * mid;
              const t2 = ((j + 1) / steps) * mid;
              const a = evaluateCubic(t1, p0, p1, p2, p3);
              const b = evaluateCubic(t2, p0, p1, p2, p3);
              subLen += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
            }
            if (subLen < remaining) {
              lo = mid;
            } else {
              hi = mid;
            }
          }
          const t = (lo + hi) / 2;
          const point = evaluateCubic(t, p0, p1, p2, p3);
          const deriv = cubicDerivative(t, p0, p1, p2, p3);
          const dLen = Math.sqrt(deriv.x * deriv.x + deriv.y * deriv.y);
          return {
            point,
            tangent: dLen > 0 ? { x: deriv.x / dLen, y: deriv.y / dLen } : { x: 1, y: 0 },
          };
        }
        accumulated += segLen;
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'Q': {
        const p0 = { x: currentX, y: currentY };
        const p1 = { x: seg.x1, y: seg.y1 };
        const p2 = { x: seg.x, y: seg.y };
        const segLen = quadraticLength(p0, p1, p2);
        if (accumulated + segLen >= targetLength) {
          const remaining = targetLength - accumulated;
          let lo = 0;
          let hi = 1;
          for (let iter = 0; iter < 30; iter++) {
            const mid = (lo + hi) / 2;
            let subLen = 0;
            const steps = 20;
            for (let j = 0; j < steps; j++) {
              const t1 = (j / steps) * mid;
              const t2 = ((j + 1) / steps) * mid;
              const a = evaluateQuadratic(t1, p0, p1, p2);
              const b = evaluateQuadratic(t2, p0, p1, p2);
              subLen += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
            }
            if (subLen < remaining) {
              lo = mid;
            } else {
              hi = mid;
            }
          }
          const t = (lo + hi) / 2;
          const point = evaluateQuadratic(t, p0, p1, p2);
          const deriv = quadraticDerivative(t, p0, p1, p2);
          const dLen = Math.sqrt(deriv.x * deriv.x + deriv.y * deriv.y);
          return {
            point,
            tangent: dLen > 0 ? { x: deriv.x / dLen, y: deriv.y / dLen } : { x: 1, y: 0 },
          };
        }
        accumulated += segLen;
        currentX = seg.x;
        currentY = seg.y;
        break;
      }
      case 'Z': {
        const dx = startX - currentX;
        const dy = startY - currentY;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        if (accumulated + segLen >= targetLength && segLen > 0) {
          const t = (targetLength - accumulated) / segLen;
          return {
            point: { x: currentX + dx * t, y: currentY + dy * t },
            tangent: { x: dx / segLen, y: dy / segLen },
          };
        }
        accumulated += segLen;
        currentX = startX;
        currentY = startY;
        break;
      }
    }
  }

  // Past the end - return the last point
  return {
    point: { x: currentX, y: currentY },
    tangent: { x: 1, y: 0 },
  };
}

// ─── Path Operations ─────────────────────────────────────────────────────────

/** Reverse a path (draw it in the opposite direction). */
export function reversePath(path: Path): Path {
  if (path.segments.length === 0) {
    return { segments: [], closed: path.closed };
  }

  // Collect endpoint positions for each segment
  interface SegmentWithPosition {
    seg: PathSegment;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  }

  // Split into subpaths at each M command
  const subpaths: SegmentWithPosition[][] = [];
  let currentSubpath: SegmentWithPosition[] = [];
  let cx = 0;
  let cy = 0;
  let moveX = 0;
  let moveY = 0;

  for (const seg of path.segments) {
    const startX = cx;
    const startY = cy;
    switch (seg.type) {
      case 'M':
        // Start a new subpath
        if (currentSubpath.length > 0) {
          subpaths.push(currentSubpath);
          currentSubpath = [];
        }
        cx = seg.x;
        cy = seg.y;
        moveX = seg.x;
        moveY = seg.y;
        break;
      case 'L':
        cx = seg.x;
        cy = seg.y;
        break;
      case 'C':
        cx = seg.x;
        cy = seg.y;
        break;
      case 'Q':
        cx = seg.x;
        cy = seg.y;
        break;
      case 'Z':
        cx = moveX;
        cy = moveY;
        break;
    }
    currentSubpath.push({ seg, startX, startY, endX: cx, endY: cy });
  }
  if (currentSubpath.length > 0) {
    subpaths.push(currentSubpath);
  }

  // Reverse each subpath individually, then concatenate
  const reversed: PathSegment[] = [];

  for (const subpath of subpaths) {
    // Determine if this subpath was closed
    const wasClosed = subpath.some((s) => s.seg.type === 'Z');

    // Find the last drawable segment's endpoint to start the reversed subpath
    // (excluding Z, which goes back to M)
    let lastEndX: number;
    let lastEndY: number;
    if (wasClosed) {
      // If closed, the effective last point before Z is the move point
      // But we want the last drawn-to point as M for the reversed subpath
      // Find the last non-Z segment
      let lastDrawn = subpath[subpath.length - 1];
      for (let j = subpath.length - 1; j >= 0; j--) {
        if (subpath[j].seg.type !== 'Z') {
          lastDrawn = subpath[j];
          break;
        }
      }
      lastEndX = lastDrawn.endX;
      lastEndY = lastDrawn.endY;
    } else {
      const last = subpath[subpath.length - 1];
      lastEndX = last.endX;
      lastEndY = last.endY;
    }

    // Start reversed subpath at the last point
    reversed.push({ type: 'M', x: lastEndX, y: lastEndY });

    // Walk backwards through segments (skip M and Z)
    for (let j = subpath.length - 1; j >= 0; j--) {
      const { seg, startX, startY } = subpath[j];
      switch (seg.type) {
        case 'M':
          // Skip - handled by the new M at the start
          break;
        case 'L':
          reversed.push({ type: 'L', x: startX, y: startY });
          break;
        case 'C':
          // Reverse cubic: swap control points
          reversed.push({
            type: 'C',
            x1: seg.x2,
            y1: seg.y2,
            x2: seg.x1,
            y2: seg.y1,
            x: startX,
            y: startY,
          });
          break;
        case 'Q':
          // Reverse quadratic: control point stays the same
          reversed.push({
            type: 'Q',
            x1: seg.x1,
            y1: seg.y1,
            x: startX,
            y: startY,
          });
          break;
        case 'Z':
          // The Z segment represents the implicit close-line from the last drawn
          // point back to the subpath's M position. In the reversed path, the new M
          // already starts at the last drawn point, and the final Z (appended below)
          // will close from the original M position back to the new M — which is
          // exactly the reversal of this close-line. Emitting an L here would create
          // a spurious zero-length segment (from the new M back to itself).
          break;
      }
    }

    // If the original subpath was closed, close the reversed one too
    if (wasClosed) {
      reversed.push({ type: 'Z' });
    }
  }

  return { segments: reversed, closed: path.closed };
}

// ─── SubPath Splitting ──────────────────────────────────────────────────────

/**
 * Split a path into its constituent subpaths.
 * Each subpath starts at a 'M' (moveTo) segment.
 * If path.subPaths is already populated, returns it directly.
 */
export function splitIntoSubPaths(path: Path): SubPath[] {
  if (path.subPaths && path.subPaths.length > 0) {
    return path.subPaths;
  }

  const subPaths: SubPath[] = [];
  let currentSegments: PathSegment[] = [];

  for (const segment of path.segments) {
    if (segment.type === 'M' && currentSegments.length > 0) {
      const closed =
        currentSegments.length > 0 && currentSegments[currentSegments.length - 1].type === 'Z';
      subPaths.push({ segments: currentSegments, closed });
      currentSegments = [];
    }
    currentSegments.push(segment);
  }

  if (currentSegments.length > 0) {
    const closed = currentSegments[currentSegments.length - 1].type === 'Z';
    subPaths.push({ segments: currentSegments, closed });
  }

  return subPaths;
}

/** Transform every point in a path by an affine transform. */
export function transformPath(path: Path, matrix: AffineTransform): Path {
  const segments: PathSegment[] = path.segments.map((seg) => {
    switch (seg.type) {
      case 'M': {
        const p = transformPoint(matrix, { x: seg.x, y: seg.y });
        return { type: 'M' as const, x: p.x, y: p.y };
      }
      case 'L': {
        const p = transformPoint(matrix, { x: seg.x, y: seg.y });
        return { type: 'L' as const, x: p.x, y: p.y };
      }
      case 'C': {
        const p1 = transformPoint(matrix, { x: seg.x1, y: seg.y1 });
        const p2 = transformPoint(matrix, { x: seg.x2, y: seg.y2 });
        const p = transformPoint(matrix, { x: seg.x, y: seg.y });
        return { type: 'C' as const, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y };
      }
      case 'Q': {
        const p1 = transformPoint(matrix, { x: seg.x1, y: seg.y1 });
        const p = transformPoint(matrix, { x: seg.x, y: seg.y });
        return { type: 'Q' as const, x1: p1.x, y1: p1.y, x: p.x, y: p.y };
      }
      case 'Z':
        return { type: 'Z' as const };
    }
  });

  return { segments, closed: path.closed };
}
