/**
 * Insertion Preview Rendering
 *
 * Renders a dashed rectangle preview during drag-to-insert shape mode.
 * When the user is in "inserting" state and dragging, shows the shape
 * bounds they are defining as a dashed blue rectangle with a light fill.
 *
 * @module @mog/canvas-overlay/insertion-preview
 */

import type { OverlayConfig } from './types';

/**
 * Insertion preview bounds — the rectangle defined by the drag start
 * and current pointer positions during shape insertion.
 */
export interface InsertionPreviewBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Render the insertion preview rectangle.
 *
 * Draws a 1px dashed blue stroke with a semi-transparent fill to indicate
 * the bounds of the shape being inserted. All coordinates are in
 * screen-space CSS pixels (post-zoom).
 *
 * @param ctx - Canvas 2D rendering context
 * @param bounds - Rectangle bounds computed from insert start/current positions
 * @param config - Overlay configuration for selection color
 */
export function renderInsertionPreview(
  ctx: CanvasRenderingContext2D,
  bounds: InsertionPreviewBounds,
  config: Pick<OverlayConfig, 'selectionColor'>,
): void {
  ctx.save();

  // Semi-transparent fill
  ctx.fillStyle = 'rgba(66, 133, 244, 0.08)';
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Dashed border
  ctx.strokeStyle = config.selectionColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  ctx.restore();
}
