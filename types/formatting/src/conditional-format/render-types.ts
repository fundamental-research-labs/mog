/**
 * Conditional Formatting Render Types
 *
 * Types needed by canvas-renderer to render conditional formatting results.
 * These are extracted from engine to avoid circular dependencies during the
 * canvas-renderer extraction.
 *
 * ## Two-tier Rust type architecture
 *
 * The CFStyle defined here mirrors `compute-cf/src/types/rule.rs` — the
 * computation / rendering type used by the Rust CF evaluation engine.
 *
 * A separate, intentionally simplified persistence subset lives in
 * `domain-types/src/domain/conditional_format.rs`. That domain type is
 * auto-generated into `compute-types.gen.ts`, which is therefore NOT the
 * rendering source of truth for CFStyle — this file is.
 *
 * @module contracts/conditional-format/render-types
 */

// =============================================================================
// Style Definition
// =============================================================================

/**
 * Style to apply when a CF rule matches.
 * All properties are optional - only specified properties are applied.
 */
export interface CFStyle {
  // Background
  backgroundColor?: string;

  // Font
  fontColor?: string;
  bold?: boolean;
  italic?: boolean;
  underlineType?: 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting';
  strikethrough?: boolean;

  // Number format override
  numberFormat?: string;

  // Borders (optional, Excel-compatible — full CFBorderStyle enum from Rust)
  borderColor?: string;
  borderStyle?: CFBorderStyle;

  // Per-side borders (override unified borderColor/borderStyle when set)
  borderTopColor?: string;
  borderTopStyle?: CFBorderStyle;
  borderBottomColor?: string;
  borderBottomStyle?: CFBorderStyle;
  borderLeftColor?: string;
  borderLeftStyle?: CFBorderStyle;
  borderRightColor?: string;
  borderRightStyle?: CFBorderStyle;
}

/**
 * Border styles for conditional formatting.
 * Maps 1:1 to Rust `CFBorderStyle` enum in compute-cf/src/types.rs.
 */
export type CFBorderStyle =
  | 'none'
  | 'thin'
  | 'medium'
  | 'thick'
  | 'dashed'
  | 'dotted'
  | 'double'
  | 'hair'
  | 'mediumDashed'
  | 'dashDot'
  | 'mediumDashDot'
  | 'dashDotDot'
  | 'mediumDashDotDot'
  | 'slantDashDot';

// =============================================================================
// Icon Set Types
// =============================================================================

/**
 * Available icon set names (Excel-compatible).
 */
export type CFIconSetName =
  // 3-icon sets
  | '3Arrows'
  | '3ArrowsGray'
  | '3Flags'
  | '3TrafficLights1'
  | '3TrafficLights2'
  | '3Signs'
  | '3Symbols'
  | '3Symbols2'
  | '3Stars'
  | '3Triangles'
  // 4-icon sets
  | '4Arrows'
  | '4ArrowsGray'
  | '4Rating'
  | '4RedToBlack'
  | '4TrafficLights'
  // 5-icon sets
  | '5Arrows'
  | '5ArrowsGray'
  | '5Rating'
  | '5Quarters'
  | '5Boxes';

// =============================================================================
// Evaluation Result Types
// =============================================================================

/**
 * Result of evaluating conditional formatting for a single cell.
 * Multiple results possible if multiple rules match.
 */
export interface CFResult {
  /** Style overrides to apply */
  style?: CFStyle;

  /** Computed background color (from colorScale) */
  computedBackgroundColor?: string;

  /** Data bar to render */
  dataBar?: {
    /** Bar fill percentage (0-100) */
    fillPercent: number;
    /** Bar color */
    color: string;
    /** Whether this is a negative value */
    isNegative: boolean;
    /** Gradient fill? */
    gradient: boolean;
    /** Show value text? */
    showValue: boolean;
    /** Whether to show axis (for mixed positive/negative ranges) */
    showAxis: boolean;
    /** Axis position as percentage (0-100) - 50 for midpoint, computed for automatic */
    axisPosition: number;
    /** Color for negative bars (hex string). If absent, uses the main color. */
    negativeColor?: string;
  };

  /** Icon to render */
  icon?: {
    /** Icon set name */
    setName: CFIconSetName;
    /** Icon index within the set (0-based) */
    iconIndex: number;
    /** Hide cell value, show only icon */
    iconOnly: boolean;
  };
}
