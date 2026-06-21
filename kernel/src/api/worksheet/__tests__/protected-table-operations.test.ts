import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { KernelError } from '../../../errors';
import { WorksheetFiltersImpl } from '../filters';
import { WorksheetSlicersImpl } from '../slicers';
import { WorksheetTablesImpl } from '../tables';

jest.mock('../../../domain/sheets/structures', () => ({
  insertRows: jest.fn().mockResolvedValue(undefined),
  deleteRows: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../domain/sorting/filters', () => ({
  getTableFilter: jest.fn().mockResolvedValue({ id: 'filter-1' }),
  createFilter: jest.fn().mockResolvedValue({ id: 'filter-1' }),
  applyFilter: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../domain/tables/core', () => ({
  getTable: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../../bridges/compute/compute-core', () => ({
  extractMutationData: jest.fn((result: any) => result?.data),
}));

const SHEET_ID = sheetId('sheet-1');

const protectedOptions = {
  selectLockedCells: true,
  selectUnlockedCells: true,
  insertRows: false,
  insertColumns: false,
  insertHyperlinks: false,
  deleteRows: false,
  deleteColumns: false,
  formatCells: false,
  formatColumns: false,
  formatRows: false,
  sort: false,
  useAutoFilter: false,
  usePivotTableReports: false,
  editObjects: false,
  editScenarios: false,
};

const bridgeTable = {
  id: 'table-1',
  name: 'Sales',
  displayName: 'Sales',
  sheetId: SHEET_ID,
  range: { startRow: 0, startCol: 0, endRow: 5, endCol: 3 },
  columns: [
    { id: 'Region', name: 'Region', index: 0, totalsFunction: null, totalsLabel: null },
    { id: 'Rep', name: 'Rep', index: 1, totalsFunction: null, totalsLabel: null },
    { id: 'Amount', name: 'Amount', index: 2, totalsFunction: null, totalsLabel: null },
    { id: 'Doubled', name: 'Doubled', index: 3, totalsFunction: null, totalsLabel: null },
  ],
  hasHeaderRow: true,
  hasTotalsRow: false,
  style: 'TableStyleMedium2',
  bandedRows: true,
  bandedColumns: false,
  emphasizeFirstColumn: false,
  emphasizeLastColumn: false,
  showFilterButtons: true,
  autoExpand: true,
  autoCalculatedColumns: true,
};

function createCtx(optionOverrides: Partial<typeof protectedOptions> | null = {}) {
  const options = optionOverrides === null ? null : { ...protectedOptions, ...optionOverrides };
  const bridge = {
    getSheetProtectionOptions: jest.fn().mockResolvedValue(options),
    canEditCell: jest.fn().mockResolvedValue(true),
    getTableByName: jest.fn().mockResolvedValue(bridgeTable),
    getTableAtCell: jest.fn().mockResolvedValue(bridgeTable),
    getAllTablesInSheet: jest.fn().mockResolvedValue([bridgeTable]),
    getAllTablesWorkbook: jest.fn().mockResolvedValue([]),
    getFiltersInSheet: jest.fn().mockResolvedValue([
      {
        id: 'filter-1',
        tableId: 'table-1',
        type: 'tableFilter',
        startRow: 0,
        startCol: 0,
        endRow: 5,
        endCol: 3,
        columnFilters: {},
      },
    ]),
    getCellPosition: jest.fn().mockResolvedValue(null),
    queryRange: jest.fn().mockResolvedValue({ cells: [], merges: [] }),
    createTableLifecycle: jest.fn().mockResolvedValue(undefined),
    deleteTable: jest.fn().mockResolvedValue(undefined),
    convertTableToRange: jest.fn().mockResolvedValue({ data: 0 }),
    renameTable: jest.fn().mockResolvedValue(undefined),
    tableValidateTableName: jest.fn().mockResolvedValue({ valid: true }),
    setTableStyle: jest.fn().mockResolvedValue(undefined),
    setTableBoolOption: jest.fn().mockResolvedValue(undefined),
    setTableAutoExpand: jest.fn().mockResolvedValue(undefined),
    setTableAutoCalculatedColumns: jest.fn().mockResolvedValue(undefined),
    clearAllColumnFilters: jest.fn().mockResolvedValue(undefined),
    setColumnFilter: jest.fn().mockResolvedValue(undefined),
    applyFilter: jest.fn().mockResolvedValue(undefined),
    resizeTable: jest.fn().mockResolvedValue(undefined),
    addTableColumn: jest.fn().mockResolvedValue(undefined),
    renameTableColumn: jest.fn().mockResolvedValue(undefined),
    removeTableColumn: jest.fn().mockResolvedValue(undefined),
    toggleTotalsRow: jest.fn().mockResolvedValue(undefined),
    toggleHeaderRow: jest.fn().mockResolvedValue(undefined),
    applyAutoExpansion: jest.fn().mockResolvedValue(undefined),
    updateCalculatedColumn: jest.fn().mockResolvedValue(undefined),
    removeCalculatedColumn: jest.fn().mockResolvedValue(undefined),
    addTableDataRow: jest
      .fn()
      .mockResolvedValue({ data: { insertRow: 6, needsRangeExpand: true } }),
    removeTableDataRow: jest.fn().mockResolvedValue({ data: 2 }),
    setCellsByPosition: jest.fn().mockResolvedValue(undefined),
    setCellValueParsed: jest.fn().mockResolvedValue(undefined),
    createFilter: jest.fn().mockResolvedValue(undefined),
    deleteFilter: jest.fn().mockResolvedValue(undefined),
    clearColumnFilter: jest.fn().mockResolvedValue(undefined),
    computeDynamicFilterSerialRange: jest.fn().mockResolvedValue(null),
    setFilterSortState: jest.fn().mockResolvedValue(undefined),
    getAllSlicersWorkbook: jest.fn().mockResolvedValue([]),
    getAllSlicers: jest.fn().mockResolvedValue([]),
    getSlicerState: jest.fn().mockResolvedValue({
      id: 'slicer-1',
      caption: 'Region',
      name: 'Region',
      source: { type: 'table', tableId: 'Sales', columnCellId: 'Region' },
      selectedValues: [],
    }),
    createSlicer: jest.fn().mockResolvedValue({ data: { id: 'slicer-2' } }),
    deleteSlicer: jest.fn().mockResolvedValue(undefined),
    updateSlicerConfig: jest.fn().mockResolvedValue(undefined),
    clearSlicerSelection: jest.fn().mockResolvedValue(undefined),
    toggleSlicerItem: jest.fn().mockResolvedValue(undefined),
  };
  return {
    computeBridge: bridge,
    writeGate: { assertWritable: jest.fn() },
    eventBus: { emit: jest.fn(), on: jest.fn() },
  } as any;
}

