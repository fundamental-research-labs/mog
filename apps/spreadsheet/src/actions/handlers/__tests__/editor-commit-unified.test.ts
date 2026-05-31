import { jest } from '@jest/globals';

import {
  AUTO_SUM,
  CLEAR_CONTENTS,
  COMMIT_ACTION_FOR,
  COMMIT_IN_PLACE,
  EDIT_CELL,
  FILL_SELECTION,
  INSERT_AUTO_FUNCTION,
  PICKER_COMMIT,
} from '../editor';

function createMockDeps() {
  const editorCommands = {
    commit: jest.fn(),
    pickerCommit: jest.fn(),
  };
  return {
    deps: {
      commands: {
        editor: editorCommands,
      },
    } as any,
    editorCommands,
  };
}

describe('Unified editor commit handlers', () => {
  test('COMMIT_IN_PLACE calls commands.editor.commit("none") and returns handled', () => {
    const { deps, editorCommands } = createMockDeps();
    const result = COMMIT_IN_PLACE(deps);
    expect(editorCommands.commit).toHaveBeenCalledWith('none');
    expect(result).toEqual({ handled: true });
  });

  test('PICKER_COMMIT with payload calls commands.editor.pickerCommit(value, direction)', () => {
    const { deps, editorCommands } = createMockDeps();
    const payload = { value: 'test-value', direction: 'down' };
    const result = PICKER_COMMIT(deps, payload);
    expect(editorCommands.pickerCommit).toHaveBeenCalledWith('test-value', 'down');
    expect(result).toEqual({ handled: true });
  });

  test('PICKER_COMMIT without payload does not crash and returns handled', () => {
    const { deps } = createMockDeps();
    const result = PICKER_COMMIT(deps);
    expect(result).toEqual({ handled: true });
  });

  test('COMMIT_ACTION_FOR maps directions to correct action names', () => {
    expect(COMMIT_ACTION_FOR['down']).toBe('COMMIT_AND_MOVE_DOWN');
    expect(COMMIT_ACTION_FOR['up']).toBe('COMMIT_AND_MOVE_UP');
    expect(COMMIT_ACTION_FOR['left']).toBe('COMMIT_AND_MOVE_LEFT');
    expect(COMMIT_ACTION_FOR['right']).toBe('COMMIT_AND_MOVE_RIGHT');
    expect(COMMIT_ACTION_FOR['none']).toBe('COMMIT_IN_PLACE');
  });
});

describe('EDIT_CELL edit-source contract', () => {
  test('routes through the grid edit-entry coordinator', async () => {
    const beginEditSession = jest.fn().mockResolvedValue({ success: true } as never);
    const selectionCommands = {
      exitAllModes: jest.fn(),
    };
    const deps = {
      getActiveSheetId: jest.fn().mockReturnValue('sheet1'),
      coordinator: {
        grid: {
          beginEditSession,
        },
      },
      accessors: {
        selection: {
          getActiveCell: jest.fn().mockReturnValue({ row: 2, col: 3 }),
          getRanges: jest
            .fn()
            .mockReturnValue([{ startRow: 2, startCol: 3, endRow: 2, endCol: 3 }]),
        },
        clipboard: {
          hasCut: jest.fn().mockReturnValue(false),
          getData: jest.fn(),
        },
      },
      commands: {
        selection: selectionCommands,
      },
    } as any;

    await EDIT_CELL(deps);

    expect(selectionCommands.exitAllModes).toHaveBeenCalledTimes(1);
    expect(beginEditSession).toHaveBeenCalledWith({
      sheetId: 'sheet1',
      cell: { row: 2, col: 3 },
      entryMode: 'F2',
    });
  });

  test('leaves edit-source resolution to the edit-entry coordinator', async () => {
    const beginEditSession = jest.fn().mockResolvedValue({ success: true } as never);
    const worksheet = {
      getActiveCellEditSource: jest.fn(),
      viewport: {
        getCellData: jest.fn(),
      },
      getValueForEditing: jest.fn(),
    };
    const deps = {
      getActiveSheetId: jest.fn().mockReturnValue('sheet1'),
      coordinator: {
        grid: {
          beginEditSession,
        },
      },
      workbook: {
        getSheetById: jest.fn().mockReturnValue(worksheet),
      },
      accessors: {
        selection: {
          getActiveCell: jest.fn().mockReturnValue({ row: 0, col: 0 }),
          getRanges: jest
            .fn()
            .mockReturnValue([{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }]),
        },
        clipboard: {
          hasCut: jest.fn().mockReturnValue(false),
          getData: jest.fn(),
        },
      },
      commands: {
        selection: { exitAllModes: jest.fn() },
      },
    } as any;

    await EDIT_CELL(deps);

    expect(deps.workbook.getSheetById).not.toHaveBeenCalled();
    expect(worksheet.getActiveCellEditSource).not.toHaveBeenCalled();
    expect(worksheet.getValueForEditing).not.toHaveBeenCalled();
    expect(worksheet.viewport.getCellData).not.toHaveBeenCalled();
    expect(beginEditSession).toHaveBeenCalledWith({
      sheetId: 'sheet1',
      cell: { row: 0, col: 0 },
      entryMode: 'F2',
    });
  });
});

