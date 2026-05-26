/**
 * Shape Preset Registry
 *
 * Maps shape type names to path generator functions.
 * Each generator takes width, height, and optional adjustments
 * and returns a Path from the geometry package.
 */
import type { BoundingBox, Path } from '@mog-sdk/contracts/geometry';

// ─── Types ──────────────────────────────────────────────────────────────────

/** An adjustment handle for a shape (e.g., corner radius, arrow head size). */
export interface ShapeAdjustment {
  name: string;
  value: number;
  min?: number;
  max?: number;
}

/** A function that generates a Path for a given shape at given dimensions. */
export type PathGenerator = (width: number, height: number, adjustments: ShapeAdjustment[]) => Path;

/**
 * How a shape generator is invoked when the bounding box is non-square.
 *
 * - `'fill'` (default): generator receives (w, h) directly — shape stretches
 *   to fill the full bounding box.
 * - `'uniform'`: generator receives (s, s) where s = Math.min(w, h) — the
 *   resulting path is then translated to center within (w, h). Use for shapes
 *   with circular features that distort when stretched non-uniformly.
 */
export type ScalingMode = 'fill' | 'uniform';

/** Text inset result (mirrors TextInShapeResult from text-in-shape.ts). */
export interface TextInsetResult {
  insetBox: BoundingBox;
  verticalAlign: 'top' | 'middle' | 'bottom';
  margins: { top: number; right: number; bottom: number; left: number };
}

/**
 * Configuration for text inset computation.
 *
 * Either a simple margin fraction (applied uniformly) or a custom function
 * for shapes with complex text areas (e.g., triangle, parallelogram).
 */
export type TextInsetConfig =
  | { marginFraction: number; verticalAlign?: 'top' | 'middle' | 'bottom' }
  | { compute: (shapeBounds: BoundingBox, adjustments: ShapeAdjustment[]) => TextInsetResult };

// ─── Registry ───────────────────────────────────────────────────────────────

const registry = new Map<string, PathGenerator>();
const presetDefaults = new Map<string, ShapeAdjustment[]>();
const presetCategories = new Map<string, string>();
const textInsets = new Map<string, TextInsetConfig>();
const naturalRatios = new Map<string, number>();
const lockedRatios = new Set<string>();
const unfilledShapes = new Set<string>();
const scalingModes = new Map<string, ScalingMode>();

/** Current category for subsequent registerPreset() calls. */
let currentCategory = 'Other';

/**
 * Set the category for all subsequent `registerPreset()` calls.
 * Call this once at the top of each preset file to tag shapes with their category.
 */
export function registerCategory(category: string): void {
  currentCategory = category;
}

/** Register a path generator for a shape type, with optional default adjustments. */
export function registerPreset(
  shapeType: string,
  generator: PathGenerator,
  defaults?: ShapeAdjustment[],
): void {
  registry.set(shapeType, generator);
  if (defaults) {
    presetDefaults.set(shapeType, defaults);
  }
  presetCategories.set(shapeType, currentCategory);
}

/**
 * Register text inset configuration for a shape type.
 * This colocates text margins with the shape definition.
 */
export function registerTextInset(shapeType: string, config: TextInsetConfig): void {
  textInsets.set(shapeType, config);
}

/**
 * Get the registered text inset configuration for a shape type.
 * Returns undefined if none registered (fallback to switch).
 */
export function getTextInsetConfig(shapeType: string): TextInsetConfig | undefined {
  return textInsets.get(shapeType);
}

// ─── Natural Aspect Ratios ──────────────────────────────────────────────────

/**
 * Register the natural aspect ratio (width / height) for a shape type.
 *
 * Every shape has proportions at which it looks correct when first created.
 * Circles are 1:1, arrows are wide (2.0), brackets are tall (0.4), etc.
 *
 * @param shapeType - The canonical shape type name.
 * @param ratio - Width / height ratio (1.0 = square, >1 = wider, <1 = taller).
 * @param locked - If true, resize is constrained to this ratio. Use for shapes
 *   where stretching produces geometric degradation (gears) or is semantically
 *   wrong (circle). Defaults to false.
 */
