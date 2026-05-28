/**
 * Tables Core Domain Module
 *
 * Core CRUD operations and query methods for Excel-style tables.
 * All operations delegate to ComputeBridge (Rust compute-core).
 *
 * READ operations are async (ComputeBridge queries).
 * WRITE operations are async (ComputeBridge mutations).
 *
 * Callers that previously used synchronous reads will need to await.
 */

import { type CellRange, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  CreateTableOptions,
  TableColumn,
  TableConfig,
  TableStyle,
} from '@mog-sdk/contracts/tables';

import type { DocumentContext } from '../../context/types';
import { KernelError } from '../../errors';
import { wireTableToTableConfig } from '../../bridges/compute';

// Kernel domain modules
import {
  convertStructuredRefsToA1,
  propagateRefErrorForTableDelete,
  type TableRangeInfo,
} from '../formulas/structured-ref-updater';
import * as Filters from '../sorting/filters';

// Import from sibling module
import { resolveTableRange } from './range-resolution';
import { tableStyleIdForCompute } from './style-normalization';

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Result of table resize validation.
 */
export interface TableResizeValidation {
  /** Whether the resize is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Name of overlapping table if any */
  overlappingTable?: string;
}

/**
 * Check if two ranges overlap.
 */
function rangesOverlap(a: CellRange, b: CellRange): boolean {
  if (a.endCol < b.startCol || a.startCol > b.endCol) return false;
  if (a.endRow < b.startRow || a.startRow > b.endRow) return false;
  return true;
}

/**
 * Check if a range overlaps with any existing table in the sheet.
 */
async function findOverlappingTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  excludeTableId?: string,
): Promise<string | null> {
  const tables = (await ctx.computeBridge.getAllTablesInSheet(sheetId)).map(wireTableToTableConfig);

  for (const tableConfig of tables) {
    if (excludeTableId && tableConfig.id === excludeTableId) continue;
    const tableRange = resolveTableRange(ctx, tableConfig);
    if (tableRange && rangesOverlap(range, tableRange)) {
      return tableConfig.name;
    }
  }
  return null;
}

/**
 * Validate a proposed table resize.
 */
export async function validateTableResize(
  ctx: DocumentContext,
  tableId: string,
  newRange: CellRange,
): Promise<TableResizeValidation> {
  const existing = await getTable(ctx, tableId);
  if (!existing) {
    return { valid: false, error: 'Table not found' };
  }

  const currentRange = resolveTableRange(ctx, existing);
  if (!currentRange) {
    return { valid: false, error: 'Cannot resolve table range' };
  }

  if (newRange.startRow !== currentRange.startRow || newRange.startCol !== currentRange.startCol) {
    return { valid: false, error: 'Table start position cannot change during resize' };
  }

  const headerRowCount = existing.hasHeaderRow ? 1 : 0;
  const totalRowCount = existing.hasTotalRow ? 1 : 0;
  const newRowCount = newRange.endRow - newRange.startRow + 1;
  const dataRows = newRowCount - headerRowCount - totalRowCount;

  if (dataRows < 1) {
    return {
      valid: false,
      error: 'Table must have at least 1 data row',
    };
  }

  const colCount = newRange.endCol - newRange.startCol + 1;
  if (colCount < 1) {
    return {
      valid: false,
      error: 'Table must have at least 1 column',
    };
  }

  const overlappingTable = await findOverlappingTable(
    ctx,
    toSheetId(existing.sheetId),
    newRange,
    tableId,
  );
  if (overlappingTable) {
    return {
      valid: false,
      error: `Resize would overlap with table "${overlappingTable}"`,
      overlappingTable,
    };
  }

  return { valid: true };
}

// =============================================================================
// Validation & Naming (Read-only — async via ComputeBridge)
// =============================================================================

/**
 * Check if a table name is valid and available.
 */
export async function isValidTableName(
  ctx: DocumentContext,
  name: string,
  excludeTableId?: string,
): Promise<boolean> {
  if (!name || name.trim().length === 0) return false;
  if (!/^[A-Za-z_]/.test(name)) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;

  if (/^[A-Za-z]{1,3}\d+$/.test(name)) {
    const letterPart = name.match(/^[A-Za-z]+/)?.[0].toUpperCase();
    if (letterPart && letterPart.length <= 3) {
      if (letterPart.length === 1 || letterPart.length === 2) return false;
      if (letterPart.length === 3 && letterPart <= 'XFD') return false;
    }
  }

  const lowerName = name.toLowerCase();
  const allTables = await getAllTables(ctx);
  for (const table of allTables) {
    if (table.id === excludeTableId) continue;
    if (table.name.toLowerCase() === lowerName) return false;
  }

  return true;
}

/**
 * Generate a unique table name.
 */
