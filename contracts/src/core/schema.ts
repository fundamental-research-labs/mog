/**
 * Type System Contracts
 *
 * Schema language for describing cell/column data types.
 * Enables typed columns, validation on entry, and is prerequisite for:
 * - Monte Carlo simulations (F1)
 * - API generation (C1)
 * - Self-diagnosing spreadsheets (H1)
 */

import type { IdentityRangeSchemaRef } from '@mog/types-core';

// ============================================================================
// Cell Schema Types
// ============================================================================

/**
 * Primitive cell value types
 */
export type PrimitiveSchemaType = 'string' | 'number' | 'boolean' | 'date' | 'null';

/**
 * Semantic types with special validation/rendering
 * Track 11.4: Added 'time' for time value validation (Excel parity)
 */
export type SemanticSchemaType =
  | 'currency'
  | 'percentage'
  | 'integer'
  | 'email'
  | 'url'
  | 'phone'
  | 'time';

/**
 * Entity types that enable semantic enrichment
 */
export type EntitySchemaType = 'company' | 'person' | 'stock' | 'location';

/**
 * Special types for advanced features
 */
export type SpecialSchemaType =
  | 'distribution' // For Monte Carlo simulations
  | 'any'; // No type enforcement

/**
 * All possible cell schema types
 */
export type CellSchemaType =
  | PrimitiveSchemaType
  | SemanticSchemaType
  | EntitySchemaType
  | SpecialSchemaType;

// ============================================================================
// Distribution Types (for Monte Carlo)
// ============================================================================

/**
 * Types of probability distributions supported
 */
export type DistributionType =
  | 'normal'
  | 'uniform'
  | 'triangular'
  | 'lognormal'
  | 'beta'
  | 'exponential';

/**
 * Distribution configuration for Monte Carlo simulations
 */
export interface DistributionConfig {
  /** Type of probability distribution */
  type: DistributionType;
  /** Distribution parameters (mean, stddev, min, max, etc.) */
  params: Record<string, number>;
}

// ============================================================================
// Constraint Types
// ============================================================================

/**
 * Constraints that can be applied to column values.
 *
 * Track 11.7: Added comparison operator constraints for Excel parity:
 * - exclusiveMin, exclusiveMax: For "greater than" and "less than" operators
 * - equal, notEqual: For exact value matching
 * - notBetweenMin, notBetweenMax: For "not between" operator (value < min OR value > max)
 */
export interface SchemaConstraints {
  /** Whether the cell must have a value */
  required?: boolean;
  /** Whether blank/empty values are allowed (default: true for data validation) */
  allowBlank?: boolean;
  /** Minimum value (inclusive, for numbers/dates) - "greater than or equal to" */
  min?: number;
  /** Maximum value (inclusive, for numbers/dates) - "less than or equal to" */
  max?: number;
  /** Minimum value (exclusive, for numbers/dates) - "greater than" */
  exclusiveMin?: number;
  /** Maximum value (exclusive, for numbers/dates) - "less than" */
  exclusiveMax?: number;
  /** Exact value to match - "equal to" */
  equal?: unknown;
  /** Value that must not match - "not equal to" */
  notEqual?: unknown;
  /** Not between range - minimum bound (value must be < this OR > notBetweenMax) */
  notBetweenMin?: number;
  /** Not between range - maximum bound (value must be < notBetweenMin OR > this) */
  notBetweenMax?: number;
  /** Minimum string length */
  minLength?: number;
  /** Maximum string length */
  maxLength?: number;
  /** Regex pattern the value must match */
  pattern?: string;
  /** Allowed values (enum constraint) - static list */
  enum?: unknown[];
  /**
   * Dynamic enum source - CellId-based range reference.
   * Values are resolved at validation/render time.
   * Takes precedence over static `enum` if both specified.
   *
   * Uses Cell Identity Model for CRDT-safe concurrent editing.
   * The range is defined by corner cell CellIds, not A1 strings.
   */
  enumSource?: IdentityRangeSchemaRef;
  /**
   * Formula-based enum source for dynamic dropdown lists.
   * Supports INDIRECT and other functions that return range references.
   *
   * Group 17: INDIRECT in Validation Lists
   *
   * When specified, the formula is evaluated at validation/dropdown time
   * to determine the list of valid values. This enables:
   * - Dependent/cascading dropdowns (Country -> City)
   * - Dynamic lists based on other cell values
   *
   * Formula must return a range reference or array of values.
   * Example: "INDIRECT(A1)" where A1 contains "Products" (a named range)
   *
   * Precedence: enumSourceFormula > enumSource > enum
   */
  enumSourceFormula?: string;
  /** Whether values must be unique in the column */
  unique?: boolean;
  /**
   * Custom validation formula (returns boolean).
   *
   * Max length is 8192 characters (Excel parity).
   *
   * Edge Cases
   * - Circular validation references that result in #REF! are handled gracefully
   *   by skipping validation, preventing infinite loops
   * - Error values (#N/A, #REF!, #VALUE!, etc.) don't crash validation - they're skipped
   * - For decimal precision control, use formulas like: =INT(A1*100)=A1*100
   */
  formula?: string;
}

