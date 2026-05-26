/**
 * App Kernel API Implementation
 *
 * The main implementation of IAppKernelAPI. Provides a stable interface
 * for apps to interact with the spreadsheet kernel.
 *
 */

import type {
  AppCellValue,
  AppClipboardPayload,
  AppClipboardSnapshot,
  AppColumnId,
  AppColumnInfo,
  AppColumnSchema,
  AppColumnType,
  AppQueryOptions,
  AppRecord,
  AppTableId,
  AppTableInfo,
  AppTableSchema,
  IAppBindingsAPI,
  IAppKernelAPI,
  RecordChangeEvent,
  RecordChangeHandler,
  RecordId,
  TableSchemaChangeEvent,
  TableSchemaChangeHandler,
  Unsubscribe,
} from '@mog-sdk/contracts/apps';

import {
  toColId as toSpreadsheetColId,
  toRowId as toSpreadsheetRowId,
  type ColId,
  type RowId,
} from '@mog-sdk/contracts/cell-identity';
import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { CellChangedEvent, TableCreatedEvent } from '@mog-sdk/contracts/events';
import type { ClipboardPayload, IUndoService } from '@mog-sdk/contracts/services';
import type { TableConfig } from '@mog-sdk/contracts/tables';

import type { Workbook } from '@mog-sdk/contracts/api';

import type { IKernelContext } from '@mog-sdk/contracts/kernel';

import type { DocumentContext } from '../../context/types';
import { KernelError } from '../../errors';

import * as TablesCore from '../../domain/tables/core';
import * as TablesRangeResolution from '../../domain/tables/range-resolution';

import { AppBindingsAPIImpl } from './bindings-api';

// =============================================================================
// Type Conversions
// =============================================================================

/**
 * Convert internal RowId to app-level RecordId.
 */
function toRecordId(rowId: RowId): RecordId {
  return String(rowId) as RecordId;
}

/**
 * Convert app-level RecordId to internal RowId.
 */
function toRowId(recordId: RecordId): RowId {
  return toSpreadsheetRowId(String(recordId));
}

/**
 * Convert internal table ID to app-level AppTableId.
 */
function toAppTableId(tableId: string): AppTableId {
  return tableId as AppTableId;
}

/**
 * Convert app-level AppTableId to internal table ID.
 */
function toInternalTableId(tableId: AppTableId): string {
  return tableId as string;
}

/**
 * Convert internal ColId to app-level AppColumnId.
 */
function toAppColumnId(colId: ColId): AppColumnId {
  return String(colId) as AppColumnId;
}

/**
 * Convert app-level AppColumnId to internal ColId.
 */
function toInternalColId(columnId: AppColumnId): ColId {
  return toSpreadsheetColId(String(columnId));
}

/**
 * Convert internal CellValue to app-level AppCellValue.
 */
function toAppCellValue(value: CellValue): AppCellValue {
  if (value === null) return null;
  if (typeof value === 'object' && 'type' in value && value.type === 'error') {
    return {
      type: 'error',
      value: value.value,
      message: value.message,
    };
  }
  return value as AppCellValue;
}

/**
 * Convert app-level AppCellValue to internal CellValue.
 */
function toInternalCellValue(value: AppCellValue): CellValue {
  if (value === null) return null;
  if (typeof value === 'object' && 'type' in value && value.type === 'error') {
    return {
      type: 'error',
      value: value.value as CellValue extends { value: infer V } ? V : never,
      message: value.message,
    } as CellValue;
  }
  return value as CellValue;
}

/**
 * Convert TableConfig to AppTableInfo.
 */
async function toAppTableInfo(ctx: DocumentContext, table: TableConfig): Promise<AppTableInfo> {
  const range = TablesRangeResolution.resolveTableRange(ctx, table);
  const dataRange = range ? await TablesCore.getDataRange(ctx, table.id) : null;
  const recordCount = dataRange ? dataRange.endRow - dataRange.startRow + 1 : 0;

  return {
    id: toAppTableId(table.id),
    name: table.name,
    sheetId: table.sheetId,
    recordCount,
    columns: table.columns.map((col) => toAppColumnInfo(col)),
  };
}

/**
 * Convert TableColumn to AppColumnInfo.
 */
function toAppColumnInfo(col: {
  id: string;
  name: string;
  index: number;
  type?: AppColumnType;
}): AppColumnInfo {
  return {
    id: toAppColumnId(toSpreadsheetColId(col.id)),
    name: col.name,
    index: col.index,
    type: col.type ?? { kind: 'text' }, // Use provided type or default to text
    required: false,
    unique: false,
  };
}

/**
 * Build an AppRecord from kernel data.
 *
 * Uses a single queryRange IPC call to fetch all columns of the row at once,
 * instead of per-column Cells.getData calls (which each make 2 IPC calls).
 */
