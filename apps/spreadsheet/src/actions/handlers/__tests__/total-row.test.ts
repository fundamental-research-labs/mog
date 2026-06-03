/**
 * Total row action handler tests.
 *
 * These lock in the app-layer contract: the dropdown handler delegates totals
 * function changes to the Worksheet table API, which persists both table
 * metadata and the visible totals-row formula.
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { SET_TOTAL_ROW_FUNCTION } from '../total-row';

describe('SET_TOTAL_ROW_FUNCTION', () => {
  function makeDeps() {
    const setTotalsFunction = jest.fn().mockResolvedValue(undefined);
    const table = {
      id: 'Table1',
      name: 'Table1',
      hasTotalsRow: true,
      columns: [
        { id: '1', name: 'Region', index: 0 },
        { id: '2', name: 'Sales', index: 1 },
      ],
    };
    const ws = {
      tables: {
        get: jest.fn().mockResolvedValue(table),
        setTotalsFunction,
      },
    };
    const workbook = {
      getSheetNames: jest.fn().mockResolvedValue(['Sheet1']),
      getSheet: jest.fn().mockResolvedValue(ws),
    };

    return {
      deps: { workbook } as unknown as ActionDependencies,
      setTotalsFunction,
    };
  }

  test('delegates metadata and formula updates to the worksheet table API', async () => {
    const { deps, setTotalsFunction } = makeDeps();

    const result = await SET_TOTAL_ROW_FUNCTION(deps, {
      tableId: 'Table1',
      columnIndex: 1,
      fn: 'sum',
    });

    expect(result).toEqual({ handled: true });
    expect(setTotalsFunction).toHaveBeenCalledWith('Table1', 'Sales', 'sum');
  });

  test('rejects out-of-range columns before mutating', async () => {
    const { deps, setTotalsFunction } = makeDeps();

    const result = await SET_TOTAL_ROW_FUNCTION(deps, {
      tableId: 'Table1',
      columnIndex: 9,
      fn: 'sum',
    });

    expect(result).toEqual({ handled: false, error: 'Column index out of range: 9' });
    expect(setTotalsFunction).not.toHaveBeenCalled();
  });
});
