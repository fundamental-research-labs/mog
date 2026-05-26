/**
 * Text-Effect Types
 *
 * Implements DrawingML text warp and effects from ECMA-376 Part 1.
 * Decorative text is NOT a separate floating object type - it's a configuration
 * that can be applied to TextBoxObject to add warping and effects.
 *
 * @see ECMA-376 Part 1, Section 20.1.10 (Text Body Properties)
 * @see ECMA-376 Part 1, Section 20.1.10.78 (ST_TextShapeType)
 */

// =============================================================================
// Text Warp Presets (41 from DrawingML ST_TextShapeType)
// =============================================================================

/**
 * Text warp preset types from ECMA-376 DrawingML specification.
 * Canonical source for ST_TextShapeType (dml-main.xsd, Section 20.1.10.78).
 *
 * These define how text is geometrically transformed along a path.
 * Each preset has its own algorithm for computing the warp path.
 *
 * Note: Includes 'textNoShape' for OOXML compatibility - this represents
 * text with no warp transformation applied (distinct from 'textPlain').
 *
 * An identical type exists in the auto-generated bridge file
 * (rust-bridge/bridge-ts/generated/ooxml-types.ts) with PascalCase casing.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.78 (ST_TextShapeType)
 */
export type TextWarpPreset =
  // No warp (plain text)
  | 'textNoShape' // OOXML compatibility - no shape transformation
  | 'textPlain' // Plain text with no transformation

  // Arc paths (text follows curved arc)
  | 'textArchUp'
  | 'textArchDown'
  | 'textCircle'
  | 'textButton'

  // Arc paths with fill (poured effect)
  | 'textArchUpPour'
  | 'textArchDownPour'
  | 'textCirclePour'
  | 'textButtonPour'

  // Curve effects (upward/downward Bezier curves)
  | 'textCurveUp'
  | 'textCurveDown'

  // Wave effects (sinusoidal distortion)
  | 'textWave1'
  | 'textWave2'
  | 'textDoubleWave1'
  | 'textWave4'

  // Inflate/deflate effects (bulge/pinch)
  | 'textInflate'
  | 'textDeflate'
  | 'textInflateBottom'
  | 'textDeflateBottom'
  | 'textInflateTop'
  | 'textDeflateTop'
  | 'textDeflateInflate'
  | 'textDeflateInflateDeflate'

  // Fade effects (perspective scaling)
  | 'textFadeRight'
  | 'textFadeLeft'
  | 'textFadeUp'
  | 'textFadeDown'

  // Slant effects (shear transformation)
  | 'textSlantUp'
  | 'textSlantDown'

  // Cascade effects (stair-step)
  | 'textCascadeUp'
  | 'textCascadeDown'

  // Additional geometric warps
  | 'textTriangle'
  | 'textTriangleInverted'
  | 'textChevron'
  | 'textChevronInverted'
  | 'textRingInside'
  | 'textRingOutside'
  | 'textStop'
  | 'textCanUp'
  | 'textCanDown';

// =============================================================================
// Adjustment Values
// =============================================================================

/**
 * Adjustment values for fine-tuning warp parameters.
 *
 * Each warp preset has 0-2 adjustment handles that control its shape.
 * Values are percentages (typically 0-100) or absolute values depending on preset.
 * The specific meaning of each adjustment depends on the preset type.
 *
 * @see ECMA-376 Part 1, Section 20.1.9.9 (CT_GeomGuideList)
 *
 * @example
 * // textArchUp has one adjustment (arc height)
 * { adj1: 50 }  // 50% arc height
 *
 * @example
 * // textWave1 has two adjustments (amplitude, frequency)
 * { adj1: 20, adj2: 30 }
 */
export interface AdjustmentValues {
  /**
   * Primary adjustment value.
   * Meaning depends on the warp preset:
   * - Arc presets: arc height/curvature
   * - Wave presets: amplitude
   * - Inflate/deflate: bulge amount
   * - Fade presets: fade percentage
   */
  adj1?: number;

  /**
   * Secondary adjustment value.
   * Meaning depends on the warp preset:
   * - Wave presets: phase offset
   * - Pour presets: inner radius
   * - Some geometric presets: secondary parameter
   */
  adj2?: number;
}

// =============================================================================
// Glyph Transform
// =============================================================================

/**
 * Transform for a single character/glyph in warped text.
 *
 * When text is warped, each character needs individual positioning
 * and transformation to follow the warp path correctly.
 */
export interface GlyphTransform {
  /** Character index in the text string (0-based) */
  charIndex: number;

  /** X position along the warp path in pixels */
  x: number;

  /** Y position along the warp path in pixels */
  y: number;

  /** Rotation angle in radians (tangent to the warp path) */
  rotation: number;

