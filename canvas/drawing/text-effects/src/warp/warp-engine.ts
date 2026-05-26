/**
 * Warp Engine
 *
 * The core warp algorithm that transforms text glyphs by mapping them
 * between top and bottom guide paths.
 */
import { Matrix, PathOps } from '@mog/geometry';
import type { AffineTransform, Path, Point2D } from '@mog-sdk/contracts/geometry';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * An input glyph box representing a single character in the text.
 */
export interface GlyphBox {
  /** Horizontal position (0 = left of text) */
  x: number;
  /** Vertical position (baseline) */
  y: number;
  /** Glyph advance width */
  width: number;
  /** Height: ascent + descent */
  height: number;
  /** Distance above baseline */
  ascent: number;
  /** Distance below baseline */
  descent: number;
  /** The character */
  char: string;
}

/**
 * A warped glyph — the result of applying the warp transform to a GlyphBox.
 */
export interface WarpedGlyph {
  /** Original glyph box */
  original: GlyphBox;
  /** Warped quad corners: [topLeft, topRight, bottomRight, bottomLeft] */
  corners: [Point2D, Point2D, Point2D, Point2D];
  /** Per-glyph affine transform */
  transform: AffineTransform;
  /** Local scale factor (average of horizontal and vertical scale) */
  scale: number;
}

// ─── Path Sampling ──────────────────────────────────────────────────────────

/**
 * Sample a point on a path at a given fraction of total arc length (0-1).
 */
function samplePathAtFraction(path: Path, fraction: number): Point2D {
  const totalLen = PathOps.pathLength(path);
  if (totalLen < 0.001) {
    // Degenerate path, return start point
    const firstSeg = path.segments[0];
    if (firstSeg && firstSeg.type === 'M') {
      return { x: firstSeg.x, y: firstSeg.y };
    }
    return { x: 0, y: 0 };
  }
  const targetLen = Math.max(0, Math.min(totalLen, fraction * totalLen));
  const result = PathOps.pointAtLength(path, targetLen);
  return result.point;
}

// ─── Warp Algorithm ─────────────────────────────────────────────────────────

/**
 * Compute the total text width from glyph boxes.
 */
function totalGlyphWidth(glyphs: GlyphBox[]): number {
  if (glyphs.length === 0) return 0;
  const last = glyphs[glyphs.length - 1];
  return last.x + last.width;
}

/**
 * Compute an affine transform that maps a source rectangle to a destination quad.
 *
 * Source rect corners: tl=(sx, sy), tr=(sx+sw, sy), br=(sx+sw, sy+sh), bl=(sx, sy+sh)
 * Dest quad corners: [tl, tr, br, bl]
 *
 * We use a simple approach: compute the transform that maps the two top corners
 * and uses a "best fit" affine. For a proper quad-to-quad mapping, we'd need
 * bilinear interpolation, but affine approximation works well for small glyphs.
 */
function computeGlyphTransform(
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  dstTL: Point2D,
  dstTR: Point2D,
  dstBL: Point2D,
  _dstBR: Point2D,
): AffineTransform {
  // We compute the affine mapping from the unit square to the quad,
  // then compose with the mapping from source rect to unit square.

  if (srcW < 0.001 || srcH < 0.001) {
    return Matrix.identity();
  }

  // Map from source rect to unit square: u = (x - srcX) / srcW, v = (y - srcY) / srcH
  // Map from unit square to quad using bilinear:
  //   P(u,v) = (1-u)(1-v)*TL + u*(1-v)*TR + u*v*BR + (1-u)*v*BL
  // For affine approximation, we use the center of the quad:
  //   At u=0, v=0: TL
  //   At u=1, v=0: TR
  //   At u=0, v=1: BL

  // Affine: [x', y'] = [a c tx; b d ty] * [x; y; 1]
  // From (srcX, srcY) -> dstTL
  // From (srcX+srcW, srcY) -> dstTR
  // From (srcX, srcY+srcH) -> dstBL

  // Solve:
  // a * srcX + c * srcY + tx = dstTL.x
  // a * (srcX+srcW) + c * srcY + tx = dstTR.x
  // a * srcX + c * (srcY+srcH) + tx = dstBL.x

  // From first two: a * srcW = dstTR.x - dstTL.x => a = (dstTR.x - dstTL.x) / srcW
  // From first and third: c * srcH = dstBL.x - dstTL.x => c = (dstBL.x - dstTL.x) / srcH
  // tx = dstTL.x - a * srcX - c * srcY

  const a = (dstTR.x - dstTL.x) / srcW;
  const c = (dstBL.x - dstTL.x) / srcH;
  const tx = dstTL.x - a * srcX - c * srcY;

  const b = (dstTR.y - dstTL.y) / srcW;
  const d = (dstBL.y - dstTL.y) / srcH;
  const ty = dstTL.y - b * srcX - d * srcY;

  return { a, b, c, d, tx, ty };
}

