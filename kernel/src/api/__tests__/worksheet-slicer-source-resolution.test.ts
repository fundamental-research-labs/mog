import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

jest.mock('../../domain/sorting/filters', () => ({
  getTableFilter: jest.fn().mockResolvedValue(null),
  createFilter: jest.fn().mockResolvedValue({ id: 'f-1' }),
  clearColumnFilter: jest.fn(),
  setColumnFilter: jest.fn(),
  applyFilter: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../bridges/compute/compute-core', () => ({
  extractMutationData: jest.fn((result: any) => result?.data),
}));

import { WorksheetSlicersImpl } from '../worksheet/slicers';

const SHEET_ID = sheetId('sheet-1');

function createMockComputeBridge() {
  return {
    getAllSlicers: jest.fn().mockResolvedValue([]),
    getAllSlicersWorkbook: jest.fn().mockResolvedValue([]),
    getSlicerState: jest.fn().mockResolvedValue(null),
    getTableByName: jest.fn().mockResolvedValue(null),
    getAllTablesInSheet: jest.fn().mockResolvedValue([]),
    getAllTablesWorkbook: jest.fn().mockResolvedValue([]),
    getCellsInRangeYrs: jest.fn().mockResolvedValue([]),
    getCellPosition: jest.fn().mockResolvedValue(null),
    pivotGet: jest.fn().mockResolvedValue(null),
    pivotGetAllItems: jest.fn().mockResolvedValue([]),
  };
}

function createMockCtx(bridge = createMockComputeBridge()) {
  return {
    computeBridge: bridge,
    eventBus: { emit: jest.fn() },
    writeGate: { assertWritable: jest.fn() },
  } as any;
}

