/**
 * text effects Text Effects
 *
 * Implements DrawingML effect types from ECMA-376 Part 1.
 * These effects are applied to text after warping.
 *
 * All distance/size values use EMUs (English Metric Units) for precision:
 * - 1 inch = 914400 EMUs
 * - 1 point = 12700 EMUs
 * - 1 pixel (96 DPI) = 9525 EMUs
 *
 * @see ECMA-376 Part 1, Section 20.1.7 (DrawingML - Effects)
 */

import type {
  LightRigType as _LightRigType,
  BevelPresetType,
  LightRigDirection,
  PresetMaterialType,
} from '../drawing/three-d';

// =============================================================================
// Shadow Alignment
// =============================================================================

/**
 * Shadow alignment options.
 *
 * Specifies the alignment of the shadow relative to the text.
 * The shadow is positioned based on this anchor point.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.3 (ST_RectAlignment)
 */
export type ShadowAlignment =
  | 'tl' // Top-left
  | 't' // Top-center
  | 'tr' // Top-right
  | 'l' // Middle-left
  | 'ctr' // Center
  | 'r' // Middle-right
  | 'bl' // Bottom-left
  | 'b' // Bottom-center
  | 'br'; // Bottom-right

// =============================================================================
// Preset Shadow Types
// =============================================================================

/**
 * Preset shadow types (20 predefined shadows).
 *
 * These map to DrawingML's preset shadow definitions (shdw1-shdw20).
 * Each preset defines a complete shadow configuration including distance,
 * direction, blur, color, and opacity. Use these for consistent, quick
 * shadow application rather than configuring OuterShadowEffect manually.
 *
 * Preset categories:
 * - shdw1-shdw4: Outer shadows (basic drop shadows)
 * - shdw5-shdw8: Perspective shadows (cast at an angle)
 * - shdw9-shdw12: Offset shadows (shifted significantly from text)
 * - shdw13-shdw16: Inner shadows (shadow inside text edges)
 * - shdw17-shdw20: Special effects (reflection-like, soft shadows)
 *
 * @see ECMA-376 Part 1, Section 20.1.10.56 (ST_PresetShadowVal)
 */
export type PresetShadowType =
  | 'shdw1' // Outer offset diagonal bottom right
  | 'shdw2' // Outer offset bottom
  | 'shdw3' // Outer offset diagonal bottom left
  | 'shdw4' // Outer offset right
  | 'shdw5' // Outer offset center
  | 'shdw6' // Outer offset left
  | 'shdw7' // Outer offset diagonal top right
  | 'shdw8' // Outer offset top
  | 'shdw9' // Outer offset diagonal top left
  | 'shdw10' // Perspective diagonal upper left
  | 'shdw11' // Perspective diagonal upper right
  | 'shdw12' // Perspective diagonal lower left
  | 'shdw13' // Perspective diagonal lower right
  | 'shdw14' // Perspective below
  | 'shdw15' // Perspective above
  | 'shdw16' // Perspective left
  | 'shdw17' // Perspective right
  | 'shdw18' // Perspective upper left
  | 'shdw19' // Perspective upper right
  | 'shdw20'; // Perspective lower left

// =============================================================================
// Shadow Effects
// =============================================================================

/**
 * Outer shadow effect (shadow cast outside the text).
 *
 * Creates a shadow behind the text that appears to be cast by a light source.
 * The shadow can be positioned, blurred, scaled, and skewed for various effects
 * including simple drop shadows and perspective shadows.
 *
 * @example
 * // Simple drop shadow (bottom-right)
 * const shadow: OuterShadowEffect = {
 *   blurRadius: 50800,  // 4pt blur
 *   distance: 38100,    // 3pt offset
 *   direction: 45,      // 45 degrees (down-right)
 *   color: '#000000',
 *   opacity: 0.4
 * };
 *
 * @see ECMA-376 Part 1, Section 20.1.8.52 (outerShdw)
 */
export interface OuterShadowEffect {
  /**
   * Blur radius in EMUs (English Metric Units).
   * Higher values create a softer, more diffuse shadow.
   * 1 point = 12700 EMUs.
   *
   * @example 50800 // 4pt blur
   */
  blurRadius: number;

