/**
 * Shape Preview Thumbnail
 *
 * Canvas-based preview thumbnails for shape types.
 * Renders actual shape geometry at small sizes for the InsertShapeMenu.
 *
 * Architecture:
 * - Uses canvas for crisp, scalable shape previews
 * - Handles DPR (device pixel ratio) scaling for retina displays
 * - Detects line-type shapes and renders stroke-only
 * - Delegates shape drawing to specialized modules
 *
 * @module components/toolbar/ShapePreviewThumbnail
 */

import { getShapeRenderingInfo } from '@mog/drawing-canvas';
import type { ShapeType } from '@mog-sdk/contracts/floating-objects';
import { memo, useEffect, useRef } from 'react';

// Import shape drawing functions from modules
import { drawArrowShape } from '../shape-preview/shapes/arrow-shapes';
import { drawBasicShape } from '../shape-preview/shapes/basic-shapes';
import { drawCalloutShape } from '../shape-preview/shapes/callout-shapes';
import { drawFlowchartShape } from '../shape-preview/shapes/flowchart-shapes';
import { drawLineShape } from '../shape-preview/shapes/line-shapes';
import { drawStarShape } from '../shape-preview/shapes/star-shapes';
import { drawSymbolShape } from '../shape-preview/shapes/symbol-shapes';
import { isLineShape, SHAPE_PREVIEW_DEFAULTS, type ShapeBounds } from '../shape-preview/types';

// =============================================================================
// Types
// =============================================================================

interface ShapePreviewThumbnailProps {
  shapeType: ShapeType;
  width?: number;
  height?: number;
  fillColor?: string;
  strokeColor?: string;
}

// =============================================================================
// Shape Drawing
// =============================================================================

/**
 * Draw shape path on canvas context.
 *
 * Delegates to specialized shape modules in sequence.
 * Each module returns true if it handled the shape, false if not.
 *
 * @param ctx - Canvas 2D context
 * @param shapeType - Type of shape to draw
 * @param bounds - Bounding box for the shape
 */
function drawShapePath(
  ctx: CanvasRenderingContext2D,
  shapeType: ShapeType,
  bounds: ShapeBounds,
): void {
  ctx.beginPath();

  // Try each shape module in sequence
  if (drawBasicShape(ctx, shapeType, bounds)) return;
  if (drawArrowShape(ctx, shapeType, bounds)) return;
  if (drawFlowchartShape(ctx, shapeType, bounds)) return;
  if (drawStarShape(ctx, shapeType, bounds)) return;
  if (drawCalloutShape(ctx, shapeType, bounds)) return;
  if (drawLineShape(ctx, shapeType, bounds)) return;
  if (drawSymbolShape(ctx, shapeType, bounds)) return;

  // Fallback for unsupported or complex shapes - render as rounded rectangle
  const { x, y, width, height } = bounds;
  const info = getShapeRenderingInfo(shapeType);

  if (info.strategy === 'fallback') {
    const radius = Math.min(width, height) * 0.1;
    ctx.roundRect(x, y, width, height, radius);
  } else {
    // For supported shapes we haven't implemented yet, draw basic rectangle
    ctx.rect(x, y, width, height);
  }
}

// =============================================================================
// Component
// =============================================================================

/**
 * ShapePreviewThumbnail Component
 *
 * Renders a canvas-based preview thumbnail of a shape type.
 * Used in the InsertShapeMenu to show actual shape geometry.
 *
 * Wrapped with React.memo for render isolation (Architecture Checklist Section 14).
 *
 * @example
 * ```tsx
 * <ShapePreviewThumbnail shapeType="star5" width={32} height={32} />
 * ```
 */
export const ShapePreviewThumbnail = memo(function ShapePreviewThumbnail({
  shapeType,
  width = SHAPE_PREVIEW_DEFAULTS.WIDTH,
  height = SHAPE_PREVIEW_DEFAULTS.HEIGHT,
  fillColor = SHAPE_PREVIEW_DEFAULTS.FILL_COLOR,
  strokeColor = SHAPE_PREVIEW_DEFAULTS.STROKE_COLOR,
}: ShapePreviewThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle DPR for crisp rendering on retina displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Add small padding so shapes don't touch edges
    const padding = 2;
    const bounds: ShapeBounds = {
      x: padding,
      y: padding,
      width: width - padding * 2,
      height: height - padding * 2,
    };

    // Draw the shape path
    drawShapePath(ctx, shapeType, bounds);

    // Determine if this is a line-type shape
    const isLine = isLineShape(shapeType);

    // Fill and stroke based on shape type
    if (!isLine) {
      // Filled shapes: fill first, then stroke
      ctx.fillStyle = fillColor;
      ctx.fill();
    }

    // Stroke (all shapes get stroked, but lines only get stroke)
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isLine ? 1.5 : 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [shapeType, width, height, fillColor, strokeColor]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block',
      }}
    />
  );
});
