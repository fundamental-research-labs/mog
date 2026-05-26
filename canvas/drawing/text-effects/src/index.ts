/**
 * @mog/text-effects-engine
 *
 * Standalone TextEffect/text warp engine implementing all 36+ OOXML text warp presets.
 * Pure computation: no DOM, no Canvas, no React.
 *
 * Depends on @mog/geometry for path math and @mog-sdk/contracts
 * for shared types.
 */

// ─── Preset Registry ────────────────────────────────────────────────────────

export {
  getAllPresetNames,
  getPresetCount,
  getWarpPreset,
  isValidPresetName,
} from './presets/registry';
export type { WarpPreset, WarpPresetName } from './presets/registry';

// ─── Warp Engine ────────────────────────────────────────────────────────────

export { warpText } from './warp/warp-engine';
export type { GlyphBox, WarpedGlyph } from './warp/warp-engine';

// ─── Path Text Layout ───────────────────────────────────────────────────────

export { layoutTextOnPath } from './warp/path-text';

// ─── Adjustment Handles ─────────────────────────────────────────────────────

export { getAdjustHandle, updateAdjustment } from './warp/adjust-handles';
export type { AdjustHandle } from './warp/adjust-handles';

// ─── Effects ────────────────────────────────────────────────────────────────

export {
  STYLE_PRESETS,
  calculateEffectBounds,
  compute3DTransform,
  computeBevel,
  computeEffects,
  computeGlow,
  computeInnerShadow,
  computeOuterShadow,
  computePresetShadow,
  computeReflection,
  computeSoftEdge,
  computeTransform3D,
  // OOXML effects
  emuToPixels,
  getPresetShadowTypes,
  getStylePreset,
  matrixToCss3d,
  transform3DPoint,
} from './effects';
export type {
  BevelPaths,
  EffectRenderResult,
  GlowLayer,
  ReflectionLayer,
  // OOXML effect types
  ShadowLayer,
  SoftEdgeMask,
  ThreeDConfig,
  Transform3DMatrix,
  TextEffectStyle,
} from './effects';

// ─── Drawing Object Output ──────────────────────────────────────────────────

export { warpToDrawingObjects } from './drawing-object-output';

// ─── Path Utilities ────────────────────────────────────────────────────────
export {
  createArcPath,
  createBulgePath,
  createCircularArcPath,
  createSinePath,
  pointsToSmoothPath,
} from './warp/path-utils';

// ─── Diagnostics ────────────────────────────────────────────────────────────

export * as Diagnostics from './diagnostics';