export async function generateTableName(ctx: DocumentContext): Promise<string> {
  const allTables = await getAllTables(ctx);
  const existingNames = new Set(allTables.map((t) => t.name.toLowerCase()));

  let i = 1;
  while (existingNames.has(`table${i}`)) {
    i++;
  }

  return `Table${i}`;
}

/**
 * Check if a range contains any merged cells.
 * Merge validation now deferred to Rust compute-core on createTable.
 */
export function hasMergedCellsInRange(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  _range: CellRange,
): boolean {
  return false;
}

// =============================================================================
// Create Table (WRITE — DocumentContext for computeBridge)
// =============================================================================

/**
 * Create a new table on a sheet.
 */
export async function createTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: CellRange,
  options?: CreateTableOptions,
): Promise<TableConfig> {
  const name = options?.name ?? (await generateTableName(ctx));

  if (!(await isValidTableName(ctx, name))) {
    throw new KernelError(
      'TABLE_INVALID_NAME',
      `Table name "${name}" is invalid or already exists`,
    );
  }

  const overlappingTable = await findOverlappingTable(ctx, sheetId, range);
  if (overlappingTable) {
    throw new KernelError(
      'OPERATION_FAILED',
      `Cannot create table: range overlaps with existing table "${overlappingTable}"`,
    );
  }

  // Build column definitions
  const columns: TableColumn[] = [];
  const colCount = range.endCol - range.startCol + 1;
  for (let i = 0; i < colCount; i++) {
    columns.push({
      id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `Column${i + 1}`,
      index: i,
    });
  }

  const style: TableStyle = options?.style ?? {
    preset: 'medium2' as import('@mog-sdk/contracts/tables').TableStylePreset,
    showBandedRows: true,
    showBandedColumns: false,
    showFirstColumnHighlight: false,
    showLastColumnHighlight: false,
  };

  const hasHeaders = options?.hasHeaderRow ?? true;
  const now = Date.now();
  const id = `table-${now}-${Math.random().toString(36).slice(2, 7)}`;

  const config: TableConfig = {
    id,
    name,
    sheetId,
    range,
    hasHeaderRow: hasHeaders,
    hasTotalRow: false,
    columns,
    style,
    autoExpand: options?.autoExpand ?? true,
    autoCalculatedColumns: options?.autoCalculatedColumns ?? true,
    showFilterButtons: options?.showFilterButtons ?? true,
    createdAt: now,
    updatedAt: now,
  };

  // Delegate creation to ComputeBridge.
  await ctx.computeBridge.createTable(
    sheetId,
    name,
    range.startRow,
    range.startCol,
    range.endRow,
    range.endCol,
    columns.map((c) => c.name),
    hasHeaders,
  );

  return config;
}

// =============================================================================
// Get Table (READ — async via ComputeBridge)
// =============================================================================

/**
 * Get table by ID.
 *
 * No direct CB method for "get by ID" — iterates all sheets and their tables.
 */
