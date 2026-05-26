/**
 * Handle Path Builders
 *
 * Build Path2D objects for hit testing of resize handles, rotation handle,
 * and custom handles. Hit paths are expanded beyond the visual handle size
 * by `handleHitExpansion` CSS pixels in every direction, making small
 * handles easier to click/tap.
 *
 * Uses DOMMatrix for rotation transforms on Path2D objects.
 *
 * @module @mog/canvas-overlay/handle-paths
 */

import type { CustomHandle } from './custom-handles';
import {
  getCornerHandlePositions,
  getResizeHandlePositions,
  getRotationHandlePosition,
} from './handle-positions';
import type { HandleRegion, HandleVisibility, OverlayConfig, ScreenBounds } from './types';

// =============================================================================
// Rotation Matrix Helper
// =============================================================================

/**
 * Create a DOMMatrix that rotates around the center of the given bounds.
 */
function makeRotationMatrix(bounds: ScreenBounds): DOMMatrix {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return new DOMMatrix().translateSelf(cx, cy).rotateSelf(bounds.rotation).translateSelf(-cx, -cy);
}

// =============================================================================
// Resize Handle Path
// =============================================================================

/**
 * Build a Path2D for a single resize handle, expanded for hit testing.
 *
 * The visual handle is `handleSize` x `handleSize` CSS pixels. The hit
 * test path is expanded by `expansion` CSS pixels on each side, resulting
 * in an effective hit area of (handleSize + 2*expansion) squared.
 *
 * If the bounds have rotation, the path is rotated using DOMMatrix.
 *
 * @param bounds - Object bounds (used for rotation center)
 * @param region - Which resize handle to build the path for
 * @param handleSize - Visual size of the handle in CSS pixels
 * @param expansion - Hit area expansion in CSS pixels
 * @returns Path2D for the expanded handle
 */
export function buildResizeHandlePath(
  bounds: ScreenBounds,
  region: HandleRegion,
  handleSize: number,
  expansion: number,
): Path2D {
  // Find the matching position from all 8 handles
  const allPositions = getResizeHandlePositions(bounds);
  const pos = allPositions.find((p) => p.region === region);

  if (!pos) {
    // Region is not a resize handle (e.g., 'rotation' or 'warp-adjust')
    return new Path2D();
  }

  const totalHalf = (handleSize + expansion * 2) / 2;
  const basePath = new Path2D();
  basePath.rect(pos.x - totalHalf, pos.y - totalHalf, totalHalf * 2, totalHalf * 2);

  if (bounds.rotation !== 0) {
    const rotatedPath = new Path2D();
    rotatedPath.addPath(basePath, makeRotationMatrix(bounds));
    return rotatedPath;
  }

  return basePath;
}

// =============================================================================
// Rotation Handle Path
// =============================================================================

/**
 * Build a Path2D for the rotation handle, expanded for hit testing.
 *
 * The rotation handle is a circle. The hit area is also circular with
 * radius = handleSize/2 + expansion.
 *
 * @param bounds - Object bounds (used for position and rotation center)
 * @param handleSize - Visual diameter of the rotation handle in CSS pixels
 * @param offset - Distance above the top edge in CSS pixels
 * @param expansion - Hit area expansion in CSS pixels
 * @returns Path2D for the expanded rotation handle
 */
export function buildRotationHandlePath(
  bounds: ScreenBounds,
  handleSize: number,
  offset: number,
  expansion: number,
): Path2D {
  const pos = getRotationHandlePosition(bounds, offset);
  const hitRadius = handleSize / 2 + expansion;

  const basePath = new Path2D();
  basePath.arc(pos.x, pos.y, hitRadius, 0, Math.PI * 2);

  if (bounds.rotation !== 0) {
    const rotatedPath = new Path2D();
    rotatedPath.addPath(basePath, makeRotationMatrix(bounds));
    return rotatedPath;
  }

  return basePath;
}

// =============================================================================
// Build All Handle Paths
// =============================================================================

/**
 * Build Path2D objects for all active handles on the given bounds.
 *
 * Returns an array of { region, path } pairs. The set of handles depends
 * on `visibility`:
 *   - 'all': 8 resize handles + rotation handle
 *   - 'corners-only': 4 corner handles + rotation handle
 *   - 'none': empty array
 *
 * @param bounds - Object bounds in screen-space CSS pixels
 * @param visibility - Which handles are visible
 * @param config - Overlay configuration
 * @returns Array of { region, path } for hit testing
 */
export function buildAllHandlePaths(
  bounds: ScreenBounds,
  visibility: HandleVisibility,
  config: OverlayConfig,
): Array<{ region: HandleRegion; path: Path2D }> {
  if (visibility === 'none') return [];

  const { handleSize, handleHitExpansion, rotationHandleOffset } = config;
  const result: Array<{ region: HandleRegion; path: Path2D }> = [];

  // Rotation handle (tested first -- it's above the object)
  result.push({
    region: 'rotation',
    path: buildRotationHandlePath(bounds, handleSize, rotationHandleOffset, handleHitExpansion),
  });

  // Resize handles
  const positions =
    visibility === 'corners-only'
      ? getCornerHandlePositions(bounds)
      : getResizeHandlePositions(bounds);

  for (const pos of positions) {
    result.push({
      region: pos.region,
      path: buildResizeHandlePath(bounds, pos.region, handleSize, handleHitExpansion),
    });
  }

  return result;
}

// =============================================================================
// Custom Handle Path
// =============================================================================

/**
 * Build a Path2D for a custom handle, expanded for hit testing.
 *
 * The hit area shape matches the visual shape of the handle:
 *   - 'diamond': diamond path with expanded size
 *   - 'circle': circular path with expanded radius
 *   - 'square': rectangular path with expanded size
 *
 * @param handle - The custom handle definition
 * @param expansion - Hit area expansion in CSS pixels
 * @returns Path2D for the expanded custom handle
 */
export function buildCustomHandlePath(handle: CustomHandle, expansion: number): Path2D {
  const { position, shape, size } = handle;
  const { x, y } = position;
  const expandedSize = size + expansion;

  const path = new Path2D();

  switch (shape) {
    case 'diamond':
      path.moveTo(x, y - expandedSize);
      path.lineTo(x + expandedSize, y);
      path.lineTo(x, y + expandedSize);
      path.lineTo(x - expandedSize, y);
      path.closePath();
      break;
    case 'circle':
      path.arc(x, y, expandedSize, 0, Math.PI * 2);
      break;
    case 'square':
      path.rect(x - expandedSize, y - expandedSize, expandedSize * 2, expandedSize * 2);
      break;
  }

  return path;
}
