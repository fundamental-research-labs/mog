import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import { strokeToPath } from './stroke';
import type { Stroke } from './types';

/**
 * Convert an ink Stroke to a DrawingObject.
 *
 * The stroke's variable-width outline (computed by strokeToPath via pressure data)
 * becomes the geometry. The path IS the filled shape -- no separate stroke needed,
 * because strokeToPath already produces the outline of the variable-width pen stroke.
 */
export function strokeToDrawingObject(stroke: Stroke): DrawingObject {
  const geometry = strokeToPath(stroke);

  return {
    geometry,
    fill: {
      type: 'solid',
      color: stroke.color,
      opacity: stroke.opacity,
    },
    // No stroke -- the path IS the filled variable-width outline
  };
}
