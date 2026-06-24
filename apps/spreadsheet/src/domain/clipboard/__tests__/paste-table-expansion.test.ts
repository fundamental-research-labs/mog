import { jest } from '@jest/globals';

import { EXTERNAL_SOURCE_SHEET_ID, type ClipboardData } from '@mog-sdk/contracts/actors';
import type { SheetId } from '@mog-sdk/contracts/core';

import {
  createDefaultPasteOptions,
  executePaste,
  type PasteStoreOperations,
} from '../paste-executor';

describe('executePaste table expansion', () => {
  it('expands an auto-expand table when values are pasted directly below it', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const setCellValues = jest.fn();
    const resizeTable = jest.fn();
    const store: PasteStoreOperations = {
      setCellValues,
      setCellFormat: jest.fn(),
      getCellData: jest.fn(),
      getTables: jest.fn(async () => [
        {
          name: 'Table1',
          range: 'A1:B3',
          autoExpand: true,
          hasTotalsRow: false,
        },
      ]),
      resizeTable,
    };
    const data: ClipboardData = {
      sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
      sourceRanges: [],
      cells: {
        '0,0': { raw: 'C' },
        '0,1': { raw: '30' },
        '1,0': { raw: 'D' },
        '1,1': { raw: '40' },
      },
    };

    const result = await executePaste(
      data,
      { row: 3, col: 0 },
      sheetId,
      createDefaultPasteOptions(),
      store,
    );

    expect(result.success).toBe(true);
    expect(setCellValues).toHaveBeenCalledWith(sheetId, [
      { row: 3, col: 0, value: 'C' },
      { row: 3, col: 1, value: '30' },
      { row: 4, col: 0, value: 'D' },
      { row: 4, col: 1, value: '40' },
    ]);
    expect(resizeTable).toHaveBeenCalledWith(sheetId, 'Table1', 'A1:B5');
  });

  it('does not expand tables for format-only paste', async () => {
    const sheetId = 'sheet-1' as SheetId;
    const store: PasteStoreOperations = {
      setCellValues: jest.fn(),
      setCellFormat: jest.fn(),
      getCellData: jest.fn(),
      getTables: jest.fn(async () => [
        {
          name: 'Table1',
          range: 'A1:B3',
          autoExpand: true,
          hasTotalsRow: false,
        },
      ]),
      resizeTable: jest.fn(),
    };
    const data: ClipboardData = {
      sourceSheetId: EXTERNAL_SOURCE_SHEET_ID,
      sourceRanges: [],
      cells: {
        '0,0': { raw: undefined, format: { bold: true } },
      },
    };

    const result = await executePaste(
      data,
      { row: 3, col: 0 },
      sheetId,
      { ...createDefaultPasteOptions(), formats: true },
      store,
    );

    expect(result.success).toBe(true);
    expect(store.resizeTable).not.toHaveBeenCalled();
  });
});
