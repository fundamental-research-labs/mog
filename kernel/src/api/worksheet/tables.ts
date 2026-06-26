/**
 * WorksheetTablesImpl — Implementation of the WorksheetTables sub-API.
 *
 * Calls computeBridge directly, without the OperationResult/unwrap ceremony.
 * Pure helper functions from table-operations are still used for TableInfo
 * conversion and sub-range computation.
 */
import type {
  CellValue,
  FilterInfo,
  SheetId,
  TableAddReceipt,
  TableAddColumnReceipt,
  TableAddRowReceipt,
  TableAutoExpansionReceipt,
  TableClearReceipt,
  TableClearCalculatedColumnReceipt,
  TableConvertToRangeReceipt,
  TableColumn,
  TableDeleteRowReceipt,
  TableInfo,
  TableOptions,
  TableRenameColumnReceipt,
  TableRenameReceipt,
  TableUpdateOptions,
  TableRemoveColumnReceipt,
  TableRemoveReceipt,
  TableResizeReceipt,
  TableUpdateReceipt,
  TableRowCollection,
  TableSetCalculatedColumnReceipt,
  WorksheetTableEvents,
  WorksheetTableSort,
  WorksheetTables,
} from '@mog-sdk/contracts/api';
import type { CallableDisposable } from '@mog-sdk/contracts/core';
import type {
  TableCreatedEvent,
  TableDeletedEvent,
  TableSelectionChangedEvent,
  TableUpdatedEvent,
} from '@mog-sdk/contracts/events';
import type { TableConfig, TableStyle } from '@mog-sdk/contracts/tables';
import type { RangeCellData, TotalsFunction } from '../../bridges/compute/compute-types.gen';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { DocumentContext } from '../../context';
import * as Structures from '../../domain/sheets/structures';
import { KernelError } from '../../errors';
import { toDisposable } from '@mog/spreadsheet-utils/disposable';
import { normalizeCellValue } from '../internal/value-conversions';
import { resolveCell, resolveRange, resolveRangeToA1 } from '../internal/address-resolver';
import { colToLetter, letterToCol, parseCellRange } from '../internal/utils';
import {
  buildTableAddColumnReceipt,
  buildTableAddReceipt,
  buildTableAddRowReceipt,
  buildTableClearReceipt,
  buildTableConvertToRangeReceipt,
  buildTableDeleteRowReceipt,
  buildTableRemoveColumnReceipt,
  buildTableRemoveReceipt,
  buildTableRenameColumnReceipt,
  buildTableRenameReceipt,
  buildTableResizeReceipt,
  buildTableUpdateReceipt,
  bridgeTableToTableInfo,
  createGroupedTableMutationOptions,
  createTableMutationOptions,
  effectiveTableUpdateOptions,
  getDataBodyRangeFromInfo,
  getHeaderRowRangeFromInfo,
  getTableColumnDataCellsFromInfo,
  getTotalRowRangeFromInfo,
  type TableMutationOptions,
} from './operations/table-operations';
import { attachTableInfoMethods } from './operations/table-info-methods';
import { applyAutoExpansion as applyAutoExpansionOperation } from './operations/table-auto-expansion';
import {
  applyClearCalculatedColumnWithReceipt,
  applySetCalculatedColumnWithReceipt,
} from './operations/table-calculated-columns';
import { columnFilterCriteriaToCompute } from '../../bridges/compute/compute-wire-converters';
import * as FilterOps from './operations/filter-operations';
import { toCellInput } from './operations/cell-input';
import {
  assertCalculatedColumnAllowed,
  assertTableCellsEditable,
  assertTableColumnDeltaAllowed,
  assertTableFilterCriteriaAllowed,
  assertTableResizeAllowed,
  assertTableRowsDeleteAllowed,
  assertTableRowsInsertAllowed,
  assertTableSortAllowed,
  assertTableStyleAllowed,
  assertUnprotectedTableDefinition,
  dataRowToSheetRow,
  parseTableRange,
} from './protected-table-operations';
import {
  tableStyleForEventConfig,
  tableStyleIdForCompute,
} from '../../domain/tables/style-normalization';

export class WorksheetTablesImpl implements WorksheetTables {
  // TODO(4.8): Persist sort specs to document model via bridge (OOXML
  // TableSortState infrastructure exists but canonical Table type lacks it).
  private sortSpecCache = new Map<string, Array<{ columnIndex: number; ascending?: boolean }>>();

  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  private _tableMutationOptions(operationIdPrefix: string, groupId?: string): TableMutationOptions {
    return createTableMutationOptions(this.ctx, operationIdPrefix, this.sheetId, groupId);
  }

  private _groupedTableMutationOptions(operationIdPrefix: string): () => TableMutationOptions {
    return createGroupedTableMutationOptions(this.ctx, operationIdPrefix, this.sheetId);
  }

  private _undoGroupBridge(): {
    beginUndoGroup(admissionOptions?: TableMutationOptions): Promise<unknown>;
    endUndoGroup(admissionOptions?: TableMutationOptions): Promise<unknown>;
  } {
    return this.ctx.computeBridge as unknown as {
      beginUndoGroup(admissionOptions?: TableMutationOptions): Promise<unknown>;
      endUndoGroup(admissionOptions?: TableMutationOptions): Promise<unknown>;
    };
  }

  private emitTableCreated(table: TableInfo): void {
    this.ctx.eventBus.emit({
      type: 'table:created',
      timestamp: Date.now(),
      sheetId: this.sheetId,
      tableId: table.id,
      config: this.tableInfoToEventConfig(table),
      source: 'api',
    });
  }

  private emitTableUpdated(tableId: string, changes: TableUpdatedEvent['changes'] = {}): void {
    this.ctx.eventBus.emit({
      type: 'table:updated',
      timestamp: Date.now(),
      sheetId: this.sheetId,
      tableId,
      changes,
      source: 'api',
    });
  }

  private tableIdForEvent(table: TableInfo | null | undefined, tableName: string): string {
    if (!table) {
      throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    }
    return table.id;
  }

  private async resolveTableIdForName(tableName: string): Promise<string | null> {
    const table = await this.get(tableName);
    return table?.id ?? null;
  }