async function buildAppRecord(
  ctx: DocumentContext,
  table: TableConfig,
  rowId: RowId,
): Promise<AppRecord | null> {
  const range = TablesRangeResolution.resolveTableRange(ctx, table);
  if (!range) return null;

  const rowIndex = parseInt(rowId, 10);
  if (isNaN(rowIndex)) return null;

  // 1 IPC call to fetch all columns of this row
  const endCol = range.startCol + table.columns.length - 1;
  const rangeData = await ctx.computeBridge.queryRange(
    table.sheetId,
    rowIndex,
    range.startCol,
    rowIndex,
    endCol,
  );

  // Build lookup map from flat cells array
  const cellMap = new Map<number, (typeof rangeData.cells)[number]>();
  for (const vc of rangeData.cells) {
    cellMap.set(vc.col, vc);
  }

  const values: Record<string, AppCellValue> = {};
  const valuesByColumnId: Record<AppColumnId, AppCellValue> = {} as Record<
    AppColumnId,
    AppCellValue
  >;

  for (const col of table.columns) {
    const colIndex = range.startCol + col.index;
    const vc = cellMap.get(colIndex);
    const value: CellValue = vc ? ((vc.value as CellValue) ?? null) : null;
    const appValue = toAppCellValue(value);

    // Dual access pattern
    values[col.name] = appValue;
    valuesByColumnId[toAppColumnId(toSpreadsheetColId(col.id))] = appValue;
  }

  return {
    id: toRecordId(rowId),
    tableId: toAppTableId(table.id),
    values,
    valuesByColumnId,
  };
}

// =============================================================================
// Options
// =============================================================================

/**
 * Options for creating an AppKernelAPI instance.
 */
export interface AppKernelAPIOptions {
  /** Kernel context */
  ctx: IKernelContext;
  /** Unified Workbook API for all write operations */
  workbook: Workbook;
}

// =============================================================================
// Tables API Implementation
// =============================================================================

class AppTablesAPIImpl {
  constructor(
    private ctx: DocumentContext,
    private workbook: Workbook,
  ) {}

  async get(tableId: AppTableId): Promise<AppTableInfo | null> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return null;
    return toAppTableInfo(this.ctx, table);
  }

  async findByName(name: string): Promise<AppTableInfo | null> {
    const table = await TablesCore.getTableByName(this.ctx, name);
    if (!table) return null;
    return toAppTableInfo(this.ctx, table);
  }

  async list(): Promise<AppTableInfo[]> {
    const tables = await TablesCore.getAllTables(this.ctx);
    const results: AppTableInfo[] = [];
    for (const t of tables) {
      results.push(await toAppTableInfo(this.ctx, t));
    }
    return results;
  }

  async create(
    schema: AppTableSchema,
    options?: { sheetId?: string; startCell?: string },
  ): Promise<AppTableInfo> {
    // Default to first sheet if not specified
    const rawSheetId = options?.sheetId ?? (await this.ctx.computeBridge.getAllSheetIds())[0];
    if (!rawSheetId) throw new KernelError('API_SHEET_NOT_FOUND', 'No sheet available');
    const sheetId = toSheetId(rawSheetId);

    // Parse start cell or default to A1
    let startRow = 0;
    let startCol = 0;
    if (options?.startCell) {
      const match = options.startCell.match(/^([A-Z]+)(\d+)$/i);
      if (match) {
        startCol = letterToCol(match[1]);
        startRow = parseInt(match[2], 10) - 1;
      }
    }

    // Calculate range based on columns (at least 2 rows: header + 1 data)
    const endCol = startCol + schema.columns.length - 1;
    const endRow = startRow + 1; // Header + 1 data row

    const table = await TablesCore.createTable(
      this.ctx,
      sheetId,
      {
        startRow,
        startCol,
        endRow,
        endCol,
      },
      {
        name: schema.name,
        hasHeaderRow: true,
      },
    );

    // Update column names from schema
    const updatedColumns = table.columns.map((col: TableConfig['columns'][number], i: number) => ({
      ...col,
      name: schema.columns[i]?.name ?? col.name,
    }));

    await TablesCore.updateTable(this.ctx, table.id, { columns: updatedColumns });

    // Write header row with column names via unified Worksheet API (single batch IPC)
    const ws = this.workbook.getSheetById(sheetId);
    const headerUpdates = schema.columns.map((col, i) => ({
      row: startRow,
      col: startCol + i,
      value: col.name,
    }));
    await ws.setCells(headerUpdates);

    return (await this.get(toAppTableId(table.id)))!;
  }

  async rename(tableId: AppTableId, newName: string): Promise<void> {
    await TablesCore.updateTable(this.ctx, toInternalTableId(tableId), { name: newName });
  }

  async delete(tableId: AppTableId): Promise<void> {
    await TablesCore.deleteTable(this.ctx, toInternalTableId(tableId), true);
  }
}

// =============================================================================
// Columns API Implementation
// =============================================================================

class AppColumnsAPIImpl {
  constructor(
    private ctx: DocumentContext,
    private workbook: Workbook,
  ) {}

  async get(tableId: AppTableId, columnId: AppColumnId): Promise<AppColumnInfo | null> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return null;

    const col = table.columns.find((c) => c.id === toInternalColId(columnId));
    if (!col) return null;