describe('CLEAR_CONTENTS protection feedback', () => {
  test('shows protection feedback when a locked protected cell rejects Delete', async () => {
    const error = new Error('Cannot edit cell (0, 0): sheet is protected and cell is locked');
    const range = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const clear = jest.fn().mockRejectedValue(error as never);
    const setSelectionError = jest.fn();
    const showProtectionAlert = jest.fn();
    const undoGroup = jest.fn(async (fn: () => Promise<void>) => {
      await fn();
    });
    const deps = {
      getActiveSheetId: jest.fn().mockReturnValue('sheet1'),
      workbook: {
        getSheetById: jest.fn().mockReturnValue({ clear }),
        undoGroup,
      },
      accessors: {
        selection: {
          getActiveCell: jest.fn().mockReturnValue({ row: 0, col: 0 }),
          getRanges: jest.fn().mockReturnValue([range]),
        },
      },
      uiStore: {
        getState: () => ({
          setSelectionError,
          showProtectionAlert,
        }),
      },
    } as any;

    await expect(CLEAR_CONTENTS(deps)).resolves.toEqual({ handled: false, reason: 'blocked' });

    expect(clear).toHaveBeenCalledWith(range, 'contents');
    expect(setSelectionError).toHaveBeenCalledWith('protection', error.message);
    expect(showProtectionAlert).toHaveBeenCalledWith(error.message);
  });
});

describe('FILL_SELECTION edit-session range contract', () => {
  test('fills the selection captured before editing collapsed the visible selection', async () => {
    const setCells = jest.fn().mockResolvedValue(undefined as never);
    const undoGroup = jest.fn(async (fn: () => Promise<void>) => {
      await fn();
    });
    const editStartSelectionRanges = [{ startRow: 0, startCol: 0, endRow: 4, endCol: 0 }];
    const visibleCollapsedRange = [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }];
    const deps = {
      getActiveSheetId: jest.fn().mockReturnValue('sheet1'),
      workbook: {
        getSheetById: jest.fn().mockReturnValue({ setCells }),
        undoGroup,
      },
      accessors: {
        selection: {
          getActiveCell: jest.fn().mockReturnValue({ row: 0, col: 0 }),
          getRanges: jest.fn().mockReturnValue(visibleCollapsedRange),
        },
        editor: {
          getValue: jest.fn().mockReturnValue('42'),
          getEditStartSelectionRanges: jest.fn().mockReturnValue(editStartSelectionRanges),
        },
      },
      commands: {
        editor: { cancel: jest.fn() },
      },
    } as any;

    await FILL_SELECTION(deps);

    expect(setCells).toHaveBeenCalledWith([
      { row: 0, col: 0, value: '42' },
      { row: 1, col: 0, value: '42' },
      { row: 2, col: 0, value: '42' },
      { row: 3, col: 0, value: '42' },
      { row: 4, col: 0, value: '42' },
    ]);
    expect(deps.commands.editor.cancel).toHaveBeenCalledTimes(1);
  });
});

