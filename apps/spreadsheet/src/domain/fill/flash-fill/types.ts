/**
 * Flash Fill Types
 *
 * Type definitions for the Flash Fill pattern recognition engine.
 *
 * Flash Fill detects data transformation patterns from user examples and
 * applies them to fill a column automatically.
 *
 */

import type { CellValue } from '@mog-sdk/contracts/core';

// =============================================================================
// Pattern Types
// =============================================================================

/**
 * Types of patterns that Flash Fill can detect.
 */
export type FlashFillPatternType =
  | 'template' // Token/literal template synthesized by greedy match against example output
  | 'extract' // Extract substring from source
  | 'combine' // Combine multiple source values
  | 'split' // Split source value by delimiter
  | 'case_change' // Change case (upper, lower, title)
  | 'reformat' // Reformat text (e.g., phone numbers, dates)
  | 'prefix' // Add prefix to source value
  | 'suffix' // Add suffix to source value
  | 'replace' // Replace substring in source value
  | 'unknown'; // Pattern could not be determined

/**
 * Case change operations.
 */
export type CaseChangeType = 'upper' | 'lower' | 'title' | 'sentence' | 'none';

/**
 * Position specification for extraction.
 */
export interface ExtractionPosition {
  /** Starting position (0-based, or negative for from end) */
  start: number;
  /** Length of extraction (-1 for until end) */
  length: number;
  /** Delimiter to use for position reference */
  delimiter?: string;
  /** Word index (0-based) when splitting by delimiter */
  wordIndex?: number;
}

/**
 * Tokenization kind used when matching tokens against example output.
 *
 * - `'full'`: the entire source cell value (untokenized). Used when the
 * example output contains the source verbatim (e.g. "Widget" → "Widget").
 * - `'whitespace'`: split by whitespace, preserving punctuation in tokens.
 * Used for first/last name extraction (e.g. "John Smith" → "John").
 * - `'delimiter'`: split by `[\s,.\-/_]+`, dropping the delimiters. Used to
 * extract digit runs or other punctuation-bounded tokens (e.g.
 * "INV-10234-Q1" → "10234").
 */
export type TokenKind = 'full' | 'whitespace' | 'delimiter';

/**
 * A single transformation step in a Flash Fill pattern.
 */
export interface TransformationStep {
  /** Type of transformation */
  type:
    | 'extract_position'
    | 'extract_delimiter'
    | 'extract_word'
    | 'literal'
    | 'case_change'
    | 'replace'
    | 'token';
  /** Position-based extraction parameters */
  position?: ExtractionPosition;
  /** Delimiter for split operations */
  delimiter?: string;
  /** Word index for word extraction */
  wordIndex?: number;
  /** Literal text to insert */
  literal?: string;
  /** Case change type */
  caseChange?: CaseChangeType;
  /** Replacement parameters */
  replace?: { from: string; to: string };
  /** Source column index (for multi-column patterns) */
  sourceColumn?: number;
  // -- token-step specific --
  /** Tokenization kind for `type: 'token'`. */
  tokenKind?: TokenKind;
  /** Index into the tokenized source (0-based) for `type: 'token'`. */
  tokenIndex?: number;
  /**
   * Optional prefix length (1..N) for `type: 'token'`. When set, the
   * output of this step is the first `tokenPrefixLen` characters of the
   * resolved token (after case transformation). Used for first-initial
   * patterns like "J. Smith" → first char of "John".
   */
  tokenPrefixLen?: number;
}

/**
 * A complete Flash Fill pattern representing a transformation.
 */
export interface FlashFillPattern {
  /** Type of pattern detected */
  type: FlashFillPatternType;
  /** Sequence of transformation steps */
  steps: TransformationStep[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Source column indices used in the pattern */
  sourceColumns: number[];
  /** Description of what the pattern does */
  description: string;
}

// =============================================================================
// Example Types
// =============================================================================

/**
 * An example for Flash Fill pattern detection.
 * Represents a source value(s) and the expected output.
 */
export interface FlashFillExample {
  /** Source values from one or more columns */
  source: CellValue[];
  /** Expected output value */
  output: CellValue;
  /** Row index of this example */
  row: number;
}

/**
 * Context for Flash Fill analysis.
 */
export interface FlashFillContext {
  /** Column index being filled */
  targetColumn: number;
  /** Starting row of the target range */
  startRow: number;
  /** Ending row of the target range */
  endRow: number;
  /** Examples provided by the user */
  examples: FlashFillExample[];
  /** All values in potential source columns (adjacent columns) */
  sourceData: Map<number, CellValue[]>;
  /** Sheet ID */
  sheetId: string;
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of Flash Fill pattern detection.
 */
export interface FlashFillDetectionResult {
  /** Whether a pattern was successfully detected */
  success: boolean;
  /** The detected pattern (if successful) */
  pattern?: FlashFillPattern;
  /** Generated values for the target column */
  values?: CellValue[];
  /** Error message if detection failed */
  error?: string;
  /** Rows that were filled */
  filledRows?: number[];
}

/**
 * Preview data for Flash Fill.
 */
export interface FlashFillPreview {
  /** Target column index */
  column: number;
  /** Values to preview, keyed by row index */
  values: Map<number, CellValue>;
  /** Pattern description */
  patternDescription: string;
  /** Whether the preview is currently shown */
  isShown: boolean;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for Flash Fill detection.
 */
export interface FlashFillConfig {
  /** Minimum number of examples required */
  minExamples: number;
  /** Minimum confidence threshold (0-1) */
  minConfidence: number;
  /** Maximum number of source columns to consider */
  maxSourceColumns: number;
  /** Maximum number of rows to analyze */
  maxRows: number;
  /** Whether to show preview automatically */
  autoPreview: boolean;
}

/**
 * Default Flash Fill configuration.
 */
export const DEFAULT_FLASH_FILL_CONFIG: FlashFillConfig = {
  minExamples: 1,
  minConfidence: 0.8,
  maxSourceColumns: 5,
  maxRows: 10000,
  autoPreview: true,
};
