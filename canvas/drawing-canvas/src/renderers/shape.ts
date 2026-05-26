/**
 * Shape Renderer
 *
 * Renders ShapeScene objects by delegating to shape-engine for geometry
 * generation and drawing-engine for Canvas2D rendering. Handles fill/stroke
 * mapping, position transforms, rotation, flip, and simple centered text.
 *
 * Pure function with per-object error boundary.
 *
 * @module @mog/drawing-canvas/renderers/shape
 */

import type { TextMeasurer } from '@mog/canvas-engine';
import { pathToPath2D, renderDrawingObjectToCanvas } from '@mog/drawing-engine';
import type { ShapeVisualProperties } from '@mog/shape-engine';
import { createDrawingObject } from '@mog/shape-engine';
import type { DrawingFill, DrawingStroke } from '@mog-sdk/contracts/drawing';
import type { HitMap } from '../hit-testing/hit-map';
import type { ShapeScene } from '../scene/types';
import { withRenderContext } from './render-utils';
import { renderRichTextBlock } from './rich-text';

// =============================================================================
// Fill/Stroke Mapping
// =============================================================================

/**
 * Map ObjectFillConfig (scene type) to DrawingFill (contracts type).
 */
function mapFill(fill: ShapeScene['data']['fill']): DrawingFill | undefined {
  if (!fill || fill.type === 'none') return undefined;

  if (fill.type === 'solid' && fill.color) {
    return { type: 'solid', color: fill.color };
  }

  if (fill.type === 'gradient' && fill.gradient) {
    if (fill.gradient.type === 'linear') {
      return {
        type: 'linear-gradient',
        angle: fill.gradient.angle ?? 0,
        stops: fill.gradient.stops.map((s) => ({ offset: s.offset, color: s.color })),
      };
    }
    return {
      type: 'radial-gradient',
      centerX: 0.5,
      centerY: 0.5,
      radiusX: 0.5,
      radiusY: 0.5,
      stops: fill.gradient.stops.map((s) => ({ offset: s.offset, color: s.color })),
    };
  }

  return undefined;
}

/**
 * Map ObjectBorderConfig (scene type) to DrawingStroke (contracts type).
 */
function mapStroke(border: ShapeScene['data']['border']): DrawingStroke | undefined {
  if (!border) return undefined;
  return { color: border.color, width: border.width };
}

// =============================================================================
// Shape Renderer
// =============================================================================

/**
 * Render a ShapeScene object to a Canvas2D context.
 *
 * Pipeline:
 * 1. Map scene fill/stroke to drawing-engine types
 * 2. Create DrawingObject via shape-engine (geometry + visual)
 * 3. Position via AffineTransform (identity + translation)
 * 4. Render via drawing-engine
 * 5. Render centered text if present (MVP: no wrapping)
 * 6. Apply rotation and flip transforms
 */
export function renderShape(
  ctx: CanvasRenderingContext2D,
  obj: ShapeScene,
  hitMap: HitMap | null,
  textMeasurer: TextMeasurer | null = null,
): void {
  withRenderContext(ctx, obj, 'Shape', () => {
    // Map scene fill/stroke to drawing-engine types
    const fill = mapFill(obj.data.fill);
    const stroke = mapStroke(obj.data.border);

    const visual: ShapeVisualProperties = {};
    if (fill) visual.fill = fill;
    if (stroke) visual.stroke = stroke;
    if (obj.data.scene3d) visual.scene3d = obj.data.scene3d;
    if (obj.data.sp3d) visual.sp3d = obj.data.sp3d;

    // Create drawing object via shape-engine
    const drawingObj = createDrawingObject(
      obj.data.shapeType,
      obj.bounds.width,
      obj.bounds.height,
      obj.data.adjustments ? [...obj.data.adjustments] : undefined,
      visual,
    );

    // Register hit-test Path2D from the shape geometry.
    // The geometry path is in local (0,0) space, so we translate it to document
    // position to match the coordinate space used in HitMap.hitTest().
    if (hitMap) {
      const localPath = pathToPath2D(drawingObj.geometry);
      const translated = new Path2D();
      translated.addPath(localPath, { e: obj.bounds.x, f: obj.bounds.y });
      hitMap.registerBody(obj.id, translated);
    }

    // Apply position transform: translate to obj.bounds origin
    const positionedObj = {
      ...drawingObj,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: obj.bounds.x, ty: obj.bounds.y },
    };

    // Render the shape via drawing-engine
    renderDrawingObjectToCanvas(positionedObj, ctx);

    // Render text content with rich text support
    if (obj.data.text) {
      const margin = 4;
      const textBounds = {
        x: obj.bounds.x + margin,
        y: obj.bounds.y + margin,
        width: obj.bounds.width - margin * 2,
        height: obj.bounds.height - margin * 2,
      };
      renderRichTextBlock(
        ctx,
        textBounds,
        obj.data.text,
        obj.data.richText,
        { horizontal: 'center', vertical: 'middle' },
        textMeasurer,
      );
    }
  });
}
