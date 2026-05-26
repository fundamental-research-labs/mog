/**
 * Warp Preset Type Definitions
 *
 * This file contains type definitions for warp presets used in text effects.
 * These types define the structure of preset metadata and categorization.
 *
 * IMPORTANT: This file contains ONLY type definitions (no runtime data).
 * The actual WARP_PRESETS Map with 35 preset configurations belongs in
 * engine/src/text-effects/presets.ts and will be implemented as part of 02-TEXT-WARPING.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.78 (ST_TextShapeType) for preset specs
 */

import type { AdjustmentValues, TextWarpPreset } from './types';

// =============================================================================
// Adjustment Range
// =============================================================================

/**
 * Defines the valid range for an adjustment value.
 *
 * Each warp preset can have 0-2 adjustment handles that control its shape.
 * This interface defines the min/max bounds for each adjustment value.
 *
 * @example
 * // Arc height adjustment from 0% to 100%
 * const arcRange: AdjustmentRange = { min: 0, max: 100 };
 *
 * // Wave amplitude that can go negative
 * const waveRange: AdjustmentRange = { min: -100, max: 100 };
 */
export interface AdjustmentRange {
  /** Minimum allowed value for this adjustment */
  min: number;
  /** Maximum allowed value for this adjustment */
  max: number;
}

// =============================================================================
// Warp Category
// =============================================================================

/**
 * Categories for organizing warp presets in the gallery UI.
 *
 * - 'basic': No transformation (textPlain only)
 * - 'follow-path': Text follows a curved path (arcs, circles, rings)
 * - 'warp': Text is geometrically distorted (waves, inflate/deflate, triangles)
 * - 'perspective': Text has perspective/fade effects (slants, cascades, fades)
 *
 * @example
 * // Category counts:
 * // basic: 1 (textPlain)
 * // follow-path: 10 (arcs, circles, buttons, rings)
 * // warp: 16 (waves, inflate/deflate, triangles, chevrons)
 * // perspective: 8 (fades, slants, cascades)
 */
export type WarpCategory = 'basic' | 'follow-path' | 'warp' | 'perspective';

// =============================================================================
// Warp Preset Definition
// =============================================================================

/**
 * Metadata definition for a warp preset.
 *
 * Contains all the information needed to display and configure a warp preset
 * in the UI, including display name, description, adjustment parameters, and
 * category for gallery organization.
 *
 * NOTE: This is a TYPE definition only. The actual preset data (WARP_PRESETS Map)
 * is implemented in engine/src/text-effects/presets.ts, not in contracts.
 * Contracts package contains only types, no runtime data.
 *
 * @example
 * // Example preset definition (for reference - actual data is in engine/)
 * const archUpPreset: WarpPresetDefinition = {
 *   id: 'textArchUp',
 *   name: 'Arch Up',
 *   description: 'Text curves upward along an arc',
 *   adjustmentCount: 1,
 *   defaultAdjustments: { adj1: 50 },
 *   adjustmentRanges: { adj1: { min: 0, max: 100 } },
 *   category: 'follow-path'
 * };
 */
export interface WarpPresetDefinition {
  /**
   * Unique preset identifier matching the TextWarpPreset type.
   * This is the value stored in the text-effect configuration's warpPreset.
   */
  id: TextWarpPreset;

  /**
   * Human-readable display name for the preset.
   * Shown in the text-effect gallery and format panel.
   *
   * @example 'Arch Up', 'Wave 1', 'Inflate'
   */
  name: string;

  /**
   * Description text for gallery tooltips.
   * Provides users with a brief explanation of the effect.
   *
   * @example 'Text curves upward along an arc'
   */
  description: string;

  /**
   * Number of adjustment handles this preset supports.
   * - 0: No adjustments (e.g., textPlain)
   * - 1: Single adjustment (e.g., textArchUp has arc height)
   * - 2: Two adjustments (e.g., textWave1 has amplitude and frequency)
   */
  adjustmentCount: 0 | 1 | 2;

  /**
   * Default values for the adjustment handles.
   * Applied when the preset is first selected.
   *
   * @example { adj1: 50 } for single-adjustment presets
   * @example { adj1: 20, adj2: 0 } for dual-adjustment presets
   */
  defaultAdjustments: AdjustmentValues;

  /**
   * Optional min/max ranges for each adjustment value.
   * Used for UI sliders and validation.
   * If not specified, the adjustment has no enforced range.
   */
  adjustmentRanges?: {
    /** Range for primary adjustment (if preset has adjustmentCount >= 1) */
    adj1?: AdjustmentRange;
    /** Range for secondary adjustment (if preset has adjustmentCount >= 2) */
    adj2?: AdjustmentRange;
  };

  /**
   * Category for organizing presets in the gallery UI.
   * Presets are grouped by category for easier browsing.
   */
  category: WarpCategory;

  /**
   * Optional thumbnail image for the gallery.
   * Can be a base64-encoded data URL or a URL path to an image asset.
   * Used for visual preview in the text-effect gallery picker.
   *
   * @example 'data:image/png;base64,iVBORw0KGgo...'
   * @example '/assets/text-effects/thumbnails/arch-up.png'
   */
  thumbnail?: string;
}
