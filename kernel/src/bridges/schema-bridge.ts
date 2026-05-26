/**
 * Schema Validation Bridge
 *
 * Thin adapter that processes validation annotations from Rust compute-core.
 * Rust validates cells during every mutation (in prepare_recalc_for_flush).
 * Annotations flow through MutationResult.recalc.validationAnnotations and
 * are emitted as `validation:recalc-annotations` EventBus events.
 *
 * This bridge:
 * 1. Listens for `validation:recalc-annotations` events
 * 2. Stores validation errors in cell metadata
 * 3. Emits `validation:failed` / `validation:passed` events for UI consumption
 * 4. Provides on-demand validation (validateColumn, validateSheet) via Rust
 */

import type {
  CellWithErrors,
  ISchemaBridge,
  ValidationErrorSummary,
  ValidationRecalcAnnotation,
} from '@mog-sdk/contracts/bridges';
import { type SheetId, type ValidationError, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  ValidationFailedEvent,
  ValidationPassedEvent,
  ValidationRecalcAnnotationsEvent,
} from '@mog-sdk/contracts/events';
import type {
  CellSchemaType,
  ColumnSchema,
  SchemaValidationError,
  ValidationResult,
  ValidationSeverity,
} from '@mog-sdk/contracts/schema';

import * as Properties from '../domain/cells/cell-properties';
import * as Schemas from '../domain/schemas/schemas';

import type { DocumentContext } from '../context/types';
import {
  rustSchemaValidate,
  type ColumnSchemaWire,
  type SchemaConstraintsWire,
  type ValidationErrorWire,
} from './compute/compute-bridge';
import type { RangeSchema as GeneratedRangeSchema } from './compute/compute-types.gen';

// =============================================================================
// Wire Conversion Helper
// =============================================================================

/**
 * Convert a ColumnSchema (contracts type) to the wire format for Rust IPC.
 */
function columnSchemaToWire(schema: ColumnSchema): ColumnSchemaWire {
  return {
    id: schema.id,
    name: schema.name,
    type: schema.type,
    constraints: schema.constraints as SchemaConstraintsWire | undefined,
    distribution: schema.distribution as ColumnSchemaWire['distribution'],
    description: schema.description,
  };
}

/**
 * Convert a generated RangeSchema (from Rust compute-types.gen) to the contracts RangeSchema type.
 */
function rangeSchemaFromWire(
  wire: GeneratedRangeSchema,
): import('@mog-sdk/contracts/schema').RangeSchema {
  return {
    id: wire.id,
    createdAt: wire.createdAt,
    ranges: wire.ranges,
    schema: {
      type: wire.schema.type as CellSchemaType | undefined,
      constraints: wire.schema.constraints,
    },
    enforcement: (wire.enforcement ??
      'warning') as import('@mog-sdk/contracts/schema').EnforcementLevel,
    ui: wire.ui,
  };
}

// =============================================================================
// Options
// =============================================================================

/**
 * Options for schema validation bridge
 */
export interface SchemaValidationOptions {
  /**
   * Whether to validate on every cell change.
   * Default: true
   */
  validateOnChange?: boolean;

  /**
   * Whether to clear validation errors when a cell is cleared.
   * Default: true
   */
  clearErrorsOnEmpty?: boolean;

  /**
   * Whether to emit validation events to the event bus.
   * Default: true
   */
  emitEvents?: boolean;
}

const DEFAULT_OPTIONS: Required<SchemaValidationOptions> = {
  validateOnChange: true,
  clearErrorsOnEmpty: true,
  emitEvents: true,
};

// =============================================================================
// Schema Validation Bridge
// =============================================================================

/**
 * Schema Validation Bridge
 *
 * Thin adapter that listens for validation annotations from Rust compute-core
 * and stores them in cell metadata / emits UI events.
 */
export class SchemaValidationBridge implements ISchemaBridge {
  private ctx: DocumentContext;
  private options: Required<SchemaValidationOptions>;
  private unsubscribers: Array<() => void> = [];