  /**
   * Horizontal scale factor for perspective effects.
   * Values > 1 stretch horizontally, < 1 compress.
   */
  scaleX: number;

  /**
   * Vertical scale factor for perspective effects.
   * Values > 1 stretch vertically, < 1 compress.
   */
  scaleY: number;

  /**
   * Opacity for this glyph (0-1).
   * Used for fade effects where characters gradually become transparent.
   */
  opacity?: number;
}

// =============================================================================
// Warped Text Path
// =============================================================================

/**
 * Computed warp path for rendering.
 *
 * The warp algorithm transforms text bounding boxes into distorted paths.
 * This is the output of the warp computation, used by the renderer.
 * Contains SVG path data for the warp envelope and per-glyph transforms.
 */
export interface WarpedTextPath {
  /**
   * SVG path data for the top edge of the text block.
   * Used for clipping and visual effects.
   */
  topPath: string;

  /**
   * SVG path data for the bottom edge of the text block.
   * Used for clipping and visual effects.
   */
  bottomPath: string;

  /**
   * Transform matrix for each character/glyph position.
   * Ordered by character index in the text string.
   */
  glyphTransforms: GlyphTransform[];

  /**
   * Overall bounds after warping (in pixels).
   * Used for hit testing and layout calculations.
   */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /**
   * Original text bounds before warping (in pixels).
   * Useful for calculating relative offsets.
   */
  originalBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// =============================================================================
// Fill Types
// =============================================================================

/**
 * Fill type discriminator for text-effect text.
 * @see ECMA-376 Part 1, Section 20.1.8 (Fill Properties)
 */
export type TextEffectFillType = 'solid' | 'gradient' | 'pattern' | 'none';

/**
 * Gradient type for gradient fills.
 * @see ECMA-376 Part 1, Section 20.1.8.41 (CT_LinearGradientFill)
 */
export type GradientType = 'linear' | 'radial' | 'path';

/** Tile flip mode for pattern and texture fills. Maps to ST_TileFlipMode (ECMA-376, dml-main.xsd). Uses lowercase variants; bridge uses PascalCase. */
export type TileFlipMode = 'none' | 'x' | 'y' | 'xy';

/** GradientStop — text-effect layer. Maps to CT_GradientStop (dml-main.xsd:1539) with position as 0-100% + CSS color. */
export interface GradientStop {
  /** Position along gradient (0-100 as percentage) */
  position: number;

  /** Color at this position (CSS color string: hex, rgb, rgba, hsl, named) */
  color: string;

  /** Opacity at this position (0-1, where 1 is fully opaque) */
  opacity?: number;
}

/**
 * Solid fill — post-theme-resolution using CSS color strings. The OOXML raw version (with DrawingColor) is in the generated ooxml-types.ts bridge.
 * @see ECMA-376 Part 1, Section 20.1.8.51 (CT_SolidColorFillProperties)
 */
export interface SolidFill {
  type: 'solid';

  /** Fill color (CSS color string: hex, rgb, rgba, hsl, named) */
  color: string;

  /** Opacity (0-1, where 0 is fully transparent, 1 is fully opaque) */
  opacity?: number;
}

/**
 * Gradient fill — post-theme-resolution using CSS color strings. The OOXML raw version (with DrawingColor) is in the generated ooxml-types.ts bridge.
 * @see ECMA-376 Part 1, Section 20.1.8.33 (CT_GradientFillProperties)
 */
export interface GradientFill {
  type: 'gradient';

  /** Type of gradient (linear, radial, or path-based) */
  gradientType: GradientType;

  /**
   * Angle in degrees for linear gradients.
   * 0 = left to right, 90 = top to bottom, 180 = right to left, 270 = bottom to top.
   */
  angle?: number;

  /**
   * Gradient stops (minimum 2 required).
   * Defines the colors and their positions along the gradient.
   */
  stops: GradientStop[];

  /**
   * Focus point X for radial gradients (0-100 as percentage).
   * Defines the horizontal center of the radial gradient.
   */
  focusX?: number;

  /**
   * Focus point Y for radial gradients (0-100 as percentage).
   * Defines the vertical center of the radial gradient.
   */
  focusY?: number;

