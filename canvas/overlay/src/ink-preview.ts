/**
 * Ink Preview Rendering
 *
 * Renders in-progress ink strokes, eraser cursor, and lasso selection
 * preview on the overlay canvas. Optimized for 60fps performance using
 * simple polylines (no bezier curves).
 *
 * Ported from grid-canvas/src/layers/overlay/renderers/stroke-preview-renderer.ts
 * but simplified for the canvas overlay's screen-space architecture
 * (no scale/offset transforms needed -- all coordinates are already CSS pixels).
 *
 * @module @mog/canvas-overlay/ink-preview
 */

// =============================================================================
// Stroke Preview
// =============================================================================

/**
 * Render in-progress ink strokes on the overlay canvas during drawing.
 * Uses polylines (no bezier) for maximum 60fps performance.
 *
 * Supports pressure-sensitive rendering: if a point has a pressure value,
 * the line width is scaled by that pressure (baseWidth * pressure).
 *
 * Single-point strokes are rendered as filled dots.
 *
 * @param ctx - Canvas 2D rendering context
 * @param strokes - Array of in-progress strokes to render
 */
export function renderInkStrokePreview(
  ctx: CanvasRenderingContext2D,
  strokes: ReadonlyArray<{
    points: ReadonlyArray<{ x: number; y: number; pressure?: number }>;
    color: string;
    width: number;
  }>,
): void {
  if (strokes.length === 0) return;

  ctx.save();

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;

    // Single point: render as a filled dot
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      const radius = (stroke.width / 2) * (point.pressure ?? 1);

      ctx.fillStyle = stroke.color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    const hasPressure = stroke.points.some((p) => p.pressure !== undefined);

    if (hasPressure) {
      // Pressure-sensitive: draw segment by segment with varying width
      renderPressureStroke(ctx, stroke);
    } else {
      // Uniform width: draw as a single polyline for performance
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }

      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Render a stroke with pressure-sensitive width variation.
 * Draws each segment individually with width scaled by the average
 * pressure of the segment's two endpoints.
 */
function renderPressureStroke(
  ctx: CanvasRenderingContext2D,
  stroke: {
    points: ReadonlyArray<{ x: number; y: number; pressure?: number }>;
    color: string;
    width: number;
  },
): void {
  ctx.strokeStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < stroke.points.length; i++) {
    const prev = stroke.points[i - 1];
    const curr = stroke.points[i];
    const avgPressure = ((prev.pressure ?? 1) + (curr.pressure ?? 1)) / 2;

    ctx.lineWidth = stroke.width * avgPressure;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }
}

// =============================================================================
// Eraser Cursor
// =============================================================================

/**
 * Render eraser cursor -- a dashed circle showing the eraser radius
 * at the current cursor position.
 *
 * @param ctx - Canvas 2D rendering context
 * @param position - Eraser position with x, y, and radius
 */
export function renderEraserCursor(
  ctx: CanvasRenderingContext2D,
  position: { x: number; y: number; radius: number },
): void {
  ctx.save();

  // Outer dashed circle
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);

  ctx.beginPath();
  ctx.arc(position.x, position.y, position.radius, 0, Math.PI * 2);
  ctx.stroke();

  // Inner circle for better visibility (lower opacity, solid)
  ctx.globalAlpha = 0.3;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(position.x, position.y, position.radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// =============================================================================
// Lasso Preview
// =============================================================================

/**
 * Render lasso selection preview -- a dashed polygon showing the
 * in-progress lasso path with a semi-transparent fill.
 *
 * @param ctx - Canvas 2D rendering context
 * @param path - Array of points forming the lasso boundary
 */
export function renderLassoPreview(
  ctx: CanvasRenderingContext2D,
  path: ReadonlyArray<{ x: number; y: number }>,
): void {
  if (path.length < 2) return;

  ctx.save();

  // Build the path
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);

  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }

  // Close the path back to start
  ctx.closePath();

  // Fill with semi-transparent color
  ctx.fillStyle = 'rgba(33,115,70,0.1)';
  ctx.fill();

  // Stroke with dashed line
  ctx.strokeStyle = '#217346';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.stroke();

  ctx.restore();
}

// =============================================================================
// Combined Ink Preview
// =============================================================================

/**
 * Render all ink preview elements: strokes, eraser cursor, and lasso.
 *
 * This is the main entry point called by the overlay render loop.
 * It delegates to the individual renderers based on what is active.
 *
 * @param ctx - Canvas 2D rendering context
 * @param preview - Ink preview state from OverlayDataSource.getInkPreview()
 */
export function renderInkPreview(
  ctx: CanvasRenderingContext2D,
  preview: {
    strokes: ReadonlyArray<{
      points: ReadonlyArray<{ x: number; y: number; pressure?: number }>;
      color: string;
      width: number;
    }>;
    eraserPosition: { x: number; y: number; radius: number } | null;
    lassoPath: ReadonlyArray<{ x: number; y: number }> | null;
  },
): void {
  // Render active strokes
  if (preview.strokes.length > 0) {
    renderInkStrokePreview(ctx, preview.strokes);
  }

  // Render eraser cursor
  if (preview.eraserPosition) {
    renderEraserCursor(ctx, preview.eraserPosition);
  }

  // Render lasso selection
  if (preview.lassoPath && preview.lassoPath.length > 0) {
    renderLassoPreview(ctx, preview.lassoPath);
  }
}
