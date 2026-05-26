/**
 * Text-in-shape layout computation.
 *
 * Computes the usable text area within a shape's bounding box,
 * accounting for the shape geometry and margins.
 */
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { ShapeAdjustment } from './presets/registry';
import { getTextInsetConfig } from './presets/registry';

// Ensure all presets (and their registerTextInset calls) are loaded
import './presets/basic';
import './presets/spec-presets';

export interface TextInShapeResult {
  /** The usable text area within the shape */
  insetBox: BoundingBox;
  /** Vertical alignment of text within the inset box */
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** Margins from shape boundary to text area */
  margins: { top: number; right: number; bottom: number; left: number };
}

/**
 * Compute the text inset box for a given shape type.
 *
 * Different shapes have different usable text areas. A diamond, for example,
 * has a much smaller text area than a rectangle of the same bounding box.
 *
 * Text inset configuration is colocated with shape presets via registerTextInset().
 * Shapes without explicit configuration fall back to a default 5% margin.
 *
 * @param shapeType - The shape type name
 * @param shapeBounds - The shape's bounding box
 * @param adjustments - Optional shape-specific adjustments
 * @returns The text inset result
 */
export function computeTextInset(
  shapeType: string,
  shapeBounds: BoundingBox,
  adjustments?: ShapeAdjustment[],
): TextInShapeResult {
  const { x, y, width: w, height: h } = shapeBounds;
  const adj = adjustments ?? [];

  // Check registry for colocated text inset config
  const registeredConfig = getTextInsetConfig(shapeType);
  if (registeredConfig) {
    if ('compute' in registeredConfig) {
      return registeredConfig.compute(shapeBounds, adj);
    }
    const mf = registeredConfig.marginFraction;
    const mx = mf * w;
    const my = mf * h;
    return {
      insetBox: {
        x: x + mx,
        y: y + my,
        width: Math.max(0, w - mx * 2),
        height: Math.max(0, h - my * 2),
      },
      verticalAlign: registeredConfig.verticalAlign ?? 'middle',
      margins: { top: my, right: mx, bottom: my, left: mx },
    };
  }

  // Default: 5% margin for shapes without explicit text inset configuration
  const marginFraction = 0.05;
  const mx = marginFraction * w;
  const my = marginFraction * h;

  return {
    insetBox: {
      x: x + mx,
      y: y + my,
      width: Math.max(0, w - mx * 2),
      height: Math.max(0, h - my * 2),
    },
    verticalAlign: 'middle',
    margins: { top: my, right: mx, bottom: my, left: mx },
  };
}