// ============================================================================
// Column Schema
// ============================================================================

/**
 * Schema definition for a column
 */
export interface ColumnSchema {
  /** Unique identifier for the schema */
  id: string;
  /** Human-readable name for the column */
  name: string;
  /** Expected data type for cells in this column */
  type: CellSchemaType;
  /** Validation constraints */
  constraints?: SchemaConstraints;
  /** Distribution config for Monte Carlo (when type is 'distribution') */
  distribution?: DistributionConfig;
  /** Default value for new cells in this column */
  defaultValue?: unknown;
  /** Description of what this column contains */
  description?: string;
}

// ============================================================================
// Validation Results
// ============================================================================

/**
 * Severity levels for validation errors
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * A single validation error
 */
export interface SchemaValidationError {
  /** Error code (e.g., "TYPE_MISMATCH", "REQUIRED", "PATTERN") */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Severity level */
  severity: ValidationSeverity;
  /** Path to the invalid value (for nested structures) */
  path?: string;
}

/**
 * Result of validating a value against a schema
 */
export interface ValidationResult {
  /** Whether the value is valid */
  valid: boolean;
  /** Validation errors (empty if valid) */
  errors: SchemaValidationError[];
  /** Value after coercion (if applicable) */
  coercedValue?: unknown;
  /** The inferred type of the value */
  inferredType?: CellSchemaType;
}

// ============================================================================
// Type Coercion
// ============================================================================

/**
 * Result of attempting to coerce a value to a target type
 */
export interface CoercionResult {
  /** Whether coercion was successful */
  success: boolean;
  /** The coerced value (undefined if failed) */
  value?: unknown;
  /** Error message if coercion failed */
  error?: string;
}

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Result of inferring a column schema from sample values
 */
export interface InferredSchema {
  /** The inferred schema */
  schema: ColumnSchema;
  /** Confidence score (0-1) */
  confidence: number;
  /** Number of values analyzed */
  sampleSize: number;
  /** Types found in the sample */
  typesFound: Map<CellSchemaType, number>;
}

// ============================================================================
// Schema Validator Interface
// ============================================================================

/**
 * Interface for type validation and inference
 */
export interface ISchemaValidator {
  /**
   * Validate a value against a column schema
   * @param value The value to validate
   * @param schema The schema to validate against
   * @returns Validation result with errors if invalid
   */
  validate(value: unknown, schema: ColumnSchema): ValidationResult;

  /**
   * Infer the type of a single value
   * @param value The value to analyze
   * @returns The inferred type
   */
  inferType(value: unknown): CellSchemaType;

  /**
   * Infer a column schema from sample values
   * @param values Array of values from the column
   * @returns Inferred schema with confidence
   */
  inferColumnSchema(values: unknown[]): InferredSchema;

  /**
   * Attempt to coerce a value to a target type
   * @param value The value to coerce
   * @param targetType The type to coerce to
   * @returns Coercion result
   */
  coerce(value: unknown, targetType: CellSchemaType): CoercionResult;

  /**
   * Check if two types are compatible (value of type A can be used where type B is expected)
   * @param sourceType The type of the value
   * @param targetType The expected type
   * @returns Whether the types are compatible
   */
  isCompatible(sourceType: CellSchemaType, targetType: CellSchemaType): boolean;
}

// ============================================================================
// Schema Registry Interface
// ============================================================================

/**
 * Interface for managing column schemas per sheet
 */
export interface ISchemaRegistry {
  /**
   * Get the schema for a column
   * @param sheetId The sheet ID
   * @param colIndex The column index (0-based)
   * @returns The column schema, or undefined if not set
   */
  getColumnSchema(sheetId: string, colIndex: number): ColumnSchema | undefined;