    return toAppColumnInfo(col);
  }

  async findByName(tableId: AppTableId, name: string): Promise<AppColumnInfo | null> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return null;

    const col = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!col) return null;

    return toAppColumnInfo(col);
  }

  async list(tableId: AppTableId): Promise<AppColumnInfo[]> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return [];

    return table.columns.map((col) => toAppColumnInfo(col));
  }

  async create(
    tableId: AppTableId,
    schema: AppColumnSchema,
    options?: { index?: number },
  ): Promise<AppColumnInfo> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) throw new KernelError('TABLE_NOT_FOUND', `Table ${tableId} not found`);

    const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
    if (!range) throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} range not found`);

    // Generate new column ID
    const newColId = `col-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const insertIndex = options?.index ?? table.columns.length;

    // Insert column at position
    const newColumns = [...table.columns];
    newColumns.splice(insertIndex, 0, {
      id: newColId,
      name: schema.name,
      index: insertIndex,
    });

    // Update indices for columns after insertion point
    for (let i = insertIndex + 1; i < newColumns.length; i++) {
      newColumns[i] = { ...newColumns[i], index: i };
    }

    // Update table range (add one column)
    const newRange = {
      ...range,
      endCol: range.endCol + 1,
    };

    await TablesCore.updateTable(this.ctx, toInternalTableId(tableId), {
      columns: newColumns,
      range: newRange,
    });

    // Write header cell via unified Worksheet API
    const headerRow = table.hasHeaderRow ? range.startRow : range.startRow - 1;
    const ws = this.workbook.getSheetById(toSheetId(table.sheetId));
    await ws.setCell(headerRow, range.startCol + insertIndex, schema.name);

    return {
      id: toAppColumnId(toSpreadsheetColId(newColId)),
      name: schema.name,
      index: insertIndex,
      type: schema.type,
      required: schema.required ?? false,
      unique: schema.unique ?? false,
      defaultValue: schema.defaultValue,
    };
  }

  async update(
    tableId: AppTableId,
    columnId: AppColumnId,
    updates: Partial<AppColumnSchema>,
  ): Promise<void> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return;

    const colIndex = table.columns.findIndex((c) => c.id === toInternalColId(columnId));
    if (colIndex === -1) return;

    const updatedColumns = [...table.columns];
    updatedColumns[colIndex] = {
      ...updatedColumns[colIndex],
      ...(updates.name ? { name: updates.name } : {}),
    };

    await TablesCore.updateTable(this.ctx, toInternalTableId(tableId), { columns: updatedColumns });
  }

  async rename(tableId: AppTableId, columnId: AppColumnId, newName: string): Promise<void> {
    await this.update(tableId, columnId, { name: newName, type: { kind: 'text' } });
  }

  async delete(tableId: AppTableId, columnId: AppColumnId): Promise<void> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return;

    const colIndex = table.columns.findIndex((c) => c.id === toInternalColId(columnId));
    if (colIndex === -1) return;

    const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
    if (!range) return;

    // Remove column from columns array and update indices
    const newColumns = table.columns
      .filter((c) => c.id !== toInternalColId(columnId))
      .map((c, i) => ({ ...c, index: i }));

    // Update table range (remove one column)
    const newRange = {
      ...range,
      endCol: range.endCol - 1,
    };

    await TablesCore.updateTable(this.ctx, toInternalTableId(tableId), {
      columns: newColumns,
      range: newRange,
    });
  }
}

// =============================================================================
// Records API Implementation
// =============================================================================

class AppRecordsAPIImpl {
  constructor(
    private ctx: DocumentContext,
    private workbook: Workbook,
  ) {}

  async get(tableId: AppTableId, recordId: RecordId): Promise<AppRecord | null> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return null;

    const rowIndex = parseInt(toRowId(recordId), 10);
    if (isNaN(rowIndex)) return null;

    // Check if the record exists within the table's range
    const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
    if (!range) return null;

    // Check if row is within the overall table range (not just data range)
    // This handles cases where the table was just expanded
    if (rowIndex < range.startRow || rowIndex > range.endRow) {
      return null;
    }

    // Also check it's not the header row (if table has header)
    if (table.hasHeaderRow && rowIndex === range.startRow) {
      return null;
    }

    // Build the record
    const record = await buildAppRecord(this.ctx, table, toRowId(recordId));

    // If record exists but has no data (all null/empty values), treat as non-existent
    // This handles the case where someone queries for a row that's way outside the table
    if (record) {
      const hasData = Object.values(record.values).some((v) => v !== null && v !== '');
      if (!hasData) {
        return null;
      }
    }

