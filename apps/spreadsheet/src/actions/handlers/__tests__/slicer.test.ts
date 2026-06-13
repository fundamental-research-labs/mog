import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { OPEN_INSERT_SLICER_DIALOG } from '../slicer';

function makeDeps() {
  const openInsertSlicerDialog = jest.fn();
  const getCellIdAt = jest.fn(async (row: number, col: number) => `cell-${row}-${col}`);
  const table = {
    id: 'tbl-stable-id',
    name: 'Table1',
    range: 'A1:B3',
    columns: [{ name: 'Name' }, { name: 'Score' }],
  };
  const ws = {
    tables: {
      getAtCell: jest.fn(async () => table),
    },
    slicers: {
      list: jest.fn(async () => [
        {
          id: 'slicer-1',
          source: {
            type: 'table',
            tableId: 'tbl-stable-id',
            columnCellId: 'cell-0-0',
          },
        },
      ]),
    },
    _internal: {
      getCellIdAt,
    },
  };
  const deps = {
    workbook: {
      getSheetById: jest.fn(() => ws),
    },
    accessors: {
      selection: {
        getActiveCell: () => ({ row: 1, col: 0 }),
      },
    },
    commands: {},
    getActiveSheetId: () => 'sheet1' as any,
    uiStore: {
      getState: () => ({ openInsertSlicerDialog }),
    },
  } as unknown as ActionDependencies;

  return { deps, openInsertSlicerDialog };
}

describe('OPEN_INSERT_SLICER_DIALOG', () => {
  test('passes stable table id to dialog and existing-slicer matching', async () => {
    const { deps, openInsertSlicerDialog } = makeDeps();

    const result = await OPEN_INSERT_SLICER_DIALOG(deps);

    expect(result.handled).toBe(true);
    expect(openInsertSlicerDialog).toHaveBeenCalledWith('table', 'tbl-stable-id', [
      {
        columnCellId: 'cell-0-0',
        columnName: 'Name',
        hasExistingSlicer: true,
      },
      {
        columnCellId: 'cell-0-1',
        columnName: 'Score',
        hasExistingSlicer: false,
      },
    ]);
  });
});
