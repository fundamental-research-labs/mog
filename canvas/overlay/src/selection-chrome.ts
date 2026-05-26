/**
 * Selection Chrome Rendering
 *
 * Rendering functions for selection outlines, group bounding boxes,
 * resize handles, and the rotation handle. All drawing is done in
 * screen-space CSS pixels.
 *
 * Port of:
 *   - grid-canvas/layers/overlay/handles/selection-handles.ts (outlines)
 *   - grid-canvas/layers/overlay/handles/resize-handles.ts (8 handles)
 *   - grid-canvas/layers/overlay/handles/rotation-handle.ts (rotation)
 *
 * @module @mog/canvas-overlay/selection-chrome
 */

import {
  getCornerHandlePositions,
  getResizeHandlePositions,
  getRotationHandlePosition,
} from './handle-positions';
import type { HandleVisibility, OverlayConfig, ScreenBounds } from './types';

// =============================================================================
// Rotation Transform Helper
// =============================================================================

/**
 * Apply a rotation transform around the center of the bounds.
 * The caller MUST call ctx.save() before and ctx.restore() after.
 */
export function applyRotation(ctx: CanvasRenderingContext2D, bounds: ScreenBounds): void {
  if (bounds.rotation !== 0) {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((bounds.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
}

// =============================================================================
// Selection Outline (per-object, solid)
// =============================================================================

/**
 * Render a solid selection outline around a single object.
 *
 * Always visible for every selected object (both in single- and multi-
 * selection). Applies rotation transform for rotated objects.
 *
 * @param ctx - Canvas 2D rendering context
 * @param bounds - Object bounds in screen-space CSS pixels
 * @param config - Overlay configuration
 */
export function renderSelectionOutline(
  ctx: CanvasRenderingContext2D,
  bounds: ScreenBounds,
  config: OverlayConfig,
): void {
  ctx.save();

  applyRotation(ctx, bounds);

  ctx.strokeStyle = config.selectionColor;
  ctx.lineWidth = config.selectionWidth;
  ctx.setLineDash([]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  ctx.restore();
}

// =============================================================================
// Group Outline (multi-selection, dashed)
// =============================================================================

/**
 * Render a dashed outline around the group bounding box.
 *
 * Only shown when 2+ objects are selected. The group bounding box
 * is axis-aligned (no rotation). Handles appear on this box, not
 * on individual objects.
 *
 * @param ctx - Canvas 2D rendering context
 * @param bounds - Union bounding box (axis-aligned, no rotation)
 * @param config - Overlay configuration
 */
export function renderGroupOutline(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  config: OverlayConfig,
): void {
  ctx.save();

  ctx.strokeStyle = config.selectionColor;
  ctx.lineWidth = config.selectionWidth;
  ctx.setLineDash(config.groupDashPattern as number[]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  ctx.restore();
}

// =============================================================================
// Resize Handles
// =============================================================================

/**
 * Render resize handles around an object or group bounding box.
 *
 * Handles are white-filled squares with a blue stroke. Visibility
 * determines whether all 8, only corners, or no handles are drawn.
 * Applies rotation transform for rotated objects.
 *
 * @param ctx - Canvas 2D rendering context
 * @param bounds - Bounds in screen-space CSS pixels
 * @param visibility - Which handles to show ('all', 'corners-only', 'none')
 * @param config - Overlay configuration
 */
export function renderResizeHandles(
  ctx: CanvasRenderingContext2D,
  bounds: ScreenBounds,
  visibility: HandleVisibility,
  config: OverlayConfig,
): void {
  if (visibility === 'none') return;

  const positions =
    visibility === 'corners-only'
      ? getCornerHandlePositions(bounds)
      : getResizeHandlePositions(bounds);

  const size = config.handleSize;
  const half = size / 2;

  ctx.save();

  applyRotation(ctx, bounds);

  ctx.fillStyle = config.handleFillColor;
  ctx.strokeStyle = config.handleStrokeColor;
  ctx.lineWidth = 1;

  for (const pos of positions) {
    ctx.fillRect(pos.x - half, pos.y - half, size, size);
    ctx.strokeRect(pos.x - half, pos.y - half, size, size);
  }

  ctx.restore();
}

// =============================================================================
// Rotation Handle
// =============================================================================

/**
 * Render the rotation handle above the top-center of an object.
 *
 * Draws a connector line from the top edge to a circular handle,
 * with a circular arrow icon inside the handle. Applies rotation
 * transform for rotated objects.
 *
 * @param ctx - Canvas 2D rendering context
 * @param bounds - Bounds in screen-space CSS pixels
 * @param config - Overlay configuration
 */
export function renderRotationHandle(
  ctx: CanvasRenderingContext2D,
  bounds: ScreenBounds,
  config: OverlayConfig,
): void {
  const size = config.handleSize;
  const offset = config.rotationHandleOffset;
  const pos = getRotationHandlePosition(bounds, offset);
  const topCenterX = bounds.x + bounds.width / 2;

  ctx.save();

  applyRotation(ctx, bounds);

  // --- Connector line from top-center to rotation circle ---
  ctx.strokeStyle = config.selectionColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(topCenterX, bounds.y);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();

  // --- Circular handle ---
  ctx.fillStyle = config.handleFillColor;
  ctx.strokeStyle = config.handleStrokeColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // --- Rotation icon (circular arrow arc) ---
  ctx.strokeStyle = config.handleStrokeColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, size / 2 - 2, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  // Arrow head at the end of the arc
  ctx.beginPath();
  ctx.moveTo(pos.x + 1, pos.y + size / 2 - 2);
  ctx.lineTo(pos.x - 2, pos.y + size / 2 - 4);
  ctx.lineTo(pos.x + 1, pos.y + size / 2 - 6);
  ctx.stroke();

  ctx.restore();
}
