/**
 * Equation Parse Error Types
 *
 * Error types for equation parsing operations (OMML and LaTeX).
 * These provide structured error information for better diagnostics.
 *
 * NOTE: These types are prefixed with "Equation" to avoid naming collision
 * with the xlsx-parser's ParseError/ParseErrorCode types.
 */

export type EquationParseErrorCode =
  | 'INVALID_XML'
  | 'UNKNOWN_ELEMENT'
  | 'INVALID_STRUCTURE'
  | 'MISSING_REQUIRED_CHILD'
  | 'INVALID_ATTRIBUTE'
  | 'MAX_DEPTH_EXCEEDED'
  | 'MAX_LENGTH_EXCEEDED'
  | 'UNSUPPORTED_LATEX'
  | 'SYNTAX_ERROR'
  | 'EMPTY_INPUT';

export interface EquationParseError {
  code: EquationParseErrorCode;
  message: string;
  /** Position in source (for LaTeX) or element path (for OMML) */
  location?: string;
  /** The problematic input fragment */
  fragment?: string;
}