  /**
   * Whether the gradient should rotate with the shape.
   * Default is true.
   */
  rotateWithShape?: boolean;
}

/**
 * Pattern types from DrawingML.
 * These are predefined hatch and fill patterns.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.46 (ST_PresetPatternVal)
 */
export type PatternType =
  // Percentage patterns
  | 'pct5'
  | 'pct10'
  | 'pct20'
  | 'pct25'
  | 'pct30'
  | 'pct40'
  | 'pct50'
  | 'pct60'
  | 'pct70'
  | 'pct75'
  | 'pct80'
  | 'pct90'
  // Horizontal/vertical lines
  | 'horz'
  | 'vert'
  | 'ltHorz'
  | 'ltVert'
  | 'dkHorz'
  | 'dkVert'
  | 'narHorz'
  | 'narVert'
  | 'dashHorz'
  | 'dashVert'
  // Cross patterns
  | 'cross'
  | 'dnDiag'
  | 'upDiag'
  | 'ltDnDiag'
  | 'ltUpDiag'
  | 'dkDnDiag'
  | 'dkUpDiag'
  | 'wdDnDiag'
  | 'wdUpDiag'
  | 'dashDnDiag'
  | 'dashUpDiag'
  | 'diagCross'
  // Check patterns
  | 'smCheck'
  | 'lgCheck'
  // Grid patterns
  | 'smGrid'
  | 'lgGrid'
  | 'dotGrid'
  // Confetti patterns
  | 'smConfetti'
  | 'lgConfetti'
  // Brick patterns
  | 'horzBrick'
  | 'diagBrick'
  // Diamond patterns
  | 'solidDmnd'
  | 'openDmnd'
  | 'dotDmnd'
  // Decorative patterns
  | 'plaid'
  | 'sphere'
  | 'weave'
  | 'divot'
  | 'shingle'
  | 'wave'
  | 'trellis'
  | 'zigZag';

/**
 * Pattern fill — post-theme-resolution using CSS color strings. The OOXML raw version (with DrawingColor) is in the generated ooxml-types.ts bridge.
 * @see ECMA-376 Part 1, Section 20.1.8.47 (CT_PatternFillProperties)
 */
export interface PatternFill {
  type: 'pattern';

  /** Pattern type (matches DrawingML preset patterns) */
  pattern: PatternType;

  /** Foreground color (CSS color string: hex, rgb, rgba, hsl, named) */
  fgColor: string;

  /** Background color (CSS color string: hex, rgb, rgba, hsl, named) */
  bgColor: string;

  /** Opacity for the entire pattern (0-1) */
  opacity?: number;
}

/**
 * No fill (transparent).
 * Text will be rendered without any fill color.
 *
 * @see ECMA-376 Part 1, Section 20.1.8.45 (CT_NoFillProperties)
 */
export interface NoFill {
  type: 'none';
}

/**
 * Union type for all fill types.
 * Used for text-effect text fill configuration.
 */
export type TextEffectFill = SolidFill | GradientFill | PatternFill | NoFill;

// =============================================================================
// Outline/Stroke Types
// =============================================================================

/**
 * Line dash style for outlines.
 * @see ECMA-376 Part 1, Section 20.1.10.48 (ST_PresetLineDashVal)
 */
export type LineDash =
  | 'solid' // Solid line
  | 'dot' // Dotted line
  | 'dash' // Dashed line
  | 'dashDot' // Dash-dot pattern
  | 'lgDash' // Long dash
  | 'lgDashDot' // Long dash-dot
  | 'lgDashDotDot' // Long dash-dot-dot
  | 'sysDash' // System dash
  | 'sysDot' // System dot
  | 'sysDashDot' // System dash-dot
  | 'sysDashDotDot'; // System dash-dot-dot

/** Line cap style. Maps to ST_LineCap (ECMA-376, dml-main.xsd). Uses lowercase variants; bridge uses PascalCase. */
export type LineCap =
  | 'flat' // Flat end (ends exactly at the endpoint)
  | 'round' // Rounded end (semicircle at the endpoint)
  | 'square'; // Square end (extends half the line width beyond the endpoint)

/** Line join style. Maps to EG_LineJoinProperties (ECMA-376, dml-main.xsd). Uses lowercase variants; bridge uses tagged union. */
export type LineJoin =
  | 'bevel' // Beveled corner (flat cut at the join)
  | 'miter' // Mitered corner (sharp pointed join)
  | 'round'; // Rounded corner (smooth arc at the join)

/** Compound line type for multi-line strokes. Maps to ST_CompoundLine (ECMA-376, dml-main.xsd). Uses camelCase variants; bridge uses PascalCase. */
export type CompoundLine = 'sng' | 'dbl' | 'thickThin' | 'thinThick' | 'tri';

/**
 * text-effect text outline configuration.
 * Defines the stroke/border around text characters.
 *
 * @see ECMA-376 Part 1, Section 20.1.8.38 (CT_LineProperties)
 */
export interface TextEffectOutline {
  /**
   * Outline width in points (1pt = 1/72 inch).
   * Typical values range from 0.5 to 6 points.
   */
  width: number;

  /** Outline color (CSS color string: hex, rgb, rgba, hsl, named) */
  color: string;

