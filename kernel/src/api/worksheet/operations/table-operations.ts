/**
 * Table Operations Module
 *
 * Standalone functions for table operations extracted from SheetAPI.
 * All mutation functions take DocumentContext as the first parameter.
 * Query functions that are workbook-scoped (by name) omit sheetId.
 *
 * @see sheet-api.ts - Main SheetAPI class that delegates to these functions
 */

import type {
  OperationEffect,
  TableAddColumnReceipt,
  TableAddReceipt,
  TableAddRowReceipt,
  TableClearReceipt,
  TableConvertToRangeReceipt,
  TableDeleteRowReceipt,
  TableInfo,
  TableRemoveColumnReceipt,
  TableRemoveReceipt,
  TableRenameColumnReceipt,
  TableRenameReceipt,
  TableResizeReceipt,
  TableUpdateOptions,
  TableUpdateReceipt,
} from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';
import type { MutationAdmissionOptions } from '../../../bridges/compute';
import type { Table, TableHitRegion } from '../../../bridges/compute/compute-types.gen';
import type { TableDef } from '../../../bridges/compute/compute-wire-types';
import { createVersionOperationContext } from '../../internal/version-operation-context';
import { colToLetter, letterToCol } from '../../internal/utils';
import type { DocumentContext, OperationResult } from './shared';
import { invalidRange, wrapOp } from './shared';
import {
  publicTableStyleId,
  tableStyleIdForCompute,
} from '../../../domain/tables/style-normalization';

// Re-export TableInfo so consumers can import from this module
export type { TableInfo } from '@mog-sdk/contracts/api';

// =============================================================================
// Helpers
// =============================================================================

export type TableMutationOptions = MutationAdmissionOptions & {
  readonly operationContext: VersionOperationContext;
};

const TABLE_MUTATION_DOMAIN_IDS = ['tables'] as const;

export function createTableMutationOptions(
  ctx: DocumentContext,
  operationIdPrefix: string,
  sheetId?: SheetId,
  groupId?: string,
): TableMutationOptions {
  return {
    operationContext: createVersionOperationContext(ctx, {
      operationIdPrefix,
      ...(sheetId !== undefined ? { sheetIds: [sheetId] } : {}),
      domainIds: TABLE_MUTATION_DOMAIN_IDS,
      ...(groupId ? { groupId } : {}),
    }),
  };
}

export function createGroupedTableMutationOptions(
  ctx: DocumentContext,
  operationIdPrefix: string,
  sheetId?: SheetId,
): () => TableMutationOptions {
  let nextOptions = ensureTableMutationGroup(
    createTableMutationOptions(ctx, operationIdPrefix, sheetId),
  );
  const groupId = nextOptions.operationContext.groupId;
  return () => {
    const options = nextOptions;
    nextOptions = createTableMutationOptions(ctx, operationIdPrefix, sheetId, groupId);
    return options;
  };
}

function ensureTableMutationGroup(options: TableMutationOptions): TableMutationOptions {
  const groupId = options.operationContext.groupId ?? options.operationContext.operationId;
  return {
    operationContext: {
      ...options.operationContext,
      groupId,
    },
  };
}

/**
 * Parse an A1 range string (e.g., "A1:D10") into numeric bounds (0-based).
 */
function parseA1Range(
  range: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    startCol: letterToCol(match[1]),
    startRow: parseInt(match[2], 10) - 1, // 1-based to 0-based
    endCol: letterToCol(match[3]),
    endRow: parseInt(match[4], 10) - 1,
  };
}

function cellCountForRange(range: string): number | undefined {
  const parsed = parseA1Range(range);
  if (!parsed) return undefined;
  return (parsed.endRow - parsed.startRow + 1) * (parsed.endCol - parsed.startCol + 1);
}

function tableDetails(
  table: TableInfo,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { objectType: 'table', name: table.name, ...extra };
}

