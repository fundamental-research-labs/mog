/**
 * Star Shapes
 *
 * Drawing functions for star-type shapes (star4, star5, star6, etc.).
 * Part of the shape preview thumbnail refactoring.
 */

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

import { drawStar } from '../paths/path-utils';
import type { ShapeBounds } from '../types';

/**
 * Draw a star shape path on canvas context.
 *
 * Handles: star4, star5, star6, star7, star8, star10, star12, star16, star24, star32
 *
 * Note: Does NOT call ctx.beginPath() - that's handled by the caller.
 *
 * @param ctx - Canvas 2D context
 * @param shapeType - Type of shape to draw
 * @param bounds - Bounding box for the shape
 * @returns true if shape was drawn, false if not handled
 */
export function drawStarShape(
  ctx: CanvasRenderingContext2D,
  shapeType: ShapeType,
  bounds: ShapeBounds,
): boolean {
  const { x, y, width, height } = bounds;

  switch (shapeType) {
    case 'star4':
      drawStar(ctx, x, y, width, height, 4);
      return true;

    case 'star5':
      drawStar(ctx, x, y, width, height, 5);
      return true;

    case 'star6':
      drawStar(ctx, x, y, width, height, 6);
      return true;

    case 'star7':
      drawStar(ctx, x, y, width, height, 7);
      return true;

    case 'star8':
      drawStar(ctx, x, y, width, height, 8);
      return true;

    case 'star10':
      drawStar(ctx, x, y, width, height, 10);
      return true;

    case 'star12':
      drawStar(ctx, x, y, width, height, 12);
      return true;

    case 'star16':
      drawStar(ctx, x, y, width, height, 16);
      return true;

    case 'star24':
      drawStar(ctx, x, y, width, height, 24);
      return true;

    case 'star32':
      drawStar(ctx, x, y, width, height, 32);
      return true;

    default:
      return false;
  }
}
