/**
 * Schema Bridge Interface
 *
 * Defines the contract for schema validation and type checking.
 * This interface wraps ISchemaValidator (from schema.ts) with engine-specific
 * functionality like event-driven validation and cell metadata storage.
 *
 * Validation is primarily owned by Rust compute-core, which validates cells
 * during every mutation (in prepare_recalc_for_flush). Annotations flow through
 * MutationResult.recalc.validationAnnotations and are emitted as
 * `validation:recalc-annotations` EventBus events. The SchemaBridge listens
 * for these events and processes the annotations (storing errors in cell
 * metadata and emitting validation:failed / validation:passed events).
 *
 * NOTE: ISchemaValidator and ISchemaRegistry already exist in contracts/src/schema.ts
 * and handle core validation/registry operations. ISchemaBridge adds:
 * - Processing validation annotations from Rust recalc results
 * - Validation error storage in cell metadata
 * - Event emission for validation results
 * - On-demand validation (validateColumn, validateSheet)
 *
 * @see contracts/src/schema.ts - ISchemaValidator, ISchemaRegistry (core validation)
 * @see kernel/src/bridges/schema-bridge.ts - Implementation
 */

import type { SheetId, ValidationError } from '@mog/types-core';
import type { ValidationRecalcAnnotationsEvent } from '@mog/types-events/validation-events';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for schema validation bridge.
 */
export interface SchemaValidationOptions {
  /**
   * Whether to validate on every cell change.
   * @default true
   */
  validateOnChange?: boolean;

  /**
   * Whether to clear validation errors when a cell is cleared.
   * @default true
   */
  clearErrorsOnEmpty?: boolean;

  /**
   * Whether to emit validation events to the event bus.
   * @default true
   */
  emitEvents?: boolean;
}

/**
 * Cell with validation errors.
 */
export interface CellWithErrors {
  row: number;
  col: number;
  errors: ValidationError[];
}

/**
 * Validation error summary for a sheet.
 */
export interface ValidationErrorSummary {
  /** Total number of errors */
  totalErrors: number;
  /** Total number of warnings */
  totalWarnings: number;
  /** Number of cells with at least one error */
  cellsWithErrors: number;
}

/**
 * A single validation annotation from Rust recalc results.
 */
export type ValidationRecalcAnnotation = ValidationRecalcAnnotationsEvent['annotations'][number];

// =============================================================================
// Schema Bridge Interface
// =============================================================================

/**
 * Bridge interface for schema validation.
 *
 * Validation is primarily driven by Rust compute-core. The bridge listens
 * for `validation:recalc-annotations` events and processes them into
 * cell metadata and UI events.
 */
export interface ISchemaBridge {
  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start listening for validation annotation events from Rust recalc.
   *
   * @returns Cleanup function to stop listening
   */
  start(): () => void;

  /**
   * Stop listening for events.
   */
  stop(): void;

  // ===========================================================================
  // Annotation Processing
  // ===========================================================================

  /**
   * Process validation annotations from Rust mutation results.
   * For each annotation: stores errors in cell metadata and emits
   * validation:failed or validation:passed events.
   *
   * @param annotations - Validation annotations from Rust recalc
   */
  processValidationAnnotations(annotations: ValidationRecalcAnnotation[]): void;

  // ===========================================================================
  // On-Demand Validation
  // ===========================================================================

  /**
   * Validate a single cell value against its column schema.
   * Stores validation errors in cell metadata and emits events.
   *
   * @param sheetId - Sheet ID
   * @param row - Row index
   * @param col - Column index
   * @param value - Cell value to validate
   */
  validateCell(sheetId: SheetId, row: number, col: number, value: unknown): void;

  /**
   * Validate all cells in a column against the column schema.
   * Useful when a schema is first applied to an existing column.
   *
   * @param sheetId - Sheet ID
   * @param colIndex - Column index
   */
  validateColumn(sheetId: SheetId, colIndex: number): void;

  /**
   * Validate all cells that have column schemas in a sheet.
   * Useful after importing data or applying schemas.
   *
   * @param sheetId - Sheet ID
   */
  validateSheet(sheetId: SheetId): void;

  // ===========================================================================
  // Error Querying
  // ===========================================================================

  /**
   * Get all cells with validation errors in a sheet.
   *
   * @param sheetId - Sheet ID
   * @returns Array of cells with their errors
   */
  getCellsWithErrors(sheetId: SheetId): CellWithErrors[] | Promise<CellWithErrors[]>;

  /**
   * Get validation error summary for a sheet.
   *
   * @param sheetId - Sheet ID
   * @returns Error summary
   */
  getErrorSummary(sheetId: SheetId): ValidationErrorSummary | Promise<ValidationErrorSummary>;
}

// =============================================================================
// Re-export schema types for convenience
// =============================================================================

export type {
  ColumnSchema,
  ISchemaRegistry,
  ISchemaValidator,
  ValidationResult,
} from '@mog/types-commands/schema';