function worksheetUnchangedEffect(sheetId: SheetId, range?: string): OperationEffect {
  return { type: 'worksheetUnchanged', sheetId, ...(range ? { range } : {}) };
}

function changedRangeEffect(
  sheetId: SheetId,
  range: string,
  details: Record<string, unknown>,
): OperationEffect {
  const count = cellCountForRange(range);
  return {
    type: 'changedRange',
    sheetId,
    range,
    ...(count !== undefined ? { count } : {}),
    details,
  };
}

export function effectiveTableUpdateOptions(
  table: TableInfo,
  updates: TableUpdateOptions,
): TableUpdateOptions {
  const effectiveUpdates: TableUpdateOptions = {};
  if (updates.name !== undefined && updates.name !== table.name) {
    effectiveUpdates.name = updates.name;
  }
  if (
    updates.style !== undefined &&
    (publicTableStyleId(updates.style) ?? updates.style) !== table.style
  ) {
    effectiveUpdates.style = updates.style;
  }
  if (
    updates.emphasizeFirstColumn !== undefined &&
    updates.emphasizeFirstColumn !== table.emphasizeFirstColumn
  ) {
    effectiveUpdates.emphasizeFirstColumn = updates.emphasizeFirstColumn;
  }
  if (
    updates.emphasizeLastColumn !== undefined &&
    updates.emphasizeLastColumn !== table.emphasizeLastColumn
  ) {
    effectiveUpdates.emphasizeLastColumn = updates.emphasizeLastColumn;
  }
  if (updates.bandedColumns !== undefined && updates.bandedColumns !== table.bandedColumns) {
    effectiveUpdates.bandedColumns = updates.bandedColumns;
  }
  if (updates.bandedRows !== undefined && updates.bandedRows !== table.bandedRows) {
    effectiveUpdates.bandedRows = updates.bandedRows;
  }
  if (
    updates.showFilterButtons !== undefined &&
    updates.showFilterButtons !== table.showFilterButtons
  ) {
    effectiveUpdates.showFilterButtons = updates.showFilterButtons;
  }
  if (updates.hasHeaderRow !== undefined && updates.hasHeaderRow !== table.hasHeaderRow) {
    effectiveUpdates.hasHeaderRow = updates.hasHeaderRow;
  }
  if (updates.hasTotalsRow !== undefined && updates.hasTotalsRow !== table.hasTotalsRow) {
    effectiveUpdates.hasTotalsRow = updates.hasTotalsRow;
  }
  if (updates.autoExpand !== undefined && updates.autoExpand !== table.autoExpand) {
    effectiveUpdates.autoExpand = updates.autoExpand;
  }
  if (
    updates.autoCalculatedColumns !== undefined &&
    updates.autoCalculatedColumns !== table.autoCalculatedColumns
  ) {
    effectiveUpdates.autoCalculatedColumns = updates.autoCalculatedColumns;
  }
  return effectiveUpdates;
}

function storedTableMetadataEffect(
  sheetId: SheetId,
  table: TableInfo,
  extra: Record<string, unknown> = {},
): OperationEffect {
  return {
    type: 'storedMetadata',
    sheetId,
    objectId: table.id,
    range: table.range,
    details: tableDetails(table, extra),
  };
}

function updatedTableEffects(
  sheetId: SheetId,
  table: TableInfo,
  extra: Record<string, unknown> = {},
): OperationEffect[] {
  return [
    {
      type: 'updatedObject',
      sheetId,
      objectId: table.id,
      range: table.range,
      details: tableDetails(table, extra),
    },
    storedTableMetadataEffect(sheetId, table, extra),
  ];
}

export function buildTableAddReceipt(sheetId: SheetId, table: TableInfo): TableAddReceipt {
  return {
    kind: 'tableAdd',
    status: 'applied',
    effects: [
      {
        type: 'createdObject',
        sheetId,
        objectId: table.id,
        range: table.range,
        details: tableDetails(table),
      },
      storedTableMetadataEffect(sheetId, table),
    ],
    diagnostics: [],
    tableId: table.id,
    name: table.name,
    range: table.range,
    table,
  };
}

