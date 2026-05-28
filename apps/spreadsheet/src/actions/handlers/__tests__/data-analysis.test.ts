import { describe, expect, it, jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { EXECUTE_DATA_TABLE, EXECUTE_GOAL_SEEK } from '../data-analysis';

function createDeps(overrides?: {
  ranges?: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  rowInputCellRef?: string;
  colInputCellRef?: string;
  dataTable?: jest.Mock;
  getCell?: jest.Mock;
  setCells?: jest.Mock;
}): ActionDependencies {
  const dataTable =
    overrides?.dataTable ??
    jest.fn().mockResolvedValue({
      results: [
        [50, 100],
        [80, 160],
      ],
      cellCount: 4,
      cancelled: false,
    });
  const cellValues = new Map([
    ['0,1', 10],
    ['0,2', 20],
    ['1,0', 5],
    ['2,0', 8],
  ]);
  const getCell =
    overrides?.getCell ??
    jest.fn((row: number, col: number) =>
      Promise.resolve({ value: cellValues.get(`${row},${col}`) ?? null }),
    );
  const setCells = overrides?.setCells ?? jest.fn().mockResolvedValue({ cellsWritten: 4 });
  const state = {
    dataTableDialog: {
      rowInputCellRef: overrides?.rowInputCellRef ?? 'E1',
      colInputCellRef: overrides?.colInputCellRef ?? 'E2',
    },
    setDataTableStatus: jest.fn(),
    setDataTableResult: jest.fn(),
  };

  return {
    uiStore: {
      getState: () => state,
    },
    workbook: {
      getSheetById: jest.fn().mockReturnValue({
        getCell,
        setCells,
        whatIf: {
          dataTable,
        },
      }),
    },
    getActiveSheetId: () => 'sheet-1',
    accessors: {
      selection: {
        getRanges: () => overrides?.ranges ?? [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
      },
    },
  } as unknown as ActionDependencies;
}

function createGoalSeekDeps(overrides?: {
  goalSeek?: jest.Mock;
  getCell?: jest.Mock;
  getDisplayValue?: jest.Mock;
}): ActionDependencies {
  const goalSeek =
    overrides?.goalSeek ??
    jest.fn().mockResolvedValue({
      found: true,
      value: 10,
      iterations: 4,
    });
  const getCell =
    overrides?.getCell ?? jest.fn().mockResolvedValue({ value: 20, formatted: '$20.00' });
  const getDisplayValue = overrides?.getDisplayValue ?? jest.fn().mockResolvedValue('$20.00');
  const state = {
    activeSheetId: 'sheet-1',
    goalSeekDialog: {
      setCell: 'B1',
      toValue: '20',
      byChangingCell: 'A1',
    },
    setGoalSeekStatus: jest.fn(),
    setGoalSeekResult: jest.fn(),
  };

  return {
    uiStore: {
      getState: () => state,
    },
    workbook: {
      getSheetById: jest.fn().mockReturnValue({
        getCell,
        getDisplayValue,
        whatIf: {
          goalSeek,
        },
      }),
    },
  } as unknown as ActionDependencies;
}

describe('data analysis actions', () => {
  it('reports raw target-cell goal seek result separately from the changing-cell solution', async () => {
    const goalSeek = jest.fn().mockResolvedValue({
      found: true,
      value: 10,
      iterations: 5,
    });
    const getCell = jest.fn().mockResolvedValue({ value: 20, formatted: '$20.00' });
    const getDisplayValue = jest.fn().mockResolvedValue('$20.00');
    const deps = createGoalSeekDeps({ goalSeek, getCell, getDisplayValue });

    const result = await EXECUTE_GOAL_SEEK(deps);
    const state = deps.uiStore.getState() as {
      setGoalSeekStatus: jest.Mock;
      setGoalSeekResult: jest.Mock;
    };

    expect(result).toEqual({ handled: true });
    expect(goalSeek).toHaveBeenCalledWith('B1', 20, 'A1');
    expect(getCell).toHaveBeenCalledWith(0, 1);
    expect(getDisplayValue).not.toHaveBeenCalled();
    expect(state.setGoalSeekStatus).toHaveBeenCalledWith('running');
    expect(state.setGoalSeekResult).toHaveBeenCalledWith({
      found: true,
      solutionValue: 10,
      achievedValue: 20,
      iterations: 5,
    });
  });

  it('falls back to the solver goal seek value when raw target-cell readback is unavailable', async () => {
    const getCell = jest.fn().mockResolvedValue({ value: 'not numeric', formatted: '$20.00' });
    const deps = createGoalSeekDeps({ getCell });

    await EXECUTE_GOAL_SEEK(deps);
    const state = deps.uiStore.getState() as {
      setGoalSeekResult: jest.Mock;
    };

    expect(state.setGoalSeekResult).toHaveBeenCalledWith({
      found: true,
      solutionValue: 10,
      achievedValue: 10,
      iterations: 4,
    });
  });

  it('calculates a two-variable data table and writes body results', async () => {
    const dataTable = jest.fn().mockResolvedValue({
      results: [
        [50, 100],
        [80, 160],
      ],
      cellCount: 4,
      cancelled: false,
    });
    const setCells = jest.fn().mockResolvedValue({ cellsWritten: 4 });
    const deps = createDeps({ dataTable, setCells });

    const result = await EXECUTE_DATA_TABLE(deps);
    const state = deps.uiStore.getState() as {
      setDataTableStatus: jest.Mock;
      setDataTableResult: jest.Mock;
    };

    expect(result).toEqual({ handled: true });
    expect(dataTable).toHaveBeenCalledWith('A1', {
      rowInputCell: 'E2',
      colInputCell: 'E1',
      rowValues: [5, 8],
      colValues: [10, 20],
    });
    expect(setCells).toHaveBeenCalledWith([
      { row: 1, col: 1, value: 50 },
      { row: 1, col: 2, value: 100 },
      { row: 2, col: 1, value: 80 },
      { row: 2, col: 2, value: 160 },
    ]);
    expect(state.setDataTableStatus).toHaveBeenCalledWith('running', 0);
    expect(state.setDataTableResult).toHaveBeenCalledWith(
      expect.objectContaining({
        cellCount: 4,
        cancelled: false,
      }),
    );
  });

  it('reports validation errors without calling the bridge', async () => {
    const dataTable = jest.fn();
    const deps = createDeps({
      dataTable,
      ranges: [
        { startRow: 0, startCol: 0, endRow: 2, endCol: 2 },
        { startRow: 4, startCol: 0, endRow: 5, endCol: 1 },
      ],
    });

    await EXECUTE_DATA_TABLE(deps);
    const state = deps.uiStore.getState() as {
      setDataTableResult: jest.Mock;
    };

    expect(dataTable).not.toHaveBeenCalled();
    expect(state.setDataTableResult).toHaveBeenCalledWith(
      expect.objectContaining({
        cellCount: 0,
        cancelled: false,
        errorMessage: 'Select exactly one Data Table range before creating the table.',
      }),
    );
  });
});