function expectProtected(error: unknown, operation: string) {
  expect(error).toBeInstanceOf(KernelError);
  const err = error as KernelError;
  expect(err.code).toBe('API_PROTECTED_SHEET');
  expect(err.context).toMatchObject({
    internalCode: 'API_PROTECTED_SHEET',
    operation,
    tableName: 'Sales',
  });
  expect(typeof err.context.reason).toBe('string');
}

function expectTableMutationOptions(operationIdPrefix: string) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      kind: 'mutation',
      sheetIds: [SHEET_ID],
      domainIds: ['tables'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

describe('protected sheet table operation policy', () => {
  it('blocks structural table definition mutations before bridge writes', async () => {
    const ctx = createCtx();
    const tables = new WorksheetTablesImpl(ctx, SHEET_ID);

    await expect(tables.rename('Sales', 'NewSales')).rejects.toThrow(KernelError);
    expect(ctx.computeBridge.renameTable).not.toHaveBeenCalled();
    await expect(tables.renameColumn('Sales', 1, 'Rep Name')).rejects.toThrow(KernelError);
    expect(ctx.computeBridge.renameTableColumn).not.toHaveBeenCalled();
    await expect(tables.convertToRange('Sales')).rejects.toThrow(KernelError);
    expect(ctx.computeBridge.convertTableToRange).not.toHaveBeenCalled();

    try {
      await tables.convertToRange('Sales');
    } catch (error) {
      expectProtected(error, 'tables.convertToRange');
    }
  });

  it('renames table columns when table definition edits are allowed', async () => {
    const ctx = createCtx(null);
    const tables = new WorksheetTablesImpl(ctx, SHEET_ID);

    await tables.renameColumn('Sales', 1, 'Rep Name');

    expect(ctx.computeBridge.renameTableColumn).toHaveBeenCalledWith(
      'Sales',
      1,
      'Rep Name',
      expectTableMutationOptions('tables.renameColumn'),
    );
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'table:updated',
        sheetId: SHEET_ID,
        tableId: 'table-1',
      }),
    );
  });

  it('allows table style mutations only with formatCells', async () => {
    const deniedCtx = createCtx();
    await expect(
      new WorksheetTablesImpl(deniedCtx, SHEET_ID).setStylePreset('Sales', 'TableStyleLight1'),
    ).rejects.toThrow(KernelError);
    expect(deniedCtx.computeBridge.setTableStyle).not.toHaveBeenCalled();

    const allowedCtx = createCtx({ formatCells: true });
    await new WorksheetTablesImpl(allowedCtx, SHEET_ID).setStylePreset('Sales', 'TableStyleLight1');
    expect(allowedCtx.computeBridge.setTableStyle).toHaveBeenCalledWith(
      'Sales',
      'TableStyleLight1',
      expectTableMutationOptions('tables.setStylePreset'),
    );
  });

  it('preflights sort before changing cache or writing cells', async () => {
    const deniedCtx = createCtx({ sort: false });
    const tables = new WorksheetTablesImpl(deniedCtx, SHEET_ID);

    await expect(tables.sort.apply('Sales', [{ columnIndex: 0, ascending: true }])).rejects.toThrow(
      KernelError,
    );
    expect(deniedCtx.computeBridge.setCellsByPosition).not.toHaveBeenCalled();
    await expect(tables.sort.reapply('Sales')).rejects.toThrow(/No sort specification cached/);
  });

  it('requires editable sort and row ranges even when structure permission is enabled', async () => {
    const ctx = createCtx({ sort: true, deleteRows: true });
    ctx.computeBridge.canEditCell.mockImplementation(
      async (_sheet: string, row: number, col: number) => !(row === 3 && col === 2),
    );
    const tables = new WorksheetTablesImpl(ctx, SHEET_ID);

    await expect(tables.sort.apply('Sales', [{ columnIndex: 0 }])).rejects.toThrow(KernelError);
    await expect(tables.deleteRow('Sales', 2)).rejects.toThrow(KernelError);
    expect(ctx.computeBridge.removeTableDataRow).not.toHaveBeenCalled();
  });

  it('guards add row, delete row, resize, and value edits before mutation', async () => {
    const ctx = createCtx();
    const tables = new WorksheetTablesImpl(ctx, SHEET_ID);

    await expect(tables.addRow('Sales', undefined, ['South'])).rejects.toThrow(KernelError);
    await expect(tables.deleteRow('Sales', 1)).rejects.toThrow(KernelError);
    await expect(tables.resize('Sales', 'A1:D7')).rejects.toThrow(KernelError);
    ctx.computeBridge.canEditCell.mockResolvedValue(false);
    await expect(tables.setRowValues('Sales', 0, ['East'])).rejects.toThrow(KernelError);

    expect(ctx.computeBridge.addTableDataRow).not.toHaveBeenCalled();
    expect(ctx.computeBridge.removeTableDataRow).not.toHaveBeenCalled();
    expect(ctx.computeBridge.resizeTable).not.toHaveBeenCalled();
    expect(ctx.computeBridge.setCellsByPosition).not.toHaveBeenCalled();
  });

  it('allows table filter criteria with useAutoFilter and blocks table filter removal', async () => {
    const deniedCtx = createCtx();
    const filters = new WorksheetFiltersImpl(deniedCtx, SHEET_ID);
    await expect(filters.setColumnFilter(0, { type: 'value', values: ['East'] })).rejects.toThrow(
      KernelError,
    );
    expect(deniedCtx.computeBridge.setColumnFilter).not.toHaveBeenCalled();

    const allowedCtx = createCtx({ useAutoFilter: true });
    await new WorksheetFiltersImpl(allowedCtx, SHEET_ID).setColumnFilter(0, {
      type: 'value',
      values: ['East'],
    });
    expect(allowedCtx.computeBridge.setColumnFilter).toHaveBeenCalled();
    await expect(new WorksheetFiltersImpl(allowedCtx, SHEET_ID).remove('filter-1')).rejects.toThrow(
      KernelError,
    );
    expect(allowedCtx.computeBridge.deleteFilter).not.toHaveBeenCalled();
  });

  it('guards slicer filtering and object edits through the same protected-sheet details', async () => {
    const deniedCtx = createCtx();
    const slicers = new WorksheetSlicersImpl(deniedCtx, SHEET_ID);
    await expect(slicers.setSelection('slicer-1', ['East'])).rejects.toThrow(KernelError);
    await expect(slicers.update('slicer-1', { caption: 'Region Filter' })).rejects.toThrow(
      KernelError,
    );
    expect(deniedCtx.computeBridge.clearSlicerSelection).not.toHaveBeenCalled();
    expect(deniedCtx.computeBridge.updateSlicerConfig).not.toHaveBeenCalled();

    const allowedCtx = createCtx({ useAutoFilter: true, editObjects: true });
    await new WorksheetSlicersImpl(allowedCtx, SHEET_ID).update('slicer-1', {
      caption: 'Region Filter',
    });
    expect(allowedCtx.computeBridge.updateSlicerConfig).toHaveBeenCalled();
  });
});
