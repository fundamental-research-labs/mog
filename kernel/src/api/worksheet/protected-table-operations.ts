import type { CellRange, SheetId, TableInfo } from '@mog-sdk/contracts/api';
import type { ColumnFilterCriteria } from '@mog-sdk/contracts/filter';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import type { FilterState } from '../../bridges/compute/compute-types.gen';
import { colToLetter, parseCellRange, toA1 } from '../internal/utils';
import { bridgeTableToTableInfo } from './operations/table-operations';

export type ProtectedTableOperation =
  | 'tables.add'
  | 'tables.remove'
  | 'tables.convertToRange'
  | 'tables.clear'
  | 'tables.rename'
  | 'tables.update.definition'
  | 'tables.update.style'
  | 'tables.update.behavior'
  | 'tables.filter.clear'
  | 'tables.filter.applyIcon'
  | 'tables.sort.apply'
  | 'tables.sort.reapply'
  | 'tables.resize'
  | 'tables.addColumn'
  | 'tables.removeColumn'
  | 'tables.toggleTotalsRow'
  | 'tables.toggleHeaderRow'
  | 'tables.applyAutoExpansion'
  | 'tables.setCalculatedColumn'
  | 'tables.clearCalculatedColumn'
  | 'tables.setTotalsFunction'
  | 'tables.addRow'
  | 'tables.deleteRow'
  | 'tables.deleteRows'
  | 'tables.setRowValues'
  | 'tables.setColumnValues'
  | 'filters.add'
  | 'filters.remove'
  | 'filters.setColumnFilter'
  | 'filters.clearColumnFilter'
  | 'filters.clearAllColumnFilters'
  | 'filters.apply'
  | 'filters.setSortState'
  | 'slicers.add'
  | 'slicers.remove'
  | 'slicers.clear'
  | 'slicers.duplicate'
  | 'slicers.update'
  | 'slicers.setSelection'
  | 'slicers.clearSelection';

type ProtectionOptions = NonNullable<
  Awaited<ReturnType<DocumentContext['computeBridge']['getSheetProtectionOptions']>>
>;

type ParsedRange = { startRow: number; startCol: number; endRow: number; endCol: number };

export interface ProtectedSheetReason {
  internalCode: 'API_PROTECTED_SHEET';
  operation: ProtectedTableOperation;
  tableName?: string;
  targetRange?: string;
  reason: string;
}

export function protectedSheetError(
  details: Omit<ProtectedSheetReason, 'internalCode'>,
): KernelError {
  const prefix = details.tableName
    ? `Cannot ${operationLabel(details.operation)} table "${details.tableName}"`
    : `Cannot ${operationLabel(details.operation)}`;
  return new KernelError('API_PROTECTED_SHEET', `${prefix}: ${details.reason}`, {
    context: {
      internalCode: 'API_PROTECTED_SHEET',
      ...details,
    },
  });
}

export async function getActiveProtectionOptions(
  ctx: DocumentContext,
  sheetId: SheetId,
): Promise<ProtectionOptions | null> {
  const getOptions = (ctx.computeBridge as Partial<DocumentContext['computeBridge']>)
    .getSheetProtectionOptions;
  if (!getOptions) return null;
  return getOptions.call(ctx.computeBridge, sheetId);
}

export async function assertUnprotectedTableDefinition(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: ProtectedTableOperation,
  tableName?: string,
  targetRange?: string,
): Promise<void> {
  if (!(await getActiveProtectionOptions(ctx, sheetId))) return;
  throw protectedSheetError({
    operation,
    tableName,
    targetRange,
    reason: 'Sheet protection does not allow changing table definitions.',
  });
}

export async function assertTableStyleAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: ProtectedTableOperation,
  table: TableInfo,
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  if (options.formatCells) return;
  throw protectedSheetError({
    operation,
    tableName: table.name,
    targetRange: table.range,
    reason: 'Sheet protection does not allow formatting this table.',
  });
}

export async function assertTableFilterCriteriaAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: ProtectedTableOperation,
  table: TableInfo,
  targetRange = table.range,
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  if (options.useAutoFilter) return;
  throw protectedSheetError({
    operation,
    tableName: table.name,
    targetRange,
    reason: 'Sheet protection does not allow filtering this table.',
  });
}

export async function assertTableSortAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: 'tables.sort.apply' | 'tables.sort.reapply',
  table: TableInfo,
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  const dataRange = getTableDataBodyRange(table);
  if (!options.sort) {
    throw protectedSheetError({
      operation,
      tableName: table.name,
      targetRange: dataRange ? rangeToA1(dataRange) : table.range,
      reason: 'Sheet protection does not allow sorting this table.',
    });
  }
  if (dataRange) {
    await assertRangeEditable(ctx, sheetId, operation, table.name, dataRange, 'sorting this table');
  }
}

export async function assertTableRowsInsertAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: 'tables.addRow',
  table: TableInfo,
  row: number,
  valueCount?: number,
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  if (!options.insertRows) {
    throw protectedSheetError({
      operation,
      tableName: table.name,
      targetRange: rowRangeToA1(
        row,
        parseTableRange(table).startCol,
        parseTableRange(table).endCol,
      ),
      reason: 'Sheet protection does not allow inserting rows in this table.',
    });
  }
  const parsed = parseTableRange(table);
  const endCol =
    valueCount != null && valueCount > 0
      ? Math.min(parsed.endCol, parsed.startCol + valueCount - 1)
      : parsed.endCol;
  await assertRangeEditable(
    ctx,
    sheetId,
    operation,
    table.name,
    { startRow: row, startCol: parsed.startCol, endRow: row, endCol },
    'inserting rows in this table',
  );
}

export async function assertTableRowsDeleteAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: 'tables.deleteRow' | 'tables.deleteRows',
  table: TableInfo,
  rows: number[],
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  if (!options.deleteRows) {
    throw protectedSheetError({
      operation,
      tableName: table.name,
      targetRange: rowsToA1(table, rows),
      reason: 'Sheet protection does not allow deleting rows from this table.',
    });
  }
  const parsed = parseTableRange(table);
  for (const row of rows) {
    await assertRangeEditable(
      ctx,
      sheetId,
      operation,
      table.name,
      { startRow: row, startCol: parsed.startCol, endRow: row, endCol: parsed.endCol },
      'deleting rows from this table',
    );
  }
}

export async function assertTableColumnDeltaAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: 'tables.addColumn' | 'tables.removeColumn',
  table: TableInfo,
  column: number,
  permission: 'insertColumns' | 'deleteColumns',
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  if (!options[permission]) {
    throw protectedSheetError({
      operation,
      tableName: table.name,
      targetRange: columnRangeToA1(table, column),
      reason:
        permission === 'insertColumns'
          ? 'Sheet protection does not allow inserting columns in this table.'
          : 'Sheet protection does not allow deleting columns from this table.',
    });
  }
  const parsed = parseTableRange(table);
  const col = Math.max(parsed.startCol, Math.min(parsed.endCol, parsed.startCol + column));
  await assertRangeEditable(
    ctx,
    sheetId,
    operation,
    table.name,
    { startRow: parsed.startRow, startCol: col, endRow: parsed.endRow, endCol: col },
    permission === 'insertColumns'
      ? 'inserting columns in this table'
      : 'deleting columns from this table',
  );
}