  /** Opacity (0-1, where 0 is fully transparent, 1 is fully opaque) */
  opacity?: number;

  /** Dash style (default: 'solid') */
  dash?: LineDash;

  /** Line cap style (default: 'flat') */
  cap?: LineCap;

  /** Line join style (default: 'round') */
  join?: LineJoin;

  /**
   * Miter limit for miter joins.
   * When the miter length exceeds this ratio of the line width,
   * the join is rendered as a bevel instead.
   */
  miterLimit?: number;

  /** Compound line type for multi-stroke outlines */
  compound?: CompoundLine;
}

// =============================================================================
// Text Effects (imported from effects.ts)
// =============================================================================

// Import TextEffects from effects.ts - the single source of truth
// This ensures the text-effect config uses the same type as the rest of the codebase
import type { TextEffects } from './effects';

// Re-export for convenience (though most code should import from index.ts)
export type { TextEffects };

// =============================================================================
// text effects Configuration
// =============================================================================

/**
 * text-effect configuration for a TextBoxObject.
 *
 * When applied to a TextBoxObject, this config transforms regular text
 * into stylized text effects with warping, fills, and effects.
 *
 * This is the main configuration type for text effects - it contains all
 * the settings needed to render text with decorative styling.
 *
 * @see ECMA-376 Part 1, Section 21.1.2.2.33 (txBody - Text Body)
 *
 * @example
 * // Basic text effects with arch warp
 * const config: TextEffectConfig = {
 *   warpPreset: 'textArchUp',
 *   warpAdjustments: { adj1: 50 },
 *   fill: { type: 'gradient', gradientType: 'linear', angle: 90, stops: [...] },
 *   outline: { width: 1.5, color: '#000000' }
 * };
 *
 * @example
 * // text effects with effects
 * const config: TextEffectConfig = {
 *   warpPreset: 'textWave1',
 *   fill: { type: 'solid', color: '#FF6600' },
 *   effects: {
 *     outerShadow: { blurRadius: 40000, distance: 25000, direction: 45, color: '#000000', opacity: 0.35 }
 *   }
 * };
 */
export interface TextEffectConfig {
  /**
   * Text warp preset type.
   * Determines the geometric transformation applied to the text.
   */
  warpPreset: TextWarpPreset;

  /**
   * Fine-tune warp parameters.
   * Values depend on the preset type.
   */
  warpAdjustments?: AdjustmentValues;

  /**
   * Text fill (solid, gradient, pattern, or none).
   * Defines how the interior of text characters is colored.
   */
  fill: TextEffectFill;

  /**
   * Text outline/stroke.
   * Defines the border around text characters.
   */
  outline?: TextEffectOutline;

  /**
   * Text effects (shadow, glow, reflection, bevel, 3D).
   * Adds visual effects to the text.
   */
  effects?: TextEffects;

  /**
   * Whether text follows the warp path exactly (true) or flows naturally (false).
   *
   * - `true` (default): Each glyph is positioned and rotated to follow the warp path
   *   tangent. Used for arc, circle, and path-following effects where text should
   *   curve with the path. The rotation of each character matches the path direction.
   *
   * - `false`: Text maintains its baseline orientation while the overall shape is
   *   warped. Used for inflate/deflate effects where text distorts but doesn't rotate.
   *   Characters remain upright even as they are scaled/positioned along the path.
   */
  followPath?: boolean;

  /**
   * Text anchoring within the warp bounds.
   * Controls where text is positioned within the warped area.
   */
  anchor?: 'top' | 'middle' | 'bottom';

  /**
   * Text direction.
   * Affects how text flows within the warp.
   */
  textDirection?: 'ltr' | 'rtl';

  /**
   * Normalize letter heights across different characters.
   * When true, all characters are scaled to have the same height.
   */
  normalizeHeights?: boolean;
}

/** Typed patch for updating an existing text-effect configuration. */
export type TextEffectConfigUpdate = Partial<
  Omit<TextEffectConfig, 'warpAdjustments' | 'outline' | 'effects'>
> & {
  /** Warp adjustment values. Explicit undefined removes stored adjustments. */
  warpAdjustments?: AdjustmentValues | undefined;
  /** Text outline configuration. Explicit undefined removes the outline. */
  outline?: TextEffectOutline | undefined;
  /** Text effects. Explicit undefined removes stored effects. */
  effects?: TextEffects | undefined;
};

// =============================================================================
// Bridge Interface for Background Processing
// =============================================================================

// `Itext effectsBridge` now lives in `./bridge` so this module does not import
// `./presets` (which imports from here). Consumers should import
// `Itext effectsBridge` from `./bridge` or via the `./index` barrel.

// =============================================================================
// Type Guards
// =============================================================================
