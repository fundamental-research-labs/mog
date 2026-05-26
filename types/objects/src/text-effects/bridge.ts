/**
 * text effects Bridge Interface
 *
 * Bridge interface for text effects warp computation. Separated from `types.ts`
 * so the core type module does not depend on preset metadata, breaking the
 * `types.ts ↔ presets.ts` import cycle. The bridge sits one layer above
 * both: it consumes core text effects types and preset metadata.
 *
 * @see ECMA-376 Part 1, Section 20.1.10 (Text Body Properties)
 */

import type { TextWarpPreset, WarpedTextPath, TextEffectConfig } from './types';
import type { WarpPresetDefinition } from './presets';

/**
 * Bridge interface for text effects warp computation.
 *
 * The bridge provides methods for computing warp paths and retrieving preset
 * definitions. It can be used in background threads for heavy computation
 * without blocking the main thread.
 *
 * IMPORTANT: This interface returns portable WarpedTextPath data structures
 * rather than browser-specific Path2D objects. The conversion to Path2D
 * happens in the renderer layer for optimal performance in the browser.
 *
 * @see WarpedTextPath for the output data structure
 * @see WarpPresetDefinition for preset metadata
 */
export interface ITextEffectBridge {
  /**
   * Compute the warp path for text with the given configuration.
   *
   * This is the core warp computation method. It takes text content,
   * text-effect configuration, font size, and bounding box dimensions,
   * and returns a WarpedTextPath with SVG path data and glyph transforms.
   *
   * @param text The text content to warp
   * @param config The text-effect configuration containing warp preset and adjustments
   * @param fontSize The font size in pixels (affects glyph spacing and scaling)
   * @param bounds The bounding box dimensions for the warped text
   * @returns Computed warp path with SVG paths and per-glyph transforms
   *
   * @example
   * const warpedPath = bridge.computeWarpPath(
   *   'Hello World',
   *   { warpPreset: 'textArchUp', fill: { type: 'solid', color: '#000' } },
   *   36,
   *   { width: 200, height: 100 }
   * );
   */
  computeWarpPath(
    text: string,
    config: TextEffectConfig,
    fontSize: number,
    bounds: { width: number; height: number },
  ): WarpedTextPath;

  /**
   * Get the preset definition for a warp preset type.
   *
   * Returns metadata about the preset including display name, description,
   * default adjustment values, and category. Returns undefined if the
   * preset type is not recognized.
   *
   * @param preset The warp preset identifier
   * @returns Preset definition or undefined if not found
   *
   * @example
   * const def = bridge.getPresetDefinition('textArchUp');
   * if (def) {
   *   console.log(def.name); // 'Arch Up'
   *   console.log(def.defaultAdjustments); // { adj1: 50 }
   * }
   */
  getPresetDefinition(preset: TextWarpPreset): WarpPresetDefinition | undefined;

  /**
   * Get the default text-effect configuration.
   *
   * Returns a configuration with sensible defaults for creating new text effects:
   * - warpPreset: 'textPlain' (no warp)
   * - fill: Blue gradient
   * - effects: Subtle outer shadow
   *
   * @returns Default text-effect configuration
   *
   * @example
   * const config = bridge.getDefaultConfig();
   * // Customize from defaults
   * config.warpPreset = 'textArchUp';
   */
  getDefaultConfig(): TextEffectConfig;
}
