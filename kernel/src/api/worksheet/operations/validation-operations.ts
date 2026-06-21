/**
 * Validation Operations Module
 *
 * Operations for data validation that require real business logic beyond
 * a single bridge call: viewport filtering, dropdown item resolution,
 * and multi-step orchestration.
 *
 * Trivial one-liner bridge delegations (setRangeSchema, deleteRangeSchema,
 * getRangeSchemasForSheet, etc.) have been inlined into their callers.
 */

import type {
  CellValidationResult,
  RangeSchema,
  ColumnSchemaWire,
  InferredSchemaWire,
  SchemaTypeWire,
  ValidationResultWire,
} from '../../../bridges/compute/compute-bridge';
import type { MutationAdmissionOptions } from '../../../bridges/compute';
import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { isCellError } from '@mog/spreadsheet-utils/errors';
import { KernelError } from '../../../errors';

import type { DocumentContext, OperationResult } from './shared';
import { operationFailed } from './shared';
import {
  getWorksheetValidationCache,
  invalidateWorksheetValidationCache,
} from '../validation-cache';

export interface DropdownItemResolution {
  items: string[];
  resolved: boolean;
}

// =============================================================================
// Range Schema Viewport Filtering
// =============================================================================

/**
 * Update a column schema (data validation) for a specific column.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param column - Column index (0-based)
 * @param schema - Column schema definition
 * @param version - Schema version number
 * @returns OperationResult indicating success or failure
 */
export async function updateColumnSchema(
  ctx: DocumentContext,
  sheetId: SheetId,
  column: number,
  schema: ColumnSchemaWire,
  version: number,
): Promise<OperationResult<boolean>> {
  if (column < 0) {
    return { success: false, error: operationFailed('updateColumnSchema', 'Column must be >= 0') };
  }

  try {
    await ctx.computeBridge.updateSchema(sheetId, column, schema, version);
    return { success: true, data: true };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('updateColumnSchema', String(e)),
    };
  }
}

/**
 * Remove a column schema (data validation) for a specific column.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param column - Column index (0-based)
 * @param version - Schema version number
 * @returns OperationResult indicating success or failure
 */
export async function removeColumnSchema(
  ctx: DocumentContext,
  sheetId: SheetId,
  column: number,
  version: number,
): Promise<OperationResult<boolean>> {
  if (column < 0) {
    return { success: false, error: operationFailed('removeColumnSchema', 'Column must be >= 0') };
  }

  try {
    await ctx.computeBridge.removeSchema(sheetId, column, version);
    return { success: true, data: true };
  } catch (e) {
    return {
      success: false,
      error: operationFailed('removeColumnSchema', String(e)),
    };
  }
}

/**
 * Validate a cell value against a schema.
 *
 * Stateless validation — does not modify any data.
 *
 * @param ctx - Store context
 * @param value - The cell value to validate
 * @param schema - The column schema to validate against
 * @returns Validation result
 */
export async function validateCellValue(
  ctx: DocumentContext,
  value: CellValue,
  schema: ColumnSchemaWire,
): Promise<ValidationResultWire> {
  try {
    return await ctx.computeBridge.schemaValidate(value, schema);
  } catch (e) {
    throw KernelError.from(e, 'OPERATION_FAILED', `Failed to validate cell value: ${String(e)}`);
  }
}

/**
 * Infer the schema type for a single value.
 *
 * Stateless inference — does not modify any data.
 *
 * @param ctx - Store context
 * @param value - The cell value to infer type for
 * @returns Inferred schema type
 */
export async function inferSchemaType(
  ctx: DocumentContext,
  value: CellValue,
): Promise<SchemaTypeWire> {
  try {
    return await ctx.computeBridge.schemaInferType(value);
  } catch (e) {
    throw KernelError.from(e, 'OPERATION_FAILED', `Failed to infer schema type: ${String(e)}`);
  }
}

/**
 * Infer a column schema from an array of values.
 *
 * Stateless inference — does not modify any data.
 *
 * @param ctx - Store context
 * @param values - Array of cell values
 * @returns Inferred column schema
 */
export async function inferColumnSchema(
  ctx: DocumentContext,
  values: CellValue[],
): Promise<InferredSchemaWire> {
  try {
    return await ctx.computeBridge.schemaInferColumn(values);
  } catch (e) {
    throw KernelError.from(e, 'OPERATION_FAILED', `Failed to infer column schema: ${String(e)}`);
  }
}

// =============================================================================
// Range Schema Operations (data validation rules)
// =============================================================================

/**
 * Get a range schema by ID.
 */
export async function getRangeSchema(
  ctx: DocumentContext,
  sheetId: SheetId,
  schemaId: string,
): Promise<RangeSchema | null> {
  try {
    return await ctx.computeBridge.getRangeSchema(sheetId, schemaId);
  } catch (e) {
    return null;
  }
}

/**
 * Get all range schemas for a sheet.
 */
export async function getRangeSchemasForSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<RangeSchema[]> {
  try {
    return await getWorksheetValidationCache(ctx).getSchemasForSheet(sheetId);
  } catch (e) {
    return [];
  }
}

/**
 * Get range schemas visible in a viewport.
 * Fetches all schemas for the sheet and filters client-side by viewport bounds.
 * <100 rules per sheet makes this negligible.
 */
