/**
 * Ink Renderer
 *
 * Renders InkScene objects (freehand ink strokes). Each stroke is drawn as a
 * smooth bezier path through its points using Catmull-Rom to bezier conversion.
 * Single-point strokes render as filled dots.
 *
 * Pure function with error boundary: try-catch to renderErrorPlaceholder.
 *
 * @module @mog/drawing-canvas/renderers/ink
 */

import type { InkScene, InkStrokeData } from '../scene/types';
import { withRenderContext } from './render-utils';

// =============================================================================
// Ink Renderer
// =============================================================================

/**
 * Render an InkScene object to the canvas.
 *
 * - Clips to obj.bounds and translates coordinate space.
 * - Iterates strokes in order, rendering each as a smooth bezier path.
 * - Single-point strokes are rendered as filled dots.
 * - On error: renders an error placeholder labeled "Ink".
 */
export function renderInk(ctx: CanvasRenderingContext2D, obj: InkScene): void {
  withRenderContext(ctx, obj, 'Ink', () => {
    const { bounds } = obj;

    // Clip to bounds
    ctx.beginPath();
    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.clip();

    // Translate so stroke points are relative to bounds origin
    ctx.translate(bounds.x, bounds.y);

    // Render each stroke
    for (const stroke of obj.data.strokes) {
      renderStroke(ctx, stroke);
    }
  });
}

// =============================================================================
// Stroke Rendering
// =============================================================================

/**
 * Render a single ink stroke as a smooth bezier path.
 */
function renderStroke(ctx: CanvasRenderingContext2D, stroke: InkStrokeData): void {
  const { points, color, width, opacity } = stroke;
  if (points.length === 0) return;

  ctx.save();

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (opacity != null && opacity < 1) {
    ctx.globalAlpha = opacity;
  }

  if (points.length === 1) {
    // Single point: render as a filled dot
    const p = points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Multiple points: render smooth bezier curves
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
      // Two points: simple line
      ctx.lineTo(points[1].x, points[1].y);
    } else {
      // Three or more points: Catmull-Rom to bezier conversion
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        // Catmull-Rom to cubic bezier control points
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
    }

    ctx.stroke();
  }

  ctx.restore();
}
