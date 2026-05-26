/**
 * TextEffect Types
 *
 * Type definitions for TextEffect text effects (DrawingML text warp).
 * TextEffect is implemented as an extension to TextBoxObject.
 *
 * @example
 * import {
 *   TextEffectConfig,
 *   TextWarpPreset,
 *   isTextEffectConfig
 * } from '@mog-sdk/contracts/text-effects';
 */

// =============================================================================
// Core TextEffect Types
// =============================================================================

export type {
  AdjustmentValues,
  CompoundLine,
  GlyphTransform,
  GradientFill,
  GradientStop,
  GradientType,
  LineCap,
  LineDash,
  LineJoin,
  NoFill,
  PatternFill,
  PatternType,
  SolidFill,
  // Warp preset types
  TextWarpPreset,
  TileFlipMode,
  // Computed warp output
  WarpedTextPath,
  // Main configuration
  TextEffectConfig,
  TextEffectConfigUpdate,

  // Fill types
  TextEffectFill,
  TextEffectFillType,
  // Outline types
  TextEffectOutline,
} from './types';

// =============================================================================
// Bridge Interface
// =============================================================================

export type { ITextEffectBridge } from './bridge';

// =============================================================================
// Text Effects Types
// =============================================================================

export type {
  // 3D effects
  BevelEffect,
  BevelPreset,
  // Other effects
  GlowEffect,
  InnerShadowEffect,
  LightDirection,
  LightRigType,
  MaterialPreset,
  // Shadow effects
  OuterShadowEffect,
  PresetShadowType,
  ReflectionEffect,
  ShadowAlignment,
  SoftEdgeEffect,
  // Effect container
  TextEffects,
  Transform3DEffect,
} from './effects';

// =============================================================================
// Preset Definition Types
// =============================================================================

export type { AdjustmentRange, WarpCategory, WarpPresetDefinition } from './presets';
