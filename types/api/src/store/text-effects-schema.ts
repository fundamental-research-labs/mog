/**
 * TextEffect Schema - Type Definitions Only
 *
 * Runtime schema objects, defaults, factory functions, and utility functions have been moved to:
 * @see @mog-sdk/kernel/defaults/text-effects
 *
 * This file retains only the type exports for the contracts layer.
 */

/**
 * Type for the schema keys - all valid TextEffectConfig field names.
 */
export type TextEffectSchemaField =
  | 'warpPreset'
  | 'warpAdjustments'
  | 'fill'
  | 'outline'
  | 'effects'
  | 'followPath'
  | 'anchor'
  | 'textDirection'
  | 'normalizeHeights';
