import { describe, expect, it, jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import {
  APPLY_GOAL_SEEK_RESULT,
  EXECUTE_DATA_TABLE,
  EXECUTE_GOAL_SEEK,
  OPEN_FORECAST_SHEET_DIALOG,
} from '../data-analysis';

function dataTableWriteReceipt(cellCount: number, overrides: Record<string, unknown> = {}) {
  return {
    kind: 'dataTable.writeStaticValues',
    status: 'applied',
    effects: [
      { type: 'computedGrid', sheetId: 'sheet-1', count: cellCount },
      { type: 'wroteStaticValues', sheetId: 'sheet-1', range: 'B2:C3', count: cellCount },
    ],
    diagnostics: [],
    lifecycle: 'staticValues',
    materialized: true,
    worksheetChanged: true,
    targetRange: 'B2:C3',
    results: [
      [50, 100],
      [80, 160],
    ],
    cellCount,
    cellsWritten: cellCount,
    elapsedMs: 0,
    ...overrides,
  };
}

function createDeps(overrides?: {
  ranges?: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  rowInputCellRef?: string;
  colInputCellRef?: string;
  writeDataTableValues?: jest.Mock;
  getCell?: jest.Mock;
  setCells?: jest.Mock;
}): ActionDependencies {
  const writeDataTableValues =
    overrides?.writeDataTableValues ?? jest.fn().mockResolvedValue(dataTableWriteReceipt(4));
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
          writeDataTableValues,
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
  goalSeekResult?: {
    found: boolean;
    solutionValue?: number;
    achievedValue?: number;
    iterations?: number;
  } | null;
  getCell?: jest.Mock;
  getDisplayValue?: jest.Mock;
  setCell?: jest.Mock;
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
  const setCell = overrides?.setCell ?? jest.fn().mockResolvedValue(undefined);
  const state = {
    activeSheetId: 'sheet-1',
    goalSeekDialog: {
      setCell: 'B1',
      toValue: '20',
      byChangingCell: 'A1',
      result: overrides?.goalSeekResult,
    },
    setGoalSeekStatus: jest.fn(),
    setGoalSeekResult: jest.fn(),
    closeGoalSeekDialog: jest.fn(),
  };

  return {
    uiStore: {
      getState: () => state,
    },
    workbook: {
      getSheetById: jest.fn().mockReturnValue({
        getCell,
        getDisplayValue,
        setCell,
        whatIf: {
          goalSeek,
        },
      }),
    },
  } as unknown as ActionDependencies;
}

function createForecastDeps(overrides?: {
  cells?: unknown[][];
  ranges?: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  sheetNames?: string[];
}): ActionDependencies {
  const cells = overrides?.cells ?? [
    ['Month', 'Revenue'],
    [46023, 100],
    [46054, 118],
    [46082, 132],
    [46113, 155],
    [46143, 181],
    [46174, 214],
    [46204, 246],
  ];
  const getCell = jest.fn((row: number, col: number) =>
    Promise.resolve({
      value: cells[row]?.[col] ?? null,
      displayText: cells[row]?.[col] == null ? '' : String(cells[row]?.[col]),
    }),
  );
  const setRange = jest.fn().mockResolvedValue(undefined);
  const forecastSheet = { setRange };
  const activeSheet = {
    getCell,
    getCurrentRegion: jest.fn().mockResolvedValue({
      startRow: 0,
      startCol: 0,
      endRow: cells.length - 1,
      endCol: 1,
    }),
  };
  const alert = jest.fn().mockResolvedValue(undefined);
  const undoGroup = jest.fn(async (fn: () => Promise<void>) => fn());
  const sheetsAdd = jest.fn().mockResolvedValue(forecastSheet);

  return {
    workbook: {
      getSheetById: jest.fn().mockReturnValue(activeSheet),
      getSheetNames: jest.fn().mockResolvedValue(overrides?.sheetNames ?? ['Sheet1']),
      sheets: { add: sheetsAdd },
      undoGroup,
    },
    getActiveSheetId: () => 'sheet-1',
    accessors: {
      selection: {
        getActiveCell: () => ({ row: 0, col: 0 }),
        getRanges: () =>
          overrides?.ranges ?? [
            {
              startRow: 0,
              startCol: 0,
              endRow: cells.length - 1,
              endCol: 1,
            },
          ],
      },
    },
    platform: {
      dialogs: { alert },
    },
  } as unknown as ActionDependencies;
}

describe('data analysis actions', () => {
  it('creates a forecast worksheet from a selected two-column time series', async () => {
    const deps = createForecastDeps();

    const result = await OPEN_FORECAST_SHEET_DIALOG(deps);
    const workbook = deps.workbook as any;
    const forecastSheet = await workbook.sheets.add.mock.results[0].value;
    const values = forecastSheet.setRange.mock.calls[0][2] as unknown[][];

    expect(result).toEqual({ handled: true });
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(workbook.sheets.add).toHaveBeenCalledWith('Forecast');
    expect(forecastSheet.setRange).toHaveBeenCalledWith(0, 0, expect.any(Array));
    expect(values[0][0]).toBe('Forecast Sheet');
    expect(values[1][1]).toBe('A1:B8');
    expect(values[2]).toEqual([
      'Timeline',
      'Revenue',
      'Forecast',
      'Lower Confidence Bound',
      'Upper Confidence Bound',
    ]);
    expect(values.every((row) => Array.isArray(row) && row.length === 5)).toBe(true);
    expect(values.filter((row) => typeof row?.[2] === 'number' && row[2] > 260)).toHaveLength(6);
    expect((deps.platform as any).dialogs.alert).not.toHaveBeenCalled();
  });

  it('keeps invalid Forecast Sheet selections on the validation alert path', async () => {
    const deps = createForecastDeps({
      cells: [
        ['Product', 'Region', 'Amount'],
        ['Alpha', 'East', 100],
        ['Beta', 'West', 125],
      ],
      ranges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }],
    });

    const result = await OPEN_FORECAST_SHEET_DIALOG(deps);
    const workbook = deps.workbook as any;

    expect(result).toEqual({ handled: true });
    expect(workbook.sheets.add).not.toHaveBeenCalled();
    expect((deps.platform as any).dialogs.alert).toHaveBeenCalledWith(
      expect.stringContaining('Current selection: A1:C3'),
      { type: 'info' },
    );
  });

  it('reports the goal seek achieved value separately from the changing-cell solution', async () => {
    const goalSeek = jest.fn().mockResolvedValue({
      found: true,
      value: 10,
      achievedValue: 20,
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
    expect(getCell).not.toHaveBeenCalled();
    expect(getDisplayValue).not.toHaveBeenCalled();
    expect(state.setGoalSeekStatus).toHaveBeenCalledWith('running');
    expect(state.setGoalSeekResult).toHaveBeenCalledWith({
      found: true,
      solutionValue: 10,
      achievedValue: 20,
      iterations: 5,
    });
  });

  it('falls back to the solver goal seek value when achieved value is unavailable', async () => {
    const getCell = jest.fn().mockResolvedValue({ value: 'not numeric', formatted: '$20.00' });
    const deps = createGoalSeekDeps({ getCell });

    await EXECUTE_GOAL_SEEK(deps);
    const state = deps.uiStore.getState() as {
      setGoalSeekResult: jest.Mock;
    };

    expect(getCell).not.toHaveBeenCalled();
    expect(state.setGoalSeekResult).toHaveBeenCalledWith({
      found: true,
      solutionValue: 10,
      achievedValue: 10,
      iterations: 4,
    });
  });

  it('applies the goal seek solution as a typed number', async () => {
    const setCell = jest.fn().mockResolvedValue(undefined);
    const deps = createGoalSeekDeps({
      setCell,
      goalSeekResult: {
        found: true,
        solutionValue: 0.5,
        achievedValue: 5,
        iterations: 3,
      },
    });

    const result = await APPLY_GOAL_SEEK_RESULT(deps);
    const state = deps.uiStore.getState() as {
      closeGoalSeekDialog: jest.Mock;
    };

    expect(result).toEqual({ handled: true });
    expect(setCell).toHaveBeenCalledWith(0, 0, 0.5);
    expect(state.closeGoalSeekDialog).toHaveBeenCalledTimes(1);
  });

  it('calculates a two-variable data table and writes body results', async () => {
    const writeDataTableValues = jest.fn().mockResolvedValue(dataTableWriteReceipt(4));
    const setCells = jest.fn();
    const deps = createDeps({ writeDataTableValues, setCells });

    const result = await EXECUTE_DATA_TABLE(deps);
    const state = deps.uiStore.getState() as {
      setDataTableStatus: jest.Mock;
      setDataTableResult: jest.Mock;
    };

    expect(result).toEqual({ handled: true });
    expect(writeDataTableValues).toHaveBeenCalledWith('A1', {
      rowInputCell: 'E2',
      colInputCell: 'E1',
      rowValues: [5, 8],
      colValues: [10, 20],
      targetRange: 'B2:C3',
    });
    expect(setCells).not.toHaveBeenCalled();
    expect(state.setDataTableStatus).toHaveBeenCalledWith('running', 0);
    expect(state.setDataTableResult).toHaveBeenCalledWith(
      expect.objectContaining({
        cellCount: 4,
        cancelled: false,
      }),
    );
  });

  it('reports failed Data Table static write receipts', async () => {
    const writeDataTableValues = jest.fn().mockResolvedValue(
      dataTableWriteReceipt(0, {
        status: 'failed',
        materialized: false,
        worksheetChanged: false,
        cellsWritten: 0,
        diagnostics: [
          {
            severity: 'error',
            code: 'DATA_TABLE_INPUT_NOT_FOUND',
            message: 'Input cell must contain a value.',
          },
        ],
      }),
    );
    const setCells = jest.fn();
    const deps = createDeps({ writeDataTableValues, setCells });

    await EXECUTE_DATA_TABLE(deps);
    const state = deps.uiStore.getState() as {
      setDataTableResult: jest.Mock;
    };

    expect(setCells).not.toHaveBeenCalled();
    expect(state.setDataTableResult).toHaveBeenCalledWith(
      expect.objectContaining({
        cellCount: 0,
        cancelled: false,
        errorMessage: 'Input cell must contain a value.',
      }),
    );
  });

  it('reports partial Data Table static write receipts', async () => {
    const writeDataTableValues = jest.fn().mockResolvedValue(
      dataTableWriteReceipt(2, {
        status: 'partial',
        materialized: true,
        worksheetChanged: true,
        cellsWritten: 2,
        diagnostics: [
          {
            severity: 'error',
            code: 'DATA_TABLE_STATIC_WRITE_CELL_FAILED',
            message: 'Only part of the static Data Table range was written.',
          },
        ],
      }),
    );
    const deps = createDeps({ writeDataTableValues });

    await EXECUTE_DATA_TABLE(deps);
    const state = deps.uiStore.getState() as {
      setDataTableResult: jest.Mock;
    };

    expect(state.setDataTableResult).toHaveBeenCalledWith(
      expect.objectContaining({
        cellCount: 0,
        cancelled: false,
        errorMessage: 'Only part of the static Data Table range was written.',
      }),
    );
  });

  it('reports validation errors without calling the bridge', async () => {
    const writeDataTableValues = jest.fn();
    const deps = createDeps({
      writeDataTableValues,
      ranges: [
        { startRow: 0, startCol: 0, endRow: 2, endCol: 2 },
        { startRow: 4, startCol: 0, endRow: 5, endCol: 1 },
      ],
    });

    await EXECUTE_DATA_TABLE(deps);
    const state = deps.uiStore.getState() as {
      setDataTableResult: jest.Mock;
    };

    expect(writeDataTableValues).not.toHaveBeenCalled();
    expect(state.setDataTableResult).toHaveBeenCalledWith(
      expect.objectContaining({
        cellCount: 0,
        cancelled: false,
        errorMessage: 'Select exactly one Data Table range before creating the table.',
      }),
    );
  });
});
