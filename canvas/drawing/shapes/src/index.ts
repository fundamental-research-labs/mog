/**
 * @mog/shape-engine
 *
 * Standalone shape computation engine for generating geometric paths
 * from shape presets and producing DrawingObjects for rendering.
 *
 * Depends only on @mog/geometry and @mog-sdk/contracts.
 * No Yjs, React, Canvas, or DOM dependencies.
 */

// ─── Core API ───────────────────────────────────────────────────────────────

export {
  generateShapePath,
  getDefaultAdjustments,
  getRegisteredShapeTypes,
  isValidShapeType,
} from './shape-to-path';

// ─── Custom Geometry ────────────────────────────────────────────────────────

export {
  customGeometryToPath,
  evaluateGuides,
  parseCustomGeometry,
  resolveOoxmlPath,
  resolveOoxmlPaths,
} from './custom-geometry';
export type {
  CustomGeometryOptions,
  CustomGuide,
  CustomPath,
  CustomPathCommand,
} from './custom-geometry';

// ─── Text in Shape ──────────────────────────────────────────────────────────

export { computeTextInset } from './text-in-shape';
export type { TextInShapeResult } from './text-in-shape';

// ─── Preset Registry ────────────────────────────────────────────────────────

export {
  computeBoundsForRatio,
  getAdjustmentValue,
  getAllPresetNames,
  getNaturalRatio,
  getPreset,
  getPresetCount,
  getPresetDefaults,
  getPresetsByCategory,
  getScalingMode,
  getTextInsetConfig,
  hasPreset,
  isRatioLocked,
  isUnfilled,
  registerCategory,
  registerNaturalRatio,
  registerPreset,
  registerScalingMode,
  registerTextInset,
  registerUnfilled,
} from './presets/registry';
export type {
  PathGenerator,
  ScalingMode,
  ShapeAdjustment,
  TextInsetConfig,
  TextInsetResult,
} from './presets/registry';

// ─── DrawingObject Output ──────────────────────────────────────────────────

export { createDrawingObject } from './drawing-object-output';
export type { ShapeVisualProperties } from './drawing-object-output';

// ─── Generated OOXML Types ─────────────────────────────────────────────────
// ShapePreset: string union of all 188 OOXML shape preset values,
// auto-generated from Rust via bridge-ts. Use for type-safe registry validation.

export type { ShapePreset } from '@mog/bridge-ts/generated/ooxml-types';

// ─── Diagnostics ────────────────────────────────────────────────────────────

export {
  compareShapes,
  generatePresetSummaryReport,
  generateShapeReport,
  validateShape,
} from './diagnostics';
export type {
  DiagnosticIssue,
  ShapeComparisonResult,
  ShapeDifference,
  ShapeValidationResult,
} from './diagnostics';
