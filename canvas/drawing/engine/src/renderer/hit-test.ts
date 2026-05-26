/**
 * Hit testing for DrawingObjects.
 *
 * Uses Canvas2D Path2D and isPointInPath/isPointInStroke for
 * pixel-accurate narrow-phase hit testing. The spatial-query module
 * handles broad-phase (bounding-box) culling; this module handles
 * the precise geometry test.
 */
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import { pathToPath2D } from './path';

/**
 * Build a Path2D from a DrawingObject for hit testing.
 *
 * Applies the object's transform (if any) to create the correct hit area.
 * The returned Path2D can be used directly with `ctx.isPointInPath()`.
 */
export function buildHitTestPath(obj: DrawingObject): Path2D {
  const path2d = pathToPath2D(obj.geometry);

  if (obj.transform) {
    const t = obj.transform;
    const matrix = new DOMMatrix([t.a, t.b, t.c, t.d, t.tx, t.ty]);
    const transformed = new Path2D();
    transformed.addPath(path2d, matrix);
    return transformed;
  }

  return path2d;
}

/**
 * Test if a point (x, y) is inside a DrawingObject.
 *
 * Uses Canvas2D isPointInPath for pixel-accurate testing.
 * Checks both fill area and stroke area (with expanded hit tolerance
 * of at least 4px for thin or stroked-only shapes).
 *
 * For group objects with children, recurses into child objects.
 */
export function isPointInDrawingObject(
  obj: DrawingObject,
  x: number,
  y: number,
  ctx: CanvasRenderingContext2D,
): boolean {
  const path2d = buildHitTestPath(obj);

  // Check fill area
  if (ctx.isPointInPath(path2d, x, y)) {
    return true;
  }

  // Check stroke area (for stroked-only shapes, or thin shapes)
  if (obj.stroke) {
    ctx.save();
    ctx.lineWidth = Math.max(obj.stroke.width, 4); // Minimum 4px hit area
    const strokeHit = ctx.isPointInStroke(path2d, x, y);
    ctx.restore();
    if (strokeHit) {
      return true;
    }
  }

  // Check children — if parent has a transform, inverse-transform the point
  // into the parent's local coordinate space before testing children.
  if (obj.children) {
    let localX = x;
    let localY = y;

    if (obj.transform) {
      const mat = new DOMMatrix([
        obj.transform.a,
        obj.transform.b,
        obj.transform.c,
        obj.transform.d,
        obj.transform.tx,
        obj.transform.ty,
      ]);
      const inv = mat.inverse();
      const localPt = inv.transformPoint(new DOMPoint(x, y));
      localX = localPt.x;
      localY = localPt.y;
    }

    for (const child of obj.children) {
      if (isPointInDrawingObject(child, localX, localY, ctx)) {
        return true;
      }
    }
  }

  return false;
}
