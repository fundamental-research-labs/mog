/**
 * Equation Types
 *
 * Core types for mathematical equations in the spreadsheet.
 * Equations are floating objects that render math notation.
 */

import type { MathNode } from './omml-ast';

/**
 * Unique identifier for an equation
 */
export type EquationId = string & { readonly __brand: 'EquationId' };

/**
 * Math font for equation rendering
 * Excel uses Cambria Math by default
 */
export type MathFont =
  | 'Cambria Math' // Default Excel math font
  | 'Latin Modern' // TeX-style
  | 'STIX Two Math' // Scientific publishing
  | 'XITS Math' // Based on STIX
  | string; // Custom font

/**
 * Equation justification within its bounding box
 */
export type EquationJustification = 'left' | 'center' | 'right' | 'centerGroup';

/**
 * Main equation data model
 */
export interface Equation {
  /** Unique equation identifier */
  id: EquationId;

  /**
   * OMML XML string - the canonical storage format.
   * This is what gets written to XLSX files.
   * Example: <m:oMath><m:f><m:num>...</m:num><m:den>...</m:den></m:f></m:oMath>
   */
  omml: string;

  /**
   * LaTeX source (optional, for display/editing).
   * Not stored in XLSX - regenerated from OMML on import if needed.
   */
  latex?: string;

  /**
   * Parsed AST (computed, not persisted).
   * Used for rendering. Regenerated from OMML when needed.
   */
  ast?: MathNode;

  /**
   * Cached rendered image as data URL.
   * Invalidated when equation changes.
   */
  _cachedImageData?: string;

  /** Style options */
  style: EquationStyle;
}

/**
 * Equation rendering style options
 */
export interface EquationStyle {
  /** Math font family */
  fontFamily: MathFont;

  /** Base font size in points */
  fontSize: number;

  /** Text color (CSS color string) */
  color: string;

  /** Background color (CSS color string, 'transparent' for none) */
  backgroundColor: string;

  /** Justification */
  justification: EquationJustification;

  /** Display mode (block) vs inline mode */
  displayMode: boolean;

  /** Use small fractions (numerator/denominator same size as surrounding) */
  smallFractions: boolean;
}

/**
 * Result type for parser operations.
 * Re-exported from core/result.ts — canonical location for all packages.
 */
export type { Result } from '@mog/types-core/result';

/**
 * Function type for converting equation AST to LaTeX string.
 * Used for rendering equations with KaTeX.
 *
 * This type is defined in contracts to maintain package boundaries:
 * - GridRenderer interface (contracts) needs the type signature
 * - canvas-renderer uses the function for rendering
 * - engine provides the implementation
 */
export type AstToLatexFn = (node: MathNode) => string;

// NOTE: Do NOT define DEFAULT_EQUATION_STYLE here.
// Defaults are derived from EQUATION_STYLE_SCHEMA.
// Use getEquationStyleDefaults() from equation-schema.ts to get defaults.
//
// RATIONALE: Schema-driven approach ensures:
// 1. Single source of truth for defaults (EQUATION_STYLE_SCHEMA)
// 2. Defaults stay in sync with schema definitions
// 3. Type safety from schema inference
// 4. Consistency with other schema-based types (Cell, FloatingObject, etc.)
//
// ACCESSING DEFAULTS:
// - Import from kernel: import { getEquationStyleDefaults } from '@mog-sdk/kernel';
// - Get all defaults: const defaults = getEquationStyleDefaults();
// - Get specific default: const defaultFont = getEquationStyleDefault('fontFamily');
