/**
 * Rubber Band Selection Rendering
 *
 * Renders the marquee (rubber band) selection rectangle during
 * click-drag selection on the canvas. Shows a dashed border with
 * semi-transparent fill.
 *
 * @module @mog/canvas-overlay/rubber-band
 */

import type { OverlayConfig } from './types';

/**
 * Render the rubber band (marquee) selection rectangle.
 *
 * Draws a dashed border with semi-transparent fill. All coordinates
 * are in screen-space CSS pixels (post-zoom).
 *
 * @param ctx - Canvas 2D rendering context
 * @param bounds - Rectangle bounds from OverlayDataSource.getRubberBand()
 * @param config - Overlay configuration for border and fill colors
 */
export function renderRubberBand(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  config: Pick<OverlayConfig, 'rubberBandBorderColor' | 'rubberBandFillColor'>,
): void {
  ctx.save();

  // Fill with semi-transparent color
  ctx.fillStyle = config.rubberBandFillColor;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Dashed border
  ctx.strokeStyle = config.rubberBandBorderColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  ctx.restore();
}
