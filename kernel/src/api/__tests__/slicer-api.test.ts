/**
 * Slicer API — Unit Tests
 *
 * Tests for:
 * 1. SlicerInfo caption field (list returns name + caption, fallback behavior)
 * 2. Name uniqueness validation (create/update reject duplicates)
 * 3. Named slicer style registry (add, getItemOrNullObject, delete, duplicate, getCount)
 *
 * Each test directly instantiates the implementation class with a mock context
 * to avoid the heavy ESM import chain from WorksheetImpl.
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

// ---------------------------------------------------------------------------
// Mock transitive dependencies to prevent ESM import chain issues
// ---------------------------------------------------------------------------
jest.mock('../../domain/sorting/filters', () => ({
  getTableFilter: jest.fn().mockResolvedValue(null),
  createFilter: jest.fn().mockResolvedValue({ id: 'f-1' }),
  clearColumnFilter: jest.fn(),
  setColumnFilter: jest.fn(),
  applyFilter: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../domain/tables/core', () => ({
  getTable: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../bridges/compute/compute-core', () => ({
  extractMutationData: jest.fn((result: any) => {
    if (result?.data === undefined || result?.data === null) return undefined;
    return result.data;
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { WorksheetSlicersImpl } from '../worksheet/slicers';
import { WorkbookSlicerStylesImpl } from '../workbook/slicer-styles';
import { KernelError } from '../../errors';

const SHEET_ID = sheetId('sheet-1');

function mockTable(id: string, columns: Array<{ name: string; id?: string; index?: number }>) {
  const mappedColumns = columns.map((col, index) => ({
    name: col.name,
    id: col.id ?? col.name,
    index: col.index ?? index,
  }));
  return {
    id,
    name: id,
    displayName: id,
    sheetId: String(SHEET_ID),
    columns: mappedColumns,
    range: { startRow: 0, startCol: 0, endRow: 4, endCol: Math.max(0, mappedColumns.length - 1) },
    hasHeaderRow: true,
    hasTotalsRow: false,
  };
}

const DEFAULT_TABLES = [
  mockTable('T1', [{ name: 'C1' }, { name: 'C2' }, { name: 'Col1', index: 0 }]),
  mockTable('T2', [{ name: 'C2' }]),
  mockTable('T3', [{ name: 'C3' }]),
  mockTable('SalesTable', [
    { name: 'Region', id: 'col-region' },
    { name: 'Amount', id: 'col-amount' },
  ]),
];

function createMockComputeBridge() {
  return {
    // Slicer CRUD
    createSlicer: jest.fn().mockResolvedValue(undefined),
    deleteSlicer: jest.fn().mockResolvedValue(undefined),
    getAllSlicers: jest.fn().mockResolvedValue([]),
    getAllSlicersWorkbook: jest.fn().mockResolvedValue([]),
    getSlicerState: jest.fn().mockResolvedValue(null),
    updateSlicerConfig: jest.fn().mockResolvedValue(undefined),
    clearSlicerSelection: jest.fn().mockResolvedValue(undefined),
    getSheetProtectionOptions: jest.fn().mockResolvedValue(null),
    toggleSlicerItem: jest.fn().mockResolvedValue(undefined),

    // Table queries (used by getItems/checkSlicerConnectivity)
    getTableByName: jest.fn().mockResolvedValue(null),
    getAllTablesInSheet: jest.fn().mockResolvedValue([]),
    getAllTablesWorkbook: jest.fn().mockResolvedValue([]),
    getCellsInRangeYrs: jest.fn().mockResolvedValue([]),
    getCellPosition: jest.fn().mockResolvedValue(null),
    getFiltersInSheet: jest.fn().mockResolvedValue([
      {
        id: 'f-1',
        tableId: 'SalesTable',
        type: 'tableFilter',
        startRow: 0,
        startCol: 0,
        endRow: 3,
        endCol: 1,
        columnFilters: {},
      },
    ]),
    setColumnFilter: jest.fn().mockResolvedValue(undefined),
    clearColumnFilter: jest.fn().mockResolvedValue(undefined),
    applyFilter: jest.fn().mockResolvedValue(undefined),

    // Pivot queries (used by checkSlicerConnectivity for pivot slicers)
    pivotGet: jest.fn().mockResolvedValue(null),
    pivotGetAllItems: jest.fn().mockResolvedValue([]),

    // Slicer style registry
    getDefaultSlicerStyle: jest.fn().mockResolvedValue(null),
    setDefaultSlicerStyle: jest.fn().mockResolvedValue(undefined),
    addSlicerStyle: jest.fn().mockResolvedValue({ data: null }),
    getSlicerStyle: jest.fn().mockResolvedValue(null),
    deleteSlicerStyle: jest.fn().mockResolvedValue({ data: null }),
    duplicateSlicerStyle: jest.fn().mockResolvedValue({ data: null }),
  };
}

function createMockCtx(bridge?: ReturnType<typeof createMockComputeBridge>) {
  return {
    computeBridge: bridge ?? createMockComputeBridge(),
    eventBus: {
      emit: jest.fn(),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
  } as any;
}

// =============================================================================
// Tests
// =============================================================================

describe('WorksheetSlicersImpl', () => {
  let bridge: ReturnType<typeof createMockComputeBridge>;
  let ctx: any;
  let slicers: WorksheetSlicersImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = createMockComputeBridge();
    bridge.getAllTablesInSheet.mockResolvedValue(DEFAULT_TABLES);
    ctx = createMockCtx(bridge);
    slicers = new WorksheetSlicersImpl(ctx, SHEET_ID);
  });

  // =========================================================================
  // Group 1: SlicerInfo caption field
  // =========================================================================
  describe('Group 1: SlicerInfo caption field', () => {
    it('list() returns slicers with both name and caption fields', async () => {
      bridge.getAllSlicers.mockResolvedValue([
        {
          id: 'slicer-1',
          caption: 'Region Filter',
          name: 'Slicer_Region',
          source: { type: 'table', tableId: 'Table1', columnCellId: 'Region' },
        },
      ]);

      const result = await slicers.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'slicer-1',
        name: 'Slicer_Region',
        caption: 'Region Filter',
        tableName: 'Table1',
        columnName: 'Region',
        source: { type: 'table', tableId: 'Table1', columnCellId: 'Region' },
      });
    });

    it('caption is the display caption from the stored slicer', async () => {
      bridge.getAllSlicers.mockResolvedValue([
        {
          id: 'slicer-2',
          caption: 'Sales by Category',
          name: 'Slicer_Category',
          source: { type: 'table', tableId: 'SalesTable', columnCellId: 'Category' },
        },
      ]);

      const result = await slicers.list();

      expect(result[0].caption).toBe('Sales by Category');
      expect(result[0].name).toBe('Slicer_Category');
    });

    it('name falls back to caption when no explicit name is set', async () => {
      bridge.getAllSlicers.mockResolvedValue([
        {
          id: 'slicer-3',
          caption: 'Department',
          // name is undefined — should fall back to caption
          source: { type: 'table', tableId: 'Table2', columnCellId: 'Dept' },
        },
      ]);

      const result = await slicers.list();

      expect(result[0].name).toBe('Department');
      expect(result[0].caption).toBe('Department');
    });

    it('get() also returns caption and name fields', async () => {
      bridge.getSlicerState.mockResolvedValue({
        id: 'slicer-4',
        caption: 'My Slicer',
        name: 'Slicer_Custom',
        source: { type: 'table', tableId: 'T1', columnCellId: 'Col1' },
        selectedValues: [],
        position: { x: 10, y: 20, width: 200, height: 300 },
        style: null,
        zIndex: 0,
        locked: false,
        showHeader: true,
      });

      const result = await slicers.get('slicer-4');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Slicer_Custom');
      expect(result!.caption).toBe('My Slicer');
    });

    it('get() falls back name to caption when name is undefined', async () => {
      bridge.getSlicerState.mockResolvedValue({
        id: 'slicer-5',
        caption: 'Auto Name',
        // no name field
        source: { type: 'table', tableId: 'T2', columnCellId: 'Col2' },
        selectedValues: [],
        position: { x: 0, y: 0, width: 200, height: 300 },
        style: null,
        zIndex: 0,
        locked: false,
        showHeader: true,
      });

      const result = await slicers.get('slicer-5');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Auto Name');
      expect(result!.caption).toBe('Auto Name');
    });
  });

  // =========================================================================
  // Group 1b: Duplicate anchor serialization
  // =========================================================================
  describe('duplicate', () => {
    it('offsets canonical EMU anchors without emitting non-canonical aliases', async () => {
      bridge.getSlicerState.mockResolvedValue({
        id: 'slicer-1',
        sheetId: String(SHEET_ID),
        caption: 'Region',
        name: 'RegionSlicer',
        source: { type: 'table', tableId: 'SalesTable', columnCellId: 'col-region' },
        style: {
          columnCount: 1,
          buttonHeight: 30,
          showSelectionIndicator: true,
          crossFilter: 'showItemsWithDataAtTop',
          customListSort: false,
          showItemsWithNoData: false,
          sortOrder: 'ascending',
        },
        position: {
          anchorRow: 0,
          anchorCol: 0,
          anchorRowOffsetEmu: 10 * 9525,
          anchorColOffsetEmu: 30 * 9525,
          anchorMode: 'absolute',
          extentCxEmu: 150 * 9525,
          extentCyEmu: 200 * 9525,
        },
        zIndex: 0,
        locked: false,
        showHeader: true,
        multiSelect: false,
        selectedValues: ['West'],
      });
      bridge.createSlicer.mockResolvedValue({
        data: {
          id: 'slicer-2',
        },
      });

      const newId = await slicers.duplicate('slicer-1');

      expect(newId).toBe('slicer-2');
      const [, config] = bridge.createSlicer.mock.calls[0];
      expect(config.position).toEqual(
        expect.objectContaining({
          anchorRowOffsetEmu: 30 * 9525,
          anchorColOffsetEmu: 50 * 9525,
          extentCxEmu: 150 * 9525,
          extentCyEmu: 200 * 9525,
        }),
      );
      expect(config.position).not.toHaveProperty('anchorRowOffset');
      expect(config.position).not.toHaveProperty('anchorColOffset');
      expect(config.position).not.toHaveProperty('extentCx');
      expect(config.position).not.toHaveProperty('extentCy');
    });
  });

  // =========================================================================
  // Group 2: Name uniqueness validation
  // =========================================================================
  describe('Group 2: Name uniqueness validation', () => {
    it('creating a slicer with a duplicate name throws an error', async () => {
      // Existing slicer in the workbook with name "MySlicer"
      bridge.getAllSlicersWorkbook.mockResolvedValue([
        {
          id: 'existing-1',
          caption: 'MySlicer',
          name: 'MySlicer',
          source: { type: 'table', tableId: 'T1', columnCellId: 'C1' },
        },
      ]);

      await expect(
        slicers.add({
          name: 'MySlicer',
          caption: 'MySlicer',
          source: { type: 'table', tableId: 'T2', columnCellId: 'C2' },
        } as any),
      ).rejects.toThrow(/already exists/);
    });

    it('creating a slicer with a duplicate name throws KernelError', async () => {
      bridge.getAllSlicersWorkbook.mockResolvedValue([
        {
          id: 'existing-1',
          caption: 'DupName',
          name: 'DupName',
          source: { type: 'table', tableId: 'T1', columnCellId: 'C1' },
        },
      ]);

      try {
        await slicers.add({
          name: 'DupName',
          source: { type: 'table', tableId: 'T3', columnCellId: 'C3' },
        } as any);
        // Should not reach here
        expect(true).toBe(false);
      } catch (err) {
        expect(err).toBeInstanceOf(KernelError);
        expect((err as KernelError).message).toContain('DupName');
      }
    });

    it('updating a slicer name to conflict with another throws an error', async () => {
      bridge.getAllSlicersWorkbook.mockResolvedValue([
        {
          id: 'slicer-a',
          caption: 'SlicerA',
          name: 'SlicerA',
          source: { type: 'table', tableId: 'T1', columnCellId: 'C1' },
        },
        {
          id: 'slicer-b',
          caption: 'SlicerB',
          name: 'SlicerB',
          source: { type: 'table', tableId: 'T1', columnCellId: 'C2' },
        },
      ]);

      // Try to rename slicer-b to "SlicerA" which conflicts with slicer-a
      await expect(slicers.update('slicer-b', { name: 'SlicerA' })).rejects.toThrow(
        /already exists/,
      );
    });

    it('updating a slicer name to its own name succeeds (self-exclusion)', async () => {
      bridge.getAllSlicersWorkbook.mockResolvedValue([
        {
          id: 'slicer-x',
          caption: 'MyName',
          name: 'MyName',
          source: { type: 'table', tableId: 'T1', columnCellId: 'C1' },
        },
      ]);

      // Renaming slicer-x to "MyName" (its own name) should NOT throw
      await expect(slicers.update('slicer-x', { name: 'MyName' })).resolves.not.toThrow();

      expect(bridge.updateSlicerConfig).toHaveBeenCalledWith(
        SHEET_ID,
        'slicer-x',
        expect.objectContaining({ name: 'MyName' }),
      );
    });

    it('creating a slicer with a unique name succeeds', async () => {
      bridge.getAllSlicersWorkbook.mockResolvedValue([
        {
          id: 'existing-1',
          caption: 'ExistingSlicer',
          name: 'ExistingSlicer',
          source: { type: 'table', tableId: 'T1', columnCellId: 'C1' },
        },
      ]);
      bridge.getTableByName.mockResolvedValue({
        id: 'tbl-unique',
        name: 'T2',
        displayName: 'T2',
        sheetId: String(SHEET_ID),
        columns: [{ name: 'C2', id: 'col-unique', index: 0 }],
        range: { startRow: 0, startCol: 0, endRow: 4, endCol: 0 },
        hasHeaderRow: true,
        hasTotalsRow: false,
      });

      // "NewSlicer" does not conflict
      await expect(
        slicers.add({
          name: 'NewSlicer',
          caption: 'New Slicer Caption',
          source: { type: 'table', tableId: 'T2', columnCellId: 'C2' },
        } as any),
      ).resolves.not.toThrow();

      expect(bridge.createSlicer).toHaveBeenCalled();
    });

    it('creating a slicer without a name succeeds (no uniqueness check)', async () => {
      bridge.getAllSlicersWorkbook.mockResolvedValue([]);
      bridge.getTableByName.mockResolvedValue({
        id: 'tbl-no-name',
        name: 'T1',
        displayName: 'T1',
        sheetId: String(SHEET_ID),
        columns: [{ name: 'C1', id: 'col-no-name', index: 0 }],
        range: { startRow: 0, startCol: 0, endRow: 4, endCol: 0 },
        hasHeaderRow: true,
        hasTotalsRow: false,
      });

      await expect(
        slicers.add({
          source: { type: 'table', tableId: 'T1', columnCellId: 'C1' },
        } as any),
      ).resolves.not.toThrow();

      expect(bridge.createSlicer).toHaveBeenCalled();
    });

    it('creating a table slicer stores canonical source and public cache name', async () => {
      bridge.getAllSlicersWorkbook.mockResolvedValue([]);
      bridge.getTableByName.mockResolvedValue({
        id: 'tbl-sales',
        name: 'SalesTable',
        displayName: 'SalesTable',
        sheetId: String(SHEET_ID),
        columns: [
          { name: 'Region', id: 'col-region', index: 0 },
          { name: 'Amount', id: 'col-amount', index: 1 },
        ],
        range: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 },
        hasHeaderRow: true,
        hasTotalsRow: false,
      });

      await slicers.add({
        name: 'RegionSlicer',
        caption: 'Region',
        tableName: 'SalesTable',
        columnName: 'Amount',
      } as any);

      const [, config] = bridge.createSlicer.mock.calls[0];
      expect(config).toEqual(
        expect.objectContaining({
          source: {
            type: 'table',
            tableId: 'tbl-sales',
            columnCellId: 'col-amount',
          },
          cacheName: 'Slicer_Amount',
          tableColumnIndex: 1,
        }),
      );
    });
  });

  // =========================================================================
  // Group: getState returns real items and connectivity
  // =========================================================================
  describe('getState returns enriched runtime state', () => {
    it('getState returns items from a connected table slicer', async () => {
      // Set up a table slicer with real data
      bridge.getSlicerState.mockResolvedValue({
        id: 'slicer-t1',
        caption: 'Region',
        source: { type: 'table', tableId: 'SalesTable', columnCellId: 'col-region' },
        selectedValues: [],
        position: { x: 0, y: 0, width: 200, height: 300 },
        style: null,
        zIndex: 0,
        locked: false,
        showHeader: true,
      });

      // Mock table with columns
      bridge.getTableByName.mockResolvedValue({
        id: 'SalesTable',
        columns: [
          { name: 'Region', id: 'Region' },
          { name: 'Amount', id: 'Amount' },
        ],
        range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
        hasHeaderRow: true,
        hasTotalsRow: false,
      });

      // Mock cell data for column values (rows 1-3, col 0 = "Region")
      bridge.getCellsInRangeYrs.mockResolvedValue([
        { row: 1, col: 0, value: { type: 'text', value: 'East' } },
        { row: 2, col: 0, value: { type: 'text', value: 'West' } },
        { row: 3, col: 0, value: { type: 'text', value: 'East' } },
      ]);

      const state = await slicers.getState('slicer-t1');

      expect(state.isConnected).toBe(true);
      expect(state.items.length).toBe(2); // "East" and "West" unique values
      expect(state.items.map((i) => i.value)).toEqual(expect.arrayContaining(['East', 'West']));
      expect(state.items.find((i) => i.value === 'East')?.count).toBe(2);
      expect(state.items.find((i) => i.value === 'West')?.count).toBe(1);
    });

    it('resolves table slicer items from a header CellId source', async () => {
      bridge.getSlicerState.mockResolvedValue({
        id: 'slicer-cell-id',
        caption: 'Region',
        source: {
          type: 'table',
          tableId: 'SalesTable',
          columnCellId: 'header-region-cell-id',
        },
        selectedValues: [],
        position: { x: 0, y: 0, width: 200, height: 300 },
        style: null,
        zIndex: 0,
        locked: false,
        showHeader: true,
      });
      bridge.getAllTablesInSheet.mockResolvedValue([
        {
          id: 'SalesTable',
          name: 'SalesTable',
          displayName: 'SalesTable',
          sheetId: String(SHEET_ID),
          columns: [
            { name: 'Region', id: 'col-1', index: 0 },
            { name: 'Amount', id: 'col-2', index: 1 },
          ],
          range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
          hasHeaderRow: true,
          hasTotalsRow: false,
        },
      ]);
      bridge.getCellPosition.mockResolvedValue({ row: 0, col: 0 });
      bridge.getCellsInRangeYrs.mockResolvedValue([
        { row: 1, col: 0, value: { type: 'text', value: 'East' } },
        { row: 2, col: 0, value: { type: 'text', value: 'West' } },
        { row: 3, col: 0, value: { type: 'text', value: 'East' } },
      ]);

      const state = await slicers.getState('slicer-cell-id');

      expect(state.isConnected).toBe(true);
      expect(bridge.getCellPosition).toHaveBeenCalledWith(SHEET_ID, 'header-region-cell-id');
      expect(bridge.getCellsInRangeYrs).toHaveBeenCalledWith(SHEET_ID, 1, 0, 3, 0);
      expect(state.items.map((item) => item.value)).toEqual(
        expect.arrayContaining(['East', 'West']),
      );
    });

    it('returns numeric slicer items from Rust number cell values', async () => {
      bridge.getSlicerState.mockResolvedValue({
        id: 'slicer-amount',
        caption: 'Amount',
        source: {
          type: 'table',
          tableId: 'SalesTable',
          columnCellId: 'header-amount-cell-id',
        },
        selectedValues: [],
        position: { x: 0, y: 0, width: 200, height: 300 },
        style: null,
        zIndex: 0,
        locked: false,
        showHeader: true,
      });
      bridge.getAllTablesInSheet.mockResolvedValue([
        {
          id: 'SalesTable',
          name: 'SalesTable',
          displayName: 'SalesTable',
          sheetId: String(SHEET_ID),
          columns: [
            { name: 'Region', id: 'col-1', index: 0 },
            { name: 'Amount', id: 'col-2', index: 1 },
          ],
          range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
          hasHeaderRow: true,
          hasTotalsRow: false,
        },
      ]);
      bridge.getCellPosition.mockResolvedValue({ row: 0, col: 1 });
      bridge.getCellsInRangeYrs.mockResolvedValue([
        { row: 1, col: 1, value: { type: 'number', value: 10 } },
        { row: 2, col: 1, value: { type: 'number', value: 20 } },
        { row: 3, col: 1, value: { type: 'number', value: 10 } },
      ]);

      const state = await slicers.getState('slicer-amount');

      expect(state.isConnected).toBe(true);
      expect(state.items.map((item) => item.value)).toEqual(expect.arrayContaining([10, 20]));
      expect(state.items.find((item) => item.value === 10)?.count).toBe(2);
      expect(state.items.find((item) => item.value === 20)?.count).toBe(1);
    });

    it('applies slicer selection to the resolved CellId-backed table column', async () => {
      bridge.getSlicerState.mockResolvedValue({
        id: 'slicer-cell-id',
        caption: 'Region',
        source: {
          type: 'table',
          tableId: 'SalesTable',
          columnCellId: 'header-region-cell-id',
        },
        selectedValues: [],
        position: { x: 0, y: 0, width: 200, height: 300 },
        style: null,
        zIndex: 0,
        locked: false,
        showHeader: true,
      });
      bridge.getAllTablesInSheet.mockResolvedValue([
        {
          id: 'SalesTable',
          name: 'SalesTable',
          displayName: 'SalesTable',
          sheetId: SHEET_ID,
          columns: [
            { name: 'Region', id: 'col-1', index: 0 },
            { name: 'Amount', id: 'col-2', index: 1 },
          ],
          range: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
          hasHeaderRow: true,
          hasTotalsRow: false,
        },
      ]);
      bridge.getCellPosition.mockResolvedValue({ row: 0, col: 0 });

      await slicers.setSelection('slicer-cell-id', ['West']);

      expect(bridge.clearSlicerSelection).toHaveBeenCalledWith(SHEET_ID, 'slicer-cell-id');
      expect(bridge.toggleSlicerItem).toHaveBeenCalledWith(SHEET_ID, 'slicer-cell-id', 'West');
      expect(bridge.setColumnFilter).toHaveBeenCalledWith(
        SHEET_ID,
        'f-1',
        0,
        expect.objectContaining({ type: 'values', values: ['West'] }),
      );
    });

    it('getState returns isConnected=false when table is missing', async () => {
      bridge.getSlicerState.mockResolvedValue({
        id: 'slicer-orphan',
        caption: 'Orphan',
        source: { type: 'table', tableId: 'DeletedTable', columnCellId: 'Col' },
        selectedValues: [],
        position: {},
        style: null,
        zIndex: 0,
        locked: false,
        showHeader: true,
      });
      bridge.getTableByName.mockResolvedValue(null);

      const state = await slicers.getState('slicer-orphan');

      expect(state.isConnected).toBe(false);
      expect(state.items).toEqual([]);
    });

    it('getState throws KernelError when slicer not found', async () => {
      bridge.getSlicerState.mockResolvedValue(null);

      await expect(slicers.getState('nonexistent')).rejects.toThrow(KernelError);
    });
  });
});

// =============================================================================
// WorkbookSlicerStylesImpl Tests
// =============================================================================

describe('WorkbookSlicerStylesImpl', () => {
  let bridge: ReturnType<typeof createMockComputeBridge>;
  let styles: WorkbookSlicerStylesImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = createMockComputeBridge();
    const ctx = createMockCtx(bridge);
    styles = new WorkbookSlicerStylesImpl({ ctx });
  });

  // =========================================================================
  // Group 3: Named style registry (workbook-level)
  // =========================================================================
  describe('Group 3: Named slicer style registry', () => {
    it('add() creates a named style and returns the final name', async () => {
      bridge.addSlicerStyle.mockResolvedValue({
        data: 'MyCustomStyle',
      });

      const customStyle = {
        headerBackgroundColor: '#FF0000',
        selectedBackgroundColor: '#00FF00',
      };

      const result = await styles.add('MyCustomStyle', customStyle);

      expect(bridge.addSlicerStyle).toHaveBeenCalledWith('MyCustomStyle', customStyle, false);
      expect(result).toBe('MyCustomStyle');
    });

    it('add() with makeUniqueName=true passes flag to bridge', async () => {
      bridge.addSlicerStyle.mockResolvedValue({
        data: 'MyStyle 2',
      });

      const result = await styles.add('MyStyle', { borderColor: '#000' }, true);

      expect(bridge.addSlicerStyle).toHaveBeenCalledWith('MyStyle', { borderColor: '#000' }, true);
      expect(result).toBe('MyStyle 2');
    });

    it('add() returns the input name when bridge returns no data', async () => {
      bridge.addSlicerStyle.mockResolvedValue({ data: null });

      const result = await styles.add('FallbackName', {});

      expect(result).toBe('FallbackName');
    });

    it('get() returns the style when found', async () => {
      const mockStyle = {
        name: 'Custom1',
        readOnly: false,
        style: { headerBackgroundColor: '#123456' },
      };
      bridge.getSlicerStyle.mockResolvedValue(mockStyle);

      const result = await styles.get('Custom1');

      expect(bridge.getSlicerStyle).toHaveBeenCalledWith('Custom1');
      expect(result).toEqual(mockStyle);
    });

    it('get() returns null when not found', async () => {
      bridge.getSlicerStyle.mockResolvedValue(null);

      const result = await styles.get('NonExistent');

      expect(result).toBeNull();
    });

    it('remove() removes a style by name', async () => {
      await styles.remove('ObsoleteStyle');

      expect(bridge.deleteSlicerStyle).toHaveBeenCalledWith('ObsoleteStyle');
    });

    it('duplicate() creates a copy and returns the new name', async () => {
      bridge.duplicateSlicerStyle.mockResolvedValue({
        data: 'OriginalStyle Copy',
      });

      const result = await styles.duplicate('OriginalStyle');

      expect(bridge.duplicateSlicerStyle).toHaveBeenCalledWith('OriginalStyle');
      expect(result).toBe('OriginalStyle Copy');
    });

    it('duplicate() rejects when bridge returns no data', async () => {
      bridge.duplicateSlicerStyle.mockResolvedValue({ data: null });

      await expect(styles.duplicate('SomeStyle')).rejects.toThrow(KernelError);
    });

    it('getCount() returns the number of built-in styles', async () => {
      const count = await styles.getCount();

      // Built-in styles: light1-6, dark1-6, other1-2 = 14 total
      expect(count).toBe(14);
    });

    it('list() returns built-in styles with isDefault flag', async () => {
      bridge.getDefaultSlicerStyle.mockResolvedValue('dark2');

      const items = await styles.list();

      expect(items).toHaveLength(14);

      const defaultItem = items.find((i) => i.name === 'dark2');
      expect(defaultItem).toBeDefined();
      expect(defaultItem!.isDefault).toBe(true);

      const nonDefaultItem = items.find((i) => i.name === 'light1');
      expect(nonDefaultItem).toBeDefined();
      expect(nonDefaultItem!.isDefault).toBe(false);
    });

    it('getItem() returns a built-in style with isDefault flag', async () => {
      bridge.getDefaultSlicerStyle.mockResolvedValue('light3');

      const item = await styles.getItem('light3');

      expect(item).not.toBeNull();
      expect(item!.name).toBe('light3');
      expect(item!.isDefault).toBe(true);
    });

    it('getItem() returns null for unknown style name', async () => {
      const item = await styles.getItem('nonexistent-style');

      expect(item).toBeNull();
    });

    it('getDefault() returns light1 when no default is set', async () => {
      bridge.getDefaultSlicerStyle.mockResolvedValue(null);

      const result = await styles.getDefault();

      expect(result).toBe('light1');
    });

    it('setDefault() delegates to bridge', async () => {
      await styles.setDefault('dark5');

      expect(bridge.setDefaultSlicerStyle).toHaveBeenCalledWith('dark5');
    });
  });
});
