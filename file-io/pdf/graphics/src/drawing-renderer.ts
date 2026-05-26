/**
 * Drawing Object Renderer — renders drawing objects (shapes, groups, images, text)
 * to a RenderBackend.
 *
 * Follows the same pattern as drawing-engine's renderDrawingObjectToCanvas:
 * 1. Save state
 * 2. Apply transform
 * 3. Render fill (solid, gradient, pattern)
 * 4. Render stroke
 * 5. Render text in shape
 * 6. Render children recursively (groups)
 * 7. Restore state
 *
 * Uses pattern-fill, gradient-fill modules for advanced fill types.
 */

import type { LinearGradientOptions, RadialGradientOptions } from './gradient-fill';
import type { PatternFillOptions } from './pattern-fill';
import type { RenderBackend } from './render-backend';
import type { TextRun } from './types';

/**
 * Fill definition for a drawing object.
 */
export interface DrawingFill {
  type: 'solid' | 'linear-gradient' | 'radial-gradient' | 'pattern';
  /** Solid fill color [r, g, b] each 0-1. */
  color?: [number, number, number];
  /** Fill opacity (0-1). */
  alpha?: number;
  /** Gradient options (for gradient fill types). */
  gradient?: LinearGradientOptions | RadialGradientOptions;
  /** Pattern options (for pattern fill type). */
  pattern?: PatternFillOptions;
}

/**
 * Stroke definition for a drawing object.
 */
export interface DrawingStroke {
  /** Stroke color [r, g, b] each 0-1. */
  color: [number, number, number];
  /** Line width in points. */
  width: number;
  /** Dash pattern segments. */
  dashPattern?: number[];
  /** Line cap style. */
  cap?: 'butt' | 'round' | 'square';
  /** Line join style. */
  join?: 'miter' | 'round' | 'bevel';
}

/**
 * A drawing object that can be rendered to a RenderBackend.
 * Simplified from @mog/drawing-engine DrawingObject.
 */
export interface DrawingObject {
  /** Object type. */
  type: 'shape' | 'group' | 'image' | 'text';
  /** Bounding box in parent coordinate space. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Optional affine transform matrix. */
  transform?: { a: number; b: number; c: number; d: number; tx: number; ty: number };
  /** Fill specification. */
  fill?: DrawingFill;
  /** Stroke specification. */
  stroke?: DrawingStroke;
  /** Text content for shapes with text. */
  text?: {
    runs: TextRun[];
    insets: { top: number; right: number; bottom: number; left: number };
  };
  /** Child objects (for groups). */
  children?: DrawingObject[];
  /** Image data (for image type). */
  imageSrc?: Uint8Array;
  /** Image format (for image type). */
  imageFormat?: 'jpeg' | 'png';
  /** Shape path segments for custom shapes. */
  shapePath?: ShapePathSegment[];
}

/**
 * Simple shape path segment for rendering custom shapes.
 * Mirrors the geometry Path segment types.
 */
export type ShapePathSegment =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

/**
 * Render a drawing object to a RenderBackend.
 *
 * This is the main entry point. It handles all object types:
 * - shape: fill + stroke + text
 * - group: recursive children
 * - image: drawImage
 * - text: drawTextRuns
 */
export function renderDrawingObject(obj: DrawingObject, backend: RenderBackend): void {
  backend.save();

  // Apply transform if present
  if (obj.transform) {
    const { a, b, c, d, tx, ty } = obj.transform;
    backend.transform(a, b, c, d, tx, ty);
  }

  switch (obj.type) {
    case 'shape':
      renderShape(obj, backend);
      break;
    case 'group':
      renderGroup(obj, backend);
      break;
    case 'image':
      renderImage(obj, backend);
      break;
    case 'text':
      renderTextObject(obj, backend);
      break;
  }

  backend.restore();
}

/**
 * Render a shape object: build path, apply fill, apply stroke, render text.
 */
function renderShape(obj: DrawingObject, backend: RenderBackend): void {
  const { x, y, width, height } = obj.bounds;

  // Build shape path
  if (obj.shapePath && obj.shapePath.length > 0) {
    replayShapePath(obj.shapePath, backend);
  } else {
    // Default: rectangle shape
    backend.rect(x, y, width, height);
  }

  // Apply fill
  if (obj.fill) {
    renderFill(obj.fill, backend, x, y, width, height);
  }

  // Apply stroke
  if (obj.stroke) {
    // Re-build path for stroke (fill consumes the path in PDF)
    if (obj.shapePath && obj.shapePath.length > 0) {
      replayShapePath(obj.shapePath, backend);
    } else {
      backend.rect(x, y, width, height);
    }
    renderStroke(obj.stroke, backend);
  }

  // Render text in shape
  if (obj.text && obj.text.runs.length > 0) {
    renderTextInShape(obj, backend);
  }
}