export function buildTableRemoveReceipt(sheetId: SheetId, table: TableInfo): TableRemoveReceipt {
  return {
    kind: 'tableRemove',
    status: 'applied',
    effects: [
      {
        type: 'removedObject',
        sheetId,
        objectId: table.id,
        range: table.range,
        details: tableDetails(table),
      },
    ],
    diagnostics: [],
    tableId: table.id,
    tableName: table.name,
    range: table.range,
    table,
  };
}

export function buildTableConvertToRangeReceipt(input: {
  sheetId: SheetId;
  table: TableInfo;
  affectedFormulaCount: number;
}): TableConvertToRangeReceipt {
  const effects: OperationEffect[] = [
    {
      type: 'removedObject',
      sheetId: input.sheetId,
      objectId: input.table.id,
      range: input.table.range,
      details: tableDetails(input.table, { affectedFormulaCount: input.affectedFormulaCount }),
    },
  ];
  if (input.affectedFormulaCount > 0) {
    effects.push({
      type: 'changedRange',
      sheetId: input.sheetId,
      count: input.affectedFormulaCount,
      details: {
        changeType: 'structuredReferenceRewrite',
        tableId: input.table.id,
        tableName: input.table.name,
      },
    });
  }

  return {
    kind: 'tableConvertToRange',
    status: 'applied',
    effects,
    diagnostics: [],
    tableId: input.table.id,
    tableName: input.table.name,
    range: input.table.range,
    table: input.table,
    affectedFormulaCount: input.affectedFormulaCount,
  };
}

export function buildTableClearReceipt(
  sheetId: SheetId,
  tables: readonly TableInfo[],
): TableClearReceipt {
  const tableIds = tables.map((table) => table.id);
  return {
    kind: 'tableClear',
    status: tables.length === 0 ? 'noOp' : 'applied',
    effects:
      tables.length === 0
        ? [worksheetUnchangedEffect(sheetId)]
        : [
            {
              type: 'removedObject',
              sheetId,
              count: tables.length,
              details: {
                objectType: 'table',
                tableIds,
                names: tables.map((table) => table.name),
              },
            },
          ],
    diagnostics: [],
    sheetId,
    removedCount: tables.length,
    tableIds,
    tables,
  };
}

export function buildTableRenameReceipt(input: {
  sheetId: SheetId;
  table: TableInfo;
  oldName: string;
  newName: string;
  status: 'applied' | 'noOp';
}): TableRenameReceipt {
  return {
    kind: 'tableRename',
    status: input.status,
    effects:
      input.status === 'noOp'
        ? [worksheetUnchangedEffect(input.sheetId, input.table.range)]
        : [
            {
              type: 'renamedObject',
              sheetId: input.sheetId,
              objectId: input.table.id,
              range: input.table.range,
              details: tableDetails(input.table, {
                oldName: input.oldName,
                newName: input.newName,
              }),
            },
            storedTableMetadataEffect(input.sheetId, input.table, { name: input.newName }),
          ],
    diagnostics: [],
    tableId: input.table.id,
    tableName: input.newName,
    oldName: input.oldName,
    newName: input.newName,
    name: input.newName,
    range: input.table.range,
  };
}

export function buildTableUpdateReceipt(input: {
  sheetId: SheetId;
  table: TableInfo;
  updates: TableUpdateOptions;
  status: 'applied' | 'noOp';
  range?: string;
  details?: Record<string, unknown>;
}): TableUpdateReceipt {
  return {
    kind: 'tableUpdate',
    status: input.status,
    effects:
      input.status === 'noOp'
        ? [worksheetUnchangedEffect(input.sheetId, input.range ?? input.table.range)]
        : updatedTableEffects(
            input.sheetId,
            input.table,
            input.details ?? { updates: input.updates },
          ),
    diagnostics: [],
    tableId: input.table.id,
    tableName: input.table.name,
    range: input.range ?? input.table.range,
    updates: input.updates,
  };
}

