/**
 * Constraint Type Runtime Helpers
 *
 * Provides category classification functions for the 64 OOXML constraint types.
 * These are used by the constraint solver and evaluator to determine how to
 * process different constraint categories.
 *
 * Each function checks whether a given ST_ConstraintType belongs to a specific
 * semantic category (positional, dimensional, margin, font, spacing, user-defined, etc.).
 *
 * @module constraint-types
 */

import type { ST_ConstraintType } from '@mog-sdk/contracts/diagram';

// =============================================================================
// Constraint Type Sets (for O(1) lookup)
// =============================================================================

const POSITIONAL_SET: ReadonlySet<ST_ConstraintType> = new Set<ST_ConstraintType>([
  'l',
  't',
  'r',
  'b',
  'lOff',
  'tOff',
  'rOff',
  'bOff',
  'ctrX',
  'ctrY',
  'ctrXOff',
  'ctrYOff',
]);

const DIMENSIONAL_SET: ReadonlySet<ST_ConstraintType> = new Set<ST_ConstraintType>([
  'w',
  'h',
  'wOff',
  'hOff',
]);

const MARGIN_SET: ReadonlySet<ST_ConstraintType> = new Set<ST_ConstraintType>([
  'lMarg',
  'tMarg',
  'rMarg',
  'bMarg',
  'begMarg',
  'endMarg',
]);

const FONT_SET: ReadonlySet<ST_ConstraintType> = new Set<ST_ConstraintType>([
  'primFontSz',
  'secFontSz',
]);

const SPACING_SET: ReadonlySet<ST_ConstraintType> = new Set<ST_ConstraintType>([
  'sp',
  'sibSp',
  'secSibSp',
]);

const GEOMETRY_SET: ReadonlySet<ST_ConstraintType> = new Set<ST_ConstraintType>([
  'connDist',
  'diam',
  'stemThick',
  'begPad',
  'endPad',
  'wArH',
  'hArH',
  'bendDist',
]);

const USER_DEFINED_SET: ReadonlySet<ST_ConstraintType> = new Set<ST_ConstraintType>([
  'userA',
  'userB',
  'userC',
  'userD',
  'userE',
  'userF',
  'userG',
  'userH',
  'userI',
  'userJ',
  'userK',
  'userL',
  'userM',
  'userN',
  'userO',
  'userP',
  'userQ',
  'userR',
  'userS',
  'userT',
  'userU',
  'userV',
  'userW',
  'userX',
  'userY',
  'userZ',
]);

// =============================================================================
// Category Classification Functions
// =============================================================================

/**
 * Check if a constraint type is positional.
 *
 * Positional constraints control the absolute or relative position of
 * layout nodes: l, t, r, b, lOff, tOff, rOff, bOff, ctrX, ctrY, ctrXOff, ctrYOff.
 *
 * @param type - The constraint type to check
 * @returns True if the type is positional
 */
export function isPositionalConstraint(type: ST_ConstraintType): boolean {
  return POSITIONAL_SET.has(type);
}

/**
 * Check if a constraint type is dimensional.
 *
 * Dimensional constraints control the width and height of layout nodes:
 * w, h, wOff, hOff.
 *
 * @param type - The constraint type to check
 * @returns True if the type is dimensional
 */
export function isDimensionalConstraint(type: ST_ConstraintType): boolean {
  return DIMENSIONAL_SET.has(type);
}

/**
 * Check if a constraint type is a margin constraint.
 *
 * Margin constraints control internal spacing within layout nodes:
 * lMarg, tMarg, rMarg, bMarg, begMarg, endMarg.
 *
 * @param type - The constraint type to check
 * @returns True if the type is a margin constraint
 */
export function isMarginConstraint(type: ST_ConstraintType): boolean {
  return MARGIN_SET.has(type);
}

/**
 * Check if a constraint type is a font constraint.
 *
 * Font constraints control text sizing within layout nodes:
 * primFontSz, secFontSz.
 *
 * @param type - The constraint type to check
 * @returns True if the type is a font constraint
 */