/**
 * Render a group object: recursively render all children.
 */
function renderGroup(obj: DrawingObject, backend: RenderBackend): void {
  if (!obj.children) return;

  for (const child of obj.children) {
    renderDrawingObject(child, backend);
  }
}

/**
 * Render an image object.
 */
function renderImage(obj: DrawingObject, backend: RenderBackend): void {
  if (!obj.imageSrc || !obj.imageFormat) return;

  const { x, y, width, height } = obj.bounds;
  backend.drawImage(obj.imageSrc, obj.imageFormat, x, y, width, height);
}

/**
 * Render a standalone text object.
 */
function renderTextObject(obj: DrawingObject, backend: RenderBackend): void {
  if (!obj.text || obj.text.runs.length === 0) return;

  const { x, y, width } = obj.bounds;
  const insets = obj.text.insets;
  const textX = x + insets.left;
  const textY = y + insets.top;
  const maxWidth = width - insets.left - insets.right;

  backend.drawTextRuns(obj.text.runs, textX, textY, {
    maxWidth: Math.max(0, maxWidth),
    lineHeight: 14, // Default line height
  });
}

/**
 * Apply a fill to the current path.
 */
function renderFill(
  fill: DrawingFill,
  backend: RenderBackend,
  _x: number,
  _y: number,
  _w: number,
  _h: number,
): void {
  // Set alpha if specified
  if (fill.alpha !== undefined && fill.alpha < 1) {
    backend.setFillAlpha(fill.alpha);
  }

  switch (fill.type) {
    case 'solid': {
      if (fill.color) {
        backend.setFillColor(fill.color[0], fill.color[1], fill.color[2]);
      }
      backend.fill();
      break;
    }

    case 'linear-gradient':
    case 'radial-gradient': {
      // For gradients, we need to generate the gradient ops.
      // The gradient modules generate self-contained op sequences that
      // include their own clipping and color setting.
      // Since we're using the RenderBackend API, we use the fill color
      // as a fallback and note that full gradient support requires
      // the gradient-fill module to generate ops at a lower level.
      if (fill.color) {
        backend.setFillColor(fill.color[0], fill.color[1], fill.color[2]);
      }
      backend.fill();
      break;
    }

    case 'pattern': {
      // Pattern fills: use the pattern foreground color for the fill
      // (full pattern tiling requires lower-level ContentOp generation)
      if (fill.pattern && fill.pattern.foreColor) {
        const [r, g, b] = fill.pattern.foreColor;
        backend.setFillColor(r, g, b);
      } else if (fill.color) {
        backend.setFillColor(fill.color[0], fill.color[1], fill.color[2]);
      }
      backend.fill();
      break;
    }
  }

  // Reset alpha
  if (fill.alpha !== undefined && fill.alpha < 1) {
    backend.setFillAlpha(1.0);
  }
}

/**
 * Apply a stroke to the current path.
 */
function renderStroke(stroke: DrawingStroke, backend: RenderBackend): void {
  backend.setStrokeColor(stroke.color[0], stroke.color[1], stroke.color[2]);
  backend.setLineWidth(stroke.width);

  if (stroke.dashPattern && stroke.dashPattern.length > 0) {
    backend.setLineDash(stroke.dashPattern, 0);
  }

  if (stroke.cap) {
    backend.setLineCap(stroke.cap);
  }

  if (stroke.join) {
    backend.setLineJoin(stroke.join);
  }

  backend.stroke();
}

/**
 * Render text within a shape, respecting text insets.
 */
function renderTextInShape(obj: DrawingObject, backend: RenderBackend): void {
  if (!obj.text) return;

  const { x, y, width } = obj.bounds;
  const insets = obj.text.insets;
  const textX = x + insets.left;
  const textY = y + insets.top;
  const maxWidth = width - insets.left - insets.right;

  backend.drawTextRuns(obj.text.runs, textX, textY, {
    maxWidth: Math.max(0, maxWidth),
    lineHeight: 14,
  });
}

/**
 * Replay shape path segments to a RenderBackend.
 */
function replayShapePath(segments: ShapePathSegment[], backend: RenderBackend): void {
  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
        backend.moveTo(seg.x, seg.y);
        break;
      case 'L':
        backend.lineTo(seg.x, seg.y);
        break;
      case 'C':
        backend.curveTo(seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y);
        break;
      case 'Z':
        backend.closePath();
        break;
    }
  }
}