export function buildTableResizeReceipt(input: {
  sheetId: SheetId;
  table: TableInfo;
  oldRange: string;
  newRange: string;
  status: 'applied' | 'noOp';
}): TableResizeReceipt {
  return {
    kind: 'tableResize',
    status: input.status,
    effects:
      input.status === 'noOp'
        ? [worksheetUnchangedEffect(input.sheetId, input.oldRange)]
        : [
            changedRangeEffect(input.sheetId, input.newRange, {
              oldRange: input.oldRange,
              newRange: input.newRange,
            }),
            ...updatedTableEffects(input.sheetId, input.table, {
              oldRange: input.oldRange,
              newRange: input.newRange,
            }),
          ],
    diagnostics: [],
    tableId: input.table.id,
    tableName: input.table.name,
    oldRange: input.oldRange,
    newRange: input.newRange,
    range: input.newRange,
  };
}

export function buildTableAddColumnReceipt(input: {
  sheetId: SheetId;
  table: TableInfo;
  columnName: string;
  position: number;
  range: string;
}): TableAddColumnReceipt {
  return {
    kind: 'tableAddColumn',
    status: 'applied',
    effects: [
      changedRangeEffect(input.sheetId, input.range, {
        changeType: 'insertTableColumn',
        columnName: input.columnName,
      }),
      ...updatedTableEffects(input.sheetId, input.table, {
        columnName: input.columnName,
        position: input.position,
      }),
    ],
    diagnostics: [],
    tableId: input.table.id,
    tableName: input.table.name,
    columnName: input.columnName,
    position: input.position,
    range: input.range,
  };
}

export function buildTableRemoveColumnReceipt(input: {
  sheetId: SheetId;
  table: TableInfo;
  columnIndex: number;
  columnName: string;
  range: string;
}): TableRemoveColumnReceipt {
  return {
    kind: 'tableRemoveColumn',
    status: 'applied',
    effects: [
      changedRangeEffect(input.sheetId, input.range, {
        changeType: 'deleteTableColumn',
        columnName: input.columnName,
      }),
      ...updatedTableEffects(input.sheetId, input.table, {
        columnIndex: input.columnIndex,
        columnName: input.columnName,
      }),
    ],
    diagnostics: [],
    tableId: input.table.id,
    tableName: input.table.name,
    columnIndex: input.columnIndex,
    columnName: input.columnName,
    range: input.range,
  };
}

export function buildTableRenameColumnReceipt(input: {
  sheetId: SheetId;
  table: TableInfo;
  columnIndex: number;
  oldColumnName: string;
  newColumnName: string;
  status: 'applied' | 'noOp';
}): TableRenameColumnReceipt {
  return {
    kind: 'tableRenameColumn',
    status: input.status,
    effects:
      input.status === 'noOp'
        ? [worksheetUnchangedEffect(input.sheetId, input.table.range)]
        : updatedTableEffects(input.sheetId, input.table, {
            columnIndex: input.columnIndex,
            oldColumnName: input.oldColumnName,
            newColumnName: input.newColumnName,
          }),
    diagnostics: [],
    tableId: input.table.id,
    tableName: input.table.name,
    columnIndex: input.columnIndex,
    oldColumnName: input.oldColumnName,
    newColumnName: input.newColumnName,
    range: input.table.range,
  };
}

export function buildTableAddRowReceipt(input: {
  sheetId: SheetId;
  table: TableInfo;
  index: number;
  range: string;
}): TableAddRowReceipt {
  return {
    kind: 'tableAddRow',
    status: 'applied',
    effects: [
      changedRangeEffect(input.sheetId, input.range, { changeType: 'insertTableRow' }),
      ...updatedTableEffects(input.sheetId, input.table, { index: input.index }),
    ],
    diagnostics: [],
    tableId: input.table.id,
    tableName: input.table.name,
    index: input.index,
    range: input.range,
  };
}