    return record;
  }

  async list(tableId: AppTableId, options?: AppQueryOptions): Promise<AppRecord[]> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return [];

    const dataRange = await TablesCore.getDataRange(this.ctx, toInternalTableId(tableId));
    if (!dataRange) return [];

    const records: AppRecord[] = [];

    // Get all records
    for (let rowIndex = dataRange.startRow; rowIndex <= dataRange.endRow; rowIndex++) {
      const rowId = toSpreadsheetRowId(String(rowIndex));
      const record = await buildAppRecord(this.ctx, table, rowId);
      if (record) {
        // Skip empty records
        const hasData = Object.values(record.values).some((v) => v !== null && v !== '');
        if (hasData) {
          records.push(record);
        }
      }
    }

    // Apply filter
    let filtered = records;
    if (options?.filter?.conditions) {
      filtered = records.filter((record) => {
        return options.filter!.conditions.every((cond) => {
          const fieldValue =
            typeof cond.field === 'string' && !cond.field.startsWith('col-')
              ? record.values[cond.field]
              : record.valuesByColumnId[cond.field as AppColumnId];

          switch (cond.operator) {
            case 'equals':
              return fieldValue === cond.value;
            case 'notEquals':
              return fieldValue !== cond.value;
            case 'contains':
              return String(fieldValue ?? '').includes(String(cond.value ?? ''));
            case 'isEmpty':
              return fieldValue === null || fieldValue === '';
            case 'isNotEmpty':
              return fieldValue !== null && fieldValue !== '';
            case 'notContains':
              return !String(fieldValue ?? '').includes(String(cond.value ?? ''));
            case 'startsWith':
              return String(fieldValue ?? '').startsWith(String(cond.value ?? ''));
            case 'endsWith':
              return String(fieldValue ?? '').endsWith(String(cond.value ?? ''));
            case 'greaterThan':
              return Number(fieldValue) > Number(cond.value);
            case 'lessThan':
              return Number(fieldValue) < Number(cond.value);
            case 'greaterThanOrEqual':
              return Number(fieldValue) >= Number(cond.value);
            case 'lessThanOrEqual':
              return Number(fieldValue) <= Number(cond.value);
            case 'isAnyOf':
              return Array.isArray(cond.value) && cond.value.includes(fieldValue);
            case 'isNoneOf':
              return !Array.isArray(cond.value) || !cond.value.includes(fieldValue);
            default: {
              const _exhaustive: never = cond.operator;
              throw new Error(`Unknown filter operator "${cond.operator}"`);
            }
          }
        });
      });
    }

    // Apply sort
    if (options?.sort && options.sort.length > 0) {
      filtered.sort((a, b) => {
        for (const sortConfig of options.sort!) {
          const aVal =
            typeof sortConfig.field === 'string' && !sortConfig.field.startsWith('col-')
              ? a.values[sortConfig.field]
              : a.valuesByColumnId[sortConfig.field as AppColumnId];
          const bVal =
            typeof sortConfig.field === 'string' && !sortConfig.field.startsWith('col-')
              ? b.values[sortConfig.field]
              : b.valuesByColumnId[sortConfig.field as AppColumnId];

          let cmp = 0;
          if (aVal === null && bVal === null) cmp = 0;
          else if (aVal === null) cmp = 1;
          else if (bVal === null) cmp = -1;
          else if (typeof aVal === 'string' && typeof bVal === 'string') {
            cmp = aVal.localeCompare(bVal);
          } else if (typeof aVal === 'number' && typeof bVal === 'number') {
            cmp = aVal - bVal;
          } else {
            cmp = String(aVal).localeCompare(String(bVal));
          }

          if (cmp !== 0) {
            return sortConfig.direction === 'desc' ? -cmp : cmp;
          }
        }
        return 0;
      });
    }

    // Apply pagination
    let paginated = filtered;
    if (options?.offset !== undefined) {
      paginated = paginated.slice(options.offset);
    }
    if (options?.limit !== undefined) {
      paginated = paginated.slice(0, options.limit);
    }

    return paginated;
  }

  async create(tableId: AppTableId, values: Record<string, AppCellValue>): Promise<AppRecord> {
    const internalTableId = toInternalTableId(tableId);
    const table = await TablesCore.getTable(this.ctx, internalTableId);
    if (!table) throw new KernelError('TABLE_NOT_FOUND', `Table ${tableId} not found`);

    const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
    if (!range)
      throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} range not resolved`);

    const dataRange = await TablesCore.getDataRange(this.ctx, internalTableId);
    if (!dataRange)
      throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${tableId} data range not resolved`);

    // New row at end of data range
    const newRowIndex = dataRange.endRow + 1;

    // Write cell values via unified Worksheet API (single batch IPC)
    const ws = this.workbook.getSheetById(toSheetId(table.sheetId));
    const updates: Array<{ row: number; col: number; value: any }> = [];
    for (const col of table.columns) {
      const colIndex = range.startCol + col.index;
      // Look up value by column name or column ID
      const appValue = values[col.name] ?? values[col.id];
      if (appValue !== undefined && appValue !== null) {
        updates.push({ row: newRowIndex, col: colIndex, value: toInternalCellValue(appValue) });
      }
    }
    if (updates.length > 0) {
      await ws.setCells(updates);
    }

    // Expand table range to include new row
    const newRange = { ...range, endRow: range.endRow + 1 };
    const newRangeIdentity = TablesRangeResolution.createTableCellIdRange(
      this.ctx,
      toSheetId(table.sheetId),
      newRange.startRow,
      newRange.startCol,
      newRange.endRow,
      newRange.endCol,
    );
    await TablesCore.updateTable(this.ctx, internalTableId, {
      range: newRange,
      rangeIdentity: newRangeIdentity,
    });

    const newRowId = toSpreadsheetRowId(String(newRowIndex));
    return (await this.get(tableId, toRecordId(newRowId)))!;
  }

  async update(
    tableId: AppTableId,
    recordId: RecordId,
    values: Record<string, AppCellValue>,
  ): Promise<AppRecord> {
    const internalTableId = toInternalTableId(tableId);
    const table = await TablesCore.getTable(this.ctx, internalTableId);
    if (!table) return (await this.get(tableId, recordId))!;

    const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
    if (!range) return (await this.get(tableId, recordId))!;

    const rowIndex = parseInt(toRowId(recordId), 10);
    if (isNaN(rowIndex)) return (await this.get(tableId, recordId))!;

    // Verify it's within the table data range
    const dataRange = await TablesCore.getDataRange(this.ctx, internalTableId);
    if (!dataRange || rowIndex < dataRange.startRow || rowIndex > dataRange.endRow) {
      return (await this.get(tableId, recordId))!;
    }

    // Write cell values via unified Worksheet API (single batch IPC)
    const ws = this.workbook.getSheetById(toSheetId(table.sheetId));
    const updates: Array<{ row: number; col: number; value: any }> = [];
    for (const [fieldId, value] of Object.entries(values)) {
      // Find column by name or by ID
      const col = table.columns.find(
        (c: { id: string; name: string }) => c.name === fieldId || c.id === fieldId,
      );
      if (!col) continue;

      const colIndex = range.startCol + col.index;
      if (value === null || value === undefined || value === '') {
        updates.push({ row: rowIndex, col: colIndex, value: null });
      } else {
        updates.push({ row: rowIndex, col: colIndex, value: toInternalCellValue(value) });
      }
    }
    if (updates.length > 0) {
      await ws.setCells(updates);
    }

    return (await this.get(tableId, recordId))!;
  }

  async delete(tableId: AppTableId, recordId: RecordId): Promise<void> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return;

    const rowIndex = parseInt(toRowId(recordId), 10);
    if (isNaN(rowIndex)) return;

    // Delete the row via unified Worksheet API
    try {
      const ws = this.workbook.getSheetById(toSheetId(table.sheetId));
      await ws.structure.deleteRows(rowIndex, 1);

      // Shrink table range
      const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
      if (range && range.endRow > range.startRow) {
        await TablesCore.updateTable(this.ctx, toInternalTableId(tableId), {
          range: { ...range, endRow: range.endRow - 1 },
        });
      }
    } catch (e) {
      console.warn(`Failed to delete record: ${e}`);
    }
  }

  async createBatch(
    tableId: AppTableId,
    records: Record<string, AppCellValue>[],
  ): Promise<AppRecord[]> {
    const results: AppRecord[] = [];
    for (const values of records) {
      results.push(await this.create(tableId, values));
    }
    return results;
  }

  async updateBatch(
    tableId: AppTableId,
    updates: Array<{ id: RecordId; values: Record<string, AppCellValue> }>,
  ): Promise<AppRecord[]> {
    const results: AppRecord[] = [];
    for (const { id, values } of updates) {
      results.push(await this.update(tableId, id, values));
    }
    return results;
  }

  async deleteBatch(tableId: AppTableId, recordIds: RecordId[]): Promise<void> {
    // Sort in descending order to delete from bottom up (avoids index shifting issues)
    const sortedIds = [...recordIds].sort((a, b) => {
      const aIdx = parseInt(toRowId(a), 10);
      const bIdx = parseInt(toRowId(b), 10);
      return bIdx - aIdx;
    });

    for (const recordId of sortedIds) {
      await this.delete(tableId, recordId);
    }
  }
}

