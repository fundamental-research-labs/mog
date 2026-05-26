/**
 * Line Shape Drawings
 *
 * Drawing functions for line-based shapes (stroke only, no fill).
 * These shapes include lines, arrows, curves, and connectors.
 *
 * @module components/toolbar/shape-preview/shapes/line-shapes
 */

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

import type { ShapeBounds } from '../types';

/**
 * Draw a line shape path on canvas context.
 * Handles line-based shapes that are stroke-only (no fill).
 *
 * Note: This function does NOT call ctx.beginPath() - the caller handles that.
 *
 * @param ctx - Canvas 2D context
 * @param shapeType - Type of shape to draw
 * @param bounds - Bounding box for the shape
 * @returns true if shape was drawn, false if not handled
 */
export function drawLineShape(
  ctx: CanvasRenderingContext2D,
  shapeType: ShapeType,
  bounds: ShapeBounds,
): boolean {
  const { x, y, width, height } = bounds;

  switch (shapeType) {
    case 'line':
      ctx.moveTo(x, y + height / 2);
      ctx.lineTo(x + width, y + height / 2);
      return true;

    case 'lineArrow':
      ctx.moveTo(x, y + height / 2);
      ctx.lineTo(x + width - 6, y + height / 2);
      // Arrow head
      ctx.moveTo(x + width, y + height / 2);
      ctx.lineTo(x + width - 6, y + height / 2 - 3);
      ctx.moveTo(x + width, y + height / 2);
      ctx.lineTo(x + width - 6, y + height / 2 + 3);
      return true;

    case 'curve': {
      // S-curve
      ctx.moveTo(x, y + height);
      ctx.bezierCurveTo(
        x + width * 0.33,
        y + height,
        x + width * 0.33,
        y,
        x + width * 0.5,
        y + height * 0.5,
      );
      ctx.bezierCurveTo(x + width * 0.67, y + height, x + width * 0.67, y, x + width, y);
      return true;
    }

    case 'arc':
      ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, 0, Math.PI / 2);
      return true;

    case 'connector':
      ctx.moveTo(x, y + height / 2);
      ctx.lineTo(x + width, y + height / 2);
      return true;

    default:
      return false;
  }
}
