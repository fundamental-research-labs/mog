/**
 * Shape Preview Module
 *
 * Entry point for shape preview thumbnail rendering.
 * Re-exports types, shape drawing functions, and path utilities.
 *
 * @module components/toolbar/shape-preview
 */

import type { ShapeType } from '@mog-sdk/contracts/floating-objects';

import { drawArrowShape } from './shapes/arrow-shapes';
import { drawBasicShape } from './shapes/basic-shapes';
import { drawCalloutShape } from './shapes/callout-shapes';
import { drawFlowchartShape } from './shapes/flowchart-shapes';
import { drawLineShape } from './shapes/line-shapes';
import { drawStarShape } from './shapes/star-shapes';
import { drawSymbolShape } from './shapes/symbol-shapes';
import type { ShapeBounds } from './types';

// Re-export all types
export * from './types';

// Re-export shape drawing functions
export { drawArrowShape } from './shapes/arrow-shapes';
export { drawBasicShape } from './shapes/basic-shapes';
export { drawCalloutShape } from './shapes/callout-shapes';
export { drawFlowchartShape } from './shapes/flowchart-shapes';
export { drawLineShape } from './shapes/line-shapes';
export { drawStarShape } from './shapes/star-shapes';
export { drawSymbolShape } from './shapes/symbol-shapes';

// Re-export path utilities
export { drawRegularPolygon, drawStar } from './paths/path-utils';

/**
 * Draw a shape path on canvas context.
 *
 * This is the main function that tries each shape module in order
 * and returns after the first one handles the shape. Use this function
 * in ShapePreviewThumbnail for unified shape rendering.
 *
 * Note: This function does NOT call ctx.beginPath() - the caller handles that.
 *
 * @param ctx - Canvas 2D context
 * @param shapeType - Type of shape to draw
 * @param bounds - Bounding box for the shape
 * @returns true if shape was drawn, false if not handled by any module
 */
export function drawShapePath(
  ctx: CanvasRenderingContext2D,
  shapeType: ShapeType,
  bounds: ShapeBounds,
): boolean {
  // Try each shape module in order, return after first match
  return (
    drawBasicShape(ctx, shapeType, bounds) ||
    drawArrowShape(ctx, shapeType, bounds) ||
    drawFlowchartShape(ctx, shapeType, bounds) ||
    drawStarShape(ctx, shapeType, bounds) ||
    drawCalloutShape(ctx, shapeType, bounds) ||
    drawLineShape(ctx, shapeType, bounds) ||
    drawSymbolShape(ctx, shapeType, bounds)
  );
}
