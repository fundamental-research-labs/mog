/**
 * Equation Bridge Interface
 *
 * Defines the contract for equation parsing (OMML and LaTeX).
 * This interface abstracts the equation parsers from the rest of the engine,
 * enabling:
 * - Parser access without direct internal module imports
 * - Caching of parsed expressions
 * - Error handling and normalization
 * - Platform-agnostic API
 *
 * ARCHITECTURE: Bridge Pattern (Section 9 of Architecture Checklist)
 * - Interface defined in contracts (this file)
 * - Implementation in engine/src/state/bridges/equation-bridge.ts
 * - Access via ctx.equationBridge from coordinators
 *
 * @see engine/src/state/bridges/equation-bridge.ts - Implementation
 */

import type { EquationParseError, MathNode, Result } from '@mog/types-objects/equation';

// =============================================================================
// Equation Bridge Interface
// =============================================================================

/**
 * Bridge interface for equation parsing.
 *
 * This interface provides all the methods needed by the engine to
 * parse equations from OMML (file import) and LaTeX (user input).
 *
 * NOTE: Both parseOmml() and parseLatex() are defined here upfront
 * to enable parallel development of the two parsers (Wave 2).
 * Each parser implementation can be developed independently
 * against this shared contract.
 */
export interface IEquationBridge {
  // ===========================================================================
  // OMML parsing
  // ===========================================================================

  /**
   * Parse OMML XML string to MathNode AST.
   *
   * Used for importing equations from XLSX files.
   * OMML is the Office Math Markup Language defined in ECMA-376.
   *
   * @param omml - OMML XML string (e.g., "<m:oMath>...</m:oMath>")
   * @returns Result with MathNode[] AST or ParseError
   *
   * @example
   * ```typescript
   * const result = ctx.equationBridge.parseOmml('<m:oMath><m:f>...</m:f></m:oMath>');
   * if (result.ok) {
   *   // result.value is MathNode[] AST
   * } else {
   *   // result.error is ParseError
   * }
   * ```
   */
  parseOmml(omml: string): Result<MathNode[], EquationParseError>;

  // ===========================================================================
  // LaTeX parsing
  // ===========================================================================

  /**
   * Parse LaTeX string to MathNode AST.
   *
   * Used for user input in the Equation Editor dialog.
   * Supports a subset of LaTeX math syntax sufficient for common equations.
   *
   * @param latex - LaTeX math string (e.g., "\\frac{1}{2}")
   * @returns Result with MathNode[] AST or ParseError
   *
   * @example
   * ```typescript
   * const result = ctx.equationBridge.parseLatex('\\frac{a}{b}');
   * if (result.ok) {
   *   // result.value is MathNode[] AST
   * } else {
   *   // result.error is ParseError
   * }
   * ```
   */
  parseLatex(latex: string): Result<MathNode[], EquationParseError>;

  // ===========================================================================
  // Future methods
  // ===========================================================================

  // astToOmml(ast: MathNode[]): string;
  // astToLatex(ast: MathNode[]): string;
  // validateEquation(ast: MathNode[]): ValidationResult;
}
