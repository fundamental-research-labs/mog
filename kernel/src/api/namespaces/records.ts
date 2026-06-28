/**
 * Kernel API: Records
 *
 * @stability experimental
 *
 * Low-level function-oriented API for record (row) operations in table-based
 * views like Kanban, Gallery, etc. Available for feedback — may change across
 * minor versions.
 *
 * A "Record" is a row in a table, with each column representing a field.
 *
 * All public functions accept {@link IKernelContext} (the SDK-facing context type).
 * Internally, each function casts to `DocumentContext` for engine access.
 *
 * This API provides CRUD operations for records:
 * - get: Get a single record's values
 * - query: Get all records in a table, optionally filtered
 * - getFieldValue: Get a single field value by column ID or name
 * - getFieldByName: Convenience wrapper — resolve by column name
 * - create: Create a new record (insert row) with field values
 * - update: Update field values for an existing record
 * - delete: Delete a record (remove row)
 *
 * Architecture:
 * - Records are stored as rows in the table's sheet
 * - Each column in the table is a field
 * - For Kanban and similar views, RowId is the row INDEX as a string (e.g., "5")
 *   since the Row Identity system may not be fully materialized
 * - Values are cell values at (row index, col index)
 *
 */

import { toColId, type ColId, type RowId, toRowId } from '@mog-sdk/contracts/cell-identity';
import { type CellValue, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import { rawToCellValue } from '@mog/spreadsheet-utils/rich-text';

import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import { withDirectEditRange } from '../../bridges/compute';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { createCellWriteVersionMutationOptions } from '../internal/cell-write-version-options';

// Domain reads (from kernel domain)
import * as TablesCore from '../../domain/tables/core';
import * as TablesRangeResolution from '../../domain/tables/range-resolution';

// Kernel domain modules
import * as Cells from '../../domain/cells/cell-reads';
import { type CellInput, toCellInput } from '../worksheet/operations/cell-input';

// No longer uses CellMutations — batch operations go through ComputeBridge directly

// =============================================================================
// Types
// =============================================================================

/**
 * A RecordValues is a map of field (column) IDs to their values.
 * This is the computed/display value, not raw formula text.
 */
export type RecordValues = { [key: ColId]: CellValue };

/**
 * A TableRecord represents a row in a table with its values.
 */
export interface TableRecord {
  /** The record's row ID (row index as string, e.g., "5") */
  rowId: RowId;
  /** The record's field values (keyed by column ID) */
  values: RecordValues;
}

/**
 * Filter expression for querying records.
 * Currently supports simple equality filters.
 */
export interface FilterExpression {
  /** Field to filter on (column ID or column name) */
  field: ColId | string;
  /** Value to match (exact equality) */
  equals: CellValue;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extract a CellValue from cell data.
 * Uses computed value if available (for formulas), otherwise converts raw value.
 */
function extractCellValue(
  cellData: { computed?: CellValue; raw?: unknown } | undefined,
): CellValue {
  if (!cellData) return null;
  // Prefer computed value (already a CellValue)
  if (cellData.computed !== undefined) {
    return cellData.computed;
  }
  // Convert raw value to CellValue
  if (cellData.raw !== undefined && cellData.raw !== null) {
    // rawToCellValue handles RichText -> string conversion
    // The raw value can be string | number | boolean | null | RichText
    const raw = cellData.raw as string | number | boolean | null | unknown[];
    if (Array.isArray(raw)) {
      // RichText case - convert to plain text
      return rawToCellValue(raw as Parameters<typeof rawToCellValue>[0]);
    }
    return raw as CellValue;
  }
  return null;
}

// =============================================================================
// Reads
// =============================================================================

/**
 * Get a single record by row ID.
 *
 * @param ctx - Store context
 * @param tableId - Table identifier
 * @param rowId - Row identifier (row index as string)
 * @returns TableRecord with field values, or null if not found
 */
export async function get(
  ctx: IKernelContext,
  tableId: string,
  rowId: RowId,
): Promise<TableRecord | null> {
  const dctx = ctx as DocumentContext;
  const table = await TablesCore.getTable(dctx, tableId);
  if (!table) return null;

  const range = TablesRangeResolution.resolveTableRange(dctx, table);
  if (!range) return null;

  // Parse rowId as row index
  const rowIndex = parseInt(rowId, 10);
  if (isNaN(rowIndex)) return null;

  // Verify it's within the table data range
  const dataRange = await TablesCore.getDataRange(dctx, tableId);
  if (!dataRange) return null;
  if (rowIndex < dataRange.startRow || rowIndex > dataRange.endRow) {
    return null;
  }

  // Build record values from the row's cells (keyed by column ID only)
  const values: RecordValues = {};
  for (const col of table.columns) {
    const colIndex = range.startCol + col.index;
    const cellData = await Cells.getData(dctx, toSheetId(table.sheetId), rowIndex, colIndex);
    const value = extractCellValue(cellData);
    values[toColId(col.id)] = value;
  }

  return { rowId, values };
}

/**
 * Query records in a table with optional filtering.
 *
 * @param ctx - Store context
 * @param tableId - Table identifier
 * @param filter - Optional filter expression
 * @returns Array of records matching the filter
 */
export async function query(
  ctx: IKernelContext,
  tableId: string,
  filter?: FilterExpression,
): Promise<TableRecord[]> {
  const dctx = ctx as DocumentContext;
  const table = await TablesCore.getTable(dctx, tableId);
  if (!table) return [];

  const range = TablesRangeResolution.resolveTableRange(dctx, table);
  if (!range) return [];

  // Get data range (excludes header and total rows)
  const dataRange = await TablesCore.getDataRange(dctx, tableId);
  if (!dataRange) return [];

  const results: TableRecord[] = [];

  // Iterate over data rows
  for (let rowIndex = dataRange.startRow; rowIndex <= dataRange.endRow; rowIndex++) {
    // Use row index as RowId
    const rowId = toRowId(String(rowIndex));

    // Build record values (keyed by column ID only)
    const values: RecordValues = {};
    let matchesFilter = true;

    for (const col of table.columns) {
      const colIndex = range.startCol + col.index;
      const cellData = await Cells.getData(dctx, toSheetId(table.sheetId), rowIndex, colIndex);
      const value = extractCellValue(cellData);

      values[toColId(col.id)] = value;

      // Check filter (match by column ID or name)
      if (filter && (col.id === filter.field || col.name === filter.field)) {
        if (value !== filter.equals) {
          matchesFilter = false;
        }
      }
    }

    // Skip empty rows (all values are null/empty)
    const hasData = Object.values(values).some((v) => v !== null && v !== '');
    if (!hasData) continue;

    if (matchesFilter) {
      results.push({ rowId, values });
    }
  }

  return results;
}

/**
 * Get a single field value from a record.
 *
 * @param ctx - Store context
 * @param tableId - Table identifier
 * @param rowId - Row identifier (row index as string)
 * @param fieldId - Field (column) identifier or name
 * @returns Field value, or null if not found
 */
export async function getFieldValue(
  ctx: IKernelContext,
  tableId: string,
  rowId: RowId,
  fieldId: ColId | string,
): Promise<CellValue> {
  const dctx = ctx as DocumentContext;
  const table = await TablesCore.getTable(dctx, tableId);
  if (!table) return null;

  const range = TablesRangeResolution.resolveTableRange(dctx, table);
  if (!range) return null;

  // Parse rowId as row index
  const rowIndex = parseInt(rowId, 10);
  if (isNaN(rowIndex)) return null;

  // Verify it's within the table data range
  const dataRange = await TablesCore.getDataRange(dctx, tableId);
  if (!dataRange) return null;
  if (rowIndex < dataRange.startRow || rowIndex > dataRange.endRow) {
    return null;
  }

  // Find the column by ID or name
  const col = table.columns.find(
    (c: { id: string; name: string }) => c.id === fieldId || c.name === fieldId,
  );
  if (!col) return null;

  const colIndex = range.startCol + col.index;
  const cellData = await Cells.getData(dctx, toSheetId(table.sheetId), rowIndex, colIndex);
  return extractCellValue(cellData);
}

/**
 * Get a field value by column name (convenience wrapper).
 * Resolves the column name to its ID, then delegates to getFieldValue.
 *
 * @param ctx - Kernel context
 * @param tableId - Table identifier
 * @param rowId - Row identifier (row index as string)
 * @param fieldName - Column name to look up
 * @returns Field value, or null if not found
 */
export async function getFieldByName(
  ctx: IKernelContext,
  tableId: string,
  rowId: RowId,
  fieldName: string,
): Promise<CellValue> {
  return getFieldValue(ctx, tableId, rowId, fieldName);
}

// =============================================================================
// Writes
// =============================================================================

/**
 * Create a new record in the table.
 * Inserts values at the end of the table's data range.
 *
 * @param ctx - Store context
 * @param tableId - Table identifier
 * @param values - Field values for the new record (keyed by column ID or name)
 * @returns The new record's RowId (row index as string)
 */
export async function create(
  ctx: IKernelContext,
  tableId: string,
  values: RecordValues,
): Promise<RowId> {
  const dctx = ctx as DocumentContext;
  const table = await TablesCore.getTable(dctx, tableId);
  if (!table) throw new KernelError('TABLE_NOT_FOUND', `Table ${tableId} not found`);

  const range = TablesRangeResolution.resolveTableRange(dctx, table);
  if (!range) throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} range not resolved`);

  // Get data range to find where to insert
  const dataRange = await TablesCore.getDataRange(dctx, tableId);
  if (!dataRange)
    throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} data range not resolved`);

  // New row goes at the end of the data range (before total row if present)
  const newRowIndex = dataRange.endRow + 1;
  const newRowId = toRowId(String(newRowIndex));

  // Build batch edits for all columns with values — single IPC call
  const edits: Array<{ row: number; col: number; input: CellInput }> = [];
  for (const col of table.columns) {
    const colIndex = range.startCol + col.index;
    const value = values[toColId(col.id)] ?? values[toColId(col.name)];

    if (value !== undefined && value !== null) {
      edits.push({
        row: newRowIndex,
        col: colIndex,
        input: toCellInput(value as string | number | boolean | null | undefined),
      });
    }
  }
  if (edits.length > 0) {
    await dctx.computeBridge.setCellsByPosition(
      toSheetId(table.sheetId),
      edits,
      createCellWriteVersionMutationOptions(dctx, {
        operationIdPrefix: 'records.create',
        sheetIds: [toSheetId(table.sheetId)],
      }),
    );
  }

  // Expand table range to include new row
  const newRange = {
    ...range,
    endRow: range.endRow + 1,
  };

  // Update table range AND rangeIdentity to keep them in sync
  const newRangeIdentity = TablesRangeResolution.createTableCellIdRange(
    dctx,
    toSheetId(table.sheetId),
    newRange.startRow,
    newRange.startCol,
    newRange.endRow,
    newRange.endCol,
  );

  await TablesCore.updateTable(dctx, tableId, {
    range: newRange,
    rangeIdentity: newRangeIdentity,
  });

  return newRowId;
}

