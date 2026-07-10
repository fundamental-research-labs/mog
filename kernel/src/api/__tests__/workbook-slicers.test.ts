import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import { WorkbookSlicersImpl } from '../workbook/slicers';
import { KernelError } from '../../errors';

const SHEET_ID = sheetId('sheet-1');

const REMOVE_RECEIPT = {
  kind: 'slicer.remove',
  status: 'applied',
  effects: [
    {
      type: 'removedObject',
      sheetId: SHEET_ID,
      objectId: 'slicer-imported',
      details: { objectType: 'slicer', sourceTableId: 'tbl-stable-sales' },
    },
    {
      type: 'invalidatedCache',
      sheetId: SHEET_ID,
      objectId: 'slicer-imported',
      details: {
        objectType: 'slicer',
        sourceTableId: 'tbl-stable-sales',
        cache: 'slicerList',
      },
    },
  ],
  diagnostics: [],
  slicerId: 'slicer-imported',
  sourceTableId: 'tbl-stable-sales',
  slicer: {
    id: 'slicer-imported',
    name: 'RegionSlicer',
    caption: 'Region',
    tableName: 'SdkSlicerSales',
    columnName: 'Region',
    source: {
      type: 'table',
      tableId: 'tbl-stable-sales',
      columnCellId: 'col-stable-region',
    },
    selectedItems: [],
    position: { x: 0, y: 0, width: 200, height: 300 },
  },
} as const;

function createMockComputeBridge() {
  return {
    getAllSlicersWorkbook: jest.fn().mockResolvedValue([]),
  };
}

function createMockCtx(bridge = createMockComputeBridge()) {
  return {
    computeBridge: bridge,
  } as any;
}

describe('WorkbookSlicersImpl', () => {
  it('lists slicers through the worksheet public projection', async () => {
    const bridge = createMockComputeBridge();
    const ctx = createMockCtx(bridge);
    bridge.getAllSlicersWorkbook.mockResolvedValue([
      {
        id: 'slicer-imported',
        sheetId: String(SHEET_ID),
        caption: 'Region',
        name: 'RegionSlicer',
        source: {
          type: 'table',
          tableId: 'tbl-stable-sales',
          columnCellId: 'col-stable-region',
        },
      },
    ]);
    const worksheetSlicers = {
      get: jest.fn().mockResolvedValue({
        id: 'slicer-imported',
        name: 'RegionSlicer',
        caption: 'Region',
        tableName: 'SdkSlicerSales',
        columnName: 'Region',
        source: {
          type: 'table',
          tableId: 'tbl-stable-sales',
          columnCellId: 'col-stable-region',
        },
        selectedItems: ['West'],
        position: { x: 0, y: 0, width: 200, height: 300 },
      }),
      getItems: jest.fn(),
      getItem: jest.fn(),
      getItemOrNullObject: jest.fn(),
      remove: jest.fn().mockResolvedValue(REMOVE_RECEIPT),
    };
    const getWorksheetSlicers = jest.fn(() => worksheetSlicers);
    const workbookSlicers = new WorkbookSlicersImpl({
      ctx,
      getWorksheetSlicers,
    });

    await expect(workbookSlicers.list()).resolves.toEqual([
      {
        id: 'slicer-imported',
        name: 'RegionSlicer',
        caption: 'Region',
        tableName: 'SdkSlicerSales',
        columnName: 'Region',
        source: {
          type: 'table',
          tableId: 'tbl-stable-sales',
          columnCellId: 'col-stable-region',
        },
      },
    ]);
    expect(getWorksheetSlicers).toHaveBeenCalledWith(SHEET_ID);
    expect(worksheetSlicers.get).toHaveBeenCalledWith('slicer-imported');
  });

  it('returns worksheet remove receipts and invalidates the workbook slicer cache', async () => {
    const bridge = createMockComputeBridge();
    const ctx = createMockCtx(bridge);
    bridge.getAllSlicersWorkbook.mockResolvedValue([
      {
        id: 'slicer-imported',
        sheetId: String(SHEET_ID),
        caption: 'Region',
        name: 'RegionSlicer',
        source: {
          type: 'table',
          tableId: 'tbl-stable-sales',
          columnCellId: 'col-stable-region',
        },
      },
    ]);
    const worksheetSlicers = {
      get: jest.fn(),
      getItems: jest.fn(),
      getItem: jest.fn(),
      getItemOrNullObject: jest.fn(),
      remove: jest.fn().mockResolvedValue(REMOVE_RECEIPT),
    };
    const getWorksheetSlicers = jest.fn(() => worksheetSlicers);
    const workbookSlicers = new WorkbookSlicersImpl({
      ctx,
      getWorksheetSlicers,
    });

    await expect(workbookSlicers.getCount()).resolves.toBe(1);
    await expect(workbookSlicers.remove('slicer-imported')).resolves.toBe(REMOVE_RECEIPT);

    bridge.getAllSlicersWorkbook.mockResolvedValue([]);
    await expect(workbookSlicers.getCount()).resolves.toBe(0);
    expect(worksheetSlicers.remove).toHaveBeenCalledWith('slicer-imported');
    expect(bridge.getAllSlicersWorkbook).toHaveBeenCalledTimes(3);
  });

  it('always observes worksheet-scoped add/remove and history replay without a stale cache', async () => {
    const bridge = createMockComputeBridge();
    const ctx = createMockCtx(bridge);
    let authoritative: any[] = [];
    bridge.getAllSlicersWorkbook.mockImplementation(() => Promise.resolve(authoritative));
    const worksheetSlicers = {
      get: jest.fn().mockResolvedValue(REMOVE_RECEIPT.slicer),
      getItems: jest.fn(),
      getItem: jest.fn(),
      getItemOrNullObject: jest.fn(),
      remove: jest.fn().mockResolvedValue(REMOVE_RECEIPT),
    };
    const workbookSlicers = new WorkbookSlicersImpl({
      ctx,
      getWorksheetSlicers: () => worksheetSlicers,
    });

    await expect(workbookSlicers.getCount()).resolves.toBe(0);
    authoritative = [
      {
        id: 'slicer-imported',
        sheetId: String(SHEET_ID),
        caption: 'Region',
        name: 'RegionSlicer',
        source: REMOVE_RECEIPT.slicer.source,
      },
    ];
    await expect(workbookSlicers.getCount()).resolves.toBe(1);
    await expect(workbookSlicers.get('slicer-imported')).resolves.toEqual(REMOVE_RECEIPT.slicer);

    authoritative = [];
    await expect(workbookSlicers.list()).resolves.toEqual([]);
    authoritative = [
      {
        id: 'slicer-imported',
        sheetId: String(SHEET_ID),
        caption: 'Region',
        name: 'RegionSlicer',
        source: REMOVE_RECEIPT.slicer.source,
      },
    ];
    await expect(workbookSlicers.getCount()).resolves.toBe(1);
  });

  it('uses SLICER_NOT_FOUND for strict workbook targets', async () => {
    const workbookSlicers = new WorkbookSlicersImpl({
      ctx: createMockCtx(),
      getWorksheetSlicers: jest.fn() as any,
    });

    for (const action of [
      () => workbookSlicers.getItem('missing', 'x'),
      () => workbookSlicers.remove('missing'),
    ]) {
      await expect(action()).rejects.toMatchObject<Partial<KernelError>>({
        code: 'SLICER_NOT_FOUND',
      });
    }
  });
});