export async function assertTableResizeAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  table: TableInfo,
  nextRange: ParsedRange,
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  const current = parseTableRange(table);
  if (nextRange.startRow !== current.startRow || nextRange.startCol !== current.startCol) {
    throw protectedSheetError({
      operation: 'tables.resize',
      tableName: table.name,
      targetRange: rangeToA1(nextRange),
      reason: 'Sheet protection does not allow moving this table.',
    });
  }
  if (nextRange.endRow > current.endRow) {
    await requirePermission(
      ctx,
      sheetId,
      options,
      'insertRows',
      'tables.resize',
      table.name,
      rangeToA1(nextRange),
      'resizing this table to add rows',
    );
    await assertRangeEditable(
      ctx,
      sheetId,
      'tables.resize',
      table.name,
      {
        startRow: current.endRow + 1,
        startCol: current.startCol,
        endRow: nextRange.endRow,
        endCol: current.endCol,
      },
      'resizing this table to add rows',
    );
  }
  if (nextRange.endRow < current.endRow) {
    await requirePermission(
      ctx,
      sheetId,
      options,
      'deleteRows',
      'tables.resize',
      table.name,
      rangeToA1(nextRange),
      'resizing this table to remove rows',
    );
    await assertRangeEditable(
      ctx,
      sheetId,
      'tables.resize',
      table.name,
      {
        startRow: nextRange.endRow + 1,
        startCol: current.startCol,
        endRow: current.endRow,
        endCol: current.endCol,
      },
      'resizing this table to remove rows',
    );
  }
  if (nextRange.endCol > current.endCol) {
    await requirePermission(
      ctx,
      sheetId,
      options,
      'insertColumns',
      'tables.resize',
      table.name,
      rangeToA1(nextRange),
      'resizing this table to add columns',
    );
    await assertRangeEditable(
      ctx,
      sheetId,
      'tables.resize',
      table.name,
      {
        startRow: current.startRow,
        startCol: current.endCol + 1,
        endRow: nextRange.endRow,
        endCol: nextRange.endCol,
      },
      'resizing this table to add columns',
    );
  }
  if (nextRange.endCol < current.endCol) {
    await requirePermission(
      ctx,
      sheetId,
      options,
      'deleteColumns',
      'tables.resize',
      table.name,
      rangeToA1(nextRange),
      'resizing this table to remove columns',
    );
    await assertRangeEditable(
      ctx,
      sheetId,
      'tables.resize',
      table.name,
      {
        startRow: current.startRow,
        startCol: nextRange.endCol + 1,
        endRow: current.endRow,
        endCol: current.endCol,
      },
      'resizing this table to remove columns',
    );
  }
}

export async function assertTableCellsEditable(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: ProtectedTableOperation,
  table: TableInfo,
  cells: Array<{ row: number; col: number }>,
  action: string,
): Promise<void> {
  if (!(await getActiveProtectionOptions(ctx, sheetId))) return;
  for (const cell of cells) {
    if (!(await ctx.computeBridge.canEditCell(sheetId, cell.row, cell.col))) {
      throw protectedSheetError({
        operation,
        tableName: table.name,
        targetRange: `${toA1(cell.row, cell.col)}:${toA1(cell.row, cell.col)}`,
        reason: `Sheet protection does not allow ${action}.`,
      });
    }
  }
}

export async function assertCalculatedColumnAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: 'tables.setCalculatedColumn' | 'tables.clearCalculatedColumn',
  table: TableInfo,
  cells: Array<{ row: number; col: number }>,
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  if (!options.formatCells) {
    throw protectedSheetError({
      operation,
      tableName: table.name,
      targetRange: table.range,
      reason: 'Sheet protection does not allow formatting this table.',
    });
  }
  await assertTableCellsEditable(
    ctx,
    sheetId,
    operation,
    table,
    cells,
    'editing this calculated column',
  );
}

export async function assertSlicerObjectTopologyAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: ProtectedTableOperation,
  slicerName?: string,
): Promise<void> {
  if (!(await getActiveProtectionOptions(ctx, sheetId))) return;
  throw protectedSheetError({
    operation,
    tableName: slicerName,
    reason: 'Sheet protection does not allow changing slicer object topology.',
  });
}

export async function assertSlicerObjectEditAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: 'slicers.update',
  slicerName?: string,
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  if (options.editObjects) return;
  throw protectedSheetError({
    operation,
    tableName: slicerName,
    reason: 'Sheet protection does not allow editing slicer objects.',
  });
}

