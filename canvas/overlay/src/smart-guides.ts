/**
 * Smart Guides Rendering
 *
 * Renders alignment guide lines during drag/resize operations.
 * Guide data comes pre-computed from OverlayDataSource.getGuides() --
 * this module is a pure renderer that draws the guide lines.
 *
 * Each guide has:
 * - axis: 'horizontal' or 'vertical'
 * - position: pixel position on that axis
 * - start/end: extent of the guide line on the perpendicular axis
 *
 * @module @mog/canvas-overlay/smart-guides
 */

import type { OverlayConfig } from './types';

/**
 * Render smart alignment guide lines on the overlay canvas.
 *
 * Draws 1px magenta lines between relevant objects (not full canvas width).
 * All coordinates are in screen-space CSS pixels (post-zoom).
 *
 * @param ctx - Canvas 2D rendering context
 * @param guides - Pre-computed guide data from OverlayDataSource.getGuides()
 * @param config - Overlay configuration for guide color and line width
 */
export function renderSmartGuides(
  ctx: CanvasRenderingContext2D,
  guides: ReadonlyArray<{
    axis: 'horizontal' | 'vertical';
    position: number;
    start: number;
    end: number;
  }>,
  config: Pick<OverlayConfig, 'guideColor' | 'guideLineWidth'>,
): void {
  if (guides.length === 0) return;

  ctx.save();

  ctx.strokeStyle = config.guideColor;
  ctx.lineWidth = config.guideLineWidth;
  ctx.setLineDash([]);

  for (const guide of guides) {
    ctx.beginPath();

    if (guide.axis === 'horizontal') {
      // Horizontal guide: fixed y position, line extends from start to end along x
      ctx.moveTo(guide.start, guide.position);
      ctx.lineTo(guide.end, guide.position);
    } else {
      // Vertical guide: fixed x position, line extends from start to end along y
      ctx.moveTo(guide.position, guide.start);
      ctx.lineTo(guide.position, guide.end);
    }

    ctx.stroke();
  }

  ctx.restore();
}
