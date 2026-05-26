/**
 * Format mapping utilities for spreadsheet special-cell typeAPI compatibility.
 *
 * Provides bidirectional conversions between spreadsheet special-cell typeformat representations
 * and OOXML/Mog internal representations.
 */

import type { PatternType } from '@mog/types-core/core';

// ============================================================================
// Text Orientation Conversion
// ============================================================================

/**
 * Convert an spreadsheet special-cell typetext orientation angle to an OOXML text rotation value.
 *
 * spreadsheet special-cell typeuses: -90 to 90 (degrees), plus 180 for vertical stacked text.
 * OOXML uses: 0-90 as-is, 91-180 for negative angles, 255 for vertical stacked.
 *
 * Conversion:
 *  - angle >= 0  → rotation = angle (clamped to 90)
 *  - angle < 0   → rotation = 90 + |angle| (clamped to 180)
 *  - angle === 180 → rotation = 255 (vertical stacked)
 */
export function officeJsAngleToOoxmlRotation(angle: number): number {
  if (angle === 180) return 255;
  if (angle >= 0) return Math.min(90, angle);
  return 90 + Math.min(90, Math.abs(angle));
}

/**
 * Convert an OOXML text rotation value to an spreadsheet special-cell typetext orientation angle.
 *
 * OOXML uses: 0-90 as-is, 91-180 for negative angles, 255 for vertical stacked.
 * spreadsheet special-cell typeuses: -90 to 90 (degrees), plus 180 for vertical stacked text.
 *
 * Conversion:
 *  - rotation <= 90       → angle = rotation
 *  - 90 < rotation <= 180 → angle = -(rotation - 90)
 *  - rotation === 255     → angle = 180 (vertical stacked)
 *  - otherwise            → 0
 */
export function ooxmlRotationToOfficeJsAngle(rotation: number): number {
  if (rotation === 255) return 180;
  if (rotation <= 90) return rotation;
  if (rotation <= 180) return -(rotation - 90);
  return 0;
}

// ============================================================================
// Pattern Type Name Mapping
// ============================================================================

/** spreadsheet special-cell typepattern name → OOXML/Mog PatternType */
const OFFICEJS_TO_OOXML_PATTERN: Record<string, PatternType> = {
  None: 'none',
  Solid: 'solid',
  Gray50: 'mediumGray',
  Gray75: 'darkGray',
  Gray25: 'lightGray',
  Gray12: 'gray125',
  Gray6: 'gray0625',
  HorizontalStripe: 'darkHorizontal',
  VerticalStripe: 'darkVertical',
  ReverseDiagonalStripe: 'darkDown',
  DiagonalStripe: 'darkUp',
  DiagonalCrosshatch: 'darkGrid',
  ThickDiagonalCrosshatch: 'darkTrellis',
  ThinHorizontalStripe: 'lightHorizontal',
  ThinVerticalStripe: 'lightVertical',
  ThinReverseDiagonalStripe: 'lightDown',
  ThinDiagonalStripe: 'lightUp',
  ThinHorizontalCrosshatch: 'lightGrid',
  ThinDiagonalCrosshatch: 'lightTrellis',
};

/** OOXML/Mog PatternType → spreadsheet special-cell typepattern name */
const OOXML_TO_OFFICEJS_PATTERN: Record<PatternType, string> = {
  none: 'None',
  solid: 'Solid',
  mediumGray: 'Gray50',
  darkGray: 'Gray75',
  lightGray: 'Gray25',
  gray125: 'Gray12',
  gray0625: 'Gray6',
  darkHorizontal: 'HorizontalStripe',
  darkVertical: 'VerticalStripe',
  darkDown: 'ReverseDiagonalStripe',
  darkUp: 'DiagonalStripe',
  darkGrid: 'DiagonalCrosshatch',
  darkTrellis: 'ThickDiagonalCrosshatch',
  lightHorizontal: 'ThinHorizontalStripe',
  lightVertical: 'ThinVerticalStripe',
  lightDown: 'ThinReverseDiagonalStripe',
  lightUp: 'ThinDiagonalStripe',
  lightGrid: 'ThinHorizontalCrosshatch',
  lightTrellis: 'ThinDiagonalCrosshatch',
};

/**
 * Convert an spreadsheet special-cell typepattern name to an OOXML/Mog PatternType.
 * Returns `'none'` for unrecognised names.
 */
export function officeJsPatternToOoxml(officeJsPattern: string): PatternType {
  return OFFICEJS_TO_OOXML_PATTERN[officeJsPattern] ?? 'none';
}

/**
 * Convert an OOXML/Mog PatternType to an spreadsheet special-cell typepattern name.
 * Returns `'None'` for unrecognised values.
 */
export function ooxmlPatternToOfficeJs(ooxmlPattern: PatternType): string {
  return OOXML_TO_OFFICEJS_PATTERN[ooxmlPattern] ?? 'None';
}

// ============================================================================
// Indent Level
// ============================================================================

/** Maximum indent level supported by the spreadsheet API. */
export const MAX_INDENT_LEVEL = 250;

/**
 * Clamp an indent value to the valid spreadsheet special-cell typerange (0-250).
 * The value is rounded to the nearest integer before clamping.
 */
export function clampIndent(indent: number): number {
  return Math.max(0, Math.min(MAX_INDENT_LEVEL, Math.round(indent)));
}
