/**
 * OLE Object Renderer
 *
 * Renders OleObjectScene objects with two visual modes:
 * 1. Preview image (dvAspect === 'content' with available previewImageUrl):
 *    draws the cached image, falling back to a placeholder while loading.
 * 2. Icon mode (dvAspect === 'icon', or no preview): draws a canvas-based
 *    document icon with a folded corner and centered label.
 *
 * Pure function with error boundary via withRenderContext.
 *
 * @module @mog/drawing-canvas/renderers/ole-object
 */

import type { OleObjectScene } from '../scene/types';
import type { ImageCache } from './image-cache';
import { renderPlaceholder, withRenderContext } from './render-utils';

// =============================================================================
// OLE Object Renderer
// =============================================================================

/**
 * Render an OleObjectScene object to the canvas.
 *
 * - dvAspect === 'icon': always draws the canvas-based document icon.
 * - dvAspect === 'content' with previewImageUrl: draws the cached image,
 *   or a loading placeholder if the image is not yet available.
 * - dvAspect === 'content' without preview: falls back to the document icon.
 */
export function renderOleObject(
  ctx: CanvasRenderingContext2D,
  obj: OleObjectScene,
  imageCache: ImageCache,
): void {
  withRenderContext(ctx, obj, 'OLE Object', () => {
    const { data, bounds } = obj;

    // Icon mode always renders the document icon, regardless of preview
    if (data.dvAspect === 'icon') {
      renderDocumentIcon(ctx, bounds, data.iconLabel);
      return;
    }

    // Content mode: try to render the preview image
    if (data.previewImageUrl) {
      const img = imageCache.getImage(data.previewImageUrl);
      if (img) {
        ctx.drawImage(img, bounds.x, bounds.y, bounds.width, bounds.height);
      } else {
        // Image is still loading — show a placeholder
        renderPlaceholder(ctx, bounds, data.iconLabel, {
          fill: '#F0F0F0',
          stroke: '#CCCCCC',
          textColor: '#999999',
          font: '12px sans-serif',
        });
      }
      return;
    }

    // No preview available — fall back to document icon
    renderDocumentIcon(ctx, bounds, data.iconLabel);
  });
}

// =============================================================================
// Document Icon (canvas-drawn, no external assets)
// =============================================================================

/**
 * Draw a generic document icon with a folded corner and centered label.
 *
 * Layout:
 * - Light gray rectangle with darker border
 * - Folded corner triangle in the top-right
 * - Label text centered in the body
 */
function renderDocumentIcon(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  label: string,
): void {
  const { x, y, width, height } = bounds;
  const foldSize = Math.min(width, height) * 0.15;

  ctx.save();

  // --- Document body with folded corner ---
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width - foldSize, y);
  ctx.lineTo(x + width, y + foldSize);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.closePath();

  ctx.fillStyle = '#F0F0F0';
  ctx.fill();
  ctx.strokeStyle = '#CCCCCC';
  ctx.lineWidth = 1;
  ctx.stroke();

  // --- Folded corner triangle ---
  ctx.beginPath();
  ctx.moveTo(x + width - foldSize, y);
  ctx.lineTo(x + width - foldSize, y + foldSize);
  ctx.lineTo(x + width, y + foldSize);
  ctx.closePath();

  ctx.fillStyle = '#E0E0E0';
  ctx.fill();
  ctx.strokeStyle = '#CCCCCC';
  ctx.lineWidth = 1;
  ctx.stroke();

  // --- Label text centered ---
  ctx.fillStyle = '#666666';
  ctx.font = `${Math.max(10, Math.min(14, height * 0.1))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + width / 2, y + height / 2, width - 8);

  ctx.restore();
}
