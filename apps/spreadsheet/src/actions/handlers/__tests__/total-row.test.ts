/**
 * Total row action handler tests.
 *
 * These lock in the app-layer contract: the dropdown handler delegates totals
 * function changes to the Worksheet table API, which persists both table
 * metadata and the visible totals-row formula.
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

jest.mock('../bridge-error-guard', () => ({
  guardBridgeMutation: async (fn: () => Promise<unknown>) => {
    await fn();
    return true;
  },
}));

import { SET_TOTAL_ROW_FUNCTION } from '../total-row';

describe('SET_TOTAL_ROW_FUNCTION', () => {
  function makeDeps() {
    const setTotalsFunction = jest.fn().mockResolvedValue(undefined);
    const table = {
      id: 'table-guid-1',
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
        list: jest.fn().mockResolvedValue([table]),
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

  test('resolves internal table ids and mutates through the canonical table name', async () => {
    const { deps, setTotalsFunction } = makeDeps();
    const ws = await (deps.workbook as any).getSheet('Sheet1');
    ws.tables.get.mockResolvedValueOnce(null);

    const result = await SET_TOTAL_ROW_FUNCTION(deps, {
      tableId: 'table-guid-1',
      columnIndex: 1,
      fn: 'sum',
    });

    expect(result).toEqual({ handled: true });
    expect(ws.tables.list).toHaveBeenCalled();
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