  /**
   * Shadow distance from text in EMUs.
   * How far the shadow is offset from the text.
   *
   * @example 38100 // 3pt offset
   */
  distance: number;

  /**
   * Shadow direction in degrees.
   * Angle measured clockwise from the positive x-axis.
   * - 0 = right
   * - 90 = down
   * - 180 = left
   * - 270 = up
   */
  direction: number;

  /**
   * Shadow color (CSS color string).
   * Typically black or dark gray for standard shadows.
   *
   * @example '#000000'
   */
  color: string;

  /**
   * Shadow opacity (0-1).
   * 0 = fully transparent, 1 = fully opaque.
   * Typical values range from 0.3 to 0.6 for natural-looking shadows.
   */
  opacity: number;

  /**
   * Horizontal scale factor for perspective shadows.
   * Values less than 1.0 compress the shadow horizontally.
   * Values greater than 1.0 stretch the shadow horizontally.
   *
   * @default 1.0 (no scaling)
   */
  scaleX?: number;

  /**
   * Vertical scale factor for perspective shadows.
   * Values less than 1.0 compress the shadow vertically.
   * Values greater than 1.0 stretch the shadow vertically.
   *
   * @default 1.0 (no scaling)
   */
  scaleY?: number;

  /**
   * Skew angle X in degrees (for perspective shadows).
   * Shears the shadow horizontally.
   *
   * @default 0 (no skew)
   */
  skewX?: number;

  /**
   * Skew angle Y in degrees (for perspective shadows).
   * Shears the shadow vertically.
   *
   * @default 0 (no skew)
   */
  skewY?: number;

  /**
   * Shadow alignment relative to the text bounding box.
   * Determines the anchor point for shadow positioning.
   *
   * @default 'b' (bottom)
   */
  alignment?: ShadowAlignment;

  /**
   * Whether shadow rotates with text when text is rotated.
   * If true, the shadow direction is relative to the text.
   * If false, the shadow direction is absolute (relative to the page).
   *
   * @default true
   */
  rotateWithShape?: boolean;
}

/**
 * Inner shadow effect (shadow cast inside the text).
 *
 * Creates a shadow effect along the inside edges of the text,
 * giving the appearance that the text is embossed or inset.
 * Unlike outer shadows, inner shadows are rendered within the text bounds.
 *
 * @example
 * // Subtle inner shadow for depth
 * const innerShadow: InnerShadowEffect = {
 *   blurRadius: 25400,  // 2pt blur
 *   distance: 12700,    // 1pt offset
 *   direction: 225,     // Light from top-left
 *   color: '#000000',
 *   opacity: 0.3
 * };
 *
 * @see ECMA-376 Part 1, Section 20.1.8.40 (innerShdw)
 */
export interface InnerShadowEffect {
  /**
   * Blur radius in EMUs.
   * Controls how soft/diffuse the inner shadow appears.
   */
  blurRadius: number;

  /**
   * Shadow distance from the text edge in EMUs.
   * How far the shadow extends inward from the edge.
   */
  distance: number;

  /**
   * Shadow direction in degrees.
   * Angle measured clockwise from the positive x-axis.
   * Determines which edge of the text the shadow appears on.
   */
  direction: number;

  /**
   * Shadow color (CSS color string).
   */
  color: string;

  /**
   * Shadow opacity (0-1).
   * 0 = fully transparent, 1 = fully opaque.
   */
  opacity: number;
}

// =============================================================================
// Glow Effect
// =============================================================================

/**
 * Glow effect (soft glow around text).
 *
 * Creates a colored glow that radiates outward from the text edges.
 * The glow fades from full opacity at the text edge to transparent
 * at the outer radius. Commonly used for emphasis or neon-like effects.
 *
 * @example
 * // Golden glow effect
 * const glow: GlowEffect = {
 *   radius: 63500,    // 5pt radius
 *   color: '#FFD700',
 *   opacity: 0.6
 * };
 *
 * @see ECMA-376 Part 1, Section 20.1.8.36 (glow)
 */
export interface GlowEffect {
  /**
   * Glow radius in EMUs.
   * How far the glow extends from the text edge.
   * Larger values create a more diffuse, spread-out glow.
   *
   * @example 63500 // 5pt radius
   */
  radius: number;