/**
 * Warp text glyphs between top and bottom guide paths.
 *
 * Algorithm:
 * 1. Compute total text width and normalize glyph positions to [0, 1]
 * 2. For each glyph, find left/right fraction along the paths
 * 3. Sample top and bottom paths at those fractions to get quad corners
 * 4. Compute per-glyph affine transform from original rect to warped quad
 *
 * @param glyphs Input glyph boxes
 * @param topPath Top guide path
 * @param bottomPath Bottom guide path
 * @param options Alignment option
 * @returns Array of warped glyphs
 */
export function warpText(
  glyphs: GlyphBox[],
  topPath: Path,
  bottomPath: Path,
  options?: { alignment?: 'left' | 'center' | 'right' },
): WarpedGlyph[] {
  if (glyphs.length === 0) return [];

  const totalWidth = totalGlyphWidth(glyphs);
  if (totalWidth < 0.001) return [];

  const alignment = options?.alignment ?? 'center';

  // Compute the fraction of the path that the text occupies.
  // We normalise glyphs to [0, textFraction] and then shift by
  // offsetFraction so the block sits at the correct alignment edge.
  const topLen = PathOps.pathLength(topPath);
  const textFraction = topLen > 0.001 ? Math.min(totalWidth / topLen, 1) : 1;

  let offsetFraction = 0;
  if (alignment === 'left') {
    offsetFraction = 0;
  } else if (alignment === 'center') {
    offsetFraction = (1 - textFraction) / 2;
  } else if (alignment === 'right') {
    offsetFraction = 1 - textFraction;
  }

  const result: WarpedGlyph[] = [];

  for (const glyph of glyphs) {
    // Normalize glyph position to [0, textFraction] then shift by offsetFraction
    const leftFrac = (glyph.x / totalWidth) * textFraction + offsetFraction;
    const rightFrac = ((glyph.x + glyph.width) / totalWidth) * textFraction + offsetFraction;

    // Sample top and bottom paths at glyph left and right edges
    const topLeft = samplePathAtFraction(topPath, leftFrac);
    const topRight = samplePathAtFraction(topPath, rightFrac);
    const bottomLeft = samplePathAtFraction(bottomPath, leftFrac);
    const bottomRight = samplePathAtFraction(bottomPath, rightFrac);

    const corners: [Point2D, Point2D, Point2D, Point2D] = [
      topLeft,
      topRight,
      bottomRight,
      bottomLeft,
    ];

    // Compute the affine transform mapping original glyph rect to warped quad
    const srcX = glyph.x;
    const srcY = glyph.y - glyph.ascent;
    const srcW = glyph.width;
    const srcH = glyph.height;

    const transform = computeGlyphTransform(
      srcX,
      srcY,
      srcW,
      srcH,
      topLeft,
      topRight,
      bottomLeft,
      bottomRight,
    );

    // Compute local scale factor
    const dx = topRight.x - topLeft.x;
    const dy = topRight.y - topLeft.y;
    const topDist = Math.sqrt(dx * dx + dy * dy);

    const bx = bottomRight.x - bottomLeft.x;
    const by = bottomRight.y - bottomLeft.y;
    const bottomDist = Math.sqrt(bx * bx + by * by);

    const avgHorizDist = (topDist + bottomDist) / 2;
    const horizScale = srcW > 0.001 ? avgHorizDist / srcW : 1;

    const vl = Math.sqrt((bottomLeft.x - topLeft.x) ** 2 + (bottomLeft.y - topLeft.y) ** 2);
    const vr = Math.sqrt((bottomRight.x - topRight.x) ** 2 + (bottomRight.y - topRight.y) ** 2);
    const avgVertDist = (vl + vr) / 2;
    const vertScale = srcH > 0.001 ? avgVertDist / srcH : 1;

    const scale = (horizScale + vertScale) / 2;

    result.push({ original: glyph, corners, transform, scale });
  }

  return result;
}