export async function getRangeSchemasInViewport(
  ctx: DocumentContext,
  sheetId: SheetId,
  bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
): Promise<RangeSchema[]> {
  const allSchemas = await getWorksheetValidationCache(ctx).getSchemasForSheet(sheetId);
  return allSchemas.filter((schema) => {
    return schema.ranges.some((rangeRef) => {
      const start = parseRefId(rangeRef.startId);
      const end = parseRefId(rangeRef.endId);
      if (!start || !end) return false;
      return (
        start.row <= bounds.endRow &&
        end.row >= bounds.startRow &&
        start.col <= bounds.endCol &&
        end.col >= bounds.startCol
      );
    });
  });
}

/**
 * Parse a range ref ID to extract row/col position.
 * Supports: "row:col" format, "cell-{sheet}-{row}-{col}" format.
 */
function parseRefId(id: string): { row: number; col: number } | null {
  // Format 1: "row:col"
  const colonIdx = id.indexOf(':');
  if (colonIdx > 0) {
    const row = parseInt(id.substring(0, colonIdx), 10);
    const col = parseInt(id.substring(colonIdx + 1), 10);
    if (!isNaN(row) && !isNaN(col) && row >= 0 && col >= 0) {
      return { row, col };
    }
  }
  // Format 2: "cell-{sheet}-{row}-{col}"
  if (id.startsWith('cell-')) {
    const parts = id.split('-');
    if (parts.length >= 4) {
      const col = parseInt(parts[parts.length - 1], 10);
      const row = parseInt(parts[parts.length - 2], 10);
      if (!isNaN(row) && !isNaN(col) && row >= 0 && col >= 0) {
        return { row, col };
      }
    }
  }
  return null;
}

function isNullCellValue(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    String((value as { type?: unknown }).type) === 'Null'
  );
}

/**
 * Set (create or replace) a range schema.
 */
export async function setRangeSchema(
  ctx: DocumentContext,
  sheetId: SheetId,
  schema: RangeSchema,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  invalidateWorksheetValidationCache(ctx, sheetId);
  await ctx.computeBridge.setRangeSchema(sheetId, schema, admissionOptions);
}

/**
 * Delete a range schema by ID.
 */
export async function deleteRangeSchema(
  ctx: DocumentContext,
  sheetId: SheetId,
  schemaId: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<void> {
  invalidateWorksheetValidationCache(ctx, sheetId);
  await ctx.computeBridge.deleteRangeSchema(sheetId, schemaId, admissionOptions);
}

/**
 * Validate a cell value against all schemas at a position (document-aware).
 * Unlike the stateless `validateCellValue` above, this checks the cell's
 * actual position against column + range schemas stored in Rust.
 */
export async function validateCellValueAtPosition(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  value: string,
): Promise<CellValidationResult> {
  return ctx.computeBridge.validateCellValueInDoc(sheetId, row, col, value);
}

/**
 * Get dropdown items for a cell with list validation.
 * Reads the range schema from CB, then resolves the dropdown items:
 * - Static enum: returns values directly
 * - Range source: queries CB for range data
 * - Formula source: uses formula evaluator callback
 */
export async function getDropdownItems(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string[]> {
  return (await resolveDropdownItems(ctx, sheetId, row, col)).items;
}

export async function resolveDropdownItems(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<DropdownItemResolution> {
  const allSchemas = await getWorksheetValidationCache(ctx).getSchemasForSheet(sheetId);

  for (const schema of allSchemas) {
    const covers = schema.ranges.some((rangeRef) => {
      const start = parseRefId(rangeRef.startId);
      const end = parseRefId(rangeRef.endId);
      if (!start || !end) return false;
      return row >= start.row && row <= end.row && col >= start.col && col <= end.col;
    });

    if (covers && schema.schema.constraints) {
      const constraints = schema.schema.constraints;

      // Static enum values
      if (constraints.enum && Array.isArray(constraints.enum)) {
        return { items: constraints.enum.map(String), resolved: true };
      }

      // Range source — query the range data from CB
      if (constraints.enumSource) {
        const src = constraints.enumSource;
        const srcStart = parseRefId(src.startId);
        const srcEnd = parseRefId(src.endId);
        if (srcStart && srcEnd) {
          try {
            // src.sheetId is a raw string from IdentityRangeSchemaRef (out-of-scope
            // contract in principal plumbing2); brand at this seam to pass to the branded bridge.
            const srcSheetId = src.sheetId ? toSheetId(src.sheetId) : sheetId;
            const rangeData = await ctx.computeBridge.queryRange(
              srcSheetId,
              srcStart.row,
              srcStart.col,
              srcEnd.row,
              srcEnd.col,
            );
            if (rangeData?.cells) {
              return {
                items: rangeData.cells
                  .filter(
                    (c) => c.value !== null && !isNullCellValue(c.value) && !isCellError(c.value),
                  )
                  .map((c) => c.formatted ?? String(c.value ?? '')),
                resolved: true,
              };
            }
          } catch {
            // Fall through
          }
        }
      }
    }
  }

  return { items: [], resolved: false };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a unique schema ID.
 * Format: rs-{timestamp}-{random}
 */
export function generateSchemaId(): string {
  return `rs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