/**
 * Update a record's field values.
 *
 * @param ctx - Store context
 * @param tableId - Table identifier
 * @param rowId - Row identifier (row index as string)
 * @param changes - Partial field values to update (keyed by column ID or name)
 */
export async function update(
  ctx: IKernelContext,
  tableId: string,
  rowId: RowId,
  changes: Partial<RecordValues>,
): Promise<void> {
  const dctx = ctx as DocumentContext;
  const table = await TablesCore.getTable(dctx, tableId);
  if (!table) throw new KernelError('TABLE_NOT_FOUND', `Table ${tableId} not found`);

  const range = TablesRangeResolution.resolveTableRange(dctx, table);
  if (!range) throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} range not resolved`);

  // Parse rowId as row index
  const rowIndex = parseInt(rowId, 10);
  if (isNaN(rowIndex)) throw new KernelError('TABLE_RECORD_NOT_FOUND', `Invalid row ID: ${rowId}`);

  // Verify it's within the table data range
  const dataRange = await TablesCore.getDataRange(dctx, tableId);
  if (!dataRange)
    throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} data range not resolved`);
  if (rowIndex < dataRange.startRow || rowIndex > dataRange.endRow) {
    throw new KernelError(
      'TABLE_RECORD_NOT_FOUND',
      `Row ${rowId} is outside table data range (${dataRange.startRow}-${dataRange.endRow})`,
    );
  }

  // Build batch edits — empty string clears a cell, non-empty sets it
  const edits: Array<{ row: number; col: number; input: CellInput }> = [];
  for (const [fieldId, value] of Object.entries(changes)) {
    const col = table.columns.find(
      (c: { id: string; name: string }) => c.id === fieldId || c.name === fieldId,
    );
    if (!col) continue;

    const colIndex = range.startCol + col.index;
    edits.push({
      row: rowIndex,
      col: colIndex,
      input: toCellInput(value as string | number | boolean | null | undefined),
    });
  }
  if (edits.length > 0) {
    await dctx.computeBridge.setCellsByPosition(
      toSheetId(table.sheetId),
      edits,
      createCellWriteVersionMutationOptions(dctx, {
        operationIdPrefix: 'records.update',
        sheetIds: [toSheetId(table.sheetId)],
      }),
    );
  }
}