export async function assertFilterMutationAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: ProtectedTableOperation,
  filterId: string,
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  const filter = await findFilter(ctx, sheetId, filterId);
  if (!filter?.tableId) return;
  const table = await findTableByIdOrName(ctx, sheetId, filter.tableId);
  if (operation === 'filters.remove') {
    throw protectedSheetError({
      operation,
      tableName: table?.name ?? filter.tableId,
      targetRange: filterRangeToA1(filter),
      reason: 'Sheet protection does not allow removing table filters.',
    });
  }
  if (!options.useAutoFilter) {
    throw protectedSheetError({
      operation,
      tableName: table?.name ?? filter.tableId,
      targetRange: filterRangeToA1(filter),
      reason: 'Sheet protection does not allow filtering this table.',
    });
  }
}

export async function assertNoProtectedTableFilterCreation(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: 'filters.add',
  range: ParsedRange,
): Promise<void> {
  if (!(await getActiveProtectionOptions(ctx, sheetId))) return;
  const table = await findTableIntersectingRange(ctx, sheetId, range);
  if (!table) return;
  throw protectedSheetError({
    operation,
    tableName: table.name,
    targetRange: rangeToA1(range),
    reason: 'Sheet protection does not allow creating table filters.',
  });
}

export async function assertSlicerFilteringAllowed(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: 'slicers.setSelection' | 'slicers.clearSelection',
  slicerId: string,
): Promise<void> {
  const options = await getActiveProtectionOptions(ctx, sheetId);
  if (!options) return;
  const stored = await ctx.computeBridge.getSlicerState(sheetId, slicerId);
  if (!stored || stored.source.type !== 'table') return;
  const table = await findTableByIdOrName(ctx, sheetId, stored.source.tableId);
  if (!options.useAutoFilter) {
    throw protectedSheetError({
      operation,
      tableName: table?.name ?? stored.source.tableId,
      targetRange: table ? bridgeRangeToA1(table.range) : undefined,
      reason: 'Sheet protection does not allow filtering this table.',
    });
  }
  const filter = table ? await findFilterForTable(ctx, sheetId, table.id) : null;
  if (!filter) {
    throw protectedSheetError({
      operation,
      tableName: table?.name ?? stored.source.tableId,
      reason: 'Sheet protection requires an existing table AutoFilter for slicer filtering.',
    });
  }
}

