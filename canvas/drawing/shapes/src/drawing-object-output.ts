import type {
  DrawingEffects,
  DrawingFill,
  DrawingObject,
  DrawingStroke,
} from '@mog-sdk/contracts/drawing';
import type { Scene3D, Shape3D } from '@mog-sdk/contracts/drawing/three-d';
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { ShapeAdjustment } from './presets/registry';
import { generateShapePath } from './shape-to-path';
import { computeTextInset } from './text-in-shape';

/**
 * Visual properties that can be applied to a shape.
 * All colors must be concrete (resolved from theme upstream).
 */
export interface ShapeVisualProperties {
  fill?: DrawingFill;
  stroke?: DrawingStroke;
  effects?: DrawingEffects;
  /** 3D scene properties (camera + lighting) from OOXML scene3d. */
  scene3d?: Scene3D;
  /** 3D shape properties (bevels, extrusion, material) from OOXML sp3d. */
  sp3d?: Shape3D;
  text?: {
    content: string;
    style?: {
      fontFamily?: string;
      fontSize?: number;
      fontWeight?: 'normal' | 'bold';
      fontStyle?: 'normal' | 'italic';
      color?: string;
      align?: 'left' | 'center' | 'right';
      verticalAlign?: 'top' | 'middle' | 'bottom';
    };
  };
}

/**
 * Create a DrawingObject from a shape type, dimensions, and optional visual properties.
 *
 * This is the primary output API for shape-engine. The returned DrawingObject
 * can be passed directly to drawing-engine/renderer for Canvas2D or SVG rendering.
 *
 * @param shapeType - Registered shape type (e.g., 'roundedRectangle', 'star5')
 * @param width - Shape width in pixels
 * @param height - Shape height in pixels
 * @param adjustments - Optional shape adjustment handles
 * @param visual - Optional visual properties (fill, stroke, effects, text)
 */
export function createDrawingObject(
  shapeType: string,
  width: number,
  height: number,
  adjustments?: ShapeAdjustment[],
  visual?: ShapeVisualProperties,
): DrawingObject {
  // Guard against NaN/Infinity dimensions — clamp to safe defaults
  const safeWidth = !isFinite(width) || isNaN(width) || width < 0 ? 0 : width;
  const safeHeight = !isFinite(height) || isNaN(height) || height < 0 ? 0 : height;

  // Generate the shape geometry
  const geometry = generateShapePath(shapeType, safeWidth, safeHeight, adjustments);

  const obj: DrawingObject = { geometry };

  if (visual) {
    if (visual.fill) {
      if (
        visual.fill.type === 'solid' &&
        visual.fill.opacity !== undefined &&
        (!isFinite(visual.fill.opacity) || isNaN(visual.fill.opacity))
      ) {
        obj.fill = { ...visual.fill, opacity: 1 };
      } else {
        obj.fill = visual.fill;
      }
    }
    if (visual.stroke) obj.stroke = visual.stroke;
    if (visual.effects) obj.effects = visual.effects;
    if (visual.scene3d) obj.scene3d = visual.scene3d;
    if (visual.sp3d) obj.sp3d = visual.sp3d;

    // Map text to DrawingTextBody if present
    if (visual.text) {
      const box: BoundingBox = { x: 0, y: 0, width: safeWidth, height: safeHeight };
      const inset = computeTextInset(shapeType, box, adjustments);

      obj.text = {
        paragraphs: [
          {
            runs: [
              {
                text: visual.text.content,
                style: visual.text.style
                  ? {
                      fontFamily: visual.text.style.fontFamily,
                      fontSize: visual.text.style.fontSize,
                      fontWeight: visual.text.style.fontWeight,
                      fontStyle: visual.text.style.fontStyle,
                      color: visual.text.style.color,
                    }
                  : undefined,
              },
            ],
            align: visual.text.style?.align,
          },
        ],
        insets: {
          top: inset.insetBox.y,
          right: safeWidth - (inset.insetBox.x + inset.insetBox.width),
          bottom: safeHeight - (inset.insetBox.y + inset.insetBox.height),
          left: inset.insetBox.x,
        },
        anchor: (visual.text.style?.verticalAlign as 'top' | 'middle' | 'bottom') || 'top',
        wrap: true,
      };
    }
  }

  return obj;
}