export function isFontConstraint(type: ST_ConstraintType): boolean {
  return FONT_SET.has(type);
}

/**
 * Check if a constraint type is a spacing constraint.
 *
 * Spacing constraints control gaps between layout nodes:
 * sp, sibSp, secSibSp.
 *
 * @param type - The constraint type to check
 * @returns True if the type is a spacing constraint
 */
export function isSpacingConstraint(type: ST_ConstraintType): boolean {
  return SPACING_SET.has(type);
}

/**
 * Check if a constraint type is a geometry constraint.
 *
 * Geometry constraints control geometric properties:
 * connDist, diam, stemThick, begPad, endPad, wArH, hArH, bendDist.
 *
 * @param type - The constraint type to check
 * @returns True if the type is a geometry constraint
 */
export function isGeometryConstraint(type: ST_ConstraintType): boolean {
  return GEOMETRY_SET.has(type);
}

/**
 * Check if a constraint type is user-defined.
 *
 * User-defined constraints (userA through userZ) are 26 custom variables
 * that can be used as intermediary values in complex constraint chains.
 * A constraint can set userA, and other constraints can reference userA
 * as their refType.
 *
 * @param type - The constraint type to check
 * @returns True if the type is a user-defined constraint
 */
export function isUserDefinedConstraint(type: ST_ConstraintType): boolean {
  return USER_DEFINED_SET.has(type);
}

/**
 * Check if a constraint type is a pyramid constraint.
 *
 * @param type - The constraint type to check
 * @returns True if the type is pyraAcctRatio
 */
export function isPyramidConstraint(type: ST_ConstraintType): boolean {
  return type === 'pyraAcctRatio';
}

/**
 * Check if a constraint type is an alignment constraint.
 *
 * @param type - The constraint type to check
 * @returns True if the type is alignOff
 */
export function isAlignmentConstraint(type: ST_ConstraintType): boolean {
  return type === 'alignOff';
}

/**
 * Get the semantic category name for a constraint type.
 *
 * Useful for logging, debugging, and diagnostics.
 *
 * @param type - The constraint type to categorize
 * @returns Human-readable category name
 */
export function getConstraintCategory(
  type: ST_ConstraintType,
):
  | 'positional'
  | 'dimensional'
  | 'margin'
  | 'font'
  | 'spacing'
  | 'geometry'
  | 'pyramid'
  | 'alignment'
  | 'user-defined'
  | 'none' {
  if (isPositionalConstraint(type)) return 'positional';
  if (isDimensionalConstraint(type)) return 'dimensional';
  if (isMarginConstraint(type)) return 'margin';
  if (isFontConstraint(type)) return 'font';
  if (isSpacingConstraint(type)) return 'spacing';
  if (isGeometryConstraint(type)) return 'geometry';
  if (isPyramidConstraint(type)) return 'pyramid';
  if (isAlignmentConstraint(type)) return 'alignment';
  if (isUserDefinedConstraint(type)) return 'user-defined';
  return 'none';
}

/**
 * Check if two constraint types form a horizontal complementary pair.
 *
 * Horizontal pairs are (l, w, r) — any two determine the third.
 * Used by the composite algorithm to derive missing positional values.
 *
 * @param type - The constraint type to check
 * @returns True if the type is part of the horizontal positional system
 */
export function isHorizontalConstraint(type: ST_ConstraintType): boolean {
  return type === 'l' || type === 'w' || type === 'r' || type === 'ctrX';
}

/**
 * Check if two constraint types form a vertical complementary pair.
 *
 * Vertical pairs are (t, h, b) — any two determine the third.
 * Used by the composite algorithm to derive missing positional values.
 *
 * @param type - The constraint type to check
 * @returns True if the type is part of the vertical positional system
 */
export function isVerticalConstraint(type: ST_ConstraintType): boolean {
  return type === 't' || type === 'h' || type === 'b' || type === 'ctrY';
}
