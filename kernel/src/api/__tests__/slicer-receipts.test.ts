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
  extractMutationData: jest.fn((result: any) => {
    if (result?.data === undefined || result?.data === null) return undefined;
    return result.data;
  }),
}));

import { WorksheetSlicersImpl } from '../worksheet/slicers';

const SHEET_ID = sheetId('sheet-1');

const SALES_TABLE = {
  id: 'SalesTable',
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
};

function storedSalesSlicer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'slicer-1',
    sheetId: String(SHEET_ID),
    caption: 'Region',
    name: 'RegionSlicer',
    source: { type: 'table', tableId: 'SalesTable', columnCellId: 'col-region' },
    style: null,
    position: null,
    zIndex: 0,
    locked: false,
    showHeader: true,
    multiSelect: true,
    selectedValues: [],
    ...overrides,
  };
}

function mutation(kind: string, data: ReturnType<typeof storedSalesSlicer>) {
  return {
    data,
    slicerChanges: [
      {
        sheetId: String(SHEET_ID),
        slicerId: data.id,
        kind,
        data,
        selectedValues: data.selectedValues,
      },
    ],
  };
}

function createMockComputeBridge() {
  return {
    createSlicer: jest.fn().mockResolvedValue(mutation('created', storedSalesSlicer())),
    deleteSlicer: jest.fn().mockResolvedValue(mutation('deleted', storedSalesSlicer())),
    getAllSlicers: jest.fn().mockResolvedValue([]),
    getAllSlicersWorkbook: jest.fn().mockResolvedValue([]),
    getSlicerState: jest.fn().mockResolvedValue(null),
    updateSlicerConfig: jest.fn().mockResolvedValue(mutation('updated', storedSalesSlicer())),
    setSlicerSelection: jest
      .fn()
      .mockResolvedValue(mutation('selectionChanged', storedSalesSlicer())),
    clearSlicerSelection: jest.fn().mockResolvedValue(undefined),
    getSheetProtectionOptions: jest.fn().mockResolvedValue(null),
    toggleSlicerItem: jest.fn().mockResolvedValue(undefined),
    getTableByName: jest.fn().mockResolvedValue(null),
    getAllTablesInSheet: jest.fn().mockResolvedValue([SALES_TABLE]),
    getAllTablesWorkbook: jest.fn().mockResolvedValue([]),
    getCellsInRangeYrs: jest.fn().mockResolvedValue([]),
    getCellPosition: jest.fn().mockResolvedValue(null),
    getFiltersInSheet: jest.fn().mockResolvedValue([
      {
        id: 'f-1',
        tableId: 'SalesTable',
        type: 'tableFilter',
        headerStartCellId: '',
        headerEndCellId: '',
        dataEndCellId: '',
        columnFilters: {},
      },
    ]),
    setColumnFilter: jest.fn().mockResolvedValue(undefined),
    clearColumnFilter: jest.fn().mockResolvedValue(undefined),
    applyFilter: jest.fn().mockResolvedValue(undefined),
    pivotGet: jest.fn().mockResolvedValue(null),
    pivotGetAllItems: jest.fn().mockResolvedValue([]),
  };
}