  /**
   * Set the schema for a column
   * @param sheetId The sheet ID
   * @param colIndex The column index (0-based)
   * @param schema The schema to set
   */
  setColumnSchema(sheetId: string, colIndex: number, schema: ColumnSchema): void;

  /**
   * Remove the schema for a column
   * @param sheetId The sheet ID
   * @param colIndex The column index (0-based)
   */
  clearColumnSchema(sheetId: string, colIndex: number): void;

  /**
   * Get all schemas for a sheet
   * @param sheetId The sheet ID
   * @returns Map of column index to schema
   */
  getAllColumnSchemas(sheetId: string): Map<number, ColumnSchema>;

  /**
   * Infer and set schemas for all columns based on data
   * @param sheetId The sheet ID
   * @param sampleRows Number of rows to sample (default: 100)
   * @returns Map of column index to inferred schema
   */
  inferAllSchemas(sheetId: string, sampleRows?: number): Promise<Map<number, InferredSchema>>;
}

// ============================================================================
// Validation Error Codes
// ============================================================================

/**
 * Standard validation error codes
 */
export const ValidationErrorCodes = {
  // Type errors
  TYPE_MISMATCH: 'TYPE_MISMATCH',
  INVALID_FORMAT: 'INVALID_FORMAT',

  // Constraint errors
  REQUIRED: 'REQUIRED',
  MIN_VALUE: 'MIN_VALUE',
  MAX_VALUE: 'MAX_VALUE',
  MIN_LENGTH: 'MIN_LENGTH',
  MAX_LENGTH: 'MAX_LENGTH',
  PATTERN: 'PATTERN',
  ENUM: 'ENUM',
  UNIQUE: 'UNIQUE',
  FORMULA: 'FORMULA',

  // Semantic type errors
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_URL: 'INVALID_URL',
  INVALID_PHONE: 'INVALID_PHONE',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  INVALID_PERCENTAGE: 'INVALID_PERCENTAGE',
  INVALID_INTEGER: 'INVALID_INTEGER',
  INVALID_DATE: 'INVALID_DATE',
} as const;

export type ValidationErrorCode = (typeof ValidationErrorCodes)[keyof typeof ValidationErrorCodes];

// ============================================================================
// Enforcement Levels (Data Validation)
// ============================================================================

/**
 * How strictly to enforce a schema constraint.
 * Maps to Excel's errorStyle:
 * - 'strict'  → 'stop' (block invalid input)
 * - 'warning' → 'warning' (show dialog, user can proceed)
 * - 'info'    → 'information' (show indicator, always allow)
 * - 'none'    → no data validation exported (AI metadata only)
 */
export type EnforcementLevel = 'none' | 'info' | 'warning' | 'strict';

// ============================================================================
// Range Schema Types (Data Validation)
// ============================================================================

/**
 * Simplified schema for individual cells or ranges.
 * A subset of ColumnSchema focused on validation constraints.
 */
export interface CellSchema {
  /** Expected data type */
  type?: CellSchemaType;
  /** Validation constraints */
  constraints?: SchemaConstraints;
}

/**
 * UI configuration for data validation.
 * Controls dropdowns, input messages, and error alerts.
 */
export interface SchemaUI {
  /** Show dropdown arrow for enum/enumSource schemas */
  showDropdown?: boolean;

  /** Input message shown when cell is selected */
  inputMessage?: {
    title?: string;
    message?: string;
  };

  /** Error message shown on invalid input */
  errorMessage?: {
    title?: string;
    message?: string;
  };
}

/**
 * Schema applied to a specific range of cells.
 * This is the unified model for Excel-style Data Validation.
 *
 * Uses Cell Identity Model for CRDT-safe concurrent editing:
 * - Ranges are defined by CellId corner references, not A1 strings
 * - Structure changes (insert/delete row/col) don't require range adjustment
 * - Concurrent structure changes compose correctly
 */
export interface RangeSchema {
  /** Unique identifier */
  id: string;

  /** Unix timestamp for precedence ordering (most recent wins) */
  createdAt: number;

  /**
   * Cell ranges this schema applies to.
   * Each range is defined by CellId corner references for CRDT safety.
   * Position resolution happens at query time via CellPositionLookup.
   */
  ranges: IdentityRangeSchemaRef[];

  /** The schema definition */
  schema: CellSchema;

  /** How strictly to enforce */
  enforcement: EnforcementLevel;

  /** UI configuration (for user-facing validation) */
  ui?: SchemaUI;
}
