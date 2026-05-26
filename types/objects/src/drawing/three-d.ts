/**
 * 3D Effect Types — shared across Diagram, TextEffect, and general shape rendering
 *
 * Based on ECMA-376 5th Edition, Part 1 (dml-main.xsd)
 * These types provide strongly-typed union literals for all 3D-related
 * enumerations, replacing the weak `string` types previously used in
 * Diagram contracts.
 */

// =============================================================================
// Enums (union literal types)
// =============================================================================

/**
 * Preset camera type.
 *
 * Defines the camera viewing angle for 3D scenes.
 * 62 presets covering legacy, orthographic, isometric, oblique,
 * and perspective projections.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.45 (ST_PresetCameraType)
 */
export type PresetCameraType =
  | 'legacyObliqueTopLeft'
  | 'legacyObliqueTop'
  | 'legacyObliqueTopRight'
  | 'legacyObliqueFront'
  | 'legacyObliqueLeft'
  | 'legacyObliqueRight'
  | 'legacyPerspectiveTopLeft'
  | 'legacyPerspectiveTop'
  | 'legacyPerspectiveTopRight'
  | 'legacyPerspectiveFront'
  | 'legacyPerspectiveLeft'
  | 'legacyPerspectiveRight'
  | 'orthographicFront'
  | 'isometricTopUp'
  | 'isometricTopDown'
  | 'isometricBottomUp'
  | 'isometricBottomDown'
  | 'isometricLeftUp'
  | 'isometricLeftDown'
  | 'isometricRightUp'
  | 'isometricRightDown'
  | 'isometricOffAxis1Left'
  | 'isometricOffAxis1Right'
  | 'isometricOffAxis1Top'
  | 'isometricOffAxis2Left'
  | 'isometricOffAxis2Right'
  | 'isometricOffAxis2Top'
  | 'isometricOffAxis3Left'
  | 'isometricOffAxis3Right'
  | 'isometricOffAxis3Bottom'
  | 'isometricOffAxis4Left'
  | 'isometricOffAxis4Right'
  | 'isometricOffAxis4Bottom'
  | 'obliqueTopLeft'
  | 'obliqueTop'
  | 'obliqueTopRight'
  | 'obliqueLeft'
  | 'obliqueRight'
  | 'obliqueBottomLeft'
  | 'obliqueBottom'
  | 'obliqueBottomRight'
  | 'perspectiveFront'
  | 'perspectiveLeft'
  | 'perspectiveRight'
  | 'perspectiveAbove'
  | 'perspectiveAboveLeftFacing'
  | 'perspectiveAboveRightFacing'
  | 'perspectiveContrastingLeftFacing'
  | 'perspectiveContrastingRightFacing'
  | 'perspectiveHeroicLeftFacing'
  | 'perspectiveHeroicRightFacing'
  | 'perspectiveHeroicExtremeLeftFacing'
  | 'perspectiveHeroicExtremeRightFacing'
  | 'perspectiveBelow'
  | 'perspectiveRelaxed'
  | 'perspectiveRelaxedModerately';

/**
 * Bevel preset type.
 *
 * Defines the cross-section profile of a 3D bevel edge effect.
 * 12 presets defining different edge shapes.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.6 (ST_BevelPresetType)
 */
export type BevelPresetType =
  | 'relaxedInset' // Subtle rounded inset
  | 'circle' // Circular cross-section
  | 'slope' // Linear angled edge
  | 'cross' // Cross-shaped profile
  | 'angle' // Sharp angled edge
  | 'softRound' // Soft rounded profile
  | 'convex' // Outward curving edge
  | 'coolSlant' // Stylized slanted edge
  | 'divot' // Indented groove
  | 'riblet' // Ribbed texture
  | 'hardEdge' // Sharp, defined edge
  | 'artDeco'; // Decorative Art Deco style

/**
 * Preset material type.
 *
 * Defines how a surface responds to light — affects highlights,
 * reflections, and the overall appearance of 3D shapes.
 * 14 presets ranging from matte to metallic.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.43 (ST_PresetMaterialType)
 */
export type PresetMaterialType =
  | 'dkEdge' // Dark edge material
  | 'flat' // Flat, non-reflective
  | 'legacyMatte' // Legacy matte finish
  | 'legacyMetal' // Legacy metallic
  | 'legacyPlastic' // Legacy plastic
  | 'legacyWireframe' // Legacy wireframe
  | 'matte' // Matte, diffuse surface
  | 'metal' // Metallic, highly reflective
  | 'plastic' // Plastic, moderate reflection
  | 'powder' // Powdered/matte texture
  | 'softEdge' // Soft edge material
  | 'softmetal' // Soft metallic finish
  | 'translucentPowder' // Translucent powder
  | 'warmMatte'; // Warm matte finish

/**
 * Light rig type.
 *
 * Defines the lighting setup used to illuminate 3D shapes.
 * Different rigs create different moods and highlight patterns.
 * 27 presets including legacy compatibility types.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.41 (ST_LightRigType)
 */
