import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

import { WorkbookSlicersImpl } from '../workbook/slicers';

const SHEET_ID = sheetId('sheet-1');

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
      remove: jest.fn(),
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
});