export function parseTableRange(table: TableInfo): ParsedRange {
  const parsed = parseCellRange(table.range);
  if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid table range: ${table.range}`);
  return parsed;
}

export function getTableDataBodyRange(table: TableInfo): ParsedRange | null {
  const parsed = parseTableRange(table);
  const startRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
  const endRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;
  if (startRow > endRow) return null;
  return { startRow, startCol: parsed.startCol, endRow, endCol: parsed.endCol };
}

export function rangeToA1(range: ParsedRange): string {
  return `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`;
}

export function dataRowToSheetRow(table: TableInfo, index: number): number {
  const parsed = parseTableRange(table);
  return (table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow) + index;
}

async function assertRangeEditable(
  ctx: DocumentContext,
  sheetId: SheetId,
  operation: ProtectedTableOperation,
  tableName: string,
  range: ParsedRange,
  action: string,
): Promise<void> {
  for (let row = range.startRow; row <= range.endRow; row++) {
    for (let col = range.startCol; col <= range.endCol; col++) {
      if (!(await ctx.computeBridge.canEditCell(sheetId, row, col))) {
        throw protectedSheetError({
          operation,
          tableName,
          targetRange: rangeToA1(range),
          reason: `Sheet protection does not allow ${action}.`,
        });
      }
    }
  }
}

async function requirePermission(
  _ctx: DocumentContext,
  _sheetId: SheetId,
  options: ProtectionOptions,
  permission: keyof ProtectionOptions,
  operation: ProtectedTableOperation,
  tableName: string,
  targetRange: string,
  action: string,
): Promise<void> {
  if (options[permission]) return;
  throw protectedSheetError({
    operation,
    tableName,
    targetRange,
    reason: `Sheet protection does not allow ${action}.`,
  });
}

async function findFilter(
  ctx: DocumentContext,
  sheetId: SheetId,
  filterId: string,
): Promise<FilterState | null> {
  const filters = await ctx.computeBridge.getFiltersInSheet(sheetId);
  return filters.find((filter) => filter.id === filterId) ?? null;
}

async function findFilterForTable(
  ctx: DocumentContext,
  sheetId: SheetId,
  tableId: string,
): Promise<FilterState | null> {
  const filters = await ctx.computeBridge.getFiltersInSheet(sheetId);
  return filters.find((filter) => filter.tableId === tableId) ?? null;
}

async function findTableByIdOrName(
  ctx: DocumentContext,
  sheetId: SheetId,
  idOrName: string,
): Promise<TableInfo | null> {
  const tables = await ctx.computeBridge.getAllTablesInSheet(sheetId);
  const match = tables.find((table) => table.id === idOrName || table.name === idOrName);
  if (!match) return null;
  return bridgeTableToTableInfo(match);
}

async function findTableIntersectingRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: ParsedRange,
): Promise<TableInfo | null> {
  const tables = await ctx.computeBridge.getAllTablesInSheet(sheetId);
  for (const table of tables) {
    if (rangesIntersect(range, table.range)) {
      return bridgeTableToTableInfo(table);
    }
  }
  return null;
}

function rangesIntersect(a: ParsedRange, b: ParsedRange): boolean {
  return !(
    a.endRow < b.startRow ||
    a.startRow > b.endRow ||
    a.endCol < b.startCol ||
    a.startCol > b.endCol
  );
}

function bridgeRangeToA1(range: ParsedRange | CellRange | string): string {
  if (typeof range === 'string') return range;
  return rangeToA1(range);
}

function filterRangeToA1(filter: FilterState): string | undefined {
  if (
    filter.startRow == null ||
    filter.startCol == null ||
    filter.endRow == null ||
    filter.endCol == null
  ) {
    return undefined;
  }
  return rangeToA1({
    startRow: filter.startRow,
    startCol: filter.startCol,
    endRow: filter.endRow,
    endCol: filter.endCol,
  });
}

function rowRangeToA1(row: number, startCol: number, endCol: number): string {
  return `${colToLetter(startCol)}${row + 1}:${colToLetter(endCol)}${row + 1}`;
}

function rowsToA1(table: TableInfo, rows: number[]): string {
  const parsed = parseTableRange(table);
  if (rows.length === 0) return table.range;
  const min = Math.min(...rows);
  const max = Math.max(...rows);
  return `${colToLetter(parsed.startCol)}${min + 1}:${colToLetter(parsed.endCol)}${max + 1}`;
}

function columnRangeToA1(table: TableInfo, columnIndex: number): string {
  const parsed = parseTableRange(table);
  const col = Math.max(parsed.startCol, Math.min(parsed.endCol, parsed.startCol + columnIndex));
  return `${colToLetter(col)}${parsed.startRow + 1}:${colToLetter(col)}${parsed.endRow + 1}`;
}

function operationLabel(operation: ProtectedTableOperation): string {
  if (operation.includes('sort')) return 'sort';
  if (operation.includes('filter') || operation.startsWith('filters.')) return 'filter';
  if (operation === 'tables.convertToRange') return 'convert to range';
  if (operation.includes('addRow')) return 'add a row to';
  if (operation.includes('deleteRow')) return 'delete rows from';
  if (operation.includes('resize')) return 'resize';
  if (operation.startsWith('slicers.')) return 'update slicer for';
  return 'update';
}

export function filterCriteriaColumnCells(
  table: TableInfo,
  columnIndex: number,
  values: unknown[],
): Array<{ row: number; col: number }> {
  const body = getTableDataBodyRange(table);
  if (!body) return [];
  const col = parseTableRange(table).startCol + columnIndex;
  return values.map((_, i) => ({ row: body.startRow + i, col }));
}

export type { ColumnFilterCriteria };
