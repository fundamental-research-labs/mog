/**
 * Main shape-to-path entry point.
 *
 * Converts a shape type + dimensions + adjustments into a geometric Path.
 */
import { PathOps, Transform } from '@mog/geometry';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { ShapeAdjustment } from './presets/registry';
import {
  getAllPresetNames,
  getPreset,
  getPresetDefaults,
  getScalingMode,
  hasPreset,
} from './presets/registry';

// Ensure all presets are registered by importing their modules
import './presets/arrows';
import './presets/basic';
import './presets/callouts';
import './presets/flowchart';
import './presets/math';
import './presets/spec-presets';
import './presets/stars';

/**
 * Generate a path for a given shape type at the given dimensions.
 *
 * @param shapeType - The shape type name (must match a registered preset)
 * @param width - The width of the bounding box
 * @param height - The height of the bounding box
 * @param adjustments - Optional shape-specific adjustment handles
 * @returns The generated Path
 * @throws Error if the shape type is not registered
 */
export function generateShapePath(
  shapeType: string,
  width: number,
  height: number,
  adjustments?: ShapeAdjustment[],
): Path {
  const generator = getPreset(shapeType);
  if (!generator) {
    throw new Error(`Unknown shape type: "${shapeType}". Use isValidShapeType() to check first.`);
  }
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const adj = adjustments ?? [];

  const mode = getScalingMode(shapeType);
  if (mode === 'uniform' && w !== h) {
    const s = Math.min(w, h);
    const path = generator(s, s, adj);
    const tx = (w - s) / 2;
    const ty = (h - s) / 2;
    return PathOps.transformPath(path, Transform.translate(tx, ty));
  }
  return generator(w, h, adj);
}

/**
 * Get the default adjustments for a shape type.
 * All defaults are now registered via registerPreset() in the preset files.
 */
export function getDefaultAdjustments(shapeType: string): ShapeAdjustment[] {
  return getPresetDefaults(shapeType) ?? [];
}

/**
 * Check if a shape type is registered and can generate a path.
 */
export function isValidShapeType(shapeType: string): boolean {
  return hasPreset(shapeType);
}

/**
 * Get all registered shape type names.
 */
export function getRegisteredShapeTypes(): string[] {
  return getAllPresetNames();
}