function createMockCtx(bridge = createMockComputeBridge()) {
  return {
    computeBridge: bridge,
    eventBus: { emit: jest.fn() },
    writeGate: { assertWritable: jest.fn() },
    awaitMaterialized: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('WorksheetSlicersImpl operation receipts', () => {
  let bridge: ReturnType<typeof createMockComputeBridge>;
  let slicers: WorksheetSlicersImpl;

  beforeEach(() => {
    jest.clearAllMocks();
    bridge = createMockComputeBridge();
    slicers = new WorksheetSlicersImpl(createMockCtx(bridge), SHEET_ID);
  });

  it('add returns a receipt preserving the created slicer payload', async () => {
    bridge.getTableByName.mockResolvedValue(SALES_TABLE);
    const created = storedSalesSlicer({
      id: 'slicer-new',
      caption: 'Region',
      name: 'RegionSlicer',
    });
    bridge.createSlicer.mockResolvedValue(mutation('created', created));

    const receipt = await slicers.add({
      name: 'RegionSlicer',
      caption: 'Region',
      tableName: 'SalesTable',
      columnName: 'Region',
    } as any);

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'slicer.add',
        status: 'applied',
        slicerId: 'slicer-new',
        sourceTableId: 'SalesTable',
        slicer: expect.objectContaining({
          id: 'slicer-new',
          name: 'RegionSlicer',
          caption: 'Region',
          tableName: 'SalesTable',
          columnName: 'Region',
        }),
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'createdObject', objectId: 'slicer-new' }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'slicer-new' }),
      ]),
    );
  });

  it('update returns an updated-object receipt for persisted slicer changes', async () => {
    bridge.getSlicerState.mockResolvedValue(
      storedSalesSlicer({
        caption: 'Region Filter',
      }),
    );
    bridge.updateSlicerConfig.mockResolvedValue(
      mutation('updated', storedSalesSlicer({ caption: 'Region Filter' })),
    );

    const receipt = await slicers.update('slicer-1', { caption: 'Region Filter' });

    expect(bridge.updateSlicerConfig).toHaveBeenCalledWith(SHEET_ID, 'slicer-1', {
      caption: 'Region Filter',
    });
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'slicer.update',
        status: 'applied',
        slicerId: 'slicer-1',
        sourceTableId: 'SalesTable',
        slicer: expect.objectContaining({ caption: 'Region Filter' }),
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'updatedObject', objectId: 'slicer-1' }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'slicer-1' }),
      ]),
    );
  });

  it('remove returns a removal receipt with the prior slicer projection', async () => {
    bridge.getSlicerState.mockResolvedValue(storedSalesSlicer());
    bridge.deleteSlicer.mockResolvedValue(mutation('deleted', storedSalesSlicer()));

    const receipt = await slicers.remove('slicer-1');

    expect(bridge.deleteSlicer).toHaveBeenCalledWith(SHEET_ID, 'slicer-1');
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'slicer.remove',
        status: 'applied',
        slicerId: 'slicer-1',
        sourceTableId: 'SalesTable',
        slicer: expect.objectContaining({ id: 'slicer-1', caption: 'Region' }),
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removedObject', objectId: 'slicer-1' }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'slicer-1' }),
      ]),
    );
  });

  it('duplicate returns a receipt preserving the new slicer ID payload', async () => {
    bridge.getSlicerState.mockImplementation((...args: unknown[]) =>
      Promise.resolve(storedSalesSlicer({ id: String(args[1] ?? 'slicer-1') })),
    );
    bridge.createSlicer.mockResolvedValue(
      mutation('created', storedSalesSlicer({ id: 'slicer-2', selectedValues: [] })),
    );

    const receipt = await slicers.duplicate('slicer-1');

    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'slicer.duplicate',
        status: 'applied',
        slicerId: 'slicer-2',
        sourceSlicerId: 'slicer-1',
        sourceTableId: 'SalesTable',
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'createdObject', objectId: 'slicer-2' }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'slicer-2' }),
      ]),
    );
  });

  it('setSelection returns a receipt with filter projection effects', async () => {
    bridge.getSlicerState.mockResolvedValue(
      storedSalesSlicer({
        selectedValues: ['West'],
      }),
    );
    bridge.setSlicerSelection.mockResolvedValue(
      mutation('selectionChanged', storedSalesSlicer({ selectedValues: ['West'] })),
    );

    const receipt = await slicers.setSelection('slicer-1', ['West']);

    expect(bridge.setColumnFilter).toHaveBeenCalledWith(
      SHEET_ID,
      'f-1',
      0,
      expect.objectContaining({ type: 'values', values: ['West'] }),
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'slicer.selection.set',
        status: 'applied',
        slicerId: 'slicer-1',
        selectedItems: ['West'],
        sourceTableId: 'SalesTable',
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'updatedObject', objectId: 'slicer-1' }),
        expect.objectContaining({
          type: 'changedFilterProjection',
          sheetId: SHEET_ID,
          range: 'A1:B5',
        }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'slicer-1' }),
      ]),
    );
  });

  it('clearSelection returns a receipt with clear projection effects', async () => {
    bridge.getSlicerState.mockResolvedValue(storedSalesSlicer());
    bridge.setSlicerSelection.mockResolvedValue(
      mutation('selectionChanged', storedSalesSlicer({ selectedValues: [] })),
    );

    const receipt = await slicers.clearSelection('slicer-1');

    expect(bridge.clearColumnFilter).toHaveBeenCalledWith(SHEET_ID, 'f-1', 0);
    expect(receipt).toEqual(
      expect.objectContaining({
        kind: 'slicer.selection.clear',
        status: 'applied',
        slicerId: 'slicer-1',
        selectedItems: [],
        sourceTableId: 'SalesTable',
      }),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'updatedObject', objectId: 'slicer-1' }),
        expect.objectContaining({
          type: 'changedFilterProjection',
          sheetId: SHEET_ID,
          range: 'A1:B5',
        }),
        expect.objectContaining({ type: 'invalidatedCache', objectId: 'slicer-1' }),
      ]),
    );
  });

  it('rejects add and duplicate when native creation evidence is absent', async () => {
    bridge.getTableByName.mockResolvedValue(SALES_TABLE);
    bridge.createSlicer.mockResolvedValue({ data: storedSalesSlicer({ id: 'fabricated' }) });

    await expect(
      slicers.add({
        tableName: 'SalesTable',
        columnName: 'Region',
      } as any),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED' });

    bridge.getSlicerState.mockResolvedValue(storedSalesSlicer());
    await expect(slicers.duplicate('slicer-1')).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
    });
  });

  it('builds clear receipts only from observed delete evidence', async () => {
    bridge.getAllSlicers.mockResolvedValue([storedSalesSlicer()]);
    bridge.deleteSlicer.mockResolvedValue({ slicerChanges: [] });

    await expect(slicers.clear()).rejects.toMatchObject({ code: 'OPERATION_FAILED' });
  });
});