function createAutoSumDeps(opts: {
  activeCell?: { row: number; col: number };
  ranges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>;
  rangeData?: unknown[][][];
}) {
  const activeCell = opts.activeCell ?? { row: 0, col: 0 };
  const beginEditSession = jest.fn().mockResolvedValue({ success: true } as never);
  const selectionCommands = {
    exitAllModes: jest.fn(),
  };
  const getRange = jest.fn();
  for (const rangeData of opts.rangeData ?? []) {
    getRange.mockResolvedValueOnce(rangeData as never);
  }

  const worksheet = {
    getRange,
  };

  return {
    deps: {
      getActiveSheetId: jest.fn().mockReturnValue('sheet1'),
      coordinator: {
        grid: {
          beginEditSession,
        },
      },
      workbook: {
        getSheetById: jest.fn().mockReturnValue(worksheet),
        indexToAddress: (row: number, col: number) => {
          let n = col + 1;
          let letters = '';
          while (n > 0) {
            const rem = (n - 1) % 26;
            letters = String.fromCharCode(65 + rem) + letters;
            n = Math.floor((n - 1) / 26);
          }
          return `${letters}${row + 1}`;
        },
      },
      accessors: {
        selection: {
          getActiveCell: jest.fn().mockReturnValue(activeCell),
          getRanges: jest.fn().mockReturnValue(opts.ranges),
        },
      },
      commands: {
        selection: selectionCommands,
      },
    } as any,
    beginEditSession,
    selectionCommands,
    getRange,
  };
}

describe('AUTO_SUM selected range placement', () => {
  test('vertical multi-cell selection edits the cell below with selected range formula', async () => {
    const { deps, beginEditSession, getRange } = createAutoSumDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 0 }],
    });

    await AUTO_SUM(deps);

    expect(getRange).not.toHaveBeenCalled();
    expect(beginEditSession).toHaveBeenCalledWith({
      sheetId: 'sheet1',
      cell: { row: 3, col: 0 },
      entryMode: 'typing',
      initialTextHint: '=SUM(A1:A3)',
    });
  });

  test('horizontal multi-cell selection edits the cell to the right with selected range formula', async () => {
    const { deps, beginEditSession, getRange } = createAutoSumDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }],
    });

    await AUTO_SUM(deps);

    expect(getRange).not.toHaveBeenCalled();
    expect(beginEditSession).toHaveBeenCalledWith({
      sheetId: 'sheet1',
      cell: { row: 0, col: 3 },
      entryMode: 'typing',
      initialTextHint: '=SUM(A1:C1)',
    });
  });

  test('rectangular multi-cell selection uses the below-left target convention', async () => {
    const { deps, beginEditSession, getRange } = createAutoSumDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 1 }],
    });

    await AUTO_SUM(deps, { functionName: 'AVERAGE' });

    expect(getRange).not.toHaveBeenCalled();
    expect(beginEditSession).toHaveBeenCalledWith({
      sheetId: 'sheet1',
      cell: { row: 3, col: 0 },
      entryMode: 'typing',
      initialTextHint: '=AVERAGE(A1:B3)',
    });
  });

  test('single-cell selection keeps the adjacent active-cell scan path', async () => {
    const { deps, beginEditSession, getRange } = createAutoSumDeps({
      activeCell: { row: 3, col: 0 },
      ranges: [{ startRow: 3, startCol: 0, endRow: 3, endCol: 0 }],
      rangeData: [[[{ value: 1 }], [{ value: 2 }], [{ value: 3 }]]],
    });

    await AUTO_SUM(deps);

    expect(getRange).toHaveBeenCalledWith(0, 0, 2, 0);
    expect(beginEditSession).toHaveBeenCalledWith({
      sheetId: 'sheet1',
      cell: { row: 3, col: 0 },
      entryMode: 'typing',
      initialTextHint: '=SUM(A1:A3)',
    });
  });
});

