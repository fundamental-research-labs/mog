/**
 * Excel Number Format Code Registry
 *
 * SINGLE SOURCE OF TRUTH for all Excel number format CODE SYNTAX support.
 *
 * This module keeps type definitions and re-exports runtime values
 * for backward compatibility.
 */

// =============================================================================
// Types (kept in contracts as the canonical source)
// =============================================================================

/**
 * Priority level for format features
 */
export type FeaturePriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Category of format feature
 */
export type FormatFeatureCategory =
  | 'number-placeholders'
  | 'separators'
  | 'percentage'
  | 'scientific'
  | 'literals'
  | 'metacharacters'
  | 'colors'
  | 'conditions'
  | 'sections'
  | 'fractions'
  | 'date-tokens'
  | 'time-tokens'
  | 'elapsed-time'
  | 'text';

/**
 * Status of a format feature
 */
export interface FormatFeatureStatus {
  /** Feature name */
  name: string;
  /** Category of the feature */
  category: FormatFeatureCategory;
  /** Pattern or syntax */
  pattern: string;
  /** Whether it's implemented */
  implemented: boolean;
  /** Implementation priority */
  priority: FeaturePriority;
  /** Example format code */
  example?: string;
  /** Expected output for example */
  expectedOutput?: string;
  /** Implementation notes */
  notes?: string;
}

/**
 * Excel built-in format definition
 */
export interface BuiltInFormat {
  /** Excel format ID (0-49) */
  id: number;
  /** Format code */
  code: string;
  /** Whether it's implemented */
  implemented: boolean;
  /** Description */
  description?: string;
}