export async function getTable(
  ctx: DocumentContext,
  tableId: string,
): Promise<TableConfig | undefined> {
  const sheetIds = await ctx.computeBridge.getAllSheetIds();
  const results = await Promise.all(
    sheetIds.map(async (sheetId) => {
      const tables = await ctx.computeBridge.getAllTablesInSheet(sheetId);
      return tables.map(wireTableToTableConfig);
    }),
  );
  for (const tables of results) {
    const found = tables.find((t) => t.id === tableId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Get table by name (case-insensitive).
 */
export async function getTableByName(
  ctx: DocumentContext,
  tableName: string,
): Promise<TableConfig | undefined> {
  const result = await ctx.computeBridge.getTableByName(tableName);
  if (!result) return undefined;
  return wireTableToTableConfig(result);
}

/**
 * Get all tables in a sheet.
 */
export async function getTablesInSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<TableConfig[]> {
  const tables = await ctx.computeBridge.getAllTablesInSheet(sheetId);
  return tables.map(wireTableToTableConfig);
}

/**
 * Get all tables in the workbook.
 */
export async function getAllTables(ctx: DocumentContext): Promise<TableConfig[]> {
  const sheetIds = await ctx.computeBridge.getAllSheetIds();
  const results = await Promise.all(
    sheetIds.map(async (sheetId) => {
      const tables = await ctx.computeBridge.getAllTablesInSheet(sheetId);
      return tables.map(wireTableToTableConfig);
    }),
  );
  return results.flat();
}

// =============================================================================
// Update Table (WRITE — DocumentContext for computeBridge)
// =============================================================================

/**
 * Update table configuration.
 * Delegates targeted updates to ComputeBridge.
 */
export async function updateTable(
  ctx: DocumentContext,
  tableId: string,
  updates: Partial<TableConfig>,
): Promise<void> {
  const existing = await getTable(ctx, tableId);
  if (!existing) return;

  if (updates.name && updates.name !== existing.name) {
    await ctx.computeBridge.renameTable(existing.name, updates.name);
  }
  if (updates.style?.preset && updates.style.preset !== existing.style?.preset) {
    const styleId = tableStyleIdForCompute(updates.style.preset) ?? updates.style.preset;
    await ctx.computeBridge.setTableStyle(existing.name, styleId);
  }
}

/**
 * Delete a table (removes table formatting but keeps cell data).
 *
 * Propagates #REF! errors to formulas referencing this table.
 *
 * @returns Number of formulas updated to #REF!
 */
export async function deleteTable(
  ctx: DocumentContext,
  tableId: string,
  propagateRefErrors: boolean = false,
): Promise<number> {
  const existing = await getTable(ctx, tableId);
  if (!existing) return 0;

  let affectedFormulaCount = 0;
  if (propagateRefErrors) {
    affectedFormulaCount = propagateRefErrorForTableDelete(ctx, existing.name);
    if (affectedFormulaCount > 0) {
      console.log(
        `[tables] Propagated #REF! to ${affectedFormulaCount} formulas after deleting table "${existing.name}"`,
      );
    }
  }

  // Delete associated filter before deleting the table
  const tableFilter = await Filters.getTableFilter(ctx, toSheetId(existing.sheetId), tableId);
  if (tableFilter) {
    await Filters.deleteFilter(ctx, toSheetId(existing.sheetId), tableFilter.id, 'user');
  }

  await ctx.computeBridge.deleteTable(existing.name);

  return affectedFormulaCount;
}

/**
 * Convert table back to a regular range (removes table, keeps data).
 *
 * Converts structured references to A1 references.
 *
 * @returns Number of formulas updated
 */
export async function convertToRange(ctx: DocumentContext, tableId: string): Promise<number> {
  const existing = await getTable(ctx, tableId);
  if (!existing) return 0;

  const range = resolveTableRange(ctx, existing);
  if (!range) return 0;

  const tableInfo: TableRangeInfo = {
    name: existing.name,
    range,
    columns: existing.columns.map((c) => ({ name: c.name, index: c.index })),
    hasHeaderRow: existing.hasHeaderRow,
    hasTotalRow: existing.hasTotalRow,
  };

  const convertedCount = convertStructuredRefsToA1(ctx, tableInfo);
  if (convertedCount > 0) {
    console.log(
      `[tables] Converted ${convertedCount} structured references to A1 when converting table "${existing.name}" to range`,
    );
  }

  await deleteTable(ctx, tableId, false);

  return convertedCount;
}

// =============================================================================
// Query Methods (READ — async via ComputeBridge)
// =============================================================================

/**
 * Check if a cell is inside any table.
 */
export async function isInTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<boolean> {
  return (await getTableAtCell(ctx, sheetId, row, col)) !== undefined;
}

/**
 * Get the table containing a specific cell.
 */
export async function getTableAtCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<TableConfig | undefined> {
  const result = await ctx.computeBridge.getTableAtCell(sheetId, row, col);
  if (!result) return undefined;
  return wireTableToTableConfig(result);
}

/**
 * Get the data range of a table (excludes header and total rows).
 */
export async function getDataRange(ctx: DocumentContext, tableId: string): Promise<CellRange> {
  const table = await getTable(ctx, tableId);
  if (!table) {
    throw new KernelError('TABLE_NOT_FOUND', `Table ${tableId} not found`);
  }

  const range = resolveTableRange(ctx, table);
  if (!range) {
    throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} range corners were deleted`);
  }

  const { hasHeaderRow, hasTotalRow } = table;
  return {
    ...range,
    startRow: hasHeaderRow ? range.startRow + 1 : range.startRow,
    endRow: hasTotalRow ? range.endRow - 1 : range.endRow,
  };
}

/**
 * Get the header row range of a table.
 */
export async function getHeaderRange(
  ctx: DocumentContext,
  tableId: string,
): Promise<CellRange | undefined> {
  const table = await getTable(ctx, tableId);
  if (!table || !table.hasHeaderRow) return undefined;

  const range = resolveTableRange(ctx, table);
  if (!range) return undefined;

  return {
    ...range,
    endRow: range.startRow,
  };
}

/**
 * Get the total row range of a table.
 */
export async function getTotalRange(
  ctx: DocumentContext,
  tableId: string,
): Promise<CellRange | undefined> {
  const table = await getTable(ctx, tableId);
  if (!table || !table.hasTotalRow) return undefined;

  const range = resolveTableRange(ctx, table);
  if (!range) return undefined;

  return {
    ...range,
    startRow: range.endRow,
  };
}
