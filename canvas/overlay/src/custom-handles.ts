/**
 * Custom Handles Rendering
 *
 * Generic extensible handle rendering for domain-specific handles such as
 * the WordArt warp-adjust diamond. The overlay layer receives custom handles
 * through a generic interface so it does not need direct knowledge of
 * WordArt, SmartArt, or other domain types.
 *
 * Port of: grid-canvas/layers/overlay/handles/wordart-handles.ts
 *
 * @module @mog/canvas-overlay/custom-handles
 */

import { applyRotation } from './selection-chrome';
import type { HandleRegion, ScreenBounds } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * A custom handle that can be rendered and hit-tested.
 *
 * Custom handles are provided by the host application through the
 * overlay data source. Each handle describes its position, visual
 * appearance, and the HandleRegion it maps to for hit testing.
 */
export interface CustomHandle {
  /** Unique identifier for this handle instance */
  readonly id: string;
  /** The handle region used for hit test results */
  readonly region: HandleRegion;
  /** Position in screen-space CSS pixels (unrotated, relative to bounds origin) */
  readonly position: { x: number; y: number };
  /** Visual shape of the handle */
  readonly shape: 'diamond' | 'circle' | 'square';
  /** Fill color (e.g., '#FFD700' for WordArt yellow diamond) */
  readonly fillColor: string;
  /** Stroke color (e.g., '#CC9900' for darker gold) */
  readonly strokeColor: string;
  /** Size of the handle in CSS pixels */
  readonly size: number;
}

// =============================================================================
// Shape Renderers
// =============================================================================

/**
 * Draw a diamond shape centered at (x, y).
 */
function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - size); // Top
  ctx.lineTo(x + size, y); // Right
  ctx.lineTo(x, y + size); // Bottom
  ctx.lineTo(x - size, y); // Left
  ctx.closePath();
}

/**
 * Draw a circle centered at (x, y).
 */
function drawCircle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.closePath();
}

/**
 * Draw a square centered at (x, y).
 */
function drawSquare(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  ctx.rect(x - size, y - size, size * 2, size * 2);
  ctx.closePath();
}

// =============================================================================
// Rendering
// =============================================================================

/**
 * Render all custom handles, applying the object's rotation transform.
 *
 * Custom handle positions are specified in the unrotated object coordinate
 * space. This function applies the rotation of the parent bounds so that
 * handles rotate with the object.
 *
 * @param ctx - Canvas 2D rendering context
 * @param handles - Array of custom handles to render
 * @param bounds - Parent object bounds (used for rotation transform)
 */
export function renderCustomHandles(
  ctx: CanvasRenderingContext2D,
  handles: ReadonlyArray<CustomHandle>,
  bounds: ScreenBounds,
): void {
  if (handles.length === 0) return;

  ctx.save();

  // Apply rotation around object center
  applyRotation(ctx, bounds);

  for (const handle of handles) {
    const { position, shape, fillColor, strokeColor, size } = handle;
    const { x, y } = position;

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;

    switch (shape) {
      case 'diamond':
        drawDiamond(ctx, x, y, size);
        break;
      case 'circle':
        drawCircle(ctx, x, y, size);
        break;
      case 'square':
        drawSquare(ctx, x, y, size);
        break;
    }

    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
