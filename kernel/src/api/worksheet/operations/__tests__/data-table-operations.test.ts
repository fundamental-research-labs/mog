import { jest } from '@jest/globals';

import * as DataTableOps from '../data-table-operations';

function createMockCtx(overrides: Record<string, jest.Mock> = {}): any {
  return {
    computeBridge: {
      createDataTable: jest.fn(),
      ...overrides,
    },
  };
}

describe('data table operations', () => {
  describe('createDataTable', () => {
    it('passes the sheet-scoped creation request to Rust and returns the result payload', async () => {
      const ctx = createMockCtx({
        createDataTable: jest.fn().mockResolvedValue({
          data: {
            regionId: 'sheet-1:1:1:3:3',
            tableRange: 'B2:D4',
            bodyRange: 'C3:D4',
            rowInputCell: 'A1',
            colInputCell: 'A2',
            rowsComputed: 2,
            colsComputed: 2,
            cellCount: 4,
          },
        }),
      });

      const result = await DataTableOps.createDataTable(ctx, 'sheet-1', {
        tableRange: 'B2:D4',
        rowInputCell: 'A1',
        colInputCell: 'A2',
      });

      expect(ctx.computeBridge.createDataTable).toHaveBeenCalledWith('sheet-1', 1, 1, 3, 3, {
        sheetId: 'sheet-1',
        tableRange: 'B2:D4',
        rowInputCell: 'A1',
        colInputCell: 'A2',
      });
      expect(result).toEqual({
        regionId: 'sheet-1:1:1:3:3',
        tableRange: 'B2:D4',
        bodyRange: 'C3:D4',
        rowInputCell: 'A1',
        colInputCell: 'A2',
        rowsComputed: 2,
        colsComputed: 2,
        cellCount: 4,
      });
    });

    it('fails when Rust does not return CreateDataTableResult data', async () => {
      const ctx = createMockCtx({
        createDataTable: jest.fn().mockResolvedValue({ data: { regionId: 'missing-fields' } }),
      });

      await expect(
        DataTableOps.createDataTable(ctx, 'sheet-1', {
          tableRange: 'B2:D4',
          rowInputCell: 'A1',
          colInputCell: 'A2',
        }),
      ).rejects.toThrow('CreateDataTableResult');
    });
  });
});