/**
 * Delete a record from the table.
 * Note: This currently clears the row's cells but doesn't delete the row itself.
 * Full row deletion would require structure operations.
 *
 * @param ctx - Store context
 * @param tableId - Table identifier
 * @param rowId - Row identifier (row index as string)
 */
export async function remove(ctx: IKernelContext, tableId: string, rowId: RowId): Promise<void> {
  const dctx = ctx as DocumentContext;
  const table = await TablesCore.getTable(dctx, tableId);
  if (!table) throw new KernelError('TABLE_NOT_FOUND', `Table ${tableId} not found`);

  const range = TablesRangeResolution.resolveTableRange(dctx, table);
  if (!range) throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} range not resolved`);

  // Parse rowId as row index
  const rowIndex = parseInt(rowId, 10);
  if (isNaN(rowIndex)) throw new KernelError('TABLE_RECORD_NOT_FOUND', `Invalid row ID: ${rowId}`);

  // Verify it's within the table data range
  const dataRange = await TablesCore.getDataRange(dctx, tableId);
  if (!dataRange)
    throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} data range not resolved`);
  if (rowIndex < dataRange.startRow || rowIndex > dataRange.endRow) {
    throw new KernelError(
      'TABLE_RECORD_NOT_FOUND',
      `Row ${rowId} is outside table data range (${dataRange.startRow}-${dataRange.endRow})`,
    );
  }

  // Clear the entire row's table columns in one IPC call
  const lastColIndex = range.startCol + table.columns.length - 1;
  await dctx.computeBridge.clearRangeByPosition(
    toSheetId(table.sheetId),
    rowIndex,
    range.startCol,
    rowIndex,
    lastColIndex,
    withDirectEditRange(
      createCellWriteVersionMutationOptions(dctx, {
        operationIdPrefix: 'records.remove',
        sheetIds: [toSheetId(table.sheetId)],
      }),
      toSheetId(table.sheetId),
      rowIndex,
      range.startCol,
      rowIndex,
      lastColIndex,
    ),
  );
}

/** @deprecated Use remove() instead. */
export const del = remove;