export type LightRigType =
  | 'balanced' // Balanced, even lighting
  | 'brightRoom' // Bright room ambient
  | 'chilly' // Cool, chilly lighting
  | 'contrasting' // High contrast
  | 'flat' // Flat, minimal shadows
  | 'flood' // Flood lighting
  | 'freezing' // Very cold lighting
  | 'glow' // Glowing effect
  | 'harsh' // Harsh, stark lighting
  | 'legacyFlat1' // Legacy flat style 1
  | 'legacyFlat2' // Legacy flat style 2
  | 'legacyFlat3' // Legacy flat style 3
  | 'legacyFlat4' // Legacy flat style 4
  | 'legacyHarsh1' // Legacy harsh style 1
  | 'legacyHarsh2' // Legacy harsh style 2
  | 'legacyHarsh3' // Legacy harsh style 3
  | 'legacyHarsh4' // Legacy harsh style 4
  | 'legacyNormal1' // Legacy normal style 1
  | 'legacyNormal2' // Legacy normal style 2
  | 'legacyNormal3' // Legacy normal style 3
  | 'legacyNormal4' // Legacy normal style 4
  | 'morning' // Morning light
  | 'soft' // Soft, diffused lighting
  | 'sunrise' // Sunrise lighting
  | 'sunset' // Sunset lighting
  | 'threePt' // Three-point lighting setup
  | 'twoPt'; // Two-point lighting setup

/**
 * Light rig direction.
 *
 * Specifies from which direction the light illuminates a 3D shape.
 * Affects shadow positions and highlight locations.
 * 8 compass directions.
 *
 * @see ECMA-376 Part 1, Section 20.1.10.40 (ST_LightRigDirection)
 */
export type LightRigDirection =
  | 't' // Top
  | 'tl' // Top-left
  | 'tr' // Top-right
  | 'l' // Left
  | 'r' // Right
  | 'b' // Bottom
  | 'bl' // Bottom-left
  | 'br'; // Bottom-right

// =============================================================================
// Structural Interfaces
// =============================================================================

/**
 * 3D rotation angles in 60,000ths of a degree.
 *
 * @see ECMA-376 Part 1, Section 20.1.7.7 (rot)
 */
export interface Rotation3D {
  /** Latitude rotation */
  lat: number;
  /** Longitude rotation */
  lon: number;
  /** Revolution rotation */
  rev: number;
}

/**
 * Camera settings defining the viewing angle for a 3D scene.
 *
 * @see ECMA-376 Part 1, Section 20.1.5.7 (camera)
 */
export interface Camera {
  /** Camera preset type */
  prst: PresetCameraType;
  /** Field of view in 60,000ths of a degree (perspective cameras only) */
  fov?: number;
  /** Camera rotation angles */
  rot?: Rotation3D;
}

/**
 * Light rig settings defining illumination for a 3D scene.
 *
 * @see ECMA-376 Part 1, Section 20.1.5.8 (lightRig)
 */
export interface LightRig {
  /** Light rig preset type */
  rig: LightRigType;
  /** Light direction */
  dir: LightRigDirection;
  /** Light rotation angles */
  rot?: Rotation3D;
}

/**
 * 3D scene definition for perspective and lighting.
 *
 * Defines the camera position and lighting setup for 3D-style
 * rendering. Used in style definitions to apply 3D effects to shapes.
 *
 * @see ECMA-376 Part 1, Section 20.1.5.1 (scene3d)
 */
export interface Scene3D {
  /** Camera settings defining the viewing angle */
  camera: Camera;
  /** Light rig settings defining illumination */
  lightRig: LightRig;
}

/**
 * Bevel effect for a 3D shape edge.
 *
 * @see ECMA-376 Part 1, Section 20.1.5.3 (bevelT) and 20.1.5.4 (bevelB)
 */
export interface Bevel {
  /** Bevel width in EMUs */
  w?: number;
  /** Bevel height in EMUs */
  h?: number;
  /** Bevel preset type */
  prst?: BevelPresetType;
}

/**
 * Color reference for 3D effects (extrusion color, contour color).
 *
 * Supports multiple color specification modes from DrawingML.
 * The `type` field is optional to allow structural compatibility
 * with domain-specific color types (e.g., Diagram SchemeColor).
 *
 * @see ECMA-376 Part 1, Section 20.1.2.3 (Color)
 */
export interface ColorRef {
  /** Color specification type */
  type?: 'schemeClr' | 'srgbClr' | 'hslClr' | 'sysClr' | 'prstClr';
  /** Color value (scheme name, hex RGB, preset name, etc.) */
  val: string;
  /** Hue component (for hslClr) */
  hue?: number;
  /** Saturation component (for hslClr) */
  sat?: number;
  /** Luminance component (for hslClr) */
  lum?: number;
}

/**
 * 3D shape properties for individual shapes.
 *
 * Defines per-shape 3D effects including bevels, extrusion, contours,
 * and material. Applied on top of the scene-level 3D settings.
 *
 * @see ECMA-376 Part 1, Section 20.1.5.12 (sp3d)
 */
export interface Shape3D {
  /** Top bevel effect */
  bevelT?: Bevel;
  /** Bottom bevel effect */
  bevelB?: Bevel;
  /** Extrusion height in EMUs */
  extrusionH?: number;
  /** Extrusion color */
  extrusionClr?: ColorRef;
  /** Contour width in EMUs */
  contourW?: number;
  /** Contour color */
  contourClr?: ColorRef;
  /** Preset material type affecting surface reflectivity */
  prstMaterial?: PresetMaterialType;
  /** Z offset in EMUs */
  z?: number;
}