describe('WorksheetSlicersImpl table source resolution', () => {
  it('projects imported stable table and column IDs as public names', async () => {
    const bridge = createMockComputeBridge();
    const slicers = new WorksheetSlicersImpl(createMockCtx(bridge), SHEET_ID);
    const source = {
      type: 'table' as const,
      tableId: 'tbl-stable-sales',
      columnCellId: 'col-stable-region',
    };
    const table = {
      id: 'tbl-stable-sales',
      name: 'SdkSlicerSales',
      displayName: 'SdkSlicerSales',
      sheetId: String(SHEET_ID),
      columns: [
        { id: 'col-stable-account', name: 'Account', index: 0 },
        { id: 'col-stable-region', name: 'Region', index: 1 },
      ],
      range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
      hasHeaderRow: true,
      hasTotalsRow: false,
    };
    bridge.getAllSlicers.mockResolvedValue([
      { id: 'slicer-imported', caption: 'Region', name: 'RegionSlicer', source },
    ]);
    bridge.getSlicerState.mockResolvedValue({
      id: 'slicer-imported',
      caption: 'Region',
      name: 'RegionSlicer',
      source,
      selectedValues: ['West'],
      position: null,
      style: null,
      zIndex: 0,
      locked: false,
      showHeader: true,
    });
    bridge.getAllTablesInSheet.mockResolvedValue([table]);

    await expect(slicers.list()).resolves.toEqual([
      {
        id: 'slicer-imported',
        name: 'RegionSlicer',
        caption: 'Region',
        tableName: 'SdkSlicerSales',
        columnName: 'Region',
        source,
      },
    ]);
    await expect(slicers.get('slicer-imported')).resolves.toEqual(
      expect.objectContaining({
        tableName: 'SdkSlicerSales',
        columnName: 'Region',
        source,
        selectedItems: ['West'],
      }),
    );
  });

  it('resolves imported stable table and column IDs when enumerating items', async () => {
    const bridge = createMockComputeBridge();
    const slicers = new WorksheetSlicersImpl(createMockCtx(bridge), SHEET_ID);
    bridge.getSlicerState.mockResolvedValue({
      id: 'slicer-imported',
      caption: 'Region',
      source: {
        type: 'table',
        tableId: 'tbl-stable-sales',
        columnCellId: 'col-stable-region',
      },
      selectedValues: ['West'],
      position: null,
      style: null,
      zIndex: 0,
      locked: false,
      showHeader: true,
    });
    bridge.getAllTablesInSheet.mockResolvedValue([
      {
        id: 'tbl-stable-sales',
        name: 'SdkSlicerSales',
        displayName: 'SdkSlicerSales',
        sheetId: String(SHEET_ID),
        columns: [
          { name: 'Account', id: 'col-stable-account', index: 0 },
          { name: 'Region', id: 'col-stable-region', index: 1 },
        ],
        range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
        hasHeaderRow: true,
        hasTotalsRow: false,
      },
    ]);
    bridge.getCellsInRangeYrs.mockResolvedValue([
      { row: 1, col: 1, value: { type: 'text', value: 'East' } },
      { row: 2, col: 1, value: { type: 'text', value: 'West' } },
      { row: 3, col: 1, value: { type: 'text', value: 'West' } },
    ]);

    const state = await slicers.getState('slicer-imported');

    expect(state.isConnected).toBe(true);
    expect(bridge.getCellsInRangeYrs).toHaveBeenCalledWith(SHEET_ID, 1, 1, 3, 1);
    expect(state.items).toEqual([
      { value: 'East', selected: false, count: 1 },
      { value: 'West', selected: true, count: 2 },
    ]);
  });

  it('does not connect stored table slicer sources by table or column name', async () => {
    const bridge = createMockComputeBridge();
    const slicers = new WorksheetSlicersImpl(createMockCtx(bridge), SHEET_ID);
    const source = {
      type: 'table' as const,
      tableId: 'LegacySales',
      columnCellId: 'Region',
    };
    bridge.getAllSlicers.mockResolvedValue([
      { id: 'slicer-legacy', caption: 'Region', name: 'LegacyRegion', source },
    ]);
    bridge.getSlicerState.mockResolvedValue({
      id: 'slicer-legacy',
      caption: 'Region',
      name: 'LegacyRegion',
      source,
      selectedValues: ['West'],
      position: null,
      style: null,
      zIndex: 0,
      locked: false,
      showHeader: true,
    });
    bridge.getTableByName.mockResolvedValue({
      id: 'tbl-stable-sales',
      name: 'LegacySales',
      displayName: 'LegacySales',
      sheetId: String(SHEET_ID),
      columns: [{ name: 'Region', id: 'col-stable-region', index: 0 }],
      range: { startRow: 0, startCol: 0, endRow: 2, endCol: 0 },
      hasHeaderRow: true,
      hasTotalsRow: false,
    });
    bridge.getCellsInRangeYrs.mockResolvedValue([
      { row: 1, col: 0, value: { type: 'text', value: 'East' } },
      { row: 2, col: 0, value: { type: 'text', value: 'West' } },
    ]);

    const state = await slicers.getState('slicer-legacy');

    expect(state.isConnected).toBe(false);
    expect(state.items).toEqual([]);
    expect(bridge.getTableByName).not.toHaveBeenCalled();
    expect(bridge.getCellsInRangeYrs).not.toHaveBeenCalled();
  });

  it('prefers stable column IDs before public column names', async () => {
    const bridge = createMockComputeBridge();
    const slicers = new WorksheetSlicersImpl(createMockCtx(bridge), SHEET_ID);
    bridge.getSlicerState.mockResolvedValue({
      id: 'slicer-collision',
      caption: 'RealColumn',
      source: {
        type: 'table',
        tableId: 'tbl-collision',
        columnCellId: 'col-target',
      },
      selectedValues: [],
      position: null,
      style: null,
      zIndex: 0,
      locked: false,
      showHeader: true,
    });
    bridge.getAllTablesInSheet.mockResolvedValue([
      {
        id: 'tbl-collision',
        name: 'CollisionTable',
        displayName: 'CollisionTable',
        sheetId: String(SHEET_ID),
        columns: [
          { name: 'col-target', id: 'col-other', index: 0 },
          { name: 'RealColumn', id: 'col-target', index: 1 },
        ],
        range: { startRow: 0, startCol: 5, endRow: 2, endCol: 6 },
        hasHeaderRow: true,
        hasTotalsRow: false,
      },
    ]);
    bridge.getCellsInRangeYrs.mockResolvedValue([
      { row: 1, col: 6, value: { type: 'text', value: 'A' } },
      { row: 2, col: 6, value: { type: 'text', value: 'B' } },
    ]);

    const slicer = await slicers.get('slicer-collision');
    const items = await slicers.getItems('slicer-collision');

    expect(slicer?.columnName).toBe('RealColumn');
    expect(slicer?.source).toEqual({
      type: 'table',
      tableId: 'tbl-collision',
      columnCellId: 'col-target',
    });
    expect(bridge.getCellsInRangeYrs).toHaveBeenCalledWith(SHEET_ID, 1, 6, 2, 6);
    expect(items.map((item) => item.value)).toEqual(['A', 'B']);
  });

  it('falls back to workbook-wide table resolution for cross-sheet imported sources', async () => {
    const bridge = createMockComputeBridge();
    const slicers = new WorksheetSlicersImpl(createMockCtx(bridge), SHEET_ID);
    bridge.getSlicerState.mockResolvedValue({
      id: 'slicer-cross-sheet',
      caption: 'Region',
      source: {
        type: 'table',
        tableId: 'tbl-cross-sheet-sales',
        columnCellId: 'col-cross-sheet-region',
      },
      selectedValues: [],
      position: null,
      style: null,
      zIndex: 0,
      locked: false,
      showHeader: true,
    });
    bridge.getAllTablesWorkbook.mockResolvedValue([
      {
        sheetId: 'source-sheet',
        table: {
          id: 'tbl-cross-sheet-sales',
          name: 'CrossSheetSales',
          displayName: 'CrossSheetSales',
          sheetId: 'source-sheet',
          columns: [{ name: 'Region', id: 'col-cross-sheet-region', index: 0 }],
          range: { startRow: 0, startCol: 2, endRow: 2, endCol: 2 },
          hasHeaderRow: true,
          hasTotalsRow: false,
        },
      },
    ]);
    bridge.getCellsInRangeYrs.mockResolvedValue([
      { row: 1, col: 2, value: { type: 'text', value: 'EMEA' } },
      { row: 2, col: 2, value: { type: 'text', value: 'APAC' } },
    ]);

    const items = await slicers.getItems('slicer-cross-sheet');

    expect(bridge.getCellsInRangeYrs).toHaveBeenCalledWith(sheetId('source-sheet'), 1, 2, 2, 2);
    expect(items.map((item) => item.value)).toEqual(['APAC', 'EMEA']);
  });
});