export function buildTableDeleteRowReceipt(input: {
  sheetId: SheetId;
  table: TableInfo;
  index: number;
  range: string;
}): TableDeleteRowReceipt {
  return {
    kind: 'tableDeleteRow',
    status: 'applied',
    effects: [
      changedRangeEffect(input.sheetId, input.range, { changeType: 'deleteTableRow' }),
      ...updatedTableEffects(input.sheetId, input.table, { index: input.index }),
    ],
    diagnostics: [],
    tableId: input.table.id,
    tableName: input.table.name,
    index: input.index,
    range: input.range,
  };
}

/**
 * Convert a bridge Table (from Rust via compute-table) into a TableInfo.
 * Converts range from SheetRange to A1 notation and built-in style IDs to
 * public table style presets. Other fields pass through directly.
 */
export function bridgeTableToTableInfo(table: Table): TableInfo {
  const startLetter = colToLetter(table.range.startCol);
  const endLetter = colToLetter(table.range.endCol);
  const startRowA1 = table.range.startRow + 1; // 0-based to 1-based
  const endRowA1 = table.range.endRow + 1;
  const range = `${startLetter}${startRowA1}:${endLetter}${endRowA1}`;

  return {
    ...table,
    displayName: table.displayName || table.name,
    columns: table.columns.map((col) => ({ ...col })),
    range,
    style: publicTableStyleId(table.style) ?? table.style,
  };
}

// =============================================================================
// Query Operations
// =============================================================================

/**
 * Get the table definition at a specific cell, or null if no table exists there.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns TableInfo if a table exists at the cell, null otherwise
 */