export function registerNaturalRatio(shapeType: string, ratio: number, locked?: boolean): void {
  naturalRatios.set(shapeType, ratio);
  if (locked) {
    lockedRatios.add(shapeType);
  }
}

/**
 * Get the natural aspect ratio for a shape type.
 * Returns 1.0 if none registered.
 */
export function getNaturalRatio(shapeType: string): number {
  return naturalRatios.get(shapeType) ?? 1.0;
}

/**
 * Check if a shape type has a locked aspect ratio (constrained during resize).
 *
 */
export function isRatioLocked(shapeType: string): boolean {
  return lockedRatios.has(shapeType);
}

/**
 * Compute default bounds for a shape at a given base size.
 * The base size is used as the shorter dimension; the longer dimension
 * is computed from the natural ratio.
 */
export function computeBoundsForRatio(
  shapeType: string,
  baseSize: number,
): { width: number; height: number } {
  const ratio = getNaturalRatio(shapeType);
  if (ratio >= 1) {
    return { width: baseSize * ratio, height: baseSize };
  }
  return { width: baseSize, height: baseSize / ratio };
}

// ─── Default Fill ───────────────────────────────────────────────────────────

/**
 * Mark a shape type as naturally unfilled (stroke-only).
 *
 * Shapes like brackets, braces, lines, connectors, and arcs are stroke-only
 * by default — they should not receive a solid fill when created.
 */
export function registerUnfilled(shapeType: string): void {
  unfilledShapes.add(shapeType);
}

/**
 * Check if a shape type is naturally unfilled (stroke-only).
 * Returns false (= filled) if not registered.
 */
export function isUnfilled(shapeType: string): boolean {
  return unfilledShapes.has(shapeType);
}

// ─── Scaling Mode ───────────────────────────────────────────────────────────

export function registerScalingMode(shapeType: string, mode: ScalingMode): void {
  scalingModes.set(shapeType, mode);
}

export function getScalingMode(shapeType: string): ScalingMode {
  return scalingModes.get(shapeType) ?? 'fill';
}

/**
 * Get the default adjustments stored in the registry for a shape type.
 *
 */
export function getPresetDefaults(shapeType: string): ShapeAdjustment[] | undefined {
  return presetDefaults.get(shapeType);
}

/** Get the path generator for a shape type. Follows aliases. */
export function getPreset(shapeType: string): PathGenerator | undefined {
  return registry.get(shapeType);
}

/** Check if a shape type is registered. */
export function hasPreset(shapeType: string): boolean {
  return registry.has(shapeType);
}

/** Get all registered shape type names. */
export function getAllPresetNames(): string[] {
  return Array.from(registry.keys());
}

/** Get the number of registered presets. */
export function getPresetCount(): number {
  return registry.size;
}

/** Get all presets grouped by category. Uncategorized presets appear under 'Other'. */
export function getPresetsByCategory(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const name of registry.keys()) {
    const category = presetCategories.get(name) ?? 'Other';
    let list = result.get(category);
    if (!list) {
      list = [];
      result.set(category, list);
    }
    list.push(name);
  }
  return result;
}

// ─── Adjustment Helpers ─────────────────────────────────────────────────────

/** Get the value of a named adjustment, with clamping and default. */
export function getAdjustmentValue(
  adjustments: ShapeAdjustment[],
  name: string,
  defaultValue: number,
  min?: number,
  max?: number,
): number {
  const adj = adjustments.find((a) => a.name === name);
  const value = adj ? adj.value : defaultValue;
  if (isNaN(value)) return defaultValue;
  let clamped = value;
  if (min !== undefined && clamped < min) clamped = min;
  if (max !== undefined && clamped > max) clamped = max;
  return clamped;
}
