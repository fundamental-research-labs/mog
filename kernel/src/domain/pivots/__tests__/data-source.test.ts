import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { convertSimpleToDataConfig } from '../data-source';

const SHEET_ID = sheetId('sheet-1');

function makeContext() {
  return {
    computeBridge: {
      getAllSheetIds: jest.fn().mockResolvedValue([SHEET_ID]),
      getSheetName: jest.fn().mockResolvedValue('Sheet1'),
      queryRange: jest
        .fn()
        .mockImplementation(
          async (
            _sheetId: unknown,
            startRow: number,
            startCol: number,
            endRow: number,
            endCol: number,
          ) => {
            const cells = [];
            if (startRow === 0 && endRow === 0) {
              const headers = ['Category', 'Amount'];
              for (let col = startCol; col <= endCol; col++) {
                cells.push({ row: 0, col, value: headers[col - startCol] });
              }
            } else {
              cells.push({ row: startRow, col: startCol, value: 'North' });
              cells.push({ row: startRow, col: startCol + 1, value: 150 });
            }
            return { cells };
          },
        ),
    },
  } as any;
}

describe('convertSimpleToDataConfig', () => {
  it('honors outputLocation and outputSheetName aliases', async () => {
    const dataConfig = await convertSimpleToDataConfig(
      makeContext(),
      {
        name: 'AliasPivot',
        dataSource: 'Sheet1!A1:B3',
        rowFields: ['Category'],
        valueFields: [{ field: 'Amount', aggregation: 'sum' }],
        outputSheetName: 'Report',
        outputLocation: { row: 4, col: 6 },
      } as any,
      'Sheet1',
      (area, fieldId, position) => `${area}:${fieldId}:${position}` as any,
    );

    expect(dataConfig).toEqual(
      expect.objectContaining({
        outputSheetName: 'Report',
        outputLocation: { row: 4, col: 6 },
      }),
    );
  });
});