// =============================================================================
// Relations API Implementation
// =============================================================================

class AppRelationsAPIImpl {
  constructor(
    private ctx: DocumentContext,
    private workbook: Workbook,
  ) {}

  async getRelated(
    tableId: AppTableId,
    recordId: RecordId,
    relationColumnId: AppColumnId,
  ): Promise<AppRecord[]> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(tableId));
    if (!table) return [];

    // Get the source record
    const record = await buildAppRecord(this.ctx, table, toRowId(recordId));
    if (!record) return [];

    // Get the relation column value
    const relationValue = record.valuesByColumnId[relationColumnId];
    if (!relationValue || relationValue === null || relationValue === '') return [];

    // Parse the relation value (single RecordId or comma-separated RecordIds)
    const targetRecordIds = this.parseRelationValue(relationValue);
    if (targetRecordIds.length === 0) return [];

    // Get the column info to find the target table
    const column = table.columns.find((c) => c.id === toInternalColId(relationColumnId));
    if (!column) return [];

    // Get column type info to find target table
    const columnInfo = toAppColumnInfo(column);
    const targetTableId = columnInfo.type.targetTableId;
    if (!targetTableId) {
      console.warn('[AppRelationsAPI] No targetTableId found in relation column', relationColumnId);
      return [];
    }

    // Get the target table
    const targetTable = await TablesCore.getTable(this.ctx, toInternalTableId(targetTableId));
    if (!targetTable) return [];

    // Fetch all target records
    const relatedRecords: AppRecord[] = [];
    for (const targetRecordId of targetRecordIds) {
      const targetRecord = await buildAppRecord(this.ctx, targetTable, toRowId(targetRecordId));
      if (targetRecord) {
        relatedRecords.push(targetRecord);
      }
    }

    return relatedRecords;
  }

  async getBacklinks(
    tableId: AppTableId,
    recordId: RecordId,
    options?: { sourceTableId?: AppTableId; sourceColumnId?: AppColumnId },
  ): Promise<AppRecord[]> {
    const backlinks: AppRecord[] = [];

    // Determine which tables to scan
    let tablesToScan: (TableConfig | undefined)[];
    if (options?.sourceTableId) {
      const singleTable = await TablesCore.getTable(
        this.ctx,
        toInternalTableId(options.sourceTableId),
      );
      tablesToScan = [singleTable];
    } else {
      tablesToScan = await TablesCore.getAllTables(this.ctx);
    }

    for (const sourceTable of tablesToScan) {
      if (!sourceTable) continue;

      // Find relation columns that point to the target table
      const relationColumns = sourceTable.columns.filter((col) => {
        // Skip if we're filtering by source column and this isn't it
        if (
          options?.sourceColumnId &&
          toAppColumnId(toSpreadsheetColId(col.id)) !== options.sourceColumnId
        ) {
          return false;
        }

        const columnInfo = toAppColumnInfo(col);
        return columnInfo.type.kind === 'relation' && columnInfo.type.targetTableId === tableId;
      });

      if (relationColumns.length === 0) continue;

      // Get all records in the source table
      const dataRange = await TablesCore.getDataRange(this.ctx, sourceTable.id);
      if (!dataRange) continue;

      for (let rowIndex = dataRange.startRow; rowIndex <= dataRange.endRow; rowIndex++) {
        const rowId = toSpreadsheetRowId(String(rowIndex));
        const sourceRecord = await buildAppRecord(this.ctx, sourceTable, rowId);
        if (!sourceRecord) continue;

        // Check each relation column for a link to our target record
        for (const relationCol of relationColumns) {
          const colId = toAppColumnId(toSpreadsheetColId(relationCol.id));
          const relationValue = sourceRecord.valuesByColumnId[colId];
          if (!relationValue || relationValue === null || relationValue === '') continue;

          const linkedRecordIds = this.parseRelationValue(relationValue);
          if (linkedRecordIds.includes(recordId)) {
            backlinks.push(sourceRecord);
            break; // Don't add the same record multiple times
          }
        }
      }
    }

    return backlinks;
  }

  async link(
    sourceTableId: AppTableId,
    sourceRecordId: RecordId,
    relationColumnId: AppColumnId,
    targetRecordId: RecordId,
  ): Promise<void> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(sourceTableId));
    if (!table) {
      throw new KernelError('TABLE_NOT_FOUND', `Source table ${sourceTableId} not found`);
    }

    // Get the column info to determine if it's multi-select
    const column = table.columns.find((c) => c.id === toInternalColId(relationColumnId));
    if (!column) {
      throw new KernelError('OPERATION_FAILED', `Relation column ${relationColumnId} not found`);
    }

    const columnInfo = toAppColumnInfo(column);
    const allowMultiple = columnInfo.type.allowMultiple ?? false;

    // Get current value
    const record = await buildAppRecord(this.ctx, table, toRowId(sourceRecordId));
    if (!record) {
      throw new KernelError('OPERATION_FAILED', `Source record ${sourceRecordId} not found`);
    }

    const currentValue = record.valuesByColumnId[relationColumnId];
    const currentIds = this.parseRelationValue(currentValue);

    // Check if already linked
    if (currentIds.includes(targetRecordId)) {
      return; // Already linked
    }

    // Build new value
    let newValue: string;
    if (allowMultiple) {
      // Add to comma-separated list
      newValue = [...currentIds, targetRecordId].join(',');
    } else {
      // Replace with single value
      newValue = targetRecordId;
    }

    // Update the cell via unified Worksheet API
    const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
    if (!range) {
      throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${sourceTableId} range not found`);
    }

    const rowIndex = parseInt(toRowId(sourceRecordId), 10);
    const colIndex = range.startCol + column.index;

    const ws = this.workbook.getSheetById(toSheetId(table.sheetId));
    await ws.setCell(rowIndex, colIndex, newValue);
  }

  async unlink(
    sourceTableId: AppTableId,
    sourceRecordId: RecordId,
    relationColumnId: AppColumnId,
    targetRecordId: RecordId,
  ): Promise<void> {
    const table = await TablesCore.getTable(this.ctx, toInternalTableId(sourceTableId));
    if (!table) {
      throw new KernelError('TABLE_NOT_FOUND', `Source table ${sourceTableId} not found`);
    }

    // Get the column
    const column = table.columns.find((c) => c.id === toInternalColId(relationColumnId));
    if (!column) {
      throw new KernelError('OPERATION_FAILED', `Relation column ${relationColumnId} not found`);
    }

    // Get current value
    const record = await buildAppRecord(this.ctx, table, toRowId(sourceRecordId));
    if (!record) {
      throw new KernelError('OPERATION_FAILED', `Source record ${sourceRecordId} not found`);
    }

    const currentValue = record.valuesByColumnId[relationColumnId];
    const currentIds = this.parseRelationValue(currentValue);

    // Remove the target record ID
    const newIds = currentIds.filter((id) => id !== targetRecordId);

    // Build new value
    const newValue = newIds.length > 0 ? newIds.join(',') : null;

    // Update the cell via unified Worksheet API
    const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
    if (!range) {
      throw new KernelError('TABLE_RANGE_NOT_FOUND', `Table ${sourceTableId} range not found`);
    }

    const rowIndex = parseInt(toRowId(sourceRecordId), 10);
    const colIndex = range.startCol + column.index;

    const ws = this.workbook.getSheetById(toSheetId(table.sheetId));
    await ws.setCell(rowIndex, colIndex, newValue ?? '');
  }

  /**
   * Parse a relation cell value into an array of RecordIds.
   * Handles both single values and comma-separated lists.
   */
  private parseRelationValue(value: AppCellValue): RecordId[] {
    if (!value || value === null || value === '') return [];

    // Handle error values
    if (typeof value === 'object' && 'type' in value) return [];

    // Handle array values (future-proofing)
    if (Array.isArray(value)) {
      return value.filter((v) => v !== null && v !== '').map((v) => String(v) as RecordId);
    }

    // Handle comma-separated string
    const valueStr = String(value).trim();
    if (!valueStr) return [];

    return valueStr
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .map((id) => id as RecordId);
  }
}

// =============================================================================
// Events API Implementation
// =============================================================================

class AppEventsAPIImpl {
  private recordChangeHandlers = new Map<string, Set<RecordChangeHandler>>();
  private schemaChangeHandlers = new Map<string, Set<TableSchemaChangeHandler>>();

  constructor(private ctx: DocumentContext) {
    // Subscribe to kernel events and translate them
    this.setupEventBridges();
  }

  private setupEventBridges(): void {
    // Subscribe to cell change events from the event bus
    this.ctx.eventBus.on('cell:changed', (event: CellChangedEvent) => {
      // Find if this cell is in a table
      void TablesCore.getAllTables(this.ctx).then(async (tables) => {
        for (const table of tables) {
          const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
          if (!range) continue;

          const { row, col } = event;
          if (
            row >= range.startRow &&
            row <= range.endRow &&
            col >= range.startCol &&
            col <= range.endCol
          ) {
            // Cell is in this table - emit record change event
            const handlers = this.recordChangeHandlers.get(table.id);
            if (handlers && handlers.size > 0) {
              const rowId = toSpreadsheetRowId(String(row));
              const recordId = toRecordId(rowId);
              const record = await buildAppRecord(this.ctx, table, rowId);

              const changeEvent: RecordChangeEvent = {
                type: 'updated',
                tableId: toAppTableId(table.id),
                recordId,
                record: record ?? undefined,
              };

              for (const handler of handlers) {
                try {
                  handler(changeEvent);
                } catch (e) {
                  console.error('[AppEventsAPI] Error in record change handler:', e);
                }
              }
            }
            break;
          }
        }
      });
    });

    // Subscribe to table events
    this.ctx.eventBus.on('table:created', (event: TableCreatedEvent) => {
      const handlers = this.schemaChangeHandlers.get(event.tableId);
      if (handlers) {
        const schemaEvent: TableSchemaChangeEvent = {
          type: 'columnAdded',
          tableId: toAppTableId(event.tableId),
        };
        for (const handler of handlers) {
          handler(schemaEvent);
        }
      }
    });
  }

  onRecordChange(tableId: AppTableId, handler: RecordChangeHandler): Unsubscribe {
    const internalId = toInternalTableId(tableId);
    if (!this.recordChangeHandlers.has(internalId)) {
      this.recordChangeHandlers.set(internalId, new Set());
    }
    this.recordChangeHandlers.get(internalId)!.add(handler);

    return () => {
      const handlers = this.recordChangeHandlers.get(internalId);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.recordChangeHandlers.delete(internalId);
        }
      }
    };
  }

  onSchemaChange(tableId: AppTableId, handler: TableSchemaChangeHandler): Unsubscribe {
    const internalId = toInternalTableId(tableId);
    if (!this.schemaChangeHandlers.has(internalId)) {
      this.schemaChangeHandlers.set(internalId, new Set());
    }
    this.schemaChangeHandlers.get(internalId)!.add(handler);

    return () => {
      const handlers = this.schemaChangeHandlers.get(internalId);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.schemaChangeHandlers.delete(internalId);
        }
      }
    };
  }

  onRecordFieldChange(
    tableId: AppTableId,
    recordId: RecordId,
    handler: (fieldId: AppColumnId, value: AppCellValue) => void,
  ): Unsubscribe {
    // Subscribe directly to cell:changed events for this specific record
    const internalTableId = toInternalTableId(tableId);
    const targetRowIndex = parseInt(toRowId(recordId), 10);

    const cellChangeHandler = (event: CellChangedEvent) => {
      // Check if this is the record we're watching
      if (event.row !== targetRowIndex) {
        return;
      }

      // Find if this cell is in our target table
      void TablesCore.getTable(this.ctx, internalTableId).then((table) => {
        if (!table) return;

        const range = TablesRangeResolution.resolveTableRange(this.ctx, table);
        if (!range) return;

        const { row, col } = event;
        if (
          row >= range.startRow &&
          row <= range.endRow &&
          col >= range.startCol &&
          col <= range.endCol &&
          event.sheetId === table.sheetId
        ) {
          // Find which column this is
          const colIndexInTable = col - range.startCol;
          if (colIndexInTable >= 0 && colIndexInTable < table.columns.length) {
            const column = table.columns[colIndexInTable];
            const fieldId = toAppColumnId(toSpreadsheetColId(column.id));
            const value = toAppCellValue(event.newValue ?? null);

            try {
              handler(fieldId, value);
            } catch (e) {
              console.error('[AppEventsAPI] Error in record field change handler:', e);
            }
          }
        }
      });
    };

    return this.ctx.eventBus.on('cell:changed', cellChangeHandler as (event: unknown) => void);
  }
}

// =============================================================================
// Clipboard API Implementation
// =============================================================================

class AppClipboardAPIImpl {
  constructor(private ctx: DocumentContext) {}

  copy(payload: AppClipboardPayload): void {
    const clipboardService = this.ctx.services?.clipboard;
    if (!clipboardService) {
      console.warn('[AppClipboardAPI] Clipboard service not available');
      return;
    }

    // Convert AppClipboardPayload to ClipboardPayload
    const kernelPayload = this.toKernelPayload(payload);
    clipboardService.copy(kernelPayload);

    // Also write to system clipboard for external paste
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(payload.text).catch((err) => {
        console.warn('[AppClipboardAPI] Failed to write to system clipboard:', err);
      });
    }
  }

  cut(payload: AppClipboardPayload): void {
    const clipboardService = this.ctx.services?.clipboard;
    if (!clipboardService) {
      console.warn('[AppClipboardAPI] Clipboard service not available');
      return;
    }

    // Convert AppClipboardPayload to ClipboardPayload
    const kernelPayload = this.toKernelPayload(payload);
    clipboardService.cut(kernelPayload);

    // Also write to system clipboard for external paste
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(payload.text).catch((err) => {
        console.warn('[AppClipboardAPI] Failed to write to system clipboard:', err);
      });
    }
  }

  getSnapshot(): AppClipboardSnapshot {
    const clipboardService = this.ctx.services?.clipboard;
    if (!clipboardService) {
      return { hasData: false, operation: null };
    }

    const snapshot = clipboardService.getSnapshot();
    return {
      hasData: snapshot.hasData,
      operation: snapshot.operation,
    };
  }

  getPayload(): AppClipboardPayload | null {
    const clipboardService = this.ctx.services?.clipboard;
    if (!clipboardService) {
      return null;
    }

    const kernelPayload = clipboardService.getPayload();
    if (!kernelPayload) {
      return null;
    }

    return this.fromKernelPayload(kernelPayload);
  }

  clear(): void {
    const clipboardService = this.ctx.services?.clipboard;
    if (clipboardService) {
      clipboardService.clear();
    }
  }

  subscribe(handler: (snapshot: AppClipboardSnapshot) => void): Unsubscribe {
    const clipboardService = this.ctx.services?.clipboard;
    if (!clipboardService) {
      // Return no-op unsubscribe
      return () => {};
    }

    const sub = clipboardService.subscribe((kernelSnapshot) => {
      handler({
        hasData: kernelSnapshot.hasData,
        operation: kernelSnapshot.operation,
      });
    });
    return () => sub.dispose();
  }

  /**
   * Convert AppClipboardPayload to the kernel's ClipboardPayload format.
   */
  private toKernelPayload(payload: AppClipboardPayload): ClipboardPayload {
    const rowCount = payload.cells.length;
    const colCount = rowCount > 0 ? payload.cells[0].length : 0;

    return {
      cells: {
        values: payload.cells as CellValue[][],
        rowCount,
        colCount,
      },
      tableContext: payload.tableContext
        ? {
            tableId: payload.tableContext.sourceTableId as string,
            rowIds: payload.tableContext.recordIds as string[],
            colIds: payload.tableContext.columnNames.map(
              (_: string, i: number) => `col-${i}` as string,
            ),
            columnSchemas: payload.tableContext.columnNames.map((name: string, i: number) => ({
              id: toSpreadsheetColId(`col-${i}`),
              name,
              kind: 'text' as const,
            })),
          }
        : undefined,
      source: {
        viewType: 'kanban',
        viewId: null,
        sheetId: null,
      },
      text: payload.text,
    };
  }

  /**
   * Convert kernel's ClipboardPayload to AppClipboardPayload format.
   */
  private fromKernelPayload(payload: ClipboardPayload): AppClipboardPayload {
    return {
      cells: payload.cells.values as AppCellValue[][],
      text: payload.text,
      tableContext: payload.tableContext
        ? {
            sourceTableId: toAppTableId(payload.tableContext.tableId),
            recordIds: payload.tableContext.rowIds as RecordId[],
            columnNames: payload.tableContext.columnSchemas.map(
              (schema) => (schema as { name: string }).name,
            ),
          }
        : undefined,
    };
  }
}

// =============================================================================
// Main API Implementation
// =============================================================================

/**
 * The App Kernel API implementation.
 */
export class AppKernelAPI implements IAppKernelAPI {
  readonly tables: AppTablesAPIImpl;
  readonly columns: AppColumnsAPIImpl;
  readonly records: AppRecordsAPIImpl;
  readonly relations: AppRelationsAPIImpl;
  readonly events: AppEventsAPIImpl;
  readonly clipboard?: AppClipboardAPIImpl;
  readonly bindings: IAppBindingsAPI;
  readonly undo?: IUndoService;

  constructor(
    private ctx: DocumentContext,
    workbook: Workbook,
  ) {
    this.tables = new AppTablesAPIImpl(ctx, workbook);
    this.columns = new AppColumnsAPIImpl(ctx, workbook);
    this.records = new AppRecordsAPIImpl(ctx, workbook);
    this.relations = new AppRelationsAPIImpl(ctx, workbook);
    this.events = new AppEventsAPIImpl(ctx);
    // App data bindings API - manages app instances and their table bindings
    this.bindings = new AppBindingsAPIImpl();
    // Expose clipboard service from kernel services if available
    if (ctx.services?.clipboard) {
      this.clipboard = new AppClipboardAPIImpl(ctx);
    }
    // Expose undo service from kernel services if available
    this.undo = ctx.services?.undo;
  }

  async undoGroup<T>(fn: () => Promise<T> | T, description?: string): Promise<T> {
    if (description) {
      this.ctx.setPendingUndoDescription(description);
    }
    await this.ctx.computeBridge.beginUndoGroup();
    try {
      const result = await fn();
      return result;
    } finally {
      await this.ctx.computeBridge.endUndoGroup();
    }
  }
}

/**
 * Create an App Kernel API instance.
 */
export function createAppKernelAPI(options: AppKernelAPIOptions): AppKernelAPI {
  const ctx = options.ctx as DocumentContext;
  return new AppKernelAPI(ctx, options.workbook);
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Convert column letter(s) to index: 'A' = 0, 'Z' = 25, 'AA' = 26
 */
function letterToCol(letters: string): number {
  let result = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result - 1;
}