  /**
   * Glow color (CSS color string).
   * The base color of the glow effect.
   * Supports any valid CSS color including hex, rgb, and named colors.
   *
   * @example '#FFD700' // Gold
   * @example 'rgba(255, 215, 0, 1)' // Gold with full opacity
   */
  color: string;

  /**
   * Glow opacity (0-1).
   * Maximum opacity of the glow at the text edge.
   * The glow fades to transparent at the outer radius.
   */
  opacity: number;
}

// =============================================================================
// Soft Edge Effect
// =============================================================================

/**
 * Soft edge effect (feathered edges).
 *
 * Creates a gradual fade-out at the edges of the text, making
 * the text appear to blend into the background. The effect
 * creates a smooth transition from fully opaque text to
 * fully transparent at the edges.
 *
 * @example
 * // Soft fade at edges
 * const softEdge: SoftEdgeEffect = {
 *   radius: 25400  // 2pt feather radius
 * };
 *
 * @see ECMA-376 Part 1, Section 20.1.8.57 (softEdge)
 */
export interface SoftEdgeEffect {
  /**
   * Soft edge radius in EMUs.
   * How far inward from the text edge the fade begins.
   * Larger values create a more gradual fade.
   *
   * @example 25400 // 2pt radius
   */
  radius: number;
}

// =============================================================================
// Reflection Effect
// =============================================================================

/**
 * Reflection effect (mirror reflection below text).
 *
 * Creates a mirrored reflection of the text, typically appearing
 * below and fading away. Used to create the illusion that text
 * is sitting on a reflective surface. The reflection can be
 * customized with blur, opacity gradient, and positioning.
 *
 * @example
 * // Standard reflection effect
 * const reflection: ReflectionEffect = {
 *   blurRadius: 6350,    // 0.5pt blur
 *   startOpacity: 0.52,   // Start at 52% opacity
 *   endOpacity: 0,        // Fade to transparent
 *   distance: 0,          // No gap between text and reflection
 *   direction: 90,        // Reflect downward
 *   scaleY: -1            // Flip vertically (mirror)
 * };
 *
 * @see ECMA-376 Part 1, Section 20.1.8.55 (reflection)
 */
export interface ReflectionEffect {
  /**
   * Blur radius in EMUs.
   * Amount of blur applied to the reflection.
   * Higher values make the reflection appear more diffuse.
   */
  blurRadius: number;

  /**
   * Start opacity at reflection top (0-1).
   * The opacity where the reflection begins (nearest to original text).
   * Typically set to a partial opacity (0.3-0.6) for realism.
   */
  startOpacity: number;

  /**
   * End opacity at reflection bottom (0-1).
   * The opacity where the reflection ends (farthest from original text).
   * Typically set to 0 for a natural fade-out.
   */
  endOpacity: number;

  /**
   * Distance from text to reflection in EMUs.
   * Gap between the bottom of the text and the top of the reflection.
   * Set to 0 for a reflection that starts immediately below the text.
   */
  distance: number;

  /**
   * Reflection direction in degrees.
   * Typically 90 (downward) for standard reflections.
   * - 90 = reflection below text
   * - 0 = reflection to the right
   * - 180 = reflection to the left
   * - 270 = reflection above text
   */
  direction: number;

  /**
   * Fade direction in degrees (for gradient fade).
   * Direction in which the opacity fades from startOpacity to endOpacity.
   * Typically aligned with or opposite to the reflection direction.
   */
  fadeDirection?: number;

  /**
   * Horizontal scale factor.
   * 1.0 = same width as original text.
   * Values less than 1.0 compress the reflection horizontally.
   */
  scaleX?: number;

  /**
   * Vertical scale factor.
   * Negative values flip the reflection vertically (mirror effect).
   * -1.0 = perfect mirror, -0.5 = compressed mirror.
   *
   * @example -1 // Full vertical flip for mirror reflection
   */
  scaleY?: number;

  /**
   * Skew angle X in degrees.
   * Shears the reflection horizontally for perspective effects.
   */
  skewX?: number;

  /**
   * Skew angle Y in degrees.
   * Shears the reflection vertically for perspective effects.
   */
  skewY?: number;

  /**
   * Reflection alignment relative to the text bounding box.
   * Determines the anchor point for reflection positioning.
   *
   * @default 'bl' (bottom-left)
   */
  alignment?: ShadowAlignment;

