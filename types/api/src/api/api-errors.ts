/**
 * API Error Types
 *
 * Structured error types for IPC serialization.
 * The ApiErrorCode type and ApiError interface define the wire format
 * for errors crossing the kernel boundary.
 *
 * Error construction and factory functions live in kernel/src/errors/api.ts.
 */

/**
 * API error codes - categorized by domain
 */
export type ApiErrorCode =
  // Cell address errors
  | 'INVALID_CELL_ADDRESS'
  | 'INVALID_RANGE'
  // Sheet errors
  | 'SHEET_NOT_FOUND'
  | 'INVALID_SHEET_ID'
  | 'SHEET_NAME_EXISTS'
  // Value errors
  | 'VALUE_TOO_LONG'
  | 'INVALID_VALUE_TYPE'
  // Formula errors
  | 'FORMULA_PARSE_ERROR'
  | 'CIRCULAR_REFERENCE'
  | 'UNKNOWN_FUNCTION'
  // Structure errors
  | 'INVALID_ROW_COUNT'
  | 'INVALID_COLUMN_COUNT'
  | 'ROW_OUT_OF_BOUNDS'
  | 'COLUMN_OUT_OF_BOUNDS'
  // Chart errors
  | 'CHART_NOT_FOUND'
  | 'INVALID_CHART_CONFIG'
  // Shape errors
  | 'SHAPE_NOT_FOUND'
  | 'INVALID_SHAPE_CONFIG'
  // Floating object errors
  | 'OBJECT_NOT_FOUND'
  | 'DRAWING_NOT_FOUND'
  | 'EQUATION_NOT_FOUND'
  | 'TEXT_EFFECT_NOT_FOUND'
  | 'DIAGRAM_NOT_FOUND'
  | 'BRIDGE_NOT_AVAILABLE'
  // Pivot errors
  | 'PIVOT_NOT_FOUND'
  | 'PIVOT_INVALID_DATA_SOURCE'
  | 'PIVOT_UNRESOLVED_FIELD_REFERENCES'
  // Protection errors
  | 'PROTECTED_RANGE'
  | 'PROTECTED_SHEET'
  // Generic errors
  | 'OPERATION_FAILED'
  | 'NOT_IMPLEMENTED';

/**
 * Structured API error with helpful context
 */
export interface ApiError {
  /** Error code for programmatic handling */
  code: ApiErrorCode;
  /** Human-readable error message */
  message: string;
  /** Path to the problematic field(s) */
  path?: string[];
  /** Suggestion for how to fix the error */
  suggestion?: string;
  /** Additional context */
  details?: Record<string, unknown>;
}