export async function getTableAtCell(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<TableInfo | null> {
  const table = await ctx.computeBridge.getTableAtCell(sheetId, row, col);
  if (!table) {
    return null;
  }
  return bridgeTableToTableInfo(table);
}

/**
 * Get a table definition by its name.
 * Tables are workbook-scoped, so no sheetId is needed.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table
 * @returns TableInfo if found, null otherwise
 */
export async function getTableByName(
  ctx: DocumentContext,
  tableName: string,
): Promise<TableInfo | null> {
  try {
    const table = await ctx.computeBridge.getTableByName(tableName);
    if (!table) {
      return null;
    }
    return bridgeTableToTableInfo(table);
  } catch {
    return null;
  }
}

/**
 * Get all tables in a sheet.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @returns Array of TableInfo objects
 */
export async function getAllTablesInSheet(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<TableInfo[]> {
  const tables = await ctx.computeBridge.getAllTablesInSheet(sheetId);
  return tables.map((t) => bridgeTableToTableInfo(t));
}

/**
 * Get the table hit region at a specific cell for table UI interactions.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID
 * @param row - Row index (0-based)
 * @param col - Column index (0-based)
 * @returns Hit region info or null
 */
export async function getTableHitRegion(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<TableHitRegion | null> {
  return ctx.computeBridge.getTableHitRegion(sheetId, row, col);
}

// =============================================================================
// Mutation Operations
// =============================================================================

/**
 * Remove a table by name. This removes the table definition and converts back to a plain range.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table to remove
 * @returns OperationResult indicating success or failure
 */
export async function removeTable(
  ctx: DocumentContext,
  tableName: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<OperationResult<void>> {
  return wrapOp('removeTable', async () => {
    await ctx.computeBridge.deleteTable(
      tableName,
      admissionOptions ?? createTableMutationOptions(ctx, 'tables.remove'),
    );
  });
}

/**
 * Resize a table to new boundaries.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table to resize
 * @param bounds - New boundaries (0-based, inclusive)
 * @returns OperationResult indicating success or failure
 */
export async function resizeTable(
  ctx: DocumentContext,
  tableName: string,
  bounds: Pick<CellRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'>,
  admissionOptions?: MutationAdmissionOptions,
): Promise<OperationResult<void>> {
  const { startRow, startCol, endRow, endCol } = bounds;
  if (startRow < 0 || startCol < 0 || endRow < startRow || endCol < startCol) {
    return {
      success: false,
      error: invalidRange(startRow, startCol, endRow, endCol),
    };
  }

  return wrapOp('resizeTable', async () => {
    await ctx.computeBridge.resizeTable(
      tableName,
      startRow,
      startCol,
      endRow,
      endCol,
      admissionOptions ?? createTableMutationOptions(ctx, 'tables.resize'),
    );
  });
}

/**
 * Set a table's visual style.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table
 * @param styleName - Style name to apply (e.g., "TableStyleLight1")
 * @returns OperationResult indicating success or failure
 */
export async function setTableStyle(
  ctx: DocumentContext,
  tableName: string,
  styleName: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<OperationResult<void>> {
  return wrapOp('setTableStyle', async () => {
    await ctx.computeBridge.setTableStyle(
      tableName,
      tableStyleIdForCompute(styleName) ?? styleName,
      admissionOptions ?? createTableMutationOptions(ctx, 'tables.setStylePreset'),
    );
  });
}

/**
 * Rename a table.
 *
 * @param ctx - Store context
 * @param oldName - Current table name
 * @param newName - New table name
 * @returns OperationResult indicating success or failure
 */
export async function renameTable(
  ctx: DocumentContext,
  oldName: string,
  newName: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<OperationResult<void>> {
  return wrapOp('renameTable', async () => {
    await ctx.computeBridge.renameTable(
      oldName,
      newName,
      admissionOptions ?? createTableMutationOptions(ctx, 'tables.rename'),
    );
  });
}

/**
 * Add a column to a table.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table
 * @param columnName - Name for the new column
 * @param position - Column position (0-based index)
 * @returns OperationResult indicating success or failure
 */
export async function addTableColumn(
  ctx: DocumentContext,
  tableName: string,
  columnName: string,
  position: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<OperationResult<void>> {
  return wrapOp('addTableColumn', async () => {
    await ctx.computeBridge.addTableColumn(
      tableName,
      columnName,
      position,
      admissionOptions ?? createTableMutationOptions(ctx, 'tables.addColumn'),
    );
  });
}

/**
 * Remove a column from a table by index.
 *
 * @param ctx - Store context
 * @param tableName - Name of the table
 * @param columnIndex - Index of the column to remove (0-based)
 * @returns OperationResult indicating success or failure
 */
export async function removeTableColumn(
  ctx: DocumentContext,
  tableName: string,
  columnIndex: number,
  admissionOptions?: MutationAdmissionOptions,
): Promise<OperationResult<void>> {
  return wrapOp('removeTableColumn', async () => {
    await ctx.computeBridge.removeTableColumn(
      tableName,
      columnIndex,
      admissionOptions ?? createTableMutationOptions(ctx, 'tables.removeColumn'),
    );
  });
}

/**
 * Create or update a table definition via setTable.
 *
 * @param ctx - Store context
 * @param sheetId - Sheet ID (used as table.sheet)
 * @param table - TableDef to create/update
 * @returns OperationResult indicating success or failure
 */
export async function createTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  table: TableDef,
  admissionOptions?: MutationAdmissionOptions,
): Promise<OperationResult<void>> {
  return wrapOp('createTable', async () => {
    await ctx.computeBridge.createTable(
      sheetId,
      table.name,
      table.start_row,
      table.start_col,
      table.end_row,
      table.end_col,
      table.columns,
      table.has_headers,
      admissionOptions ?? createTableMutationOptions(ctx, 'tables.add', sheetId),
    );
  });
}

/**
 * Toggle the totals row on a table.
 * Bridge: toggleTotalsRow(tableName) → MutationResult
 */
export async function toggleTotalsRow(
  ctx: DocumentContext,
  tableName: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<OperationResult<void>> {
  return wrapOp('toggleTotalsRow', async () => {
    await ctx.computeBridge.toggleTotalsRow(
      tableName,
      admissionOptions ?? createTableMutationOptions(ctx, 'tables.setShowTotals'),
    );
  });
}

/**
 * Toggle the header row on a table.
 * Bridge: toggleHeaderRow(tableName) → MutationResult
 */
export async function toggleHeaderRow(
  ctx: DocumentContext,
  tableName: string,
  admissionOptions?: MutationAdmissionOptions,
): Promise<OperationResult<void>> {
  return wrapOp('toggleHeaderRow', async () => {
    await ctx.computeBridge.toggleHeaderRow(
      tableName,
      admissionOptions ?? createTableMutationOptions(ctx, 'tables.setShowHeaders'),
    );
  });
}

/**
 * Get all data cell positions for a table column.
 * Pure computation: reads table def, computes data row range, returns positions.
 *
 * @param table - TableInfo (from getTableByName or getTableAtCell)
 * @param colIndex - Column index within the table (0-based)
 * @returns Array of { row, col } positions for all data cells in the column
 */
export function getTableColumnDataCellsFromInfo(
  table: TableInfo,
  colIndex: number,
): Array<{ row: number; col: number }> {
  const parsed = parseA1Range(table.range);
  if (!parsed) return [];

  // Data rows = all rows except header (if hasHeaderRow) and totals (if hasTotalsRow)
  const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
  const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;

  if (dataStartRow > dataEndRow) return [];

  // Column position = startCol + colIndex
  const col = parsed.startCol + colIndex;
  if (col > parsed.endCol) return [];

  const cells: Array<{ row: number; col: number }> = [];
  for (let row = dataStartRow; row <= dataEndRow; row++) {
    cells.push({ row, col });
  }
  return cells;
}

// =============================================================================
// Sub-Range Helpers
// =============================================================================

/**
 * Compute the A1-notation range for the data body of a table.
 *
 * The data body excludes the header row (if present) and the totals row (if present).
 * Returns null if the table has no data body rows (e.g., only header + totals).
 *
 * @param table - TableInfo object
 * @returns A1-notation range string, or null if no data rows exist
 */
export function getDataBodyRangeFromInfo(table: TableInfo): string | null {
  const parsed = parseA1Range(table.range);
  if (!parsed) return null;

  const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
  const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;

  if (dataStartRow > dataEndRow) return null;

  const startLetter = colToLetter(parsed.startCol);
  const endLetter = colToLetter(parsed.endCol);
  return `${startLetter}${dataStartRow + 1}:${endLetter}${dataEndRow + 1}`;
}

/**
 * Compute the A1-notation range for the header row of a table.
 *
 * Returns null if the table has no header row (`hasHeaders` is false).
 *
 * @param table - TableInfo object
 * @returns A1-notation range string, or null if the table has no header row
 */
export function getHeaderRowRangeFromInfo(table: TableInfo): string | null {
  if (!table.hasHeaderRow) return null;

  const parsed = parseA1Range(table.range);
  if (!parsed) return null;

  const startLetter = colToLetter(parsed.startCol);
  const endLetter = colToLetter(parsed.endCol);
  const headerRow = parsed.startRow + 1; // 0-based to 1-based
  return `${startLetter}${headerRow}:${endLetter}${headerRow}`;
}

/**
 * Compute the A1-notation range for the totals row of a table.
 *
 * Returns null if the table has no totals row (`hasTotalsRow` is false).
 *
 * @param table - TableInfo object
 * @returns A1-notation range string, or null if the table has no totals row
 */
export function getTotalRowRangeFromInfo(table: TableInfo): string | null {
  if (!table.hasTotalsRow) return null;

  const parsed = parseA1Range(table.range);
  if (!parsed) return null;

  const startLetter = colToLetter(parsed.startCol);
  const endLetter = colToLetter(parsed.endCol);
  const totalRow = parsed.endRow + 1; // 0-based to 1-based
  return `${startLetter}${totalRow}:${endLetter}${totalRow}`;
}