  private tableInfoToEventConfig(table: TableInfo): TableConfig {
    return {
      id: table.id,
      name: table.name,
      sheetId: this.sheetId,
      range: this.tableRangeFromA1(table.range),
      hasHeaderRow: table.hasHeaderRow,
      hasTotalRow: table.hasTotalsRow,
      columns: table.columns.map((col) => ({
        id: col.id,
        name: col.name,
        index: col.index,
        totalFunction: col.totalsFunction ?? undefined,
        totalFormula: col.totalsLabel ?? undefined,
        calculatedFormula: col.calculatedFormula,
      })),
      style: this.tableStyleFromPreset(table.style, {
        showBandedRows: table.bandedRows,
        showBandedColumns: table.bandedColumns,
        showFirstColumnHighlight: table.emphasizeFirstColumn,
        showLastColumnHighlight: table.emphasizeLastColumn,
      }),
      autoExpand: table.autoExpand,
      autoCalculatedColumns: table.autoCalculatedColumns,
      showFilterButtons: table.showFilterButtons,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private tableRangeFromA1(range: string): CellRange {
    const parsed = parseCellRange(range);
    if (!parsed) return { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    return {
      startRow: parsed.startRow,
      startCol: parsed.startCol,
      endRow: parsed.endRow,
      endCol: parsed.endCol,
    };
  }

  private tableStyleFromPreset(
    styleName: string | undefined,
    flags: Omit<TableStyle, 'preset' | 'custom'> = {},
  ): TableStyle {
    return tableStyleForEventConfig(styleName, flags);
  }

  private tableInfoWithMethods(table: TableInfo): TableInfo {
    return attachTableInfoMethods(table, {
      setTotalsRow: async (tableName, visible) => {
        await this.setShowTotals(tableName, visible);
      },
      setTotalsFunction: async (tableName, columnName, func) => {
        await this.setColumnTotalsFunction(tableName, columnName, func as TotalsFunction);
      },
    });
  }

  private async assertValidTableNameForRename(currentName: string, newName: string): Promise<void> {
    const existingNames = (await this.list())
      .map((table) => table.name)
      .filter((name) => name.toLowerCase() !== currentName.toLowerCase());
    const validation = await this.ctx.computeBridge.tableValidateTableName(newName, existingNames);
    if (!validation.valid) {
      throw new KernelError(
        'TABLE_INVALID_NAME',
        validation.reason ?? `Invalid table name: ${newName}`,
        {
          context: { currentName, newName },
          path: ['name'],
        },
      );
    }
  }

  private tableUpdateOptionsToEventChanges(
    updates: TableUpdateOptions,
  ): TableUpdatedEvent['changes'] {
    const changes: TableUpdatedEvent['changes'] = {};
    const style: TableStyle = {};

    if (updates.name !== undefined) changes.name = updates.name;
    if (updates.style !== undefined) {
      Object.assign(style, this.tableStyleFromPreset(updates.style));
    }
    if (updates.emphasizeFirstColumn !== undefined) {
      style.showFirstColumnHighlight = updates.emphasizeFirstColumn;
    }
    if (updates.emphasizeLastColumn !== undefined) {
      style.showLastColumnHighlight = updates.emphasizeLastColumn;
    }
    if (updates.bandedColumns !== undefined) {
      style.showBandedColumns = updates.bandedColumns;
    }
    if (updates.bandedRows !== undefined) {
      style.showBandedRows = updates.bandedRows;
    }
    if (updates.showFilterButtons !== undefined) {
      changes.showFilterButtons = updates.showFilterButtons;
    }
    if (updates.hasHeaderRow !== undefined) {
      changes.hasHeaderRow = updates.hasHeaderRow;
    }
    if (updates.hasTotalsRow !== undefined) {
      changes.hasTotalRow = updates.hasTotalsRow;
    }
    if (Object.keys(style).length > 0) {
      changes.style = style;
    }
    return changes;
  }

  private emitTableDeleted(tableId: string): void {
    this.ctx.eventBus.emit({
      type: 'table:deleted',
      timestamp: Date.now(),
      sheetId: this.sheetId,
      tableId,
      source: 'api',
    });
  }

  // ---------------------------------------------------------------------------
  // Sub-namespaces
  // ---------------------------------------------------------------------------

  private _sort: WorksheetTableSort | null = null;
  get sort(): WorksheetTableSort {
    if (!this._sort) {
      this._sort = {
        apply: (tableName, fields) => this.sortApply(tableName, fields),
        clear: (tableName) => this.sortClear(tableName),
        reapply: (tableName) => this.sortReapply(tableName),
      };
    }
    return this._sort;
  }

  private _events: WorksheetTableEvents | null = null;
  get events(): WorksheetTableEvents {
    if (!this._events) {
      this._events = {
        onTableAdded: (cb) => this.onTableAdded(cb),
        onTableDeleted: (cb) => this.onTableDeleted(cb),
        onTableChanged: (name, cb) => this.onTableChanged(name, cb),
        onSelectionChanged: (name, cb) => this.onSelectionChanged(name, cb),
      };
    }
    return this._events;
  }

  async add(range: string | CellRange, options?: TableOptions): Promise<TableAddReceipt> {
    this._ensureWritable('tables.add');
    const bounds = resolveRange(range);
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.add',
      options?.name,
      resolveRangeToA1(bounds),
    );
    const startRow = bounds.startRow;
    const startCol = bounds.startCol;
    const endRow = bounds.endRow;
    const endCol = bounds.endCol;

    await this.ctx.computeBridge.createTableLifecycle(
      this.sheetId,
      options?.name ?? null,
      startRow,
      startCol,
      endRow,
      endCol,
      [],
      options?.hasHeaders !== false,
      tableStyleIdForCompute(options?.style),
      this._tableMutationOptions('tables.add'),
    );

    // Re-fetch the table to get the complete info (with generated name, columns, etc.)
    const table = await this.ctx.computeBridge.getTableAtCell(this.sheetId, startRow, startCol);
    if (!table) {
      throw new KernelError('COMPUTE_ERROR', 'Table was created but could not be retrieved');
    }
    const tableInfo = bridgeTableToTableInfo(table);
    if (options?.autoExpand !== undefined || options?.autoCalculatedColumns !== undefined) {
      await this.update(tableInfo.name, {
        autoExpand: options.autoExpand,
        autoCalculatedColumns: options.autoCalculatedColumns,
      });
      const updated = await this.get(tableInfo.name);
      if (updated) {
        this.emitTableCreated(updated);
        return buildTableAddReceipt(this.sheetId, updated);
      }
    }
    this.emitTableCreated(tableInfo);
    return buildTableAddReceipt(this.sheetId, tableInfo);
  }

  async get(name: string): Promise<TableInfo | null> {
    try {
      const table = await this.ctx.computeBridge.getTableByName(name);
      if (!table) return null;
      return this.tableInfoWithMethods(bridgeTableToTableInfo(table));
    } catch {
      return null;
    }
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== null;
  }

  async list(): Promise<TableInfo[]> {
    const tables = await this.ctx.computeBridge.getAllTablesInSheet(this.sheetId);
    return tables.map((t) => this.tableInfoWithMethods(bridgeTableToTableInfo(t)));
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async getItemAt(index: number): Promise<TableInfo | null> {
    const tables = await this.list();
    return tables[index] ?? null;
  }

  async getFirst(): Promise<TableInfo | null> {
    return (await this.list())[0] ?? null;
  }

  async getColumnByName(tableName: string, columnName: string): Promise<TableColumn | null> {
    const table = await this.get(tableName);
    if (!table) return null;
    return table.columns.find((c) => c.name === columnName) ?? null;
  }

  async remove(
    name: string,
    nextMutationOptions?: () => TableMutationOptions,
  ): Promise<TableRemoveReceipt> {
    const table = await this.get(name);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${name}`);
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.remove',
      name,
      table.range,
    );
    await this.ctx.computeBridge.deleteTable(
      name,
      nextMutationOptions?.() ?? this._tableMutationOptions('tables.remove'),
    );
    this.sortSpecCache.delete(name);
    this.emitTableDeleted(table.id);
    return buildTableRemoveReceipt(this.sheetId, table);
  }

  async convertToRange(name: string): Promise<TableConvertToRangeReceipt> {
    const table = await this.get(name);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${name}`);
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.convertToRange',
      name,
      table.range,
    );
    const result = await this.ctx.computeBridge.convertTableToRange(
      name,
      this._tableMutationOptions('tables.convertToRange'),
    );
    this.sortSpecCache.delete(name);
    const convertedCount =
      typeof result.data === 'number'
        ? result.data
        : typeof result.data === 'string'
          ? Number(result.data)
          : 0;
    this.ctx.eventBus.emit({
      type: 'table:converted-to-range',
      timestamp: Date.now(),
      sheetId: this.sheetId,
      tableId: table.id,
      tableName: name,
      range: this.tableRangeFromA1(table.range),
      affectedFormulaCount: Number.isFinite(convertedCount) ? convertedCount : 0,
      source: 'api',
    });
    this.emitTableDeleted(table.id);
    return buildTableConvertToRangeReceipt({
      sheetId: this.sheetId,
      table,
      affectedFormulaCount: Number.isFinite(convertedCount) ? convertedCount : 0,
    });
  }

  async clear(): Promise<TableClearReceipt> {
    const tables = await this.list();
    if (tables.length === 0) {
      return buildTableClearReceipt(this.sheetId, tables);
    }
    for (const table of tables) {
      await assertUnprotectedTableDefinition(
        this.ctx,
        this.sheetId,
        'tables.clear',
        table.name,
        table.range,
      );
    }
    const nextOptions = this._groupedTableMutationOptions('tables.clear');
    for (const table of tables) {
      await this.remove(table.name, nextOptions);
    }
    return buildTableClearReceipt(this.sheetId, tables);
  }

  async rename(oldName: string, newName: string): Promise<TableRenameReceipt> {
    const table = await this.get(oldName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${oldName}`);
    if (oldName === newName) {
      return buildTableRenameReceipt({
        sheetId: this.sheetId,
        table,
        oldName,
        newName,
        status: 'noOp',
      });
    }
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.rename',
      oldName,
      table.range,
    );
    await this.assertValidTableNameForRename(oldName, newName);
    await this.ctx.computeBridge.renameTable(
      oldName,
      newName,
      this._tableMutationOptions('tables.rename'),
    );
    const cached = this.sortSpecCache.get(oldName);
    if (cached) {
      this.sortSpecCache.delete(oldName);
      this.sortSpecCache.set(newName, cached);
    }
    this.emitTableUpdated(table.id, { name: newName });
    return buildTableRenameReceipt({
      sheetId: this.sheetId,
      table,
      oldName,
      newName,
      status: 'applied',
    });
  }

  async update(tableName: string, updates: TableUpdateOptions): Promise<TableUpdateReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const effectiveUpdates = effectiveTableUpdateOptions(table, updates);
    if (Object.keys(effectiveUpdates).length === 0) {
      return buildTableUpdateReceipt({
        sheetId: this.sheetId,
        table,
        updates: effectiveUpdates,
        status: 'noOp',
      });
    }
    if (
      effectiveUpdates.name !== undefined ||
      effectiveUpdates.showFilterButtons !== undefined ||
      effectiveUpdates.hasHeaderRow !== undefined ||
      effectiveUpdates.hasTotalsRow !== undefined
    ) {
      await assertUnprotectedTableDefinition(
        this.ctx,
        this.sheetId,
        'tables.update.definition',
        tableName,
        table.range,
      );
    }
    if (
      effectiveUpdates.autoExpand !== undefined ||
      effectiveUpdates.autoCalculatedColumns !== undefined
    ) {
      await assertUnprotectedTableDefinition(
        this.ctx,
        this.sheetId,
        'tables.update.behavior',
        tableName,
        table.range,
      );
    }
    if (
      effectiveUpdates.style !== undefined ||
      effectiveUpdates.emphasizeFirstColumn !== undefined ||
      effectiveUpdates.emphasizeLastColumn !== undefined ||
      effectiveUpdates.bandedColumns !== undefined ||
      effectiveUpdates.bandedRows !== undefined
    ) {
      await assertTableStyleAllowed(this.ctx, this.sheetId, 'tables.update.style', table);
    }
    if (effectiveUpdates.name !== undefined) {
      await this.assertValidTableNameForRename(tableName, effectiveUpdates.name);
    }
    const nextOptions = this._groupedTableMutationOptions('tables.update');
    if (effectiveUpdates.style !== undefined) {
      await this.ctx.computeBridge.setTableStyle(
        tableName,
        tableStyleIdForCompute(effectiveUpdates.style) ?? effectiveUpdates.style,
        nextOptions(),
      );
    }
    if (effectiveUpdates.name !== undefined) {
      await this.ctx.computeBridge.renameTable(tableName, effectiveUpdates.name, nextOptions());
    }
    // Boolean option updates via setTableBoolOption
    // Keys match Rust TableBoolOption names directly
    const boolOptions = [
      'emphasizeFirstColumn',
      'emphasizeLastColumn',
      'bandedColumns',
      'bandedRows',
      'showFilterButtons',
    ] as const;
    for (const key of boolOptions) {
      if (effectiveUpdates[key] !== undefined) {
        await this.ctx.computeBridge.setTableBoolOption(
          tableName,
          key,
          effectiveUpdates[key],
          nextOptions(),
        );
      }
    }
    if (effectiveUpdates.autoExpand !== undefined) {
      await this.ctx.computeBridge.setTableAutoExpand(
        tableName,
        effectiveUpdates.autoExpand,
        nextOptions(),
      );
    }
    if (effectiveUpdates.autoCalculatedColumns !== undefined) {
      await this.ctx.computeBridge.setTableAutoCalculatedColumns(
        tableName,
        effectiveUpdates.autoCalculatedColumns,
        nextOptions(),
      );
    }
    // Headers/totals with set semantics (not toggle)
    if (effectiveUpdates.hasHeaderRow !== undefined) {
      await this.setShowHeaders(tableName, effectiveUpdates.hasHeaderRow, nextOptions);
    }
    if (effectiveUpdates.hasTotalsRow !== undefined) {
      await this.setShowTotals(tableName, effectiveUpdates.hasTotalsRow, nextOptions);
    }
    this.emitTableUpdated(table.id, this.tableUpdateOptionsToEventChanges(effectiveUpdates));
    return buildTableUpdateReceipt({
      sheetId: this.sheetId,
      table,
      updates: effectiveUpdates,
      status: 'applied',
    });
  }

  async getAtCell(a: string | number, b?: number): Promise<TableInfo | null> {
    const { row, col } = resolveCell(a, b);
    const table = await this.ctx.computeBridge.getTableAtCell(this.sheetId, row, col);
    if (!table) return null;
    return bridgeTableToTableInfo(table);
  }

  async clearFilters(tableName: string): Promise<void> {
    // Look up the table to find its range, then find the overlapping filter and clear it.
    const table = await this.get(tableName);
    if (!table) {
      throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    }

    const parsed = table.range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (!parsed) {
      throw new KernelError('COMPUTE_ERROR', `Invalid table range: ${table.range}`);
    }

    const startCol = letterToCol(parsed[1]);
    const startRow = parseInt(parsed[2], 10) - 1;
    const endCol = letterToCol(parsed[3]);
    const endRow = parseInt(parsed[4], 10) - 1;

    const filter = await FilterOps.getFilterForRange(this.ctx, this.sheetId, {
      startRow,
      startCol,
      endRow,
      endCol,
    });
    if (!filter) {
      // No filter on this table — nothing to clear
      return;
    }

    await assertTableFilterCriteriaAllowed(this.ctx, this.sheetId, 'tables.filter.clear', table);
    await this.ctx.awaitMaterialized?.('allSheets');
    await this.ctx.computeBridge.clearAllColumnFilters(
      this.sheetId,
      filter.id,
      this._tableMutationOptions('tables.clearFilters'),
    );
  }

  async applyIconFilter(
    tableName: string,
    columnIndex: number,
    icon: { set: string; index: number },
  ): Promise<void> {
    const table = await this.get(tableName);
    if (!table) {
      throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    }

    // Parse the table range to find the overlapping filter
    const parsed = table.range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (!parsed) {
      throw new KernelError('COMPUTE_ERROR', `Invalid table range: ${table.range}`);
    }

    const startCol = letterToCol(parsed[1]);
    const startRow = parseInt(parsed[2], 10) - 1;
    const endCol = letterToCol(parsed[3]);
    const endRow = parseInt(parsed[4], 10) - 1;

    const filter = await FilterOps.getFilterForRange(this.ctx, this.sheetId, {
      startRow,
      startCol,
      endRow,
      endCol,
    });
    if (!filter) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `No filter found for table "${tableName}". Ensure the table has filter buttons enabled.`,
      );
    }

    await assertTableFilterCriteriaAllowed(
      this.ctx,
      this.sheetId,
      'tables.filter.applyIcon',
      table,
    );

    // The header column for the filter is the table's start column + the column index
    const headerCol = startCol + columnIndex;

    // Build icon filter criteria and set it on the column
    const criteria: import('@mog-sdk/contracts/filter').ColumnFilterCriteria = {
      type: 'icon',
      iconFilter: {
        iconSet: icon.set,
        iconIndex: icon.index,
      },
    };

    await this.ctx.awaitMaterialized?.('allSheets');
    const nextOptions = this._groupedTableMutationOptions('tables.applyIconFilter');
    await this.ctx.computeBridge.setColumnFilter(
      this.sheetId,
      filter.id,
      headerCol,
      columnFilterCriteriaToCompute(criteria),
      nextOptions(),
    );

    // Apply the filter so hidden-row state is updated.
    // Note: Icon filtering at the Rust level returns all-visible;
    // real icon evaluation happens in the bridge layer when available.
    await this.ctx.computeBridge.applyFilter(this.sheetId, filter.id, nextOptions());
  }

  async setStylePreset(tableName: string, preset: string): Promise<TableUpdateReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const effectiveUpdates = effectiveTableUpdateOptions(table, { style: preset });
    if (Object.keys(effectiveUpdates).length === 0) {
      return buildTableUpdateReceipt({
        sheetId: this.sheetId,
        table,
        updates: effectiveUpdates,
        status: 'noOp',
      });
    }
    await assertTableStyleAllowed(this.ctx, this.sheetId, 'tables.update.style', table);
    const style = tableStyleIdForCompute(preset) ?? preset;
    await this.ctx.computeBridge.setTableStyle(
      tableName,
      style,
      this._tableMutationOptions('tables.setStylePreset'),
    );
    this.emitTableUpdated(table.id, { style: this.tableStyleFromPreset(style) });
    return buildTableUpdateReceipt({
      sheetId: this.sheetId,
      table,
      updates: effectiveUpdates,
      status: 'applied',
      details: { style },
    });
  }

  async resize(name: string, newRange: string | CellRange): Promise<TableResizeReceipt> {
    const bounds = resolveRange(newRange);
    const table = await this.get(name);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${name}`);
    const rangeStr = resolveRangeToA1(bounds);
    if (rangeStr === table.range) {
      return buildTableResizeReceipt({
        sheetId: this.sheetId,
        table,
        oldRange: table.range,
        newRange: rangeStr,
        status: 'noOp',
      });
    }
    await assertTableResizeAllowed(this.ctx, this.sheetId, table, bounds);
    await this.ctx.computeBridge.resizeTable(
      name,
      bounds.startRow,
      bounds.startCol,
      bounds.endRow,
      bounds.endCol,
      this._tableMutationOptions('tables.resize'),
    );
    this.emitTableUpdated(table.id, { range: bounds });
    return buildTableResizeReceipt({
      sheetId: this.sheetId,
      table: { ...table, range: rangeStr },
      oldRange: table.range,
      newRange: rangeStr,
      status: 'applied',
    });
  }

  async addColumn(
    name: string,
    columnName: string,
    position?: number,
  ): Promise<TableAddColumnReceipt> {
    const table = await this.get(name);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${name}`);
    const bounds = parseCellRange(table.range);
    if (!bounds) throw new KernelError('COMPUTE_ERROR', `Invalid table range: ${table.range}`);
    const actualPosition = Math.max(
      0,
      Math.min(position ?? table.columns.length, table.columns.length),
    );
    const targetCol = bounds.startCol + actualPosition;
    await assertTableColumnDeltaAllowed(
      this.ctx,
      this.sheetId,
      'tables.addColumn',
      table,
      actualPosition,
      'insertColumns',
    );

    const nextOptions = this._groupedTableMutationOptions('tables.addColumn');
    await this._undoGroupBridge().beginUndoGroup(nextOptions());
    try {
      await Structures.insertColumns(this.ctx, this.sheetId, null, targetCol, 1, 'api');
      await this.ctx.computeBridge.addTableColumn(name, columnName, actualPosition, nextOptions());
      await this.ctx.computeBridge.resizeTable(
        name,
        bounds.startRow,
        bounds.startCol,
        bounds.endRow,
        bounds.endCol + 1,
        nextOptions(),
      );
    } finally {
      await this._undoGroupBridge().endUndoGroup(nextOptions());
    }
    this.emitTableUpdated(table.id);
    const columnLetter = colToLetter(targetCol);
    const columnRange = `${columnLetter}${bounds.startRow + 1}:${columnLetter}${bounds.endRow + 1}`;
    const newTableRange = `${colToLetter(bounds.startCol)}${bounds.startRow + 1}:${colToLetter(
      bounds.endCol + 1,
    )}${bounds.endRow + 1}`;
    return buildTableAddColumnReceipt({
      sheetId: this.sheetId,
      table: {
        ...table,
        range: newTableRange,
      },
      columnName,
      position: actualPosition,
      range: columnRange,
    });
  }

  async renameColumn(
    name: string,
    columnIndex: number,
    newColumnName: string,
  ): Promise<TableRenameColumnReceipt> {
    const table = await this.get(name);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${name}`);
    const oldColumnName = table.columns[columnIndex]?.name;
    if (oldColumnName === undefined) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Column index ${columnIndex} out of range (table has ${table.columns.length} columns)`,
      );
    }
    if (oldColumnName === newColumnName) {
      return buildTableRenameColumnReceipt({
        sheetId: this.sheetId,
        table,
        columnIndex,
        oldColumnName,
        newColumnName,
        status: 'noOp',
      });
    }
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.renameColumn',
      name,
      table.range,
    );
    await this.ctx.computeBridge.renameTableColumn(
      name,
      columnIndex,
      newColumnName,
      this._tableMutationOptions('tables.renameColumn'),
    );
    this.emitTableUpdated(table.id);
    return buildTableRenameColumnReceipt({
      sheetId: this.sheetId,
      table,
      columnIndex,
      oldColumnName,
      newColumnName,
      status: 'applied',
    });
  }

  async removeColumn(name: string, columnIndex: number): Promise<TableRemoveColumnReceipt> {
    const table = await this.get(name);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${name}`);
    const bounds = parseCellRange(table.range);
    if (!bounds) throw new KernelError('COMPUTE_ERROR', `Invalid table range: ${table.range}`);
    if (columnIndex < 0 || columnIndex >= table.columns.length) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Column index ${columnIndex} out of range (table has ${table.columns.length} columns)`,
      );
    }
    if (table.columns.length <= 1) {
      throw new KernelError('COMPUTE_ERROR', `Cannot remove the last column from table "${name}"`);
    }
    await assertTableColumnDeltaAllowed(
      this.ctx,
      this.sheetId,
      'tables.removeColumn',
      table,
      columnIndex,
      'deleteColumns',
    );
    const nextOptions = this._groupedTableMutationOptions('tables.removeColumn');
    await this._undoGroupBridge().beginUndoGroup(nextOptions());
    try {
      await Structures.deleteColumns(
        this.ctx,
        this.sheetId,
        null,
        bounds.startCol + columnIndex,
        1,
        'api',
      );
      await this.ctx.computeBridge.removeTableColumn(name, columnIndex, nextOptions());
      await this.ctx.computeBridge.resizeTable(
        name,
        bounds.startRow,
        bounds.startCol,
        bounds.endRow,
        bounds.endCol - 1,
        nextOptions(),
      );
    } finally {
      await this._undoGroupBridge().endUndoGroup(nextOptions());
    }
    this.emitTableUpdated(table.id);
    const columnName = table.columns[columnIndex]?.name ?? '';
    const columnLetter = colToLetter(bounds.startCol + columnIndex);
    const columnRange = `${columnLetter}${bounds.startRow + 1}:${columnLetter}${bounds.endRow + 1}`;
    const newTableRange = `${colToLetter(bounds.startCol)}${bounds.startRow + 1}:${colToLetter(
      bounds.endCol - 1,
    )}${bounds.endRow + 1}`;
    return buildTableRemoveColumnReceipt({
      sheetId: this.sheetId,
      table: {
        ...table,
        range: newTableRange,
      },
      columnIndex,
      columnName,
      range: columnRange,
    });
  }

  /** @deprecated Use {@link setShowTotals} instead. */
  async toggleTotalsRow(name: string): Promise<TableUpdateReceipt> {
    const table = await this.get(name);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${name}`);
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.toggleTotalsRow',
      name,
      table.range,
    );
    await this.ctx.computeBridge.toggleTotalsRow(
      name,
      this._tableMutationOptions('tables.setShowTotals'),
    );
    const updates = { hasTotalsRow: !table.hasTotalsRow };
    this.emitTableUpdated(table.id, { hasTotalRow: updates.hasTotalsRow });
    return buildTableUpdateReceipt({
      sheetId: this.sheetId,
      table,
      updates,
      status: 'applied',
    });
  }

  /** @deprecated Use {@link setShowHeaders} instead. */
  async toggleHeaderRow(name: string): Promise<TableUpdateReceipt> {
    const table = await this.get(name);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${name}`);
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.toggleHeaderRow',
      name,
      table.range,
    );
    await this.ctx.computeBridge.toggleHeaderRow(
      name,
      this._tableMutationOptions('tables.setShowHeaders'),
    );
    const updates = { hasHeaderRow: !table.hasHeaderRow };
    this.emitTableUpdated(table.id, { hasHeaderRow: updates.hasHeaderRow });
    return buildTableUpdateReceipt({
      sheetId: this.sheetId,
      table,
      updates,
      status: 'applied',
    });
  }

  async applyAutoExpansion(tableName: string): Promise<TableAutoExpansionReceipt> {
    const result = await applyAutoExpansionOperation(this.ctx, this.sheetId, tableName, {
      assertAllowed: (table) =>
        assertUnprotectedTableDefinition(
          this.ctx,
          this.sheetId,
          'tables.applyAutoExpansion',
          tableName,
          table.range,
        ),
      unsupportedReasonForAssertError: 'protectedRegion',
    });
    if (!result.success) {
      throw result.error;
    }

    const receipt = result.data;
    if (
      receipt.tableId &&
      receipt.previousRange &&
      receipt.newRange &&
      receipt.newRange !== receipt.previousRange
    ) {
      this.emitTableUpdated(receipt.tableId, { range: this.tableRangeFromA1(receipt.newRange) });
    }
    return receipt;
  }

  async setCalculatedColumn(
    tableName: string,
    colIndex: number,
    formula: string,
  ): Promise<TableSetCalculatedColumnReceipt> {
    const table = await this.get(tableName);
    if (!table) {
      throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    }

    const cells = [...getTableColumnDataCellsFromInfo(table, colIndex)].sort((a, b) =>
      a.row === b.row ? a.col - b.col : a.row - b.row,
    );
    await assertCalculatedColumnAllowed(
      this.ctx,
      this.sheetId,
      'tables.setCalculatedColumn',
      table,
      cells,
    );
    const receipt = await applySetCalculatedColumnWithReceipt(
      this.ctx,
      this.sheetId,
      table,
      tableName,
      colIndex,
      formula,
      cells,
    );
    if (receipt.status !== 'noOp') this.emitTableUpdated(table.id);
    return receipt;
  }

  async clearCalculatedColumn(
    tableName: string,
    colIndex: number,
  ): Promise<TableClearCalculatedColumnReceipt> {
    const table = await this.get(tableName);
    if (!table) {
      throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    }

    const cells = [...getTableColumnDataCellsFromInfo(table, colIndex)].sort((a, b) =>
      a.row === b.row ? a.col - b.col : a.row - b.row,
    );
    await assertCalculatedColumnAllowed(
      this.ctx,
      this.sheetId,
      'tables.clearCalculatedColumn',
      table,
      cells,
    );
    const receipt = await applyClearCalculatedColumnWithReceipt(
      this.ctx,
      this.sheetId,
      table,
      tableName,
      colIndex,
      cells,
    );
    if (receipt.status !== 'noOp') this.emitTableUpdated(table.id);
    return receipt;
  }

  async getDataBodyRange(name: string): Promise<string | null> {
    const table = await this.get(name);
    if (!table) return null;
    return getDataBodyRangeFromInfo(table);
  }

  async getHeaderRowRange(name: string): Promise<string | null> {
    const table = await this.get(name);
    if (!table) return null;
    return getHeaderRowRangeFromInfo(table);
  }

  async getTotalRowRange(name: string): Promise<string | null> {
    const table = await this.get(name);
    if (!table) return null;
    return getTotalRowRangeFromInfo(table);
  }

  // ---------------------------------------------------------------------------
  // Boolean option setters
  // ---------------------------------------------------------------------------

  async setHighlightFirstColumn(tableName: string, value: boolean): Promise<TableUpdateReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const updates = effectiveTableUpdateOptions(table, { emphasizeFirstColumn: value });
    if (Object.keys(updates).length === 0) {
      return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'noOp' });
    }
    await assertTableStyleAllowed(this.ctx, this.sheetId, 'tables.update.style', table);
    await this.ctx.computeBridge.setTableBoolOption(
      tableName,
      'emphasizeFirstColumn',
      value,
      this._tableMutationOptions('tables.setHighlightFirstColumn'),
    );
    this.emitTableUpdated(table.id, { style: { showFirstColumnHighlight: value } });
    return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'applied' });
  }

  async setHighlightLastColumn(tableName: string, value: boolean): Promise<TableUpdateReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const updates = effectiveTableUpdateOptions(table, { emphasizeLastColumn: value });
    if (Object.keys(updates).length === 0) {
      return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'noOp' });
    }
    await assertTableStyleAllowed(this.ctx, this.sheetId, 'tables.update.style', table);
    await this.ctx.computeBridge.setTableBoolOption(
      tableName,
      'emphasizeLastColumn',
      value,
      this._tableMutationOptions('tables.setHighlightLastColumn'),
    );
    this.emitTableUpdated(table.id, { style: { showLastColumnHighlight: value } });
    return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'applied' });
  }

  async setShowBandedColumns(tableName: string, value: boolean): Promise<TableUpdateReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const updates = effectiveTableUpdateOptions(table, { bandedColumns: value });
    if (Object.keys(updates).length === 0) {
      return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'noOp' });
    }
    await assertTableStyleAllowed(this.ctx, this.sheetId, 'tables.update.style', table);
    await this.ctx.computeBridge.setTableBoolOption(
      tableName,
      'bandedColumns',
      value,
      this._tableMutationOptions('tables.setShowBandedColumns'),
    );
    this.emitTableUpdated(table.id, { style: { showBandedColumns: value } });
    return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'applied' });
  }

  async setShowBandedRows(tableName: string, value: boolean): Promise<TableUpdateReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const updates = effectiveTableUpdateOptions(table, { bandedRows: value });
    if (Object.keys(updates).length === 0) {
      return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'noOp' });
    }
    await assertTableStyleAllowed(this.ctx, this.sheetId, 'tables.update.style', table);
    await this.ctx.computeBridge.setTableBoolOption(
      tableName,
      'bandedRows',
      value,
      this._tableMutationOptions('tables.setShowBandedRows'),
    );
    this.emitTableUpdated(table.id, { style: { showBandedRows: value } });
    return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'applied' });
  }

  async setShowFilterButton(tableName: string, value: boolean): Promise<TableUpdateReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const updates = effectiveTableUpdateOptions(table, { showFilterButtons: value });
    if (Object.keys(updates).length === 0) {
      return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'noOp' });
    }
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.update.definition',
      tableName,
      table.range,
    );
    await this.ctx.computeBridge.setTableBoolOption(
      tableName,
      'showFilterButtons',
      value,
      this._tableMutationOptions('tables.setShowFilterButton'),
    );
    this.emitTableUpdated(table.id, { showFilterButtons: value });
    return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'applied' });
  }

  // ---------------------------------------------------------------------------
  // Set semantics for headers/totals
  // ---------------------------------------------------------------------------

  async setShowHeaders(
    tableName: string,
    visible: boolean,
    nextMutationOptions?: () => TableMutationOptions,
  ): Promise<TableUpdateReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const updates = effectiveTableUpdateOptions(table, { hasHeaderRow: visible });
    if (Object.keys(updates).length === 0) {
      return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'noOp' });
    }
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.toggleHeaderRow',
      tableName,
      table.range,
    );
    await this.ctx.computeBridge.toggleHeaderRow(
      tableName,
      nextMutationOptions?.() ?? this._tableMutationOptions('tables.setShowHeaders'),
    );
    this.emitTableUpdated(table.id, { hasHeaderRow: visible });
    return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'applied' });
  }

  async setShowTotals(
    tableName: string,
    visible: boolean,
    nextMutationOptions?: () => TableMutationOptions,
  ): Promise<TableUpdateReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const updates = effectiveTableUpdateOptions(table, { hasTotalsRow: visible });
    if (Object.keys(updates).length === 0) {
      return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'noOp' });
    }
    await assertUnprotectedTableDefinition(
      this.ctx,
      this.sheetId,
      'tables.toggleTotalsRow',
      tableName,
      table.range,
    );
    await this.ctx.computeBridge.toggleTotalsRow(
      tableName,
      nextMutationOptions?.() ?? this._tableMutationOptions('tables.setShowTotals'),
    );
    this.emitTableUpdated(table.id, { hasTotalRow: visible });
    return buildTableUpdateReceipt({ sheetId: this.sheetId, table, updates, status: 'applied' });
  }

  /**
   * Set the totals aggregation function for a named column, writing the
   * generated SUBTOTAL formula directly into the totals row cell.
   *
   * The totals row must already be enabled (call setShowTotals/setTotalsRow
   * first).  If the totals row is not yet enabled this method enables it
   * automatically.
   */
  private async setColumnTotalsFunction(
    tableName: string,
    columnName: string,
    func: TotalsFunction,
  ): Promise<void> {
    const initialTable = await this.get(tableName);
    if (!initialTable) return;
    let nextMutationOptions: (() => TableMutationOptions) | undefined;
    if (!initialTable.hasTotalsRow) {
      await assertUnprotectedTableDefinition(
        this.ctx,
        this.sheetId,
        'tables.setTotalsFunction',
        tableName,
        initialTable.range,
      );
      nextMutationOptions = this._groupedTableMutationOptions('tables.setTotalsFunction');
      await this.setShowTotals(tableName, true, nextMutationOptions);
    }

    const table = initialTable.hasTotalsRow ? initialTable : await this.get(tableName);
    if (!table) return;

    // Locate the column within the table.
    const colIdx = table.columns.findIndex((c: TableColumn) => c.name === columnName);
    if (colIdx === -1) return;
    const parsed = parseCellRange(table.range);
    if (!parsed) return;

    // Map TotalsFunction to SUBTOTAL function number (hidden-row-excluding variants).
    const funcNumMap: Record<string, number> = {
      sum: 109,
      average: 101,
      count: 102,
      countnums: 102,
      min: 105,
      max: 104,
      stddev: 107,
      stddevp: 108,
      var: 110,
      varp: 111,
    };
    const funcNum = funcNumMap[func.toLowerCase()];

    // Use table-qualified structured reference: =SUBTOTAL(109,TableName[ColumnName]).
    // The WASM evaluator resolves Table1[Amount] correctly; bare [Amount] gives #NAME?.
    // tableGetTotalsFormula returns the unqualified form, so we build it ourselves.
    const formula =
      funcNum === undefined ? '' : `=SUBTOTAL(${funcNum},${tableName}[${columnName}])`;

    // Write into the totals row cell.
    const totalsCol = parsed.startCol + colIdx;
    const totalsRow = parsed.endRow;
    await assertTableCellsEditable(
      this.ctx,
      this.sheetId,
      'tables.setTotalsFunction',
      table,
      [{ row: totalsRow, col: totalsCol }],
      'editing this totals cell',
    );

    const computeTable = await this.ctx.computeBridge.getTableByName(tableName);
    const computeColumn = computeTable?.columns[colIdx];
    nextMutationOptions ??= this._groupedTableMutationOptions('tables.setTotalsFunction');
    if (computeColumn) {
      await this.ctx.computeBridge.setTableTotalsFunction(
        tableName,
        computeColumn.id,
        func,
        nextMutationOptions(),
      );
    }

    // WASM normalises ANY formula written to a freshly-created totals cell to the
    // unqualified structured-reference form ([Amount]), stripping the table qualifier
    // and producing #NAME?. Writing a plain 0 first "de-registers" the fresh-cell
    // normalisation flag; the subsequent formula write then stores the table-qualified
    // form (Table1[Amount]) intact, which evaluates correctly.
    await this.ctx.computeBridge.setCellsByPosition(
      this.sheetId,
      [{ row: totalsRow, col: totalsCol, input: { kind: 'parse', text: '0' } }],
      nextMutationOptions(),
    );
    await this.ctx.computeBridge.setCellsByPosition(
      this.sheetId,
      [{ row: totalsRow, col: totalsCol, input: { kind: 'parse', text: formula } }],
      nextMutationOptions(),
    );
  }

  // ---------------------------------------------------------------------------
  // Row CRUD
  // ---------------------------------------------------------------------------

  async addRow(
    tableName: string,
    index?: number,
    values?: CellValue[],
  ): Promise<TableAddRowReceipt> {
    const before = await this.get(tableName);
    if (!before) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const beforeRange = parseTableRange(before);
    const rowCount = await this.getRowCount(tableName);
    const insertedDataRowIndex = index == null ? rowCount : Math.max(0, Math.min(index, rowCount));
    const preflightInsertRow =
      index == null
        ? before.hasTotalsRow
          ? beforeRange.endRow
          : beforeRange.endRow + 1
        : dataRowToSheetRow(before, insertedDataRowIndex);
    await assertTableRowsInsertAllowed(
      this.ctx,
      this.sheetId,
      'tables.addRow',
      before,
      preflightInsertRow,
      values?.length,
    );
    const nextOptions = this._groupedTableMutationOptions('tables.addRow');
    const result = await this.ctx.computeBridge.addTableDataRow(
      tableName,
      index ?? null,
      nextOptions(),
    );

    // result.data is { insertRow, needsRangeExpand } (new format) or a plain number (legacy).
    // The NAPI transport returns parsed objects, but guard against edge cases
    // where data might arrive as a JSON string or be missing entirely.
    let rawData = result.data;
    if (typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
      } catch {
        // not JSON — try as a bare numeric string
        const n = Number(rawData);
        if (!isNaN(n)) rawData = n;
      }
    }
    const data = rawData as
      | { insertRow: number; needsRangeExpand: boolean }
      | number
      | null
      | undefined;
    let insertRow: number;
    let needsRangeExpand: boolean;
    if (typeof data === 'number') {
      insertRow = data;
      needsRangeExpand = false;
    } else if (data != null && typeof data === 'object' && typeof data.insertRow === 'number') {
      insertRow = data.insertRow;
      needsRangeExpand = !!data.needsRangeExpand;
    } else {
      throw new KernelError(
        'COMPUTE_ERROR',
        `addTableDataRow returned unexpected data: ${JSON.stringify(result.data)} (type: ${typeof result.data})`,
      );
    }

    // Insert a worksheet row at the computed position.  shift_table_ranges
    // will expand the table range automatically when the insert falls within
    // the current range.  When appending past the end (needsRangeExpand),
    // the structural change doesn't touch the table range, so we resize it
    // explicitly afterwards.
    await Structures.insertRows(this.ctx, this.sheetId, null, insertRow, 1, 'api');

    if (needsRangeExpand) {
      const table = await this.get(tableName);
      if (table) {
        const parsed = parseCellRange(table.range);
        if (parsed) {
          await this.ctx.computeBridge.resizeTable(
            tableName,
            parsed.startRow,
            parsed.startCol,
            parsed.endRow + 1,
            parsed.endCol,
            nextOptions(),
          );
        }
      }
    }

    this.emitTableUpdated(before.id);

    // Write values if provided
    if (values && values.length > 0) {
      const edits = values.map((val, i) => ({
        row: insertRow,
        col: beforeRange.startCol + i,
        input: toCellInput(val),
      }));
      await this.ctx.computeBridge.setCellsByPosition(this.sheetId, edits, nextOptions());
    }
    const rowRange = `${colToLetter(beforeRange.startCol)}${insertRow + 1}:${colToLetter(
      beforeRange.endCol,
    )}${insertRow + 1}`;
    const newTableRange = `${colToLetter(beforeRange.startCol)}${beforeRange.startRow + 1}:${colToLetter(
      beforeRange.endCol,
    )}${beforeRange.endRow + 2}`;
    return buildTableAddRowReceipt({
      sheetId: this.sheetId,
      table: {
        ...before,
        range: newTableRange,
      },
      index: insertedDataRowIndex,
      range: rowRange,
    });
  }

  async deleteRow(
    tableName: string,
    index: number,
    nextMutationOptions?: () => TableMutationOptions,
  ): Promise<TableDeleteRowReceipt> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const rowCount = await this.getRowCount(tableName);
    if (index < 0 || index >= rowCount) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Row index ${index} is out of bounds for table "${tableName}" with ${rowCount} data row(s)`,
      );
    }
    if (rowCount <= 1) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Cannot delete 1 row(s) from table "${tableName}" — would leave 0 data rows`,
      );
    }
    await assertTableRowsDeleteAllowed(this.ctx, this.sheetId, 'tables.deleteRow', table, [
      dataRowToSheetRow(table, index),
    ]);
    const result = await this.ctx.computeBridge.removeTableDataRow(
      tableName,
      index,
      nextMutationOptions?.() ?? this._tableMutationOptions('tables.deleteRow'),
    );
    // result.data contains the absolute row index that was removed
    const removedRow =
      typeof result.data === 'number' ? result.data : parseInt(result.data as string, 10);
    await Structures.deleteRows(this.ctx, this.sheetId, null, removedRow, 1, 'api');
    this.emitTableUpdated(table.id);
    const parsed = parseCellRange(table.range);
    const rowRange = parsed
      ? `${colToLetter(parsed.startCol)}${removedRow + 1}:${colToLetter(parsed.endCol)}${
          removedRow + 1
        }`
      : table.range;
    const receiptTable =
      parsed == null
        ? table
        : {
            ...table,
            range: `${colToLetter(parsed.startCol)}${parsed.startRow + 1}:${colToLetter(
              parsed.endCol,
            )}${parsed.endRow}`,
          };
    return buildTableDeleteRowReceipt({
      sheetId: this.sheetId,
      table: receiptTable,
      index,
      range: rowRange,
    });
  }

  async deleteRows(tableName: string, indices: number[]): Promise<void> {
    // Deduplicate and sort descending to avoid index shifting and double-deletion
    const sorted = [...new Set(indices)].sort((a, b) => b - a);

    // Pre-validate: ensure deletion won't leave 0 data rows and indices are in bounds
    const rowCount = await this.getRowCount(tableName);
    for (const index of sorted) {
      if (index < 0 || index >= rowCount) {
        throw new KernelError(
          'COMPUTE_ERROR',
          `Row index ${index} is out of bounds for table "${tableName}" with ${rowCount} data row(s)`,
        );
      }
    }
    if (sorted.length >= rowCount) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Cannot delete ${sorted.length} row(s) from table "${tableName}" — would leave 0 data rows`,
      );
    }

    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    await assertTableRowsDeleteAllowed(
      this.ctx,
      this.sheetId,
      'tables.deleteRows',
      table,
      sorted.map((index) => dataRowToSheetRow(table, index)),
    );

    const nextOptions = this._groupedTableMutationOptions('tables.deleteRows');
    for (const index of sorted) {
      await this.deleteRow(tableName, index, nextOptions);
    }
  }

  async deleteRowsAt(tableName: string, index: number, count?: number): Promise<void> {
    const expandedIndices = Array.from({ length: count ?? 1 }, (_, i) => index + i);
    await this.deleteRows(tableName, expandedIndices);
  }

  async getRowCount(tableName: string): Promise<number> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const parsed = parseCellRange(table.range);
    if (!parsed) return 0;
    const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
    const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;
    return Math.max(0, dataEndRow - dataStartRow + 1);
  }

  async getRowRange(tableName: string, index: number): Promise<string> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const parsed = parseCellRange(table.range);
    if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid table range: ${table.range}`);
    const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
    const absRow = dataStartRow + index;
    const startLetter = colToLetter(parsed.startCol);
    const endLetter = colToLetter(parsed.endCol);
    return `${startLetter}${absRow + 1}:${endLetter}${absRow + 1}`;
  }

  async getRowValues(tableName: string, index: number): Promise<CellValue[]> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const parsed = parseCellRange(table.range);
    if (!parsed) return [];
    const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
    const absRow = dataStartRow + index;
    return queryRangeValues(this.ctx, this.sheetId, absRow, parsed.startCol, absRow, parsed.endCol);
  }

  async setRowValues(tableName: string, index: number, values: CellValue[]): Promise<void> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const parsed = parseCellRange(table.range);
    if (!parsed) return;
    const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
    const absRow = dataStartRow + index;
    const edits = values.map((val, i) => ({
      row: absRow,
      col: parsed.startCol + i,
      input: toCellInput(val),
    }));
    await assertTableCellsEditable(
      this.ctx,
      this.sheetId,
      'tables.setRowValues',
      table,
      edits.map(({ row, col }) => ({ row, col })),
      'editing this table row',
    );
    await this.ctx.computeBridge.setCellsByPosition(
      this.sheetId,
      edits,
      this._tableMutationOptions('tables.setRowValues'),
    );
  }

  // ---------------------------------------------------------------------------
  // Column sub-range methods
  // ---------------------------------------------------------------------------

  async getColumnDataBodyRange(tableName: string, columnIndex: number): Promise<string | null> {
    const table = await this.get(tableName);
    if (!table) return null;
    const parsed = parseCellRange(table.range);
    if (!parsed) return null;
    const col = parsed.startCol + columnIndex;
    if (col > parsed.endCol) return null;
    const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
    const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;
    if (dataStartRow > dataEndRow) return null;
    const letter = colToLetter(col);
    return `${letter}${dataStartRow + 1}:${letter}${dataEndRow + 1}`;
  }

  async getColumnHeaderRange(tableName: string, columnIndex: number): Promise<string | null> {
    const table = await this.get(tableName);
    if (!table || !table.hasHeaderRow) return null;
    const parsed = parseCellRange(table.range);
    if (!parsed) return null;
    const col = parsed.startCol + columnIndex;
    if (col > parsed.endCol) return null;
    const letter = colToLetter(col);
    const headerRow = parsed.startRow + 1; // 0-based to 1-based
    return `${letter}${headerRow}:${letter}${headerRow}`;
  }

  async getColumnRange(tableName: string, columnIndex: number): Promise<string | null> {
    const table = await this.get(tableName);
    if (!table) return null;
    const parsed = parseCellRange(table.range);
    if (!parsed) return null;
    const col = parsed.startCol + columnIndex;
    if (col > parsed.endCol) return null;
    const letter = colToLetter(col);
    return `${letter}${parsed.startRow + 1}:${letter}${parsed.endRow + 1}`;
  }

  async getColumnTotalRange(tableName: string, columnIndex: number): Promise<string | null> {
    const table = await this.get(tableName);
    if (!table || !table.hasTotalsRow) return null;
    const parsed = parseCellRange(table.range);
    if (!parsed) return null;
    const col = parsed.startCol + columnIndex;
    if (col > parsed.endCol) return null;
    const letter = colToLetter(col);
    const totalRow = parsed.endRow + 1; // 0-based to 1-based
    return `${letter}${totalRow}`;
  }

  async getColumnValues(tableName: string, columnIndex: number): Promise<CellValue[]> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const parsed = parseCellRange(table.range);
    if (!parsed) return [];
    const col = parsed.startCol + columnIndex;
    if (col > parsed.endCol) return [];
    const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
    const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;
    if (dataStartRow > dataEndRow) return [];
    return queryRangeValues(this.ctx, this.sheetId, dataStartRow, col, dataEndRow, col);
  }

  async setColumnValues(
    tableName: string,
    columnIndex: number,
    values: CellValue[],
  ): Promise<void> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    const parsed = parseCellRange(table.range);
    if (!parsed) return;
    const col = parsed.startCol + columnIndex;
    if (col > parsed.endCol) return;
    const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
    const edits = values.map((val, i) => ({
      row: dataStartRow + i,
      col,
      input: toCellInput(val),
    }));
    await assertTableCellsEditable(
      this.ctx,
      this.sheetId,
      'tables.setColumnValues',
      table,
      edits.map(({ row, col }) => ({ row, col })),
      'editing this table column',
    );
    await this.ctx.computeBridge.setCellsByPosition(
      this.sheetId,
      edits,
      this._tableMutationOptions('tables.setColumnValues'),
    );
  }

  // ---------------------------------------------------------------------------
  // Sort operations
  // ---------------------------------------------------------------------------

  async sortApply(
    tableName: string,
    fields: Array<{ columnIndex: number; ascending?: boolean }>,
  ): Promise<void> {
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    await assertTableSortAllowed(this.ctx, this.sheetId, 'tables.sort.apply', table);
    this.sortSpecCache.set(tableName, fields);
    const parsed = parseCellRange(table.range);
    if (!parsed) return;

    const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
    const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;
    if (dataStartRow > dataEndRow) return;

    const numCols = parsed.endCol - parsed.startCol + 1;
    const numRows = dataEndRow - dataStartRow + 1;

    // Read all data body values via queryRange (returns actual cell values)
    const rangeResult = await this.ctx.computeBridge.queryRange(
      this.sheetId,
      dataStartRow,
      parsed.startCol,
      dataEndRow,
      parsed.endCol,
    );

    // Build lookup map from flat cells array
    const cellMap = new Map<string, RangeCellData>();
    for (const cell of rangeResult.cells) {
      cellMap.set(`${cell.row},${cell.col}`, cell);
    }

    // Reshape into rows of CellValue
    const rows: CellValue[][] = [];
    for (let r = 0; r < numRows; r++) {
      const row: CellValue[] = [];
      for (let c = 0; c < numCols; c++) {
        const cell = cellMap.get(`${dataStartRow + r},${parsed.startCol + c}`);
        row.push(normalizeCellValue(cell?.value ?? null));
      }
      rows.push(row);
    }

    // Sort rows by the specified fields
    const indices = Array.from({ length: numRows }, (_, i) => i);
    indices.sort((a, b) => {
      for (const field of fields) {
        const aVal = rows[a][field.columnIndex] ?? '';
        const bVal = rows[b][field.columnIndex] ?? '';
        const aNum = Number(aVal);
        const bNum = Number(bVal);
        let cmp: number;
        if (!isNaN(aNum) && !isNaN(bNum) && aVal !== '' && bVal !== '') {
          cmp = aNum - bNum;
        } else {
          cmp = String(aVal).localeCompare(String(bVal));
        }
        if (field.ascending === false) cmp = -cmp;
        if (cmp !== 0) return cmp;
      }
      return 0;
    });

    // Write sorted rows back
    const edits: Array<Parameters<typeof this.ctx.computeBridge.setCellsByPosition>[1][number]> =
      [];
    for (let r = 0; r < numRows; r++) {
      const srcRow = rows[indices[r]];
      for (let c = 0; c < numCols; c++) {
        const val = srcRow[c];
        edits.push({
          row: dataStartRow + r,
          col: parsed.startCol + c,
          input: toCellInput(val),
        });
      }
    }
    await this.ctx.computeBridge.setCellsByPosition(
      this.sheetId,
      edits,
      this._tableMutationOptions('tables.sort.apply'),
    );
  }

  async sortClear(tableName: string): Promise<void> {
    this.sortSpecCache.delete(tableName);
  }

  async sortReapply(tableName: string): Promise<void> {
    const fields = this.sortSpecCache.get(tableName);
    if (!fields)
      throw new KernelError(
        'COMPUTE_ERROR',
        `No sort specification cached for table "${tableName}". ` +
          `Sort specs are stored in memory only and do not survive document reload. ` +
          `Call sortApply() first to establish the sort specification.`,
      );
    const table = await this.get(tableName);
    if (!table) throw new KernelError('COMPUTE_ERROR', `Table not found: ${tableName}`);
    await assertTableSortAllowed(this.ctx, this.sheetId, 'tables.sort.reapply', table);
    await this.sortApply(tableName, fields);
  }

  // ---------------------------------------------------------------------------
  // Filter & collection access
  // ---------------------------------------------------------------------------

  async getAutoFilter(tableName: string): Promise<FilterInfo | null> {
    await this.ctx.awaitMaterialized?.(this.sheetId);
    const table = await this.get(tableName);
    if (!table) return null;

    const filters = await this.ctx.computeBridge.getFiltersInSheet(this.sheetId);
    const match = filters.find((f) => f.tableId === table.id);
    if (!match) return null;

    return {
      id: match.id,
      filterKind: match.type,
      tableId: match.tableId,
      columnFilters: match.columnFilters ?? {},
    };
  }

  async getRows(tableName: string): Promise<TableRowCollection> {
    const rowCount = await this.getRowCount(tableName);
    return {
      count: rowCount,
      getAt: (index: number) => this.getRowValues(tableName, index),
      add: (index?: number, values?: CellValue[]) => this.addRow(tableName, index, values),
      deleteAt: (index: number) => this.deleteRow(tableName, index),
      getValues: (index: number) => this.getRowValues(tableName, index),
      setValues: (index: number, values: CellValue[]) =>
        this.setRowValues(tableName, index, values),
      getRange: (index: number) => this.getRowRange(tableName, index),
    };
  }

  // ---------------------------------------------------------------------------
  // Event subscriptions
  // ---------------------------------------------------------------------------

  onTableAdded(callback: (event: TableCreatedEvent) => void): CallableDisposable {
    const unsub = this.ctx.eventBus.on('table:created', (event: any) => {
      if (event.sheetId && event.sheetId !== this.sheetId) return;
      callback(event as TableCreatedEvent);
    });
    return toDisposable(unsub);
  }

  onTableDeleted(callback: (event: TableDeletedEvent) => void): CallableDisposable {
    const unsub = this.ctx.eventBus.on('table:deleted', (event: any) => {
      if (event.sheetId && event.sheetId !== this.sheetId) return;
      callback(event as TableDeletedEvent);
    });
    return toDisposable(unsub);
  }

  onTableChanged(
    tableName: string,
    callback: (event: TableUpdatedEvent) => void,
  ): CallableDisposable {
    let resolvedTableId: string | null = null;
    let resolvePromise: Promise<string | null> | null = null;
    const resolveTargetTableId = async (): Promise<string | null> => {
      if (resolvedTableId) return resolvedTableId;
      if (resolvePromise) return resolvePromise;
      resolvePromise = this.resolveTableIdForName(tableName).then((tableId) => {
        resolvedTableId = tableId;
        resolvePromise = null;
        return tableId;
      });
      return resolvePromise;
    };

    void resolveTargetTableId();

    const unsub = this.ctx.eventBus.on('table:updated', async (event: any) => {
      if (event.sheetId && event.sheetId !== this.sheetId) return;
      const tableId = await resolveTargetTableId();
      if (!tableId || event.tableId !== tableId) return;
      callback(event as TableUpdatedEvent);
    });
    return toDisposable(unsub);
  }

  onSelectionChanged(
    tableName: string,
    callback: (event: TableSelectionChangedEvent) => void,
  ): CallableDisposable {
    const unsub = this.ctx.eventBus.on('table:selection-changed', (event: any) => {
      if (event.sheetId && event.sheetId !== this.sheetId) return;
      if (event.tableName !== tableName) return;
      callback(event as TableSelectionChangedEvent);
    });
    return toDisposable(unsub);
  }
}

/**
 * Query a range and return a flat array of resolved CellValues (row-major order).
 *
 * Unlike getCellsInRange (which returns internal cell IDs), this uses queryRange
 * to retrieve actual display/effective values.
 */
async function queryRangeValues(
  ctx: DocumentContext,
  sheetId: SheetId,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): Promise<CellValue[]> {
  const rangeResult = await ctx.computeBridge.queryRange(
    sheetId,
    startRow,
    startCol,
    endRow,
    endCol,
  );

  // Build lookup map from flat cells array
  const cellMap = new Map<string, RangeCellData>();
  for (const cell of rangeResult.cells) {
    cellMap.set(`${cell.row},${cell.col}`, cell);
  }

  // Flatten in row-major order
  const values: CellValue[] = [];
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = cellMap.get(`${r},${c}`);
      values.push(normalizeCellValue(cell?.value ?? null));
    }
  }
  return values;
}