  /**
   * Whether reflection rotates with text when text is rotated.
   * If true, the reflection maintains its relative position to the text.
   * If false, the reflection direction is absolute.
   *
   * @default true
   */
  rotateWithShape?: boolean;
}

// =============================================================================
// Bevel Effect
// =============================================================================

/** @see BevelPresetType in drawing/three-d */
export type BevelPreset = BevelPresetType;

/**
 * Bevel effect (3D edge effect).
 *
 * Creates a three-dimensional edge around text by simulating
 * light falling on beveled edges. Bevels can be applied to the
 * top and/or bottom of the text independently, each with its
 * own preset, width, and height.
 *
 * @example
 * // Classic raised bevel effect
 * const bevel: BevelEffect = {
 *   topPreset: 'circle',
 *   topWidth: 38100,   // 3pt width
 *   topHeight: 38100,  // 3pt height
 *   bottomPreset: 'angle',
 *   bottomWidth: 25400,
 *   bottomHeight: 25400
 * };
 *
 * @see ECMA-376 Part 1, Section 20.1.5.3 (bevelT) and 20.1.5.4 (bevelB)
 */
export interface BevelEffect {
  /**
   * Top bevel preset.
   * Defines the shape of the top edge bevel.
   * If omitted, no top bevel is applied.
   */
  topPreset?: BevelPreset;

  /**
   * Top bevel width in EMUs.
   * How far the bevel extends inward from the text edge.
   *
   * @example 38100 // 3pt width
   */
  topWidth?: number;

  /**
   * Top bevel height in EMUs.
   * How tall the bevel effect appears (z-axis depth).
   *
   * @example 38100 // 3pt height
   */
  topHeight?: number;

  /**
   * Bottom bevel preset.
   * Defines the shape of the bottom edge bevel.
   * If omitted, no bottom bevel is applied.
   */
  bottomPreset?: BevelPreset;

  /**
   * Bottom bevel width in EMUs.
   * How far the bevel extends inward from the text edge.
   */
  bottomWidth?: number;

  /**
   * Bottom bevel height in EMUs.
   * How tall the bevel effect appears (z-axis depth).
   */
  bottomHeight?: number;
}

// =============================================================================
// 3D Transform Effect
// =============================================================================

/** @see PresetMaterialType in drawing/three-d */
export type MaterialPreset = PresetMaterialType;

/** @see LightRigType in drawing/three-d */
export type LightRigType = _LightRigType;

/** @see LightRigDirection in drawing/three-d */
export type LightDirection = LightRigDirection;

/**
 * 3D rotation and perspective effect.
 *
 * Creates true 3D transformations of text including rotation around
 * all three axes, perspective projection, and extrusion. Combined
 * with lighting and materials, this creates realistic 3D text effects.
 *
 * @example
 * // Subtle 3D tilt with depth
 * const transform3D: Transform3DEffect = {
 *   rotationX: 15,    // Tilt back 15 degrees
 *   rotationY: 10,    // Turn right 10 degrees
 *   rotationZ: 0,     // No rotation in plane
 *   perspective: 5000000, // Field of view
 *   extrusionHeight: 76200, // 6pt extrusion depth
 *   material: 'plastic',
 *   lightRig: 'threePt',
 *   lightDirection: 'tl'
 * };
 *
 * @see ECMA-376 Part 1, Section 20.1.5.9 (scene3d) and 20.1.5.12 (sp3d)
 */
export interface Transform3DEffect {
  /**
   * Rotation around X axis in degrees.
   * Positive values tilt the top of the text away from the viewer.
   * Range: -90 to 90 degrees.
   */
  rotationX: number;

  /**
   * Rotation around Y axis in degrees.
   * Positive values turn the right side of the text toward the viewer.
   * Range: -90 to 90 degrees.
   */
  rotationY: number;

  /**
   * Rotation around Z axis in degrees.
   * Rotates the text in the plane of the screen (like 2D rotation).
   * Range: 0 to 360 degrees.
   */
  rotationZ: number;

  /**
   * Perspective distance (field of view) in EMUs.
   * Controls the strength of perspective distortion.
   * Lower values create more dramatic perspective.
   * Higher values create flatter, more orthographic projection.
   *
   * @example 5000000 // Moderate perspective
   */
  perspective?: number;