function createInsertAutoFunctionDeps(opts: {
  activeCell: { row: number; col: number };
  usedRange: { startRow: number; startCol: number; endRow: number; endCol: number };
  cells: Record<string, unknown>;
}) {
  const setCell = jest.fn().mockResolvedValue(undefined as never);
  const worksheet = {
    getUsedRange: jest.fn().mockResolvedValue(opts.usedRange as never),
    viewport: {
      getCellData: jest.fn((row: number, col: number) => opts.cells[`${row},${col}`] ?? null),
    },
    setCell,
  };

  return {
    deps: {
      getActiveSheetId: jest.fn().mockReturnValue('sheet1'),
      workbook: {
        getSheetById: jest.fn().mockReturnValue(worksheet),
        indexToAddress: (row: number, col: number) => {
          let n = col + 1;
          let letters = '';
          while (n > 0) {
            const rem = (n - 1) % 26;
            letters = String.fromCharCode(65 + rem) + letters;
            n = Math.floor((n - 1) / 26);
          }
          return `${letters}${row + 1}`;
        },
      },
      accessors: {
        selection: {
          getActiveCell: jest.fn().mockReturnValue(opts.activeCell),
          getRanges: jest.fn().mockReturnValue([
            {
              startRow: opts.activeCell.row,
              startCol: opts.activeCell.col,
              endRow: opts.activeCell.row,
              endCol: opts.activeCell.col,
            },
          ]),
        },
      },
    } as any,
    setCell,
    getCellData: worksheet.viewport.getCellData,
  };
}

describe('INSERT_AUTO_FUNCTION range inference', () => {
  test('COUNT includes text and interior blanks in the above-column span', async () => {
    const { deps, setCell } = createInsertAutoFunctionDeps({
      activeCell: { row: 5, col: 0 },
      usedRange: { startRow: 0, startCol: 0, endRow: 4, endCol: 0 },
      cells: {
        '0,0': { value: 10 },
        '1,0': { value: 'apples' },
        '2,0': { value: 30 },
        '4,0': { value: 50 },
      },
    });

    await INSERT_AUTO_FUNCTION(deps, { functionName: 'COUNT' });

    expect(setCell).toHaveBeenCalledWith(5, 0, '=COUNT(A1:A5)');
  });

  test('MAX beside a vertical range uses the left-column span', async () => {
    const { deps, setCell } = createInsertAutoFunctionDeps({
      activeCell: { row: 0, col: 1 },
      usedRange: { startRow: 0, startCol: 0, endRow: 4, endCol: 0 },
      cells: {
        '0,0': { value: 10 },
        '1,0': { value: 20 },
        '2,0': { value: 30 },
        '3,0': { value: 40 },
        '4,0': { value: 50 },
      },
    });

    await INSERT_AUTO_FUNCTION(deps, { functionName: 'MAX' });

    expect(setCell).toHaveBeenCalledWith(0, 1, '=MAX(A1:A5)');
  });

  test('MIN beside data prefers the left column over a formula above', async () => {
    const { deps, setCell } = createInsertAutoFunctionDeps({
      activeCell: { row: 1, col: 1 },
      usedRange: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 },
      cells: {
        '0,0': { value: 10 },
        '1,0': { value: 20 },
        '2,0': { value: 30 },
        '3,0': { value: 40 },
        '4,0': { value: 50 },
        '0,1': { formula: '=MAX(A1:A5)', displayText: '50' },
      },
    });

    await INSERT_AUTO_FUNCTION(deps, { functionName: 'MIN' });

    expect(setCell).toHaveBeenCalledWith(1, 1, '=MIN(A1:A5)');
  });
});