  constructor(ctx: DocumentContext, options: SchemaValidationOptions = {}) {
    this.ctx = ctx;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start listening for validation annotation events from Rust recalc.
   * Returns a cleanup function to stop listening.
   */
  start(): () => void {
    // Subscribe to validation annotations from Rust recalc
    const unsubAnnotations = this.ctx.eventBus.on<ValidationRecalcAnnotationsEvent>(
      'validation:recalc-annotations',
      (event) => {
        this.processValidationAnnotations(event.annotations);
      },
    );
    this.unsubscribers.push(unsubAnnotations);

    return () => this.stop();
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  // ===========================================================================
  // Annotation Processing
  // ===========================================================================

  /**
   * Process validation annotations from Rust mutation results.
   * For each annotation: stores errors in cell metadata and emits
   * validation:failed or validation:passed events.
   */
  processValidationAnnotations(annotations: ValidationRecalcAnnotation[]): void {
    for (const annotation of annotations) {
      const sheetId = toSheetId(annotation.sheetId);
      const row = annotation.row;
      const col = annotation.column;

      if (annotation.errors.length > 0) {
        // Convert annotation errors to ValidationError for metadata storage
        const validationErrors: ValidationError[] = annotation.errors.map(
          (e: { rule: string; message: string; severity: 'error' | 'warning' }) => ({
            rule: e.rule,
            message: e.message,
            severity: e.severity,
          }),
        );

        // Store in cell metadata
        Properties.setMetadata(this.ctx, sheetId, row, col, { validationErrors }, 'validation');

        if (this.options.emitEvents) {
          const schema = Schemas.getColumnSchema(this.ctx, sheetId, col);

          const failedEvent: ValidationFailedEvent = {
            type: 'validation:failed',
            timestamp: Date.now(),
            sheetId: sheetId as string,
            row,
            col,
            value: null,
            schema: schema as ColumnSchema,
            errors: annotation.errors.map(
              (e: { rule: string; message: string; severity: 'error' | 'warning' }) => ({
                code: e.rule,
                message: e.message,
                severity: e.severity as SchemaValidationError['severity'],
              }),
            ),
          };
          this.ctx.eventBus.emit(failedEvent);
        }
      } else {
        // No errors — clear validation errors
        this.clearValidationErrors(sheetId, row, col);

        if (this.options.emitEvents) {
          const passedEvent: ValidationPassedEvent = {
            type: 'validation:passed',
            timestamp: Date.now(),
            sheetId: sheetId as string,
            row,
            col,
            value: null,
            inferredType: 'string' as CellSchemaType,
          };
          this.ctx.eventBus.emit(passedEvent);
        }
      }
    }
  }

  // ===========================================================================
  // On-Demand Validation
  // ===========================================================================

  /**
   * Validate a single cell value against its column schema.
   * Used for on-demand validation (e.g., validateColumn).
   * Delegates to Rust via rustSchemaValidate.
   */
  validateCell(sheetId: SheetId, row: number, col: number, value: unknown): void {
    const schema = Schemas.getColumnSchema(this.ctx, sheetId, col);
    if (!schema) return;

    // Handle empty values
    if (this.isEmpty(value)) {
      if (this.options.clearErrorsOnEmpty) {
        this.clearValidationErrors(sheetId, row, col);
      }

      if (schema.constraints?.required) {
        const errors: SchemaValidationError[] = [
          {
            code: 'REQUIRED',
            message: 'Value is required',
            severity: 'error',
          },
        ];
        this.storeValidationErrors(sheetId, row, col, errors, schema, value);
      }
      return;
    }

    // Fire-and-forget to Rust
    void this.validateCellViaRust(sheetId, row, col, value, schema);
  }

  /**
   * Validate a cell value via the Rust schema engine (async).
   */
  private async validateCellViaRust(
    sheetId: SheetId,
    row: number,
    col: number,
    value: unknown,
    schema: ColumnSchema,
  ): Promise<void> {
    try {
      const wireResult = await rustSchemaValidate(
        value as import('@mog-sdk/contracts/core').CellValue,
        columnSchemaToWire(schema),
      );

      const result: ValidationResult = {
        valid: wireResult.valid,
        errors: wireResult.errors.map((e: ValidationErrorWire) => ({
          code: e.code,
          message: e.message,
          severity: e.severity as ValidationSeverity,
        })),
        coercedValue: wireResult.coercedValue ? wireResult.coercedValue.value : undefined,
        inferredType: wireResult.inferredType as CellSchemaType | undefined,
      };

      this.applyValidationResult(sheetId, row, col, result, schema, value);
    } catch (err) {
      console.error('[SchemaValidationBridge] Rust validation failed:', err);
    }
  }

  /**
   * Validate all cells in a column against the column schema.
   */
  async validateColumn(sheetId: SheetId, colIndex: number): Promise<void> {
    const schema = Schemas.getColumnSchema(this.ctx, sheetId, colIndex);
    if (!schema) return;

    const bounds = await this.ctx.computeBridge.getDataBounds(sheetId);
    if (!bounds) return;

    const rangeResult = await this.ctx.computeBridge.queryRange(
      sheetId,
      bounds.minRow,
      colIndex,
      bounds.maxRow,
      colIndex,
    );

    for (const cell of rangeResult.cells) {
      this.validateCell(sheetId, cell.row, cell.col, cell.value);
    }
  }

  /**
   * Validate all cells that have column schemas in a sheet.
   */
  async validateSheet(sheetId: SheetId): Promise<void> {
    const schemas = Schemas.getAllColumnSchemas(sheetId);

    for (const [colIndex] of schemas) {
      await this.validateColumn(sheetId, colIndex);
    }
  }

  // ===========================================================================
  // Error Querying
  // ===========================================================================

  /**
   * Get all cells with validation errors in a sheet.
   */
  async getCellsWithErrors(sheetId: SheetId): Promise<CellWithErrors[]> {
    const cells = await Properties.queryByMetadata(this.ctx, sheetId, (meta) => {
      return (meta.validationErrors?.length ?? 0) > 0;
    });
    const results: CellWithErrors[] = [];
    for (const { row, col } of cells) {
      const meta = await Properties.getMetadata(this.ctx, sheetId, row, col);
      results.push({
        row,
        col,
        errors: meta?.validationErrors ?? [],
      });
    }
    return results;
  }

  /**
   * Get validation error summary for a sheet.
   */
  async getErrorSummary(sheetId: SheetId): Promise<ValidationErrorSummary> {
    const cellsWithErrors = await this.getCellsWithErrors(sheetId);

    let totalErrors = 0;
    let totalWarnings = 0;

    for (const cell of cellsWithErrors) {
      for (const error of cell.errors) {
        if (error.severity === 'error') {
          totalErrors++;
        } else {
          totalWarnings++;
        }
      }
    }

    return {
      totalErrors,
      totalWarnings,
      cellsWithErrors: cellsWithErrors.length,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Check if a value is empty (null, undefined, or empty string)
   */
  private isEmpty(value: unknown): boolean {
    return value === null || value === undefined || value === '';
  }

  /**
   * Apply a validation result: store errors or clear them and emit events.
   */
  private applyValidationResult(
    sheetId: SheetId,
    row: number,
    col: number,
    result: ValidationResult,
    schema: ColumnSchema,
    value: unknown,
  ): void {
    if (!result.valid) {
      this.storeValidationErrors(sheetId, row, col, result.errors, schema, value);
    } else {
      this.clearValidationErrors(sheetId, row, col);

      if (this.options.emitEvents) {
        const inferredType = result.inferredType ?? 'string';

        const passedEvent: ValidationPassedEvent = {
          type: 'validation:passed',
          timestamp: Date.now(),
          sheetId: sheetId as string,
          row,
          col,
          value: value as import('@mog-sdk/contracts').CellValue,
          coercedValue: result.coercedValue as import('@mog-sdk/contracts').CellValue | undefined,
          inferredType: inferredType,
        };
        this.ctx.eventBus.emit(passedEvent);
      }
    }
  }

  /**
   * Store validation errors in cell metadata and emit event.
   */
  private storeValidationErrors(
    sheetId: SheetId,
    row: number,
    col: number,
    errors: SchemaValidationError[],
    schema: ColumnSchema,
    value: unknown,
  ): void {
    const validationErrors: ValidationError[] = errors.map((e) => ({
      rule: e.code,
      message: e.message,
      severity: e.severity === 'info' ? 'warning' : e.severity,
    }));

    Properties.setMetadata(this.ctx, sheetId, row, col, { validationErrors }, 'validation');

    if (this.options.emitEvents) {
      const failedEvent: ValidationFailedEvent = {
        type: 'validation:failed',
        timestamp: Date.now(),
        sheetId: sheetId as string,
        row,
        col,
        value: value as import('@mog-sdk/contracts').CellValue,
        schema,
        errors,
      };
      this.ctx.eventBus.emit(failedEvent);
    }
  }

  /**
   * Clear validation errors from cell metadata.
   */
  private clearValidationErrors(sheetId: SheetId, row: number, col: number): void {
    Properties.setMetadata(this.ctx, sheetId, row, col, { validationErrors: [] }, 'validation');
  }
}