  /**
   * Extrusion depth (3D thickness) in EMUs.
   * Creates depth by extruding the text shape along the z-axis.
   * The extruded portion can have its own color.
   *
   * @example 76200 // 6pt depth
   */
  extrusionHeight?: number;

  /**
   * Extrusion color (CSS color string).
   * Color of the extruded sides of the 3D text.
   * If not specified, uses a darker shade of the text fill.
   */
  extrusionColor?: string;

  /**
   * Contour width in EMUs.
   * Adds an outline that follows the 3D shape contours.
   *
   * @example 12700 // 1pt contour
   */
  contourWidth?: number;

  /**
   * Contour color (CSS color string).
   * Color of the 3D contour outline.
   */
  contourColor?: string;

  /**
   * Preset material type.
   * Defines how the surface responds to light (shininess, reflection).
   */
  material?: MaterialPreset;

  /**
   * Light rig type.
   * Defines the overall lighting setup (number and arrangement of lights).
   */
  lightRig?: LightRigType;

  /**
   * Light rig direction.
   * From which direction the primary light source illuminates the text.
   */
  lightDirection?: LightDirection;
}

// =============================================================================
// Effect Container
// =============================================================================

/**
 * Container for all text effects.
 *
 * Groups all visual effects that can be applied to text-effect text.
 * Effects are applied in a specific order to ensure correct visual stacking:
 *
 * **Effect Application Order:**
 * 1. Text fill and outline (base rendering)
 * 2. Outer shadow (rendered behind text)
 * 3. Glow (rendered around text edges)
 * 4. Inner shadow (rendered inside text)
 * 5. Soft edges (feathers text edges)
 * 6. Reflection (rendered below text)
 * 7. 3D bevel (adds depth to edges)
 * 8. 3D rotation and perspective (transforms entire result)
 *
 * Note: You can use either `presetShadow` for quick shadow application,
 * or `outerShadow`/`innerShadow` for custom shadow configuration.
 * Using both may produce unexpected results.
 *
 * @example
 * // Dramatic text effects
 * const effects: TextEffects = {
 *   outerShadow: {
 *     blurRadius: 50800,
 *     distance: 38100,
 *     direction: 45,
 *     color: '#000000',
 *     opacity: 0.4
 *   },
 *   glow: {
 *     radius: 63500,
 *     color: '#FFD700',
 *     opacity: 0.6
 *   },
 *   bevel: {
 *     topPreset: 'circle',
 *     topWidth: 38100,
 *     topHeight: 38100
 *   }
 * };
 *
 * @see ECMA-376 Part 1, Section 20.1.8 (DrawingML - Effect)
 */
export interface TextEffects {
  /**
   * Outer shadow effect.
   * Creates a shadow behind and offset from the text.
   * For quick shadow setup, consider using `presetShadow` instead.
   */
  outerShadow?: OuterShadowEffect;

  /**
   * Inner shadow effect.
   * Creates a shadow inside the text edges for an embossed look.
   */
  innerShadow?: InnerShadowEffect;

  /**
   * Preset shadow (alternative to custom shadow).
   * Use this for quick application of standard shadow styles.
   * Choose from 20 predefined shadow configurations (shdw1-shdw20).
   * If both `presetShadow` and `outerShadow`/`innerShadow` are specified,
   * the custom shadow settings take precedence.
   */
  presetShadow?: PresetShadowType;

  /**
   * Glow effect.
   * Creates a soft colored glow around the text.
   */
  glow?: GlowEffect;

  /**
   * Soft edge effect.
   * Creates feathered/faded edges on the text.
   */
  softEdge?: SoftEdgeEffect;

  /**
   * Reflection effect.
   * Creates a mirror reflection below the text.
   */
  reflection?: ReflectionEffect;

  /**
   * Bevel effect.
   * Creates 3D beveled edges on the text.
   * Can apply different bevels to top and bottom edges.
   */
  bevel?: BevelEffect;

  /**
   * 3D rotation effect.
   * Rotates text in 3D space and applies perspective.
   * Includes lighting and material settings for realistic 3D rendering.
   */
  transform3D?: Transform3DEffect;
}
