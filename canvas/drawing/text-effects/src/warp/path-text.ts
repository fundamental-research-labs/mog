/**
 * Path Text Layout
 *
 * Layout text along an arbitrary path. Each glyph is positioned on the path
 * and rotated to follow the path tangent.
 */
import { Matrix, PathOps, Transform } from '@mog/geometry';
import type { Path, Point2D } from '@mog-sdk/contracts/geometry';
import type { GlyphBox, WarpedGlyph } from './warp-engine';

/**
 * Layout glyphs along a single path.
 *
 * Each glyph is placed with its center on the path at the appropriate
 * arc-length position, then rotated to follow the path tangent.
 *
 * @param glyphs Input glyph boxes
 * @param path The path to layout text along
 * @param options Offset and alignment
 * @returns Array of warped glyphs positioned along the path
 */
export function layoutTextOnPath(
  glyphs: GlyphBox[],
  path: Path,
  options?: {
    offset?: number;
    alignment?: 'left' | 'center' | 'right';
  },
): WarpedGlyph[] {
  if (glyphs.length === 0) return [];

  const totalPathLength = PathOps.pathLength(path);
  if (totalPathLength < 0.001) return [];

  const alignment = options?.alignment ?? 'left';
  const userOffset = options?.offset ?? 0;

  // Total text width
  let totalTextWidth = 0;
  for (const g of glyphs) {
    totalTextWidth += g.width;
  }

  // Compute starting offset based on alignment
  let startOffset = userOffset;
  if (alignment === 'center') {
    startOffset = userOffset + (totalPathLength - totalTextWidth) / 2;
  } else if (alignment === 'right') {
    startOffset = userOffset + totalPathLength - totalTextWidth;
  }

  const result: WarpedGlyph[] = [];
  let currentOffset = startOffset;

  for (const glyph of glyphs) {
    const glyphCenter = currentOffset + glyph.width / 2;

    // Get point and tangent at glyph center
    const { point, tangent } = PathOps.pointAtLength(path, glyphCenter);

    // Compute rotation angle from tangent
    const angle = Math.atan2(tangent.y, tangent.x);

    // Build transform: translate to origin, rotate, translate to path point
    const halfW = glyph.width / 2;
    const halfH = glyph.height / 2;

    // The glyph's original center
    const origCenterX = glyph.x + halfW;
    const origCenterY = glyph.y - glyph.ascent + halfH;

    // Compute transform: translate original center to origin, rotate, translate to path point
    const t = Transform.compose(
      Transform.translate(point.x, point.y),
      Transform.rotate(angle),
      Transform.translate(-origCenterX, -origCenterY),
    );

    // Compute warped corners
    const srcTL: Point2D = { x: glyph.x, y: glyph.y - glyph.ascent };
    const srcTR: Point2D = { x: glyph.x + glyph.width, y: glyph.y - glyph.ascent };
    const srcBR: Point2D = { x: glyph.x + glyph.width, y: glyph.y + glyph.descent };
    const srcBL: Point2D = { x: glyph.x, y: glyph.y + glyph.descent };

    const corners: [Point2D, Point2D, Point2D, Point2D] = [
      Matrix.transformPoint(t, srcTL),
      Matrix.transformPoint(t, srcTR),
      Matrix.transformPoint(t, srcBR),
      Matrix.transformPoint(t, srcBL),
    ];

    result.push({
      original: glyph,
      corners,
      transform: t,
      scale: 1, // Text along path maintains scale
    });

    currentOffset += glyph.width;
  }

  return result;
}
