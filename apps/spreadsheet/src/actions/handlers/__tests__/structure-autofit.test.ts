import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import {
  MAX_COLS,
  MAX_ROWS,
  sheetId as makeSheetId,
  type CellRange,
} from '@mog-sdk/contracts/core';

const autoFitRows = jest.fn(async () => undefined);
const autoFitColumns = jest.fn(async () => undefined);
const getTextMeasurementService = jest.fn(() => ({ measure: jest.fn() }));

jest.unstable_mockModule('../../../systems/grid-editing/features/autofit', () => ({
  autoFitRows,
  autoFitColumns,
}));

jest.unstable_mockModule('@mog/grid-renderer', () => ({
  getTextMeasurementService,
}));

const StructureHandlers = await import('../structure');

function createDeps(
  options: {
    activeCell?: { row: number; col: number };
    ranges?: Array<{
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
      isFullRow?: boolean;
      isFullColumn?: boolean;
    }>;
    usedRange?: CellRange | null;
    hiddenRows?: number[];
    hiddenCols?: number[];
  } = {},
): ActionDependencies {
  const activeSheetId = makeSheetId('sheet1');
  const worksheet = {
    formatValues: jest.fn(async () => []),
    getUsedRange: jest.fn(async () => options.usedRange ?? null),
    layout: {
      setRowVisible: jest.fn(async () => undefined),
      setColumnVisible: jest.fn(async () => undefined),
      setRowHeight: jest.fn(async () => undefined),
      setColumnWidths: jest.fn(async () => undefined),
      getHiddenRowsBitmap: jest.fn(async () => new Set(options.hiddenRows ?? [])),
      getHiddenColumnsBitmap: jest.fn(async () => new Set(options.hiddenCols ?? [])),
    },
    structure: {
      insertRows: jest.fn(async () => undefined),
      insertColumns: jest.fn(async () => undefined),
      deleteRows: jest.fn(async () => undefined),
      deleteColumns: jest.fn(async () => undefined),
      insertCellsWithShift: jest.fn(async () => undefined),
    },
  };
  const workbook = {
    getSheetById: jest.fn(() => worksheet),
    activeSheet: worksheet,
  };

  return {
    workbook,
    getActiveSheetId: jest.fn(() => activeSheetId),
    accessors: {
      selection: {
        getActiveCell: jest.fn(() => options.activeCell ?? { row: 4, col: 3 }),
        getRanges: jest.fn(() => options.ranges ?? []),
      },
    },
    commands: {
      selection: {
        setSelection: jest.fn(),
      },
    },
  } as unknown as ActionDependencies;
}

function getMockWorksheet(deps: ActionDependencies) {
  return (deps.workbook.getSheetById as jest.Mock).mock.results[0]?.value;
}

function getSelectionSetMock(deps: ActionDependencies): jest.Mock {
  return deps.commands.selection.setSelection as unknown as jest.Mock;
}

describe('Structure autofit handlers', () => {
  beforeEach(() => {
    autoFitRows.mockClear();
    autoFitColumns.mockClear();
    getTextMeasurementService.mockClear();
  });

  it('AUTO_FIT_COLUMN_WIDTH targets the active column when no selection ranges are available', async () => {
    const deps = createDeps({ activeCell: { row: 4, col: 3 }, ranges: [] });

    const result = await StructureHandlers.AUTO_FIT_COLUMN_WIDTH(deps);

    expect(result.handled).toBe(true);
    expect(autoFitColumns).toHaveBeenCalledWith(
      makeSheetId('sheet1'),
      [3],
      expect.anything(),
      expect.any(Function),
      deps.workbook,
    );
  });

  it('AUTO_FIT_ROW_HEIGHT targets the active row when no selection ranges are available', async () => {
    const deps = createDeps({ activeCell: { row: 4, col: 3 }, ranges: [] });

    const result = await StructureHandlers.AUTO_FIT_ROW_HEIGHT(deps);

    expect(result.handled).toBe(true);
    expect(autoFitRows).toHaveBeenCalledWith(
      makeSheetId('sheet1'),
      [4],
      expect.anything(),
      expect.any(Function),
      deps.workbook,
    );
  });

  it('row and column structure actions target the active cell when no selection ranges are available', async () => {
    const deps = createDeps({ activeCell: { row: 4, col: 3 }, ranges: [] });

    await StructureHandlers.INSERT_ROW_ABOVE(deps);
    await StructureHandlers.INSERT_COLUMN_LEFT(deps);
    await StructureHandlers.DELETE_ROWS(deps);
    await StructureHandlers.DELETE_COLUMNS(deps);

    const worksheet = getMockWorksheet(deps);
    expect(worksheet.structure.insertRows).toHaveBeenCalledWith(4, 1);
    expect(worksheet.structure.insertColumns).toHaveBeenCalledWith(3, 1);
    expect(worksheet.structure.deleteRows).toHaveBeenCalledWith(4, 1);
    expect(worksheet.structure.deleteColumns).toHaveBeenCalledWith(3, 1);
  });

  it('command-initiated row and column inserts keep the active cell in the inserted slot', async () => {
    const deps = createDeps({ activeCell: { row: 4, col: 3 }, ranges: [] });

    await StructureHandlers.INSERT_ROW_ABOVE(deps);
    await StructureHandlers.INSERT_COLUMN_LEFT(deps);

    const setSelection = getSelectionSetMock(deps);
    expect(setSelection).toHaveBeenNthCalledWith(
      1,
      [{ startRow: 4, startCol: 3, endRow: 4, endCol: 3 }],
      { row: 4, col: 3 },
    );
    expect(setSelection).toHaveBeenNthCalledWith(
      2,
      [{ startRow: 4, startCol: 3, endRow: 4, endCol: 3 }],
      { row: 4, col: 3 },
    );
  });

  it('command-initiated row and column deletes keep the active cell at the vacated index', async () => {
    const deps = createDeps({ activeCell: { row: 4, col: 3 }, ranges: [] });

    await StructureHandlers.DELETE_ROWS(deps);
    await StructureHandlers.DELETE_COLUMNS(deps);

    const setSelection = getSelectionSetMock(deps);
    expect(setSelection).toHaveBeenNthCalledWith(
      1,
      [{ startRow: 4, startCol: 3, endRow: 4, endCol: 3 }],
      { row: 4, col: 3 },
    );
    expect(setSelection).toHaveBeenNthCalledWith(
      2,
      [{ startRow: 4, startCol: 3, endRow: 4, endCol: 3 }],
      { row: 4, col: 3 },
    );
  });

  it('INSERT_CELLS_SHIFT_DOWN uses the active cell as a one-cell range when ranges are empty', async () => {
    const deps = createDeps({ activeCell: { row: 4, col: 3 }, ranges: [] });

    await StructureHandlers.INSERT_CELLS_SHIFT_DOWN(deps);

    const worksheet = deps.workbook.activeSheet as any;
    expect(worksheet.structure.insertCellsWithShift).toHaveBeenCalledWith(4, 3, 4, 3, 'down');
  });

  it('visibility and explicit sizing actions target the active row or column when ranges are empty', async () => {
    const deps = createDeps({ activeCell: { row: 4, col: 3 }, ranges: [] });

    await StructureHandlers.HIDE_ROW(deps);
    await StructureHandlers.UNHIDE_COLUMN(deps);
    await StructureHandlers.APPLY_ROW_HEIGHT(deps, { height: 27 });
    await StructureHandlers.APPLY_COLUMN_WIDTH(deps, { width: 88 });

    const worksheet = getMockWorksheet(deps);
    expect(worksheet.layout.setRowVisible).toHaveBeenCalledWith(4, false);
    expect(worksheet.layout.setColumnVisible).toHaveBeenCalledWith(3, true);
    expect(worksheet.layout.setRowHeight).toHaveBeenCalledWith(4, 27);
    expect(worksheet.layout.setColumnWidths).toHaveBeenCalledWith([[3, 88]]);
  });

  it('UNHIDE_COLUMN targets hidden columns inside or adjacent to the selection', async () => {
    const deps = createDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 0, startCol: 0, endRow: MAX_ROWS - 1, endCol: 0, isFullColumn: true }],
      hiddenCols: [1, 4],
    });

    await StructureHandlers.UNHIDE_COLUMN(deps);

    const worksheet = getMockWorksheet(deps);
    expect(worksheet.layout.setColumnVisible).toHaveBeenCalledTimes(1);
    expect(worksheet.layout.setColumnVisible).toHaveBeenCalledWith(1, true);
  });

  it('UNHIDE_COLUMN prefers hidden columns inside the selection over adjacent hidden columns', async () => {
    const deps = createDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 0, startCol: 0, endRow: MAX_ROWS - 1, endCol: 2, isFullColumn: true }],
      hiddenCols: [1, 3],
    });

    await StructureHandlers.UNHIDE_COLUMN(deps);

    const worksheet = getMockWorksheet(deps);
    expect(worksheet.layout.setColumnVisible).toHaveBeenCalledTimes(1);
    expect(worksheet.layout.setColumnVisible).toHaveBeenCalledWith(1, true);
  });

  it('UNHIDE_ROW targets hidden rows inside or adjacent to the selection', async () => {
    const deps = createDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: MAX_COLS - 1, isFullRow: true }],
      hiddenRows: [1, 4],
    });

    await StructureHandlers.UNHIDE_ROW(deps);

    const worksheet = getMockWorksheet(deps);
    expect(worksheet.layout.setRowVisible).toHaveBeenCalledTimes(1);
    expect(worksheet.layout.setRowVisible).toHaveBeenCalledWith(1, true);
  });

  it('UNHIDE_ROW prefers hidden rows inside the selection over adjacent hidden rows', async () => {
    const deps = createDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 1, startCol: 0, endRow: 4, endCol: MAX_COLS - 1, isFullRow: true }],
      hiddenRows: [2, 3, 5],
    });

    await StructureHandlers.UNHIDE_ROW(deps);

    const worksheet = getMockWorksheet(deps);
    expect(worksheet.layout.setRowVisible).toHaveBeenCalledTimes(2);
    expect(worksheet.layout.setRowVisible).toHaveBeenNthCalledWith(1, 2, true);
    expect(worksheet.layout.setRowVisible).toHaveBeenNthCalledWith(2, 3, true);
  });

  it('AUTO_FIT_COLUMN_WIDTH still honors explicit multi-column selections', async () => {
    const deps = createDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [{ startRow: 0, startCol: 2, endRow: 5, endCol: 4 }],
    });

    await StructureHandlers.AUTO_FIT_COLUMN_WIDTH(deps);

    expect(autoFitColumns).toHaveBeenCalledWith(
      makeSheetId('sheet1'),
      [2, 3, 4],
      expect.anything(),
      expect.any(Function),
      deps.workbook,
    );
  });

  it('AUTO_FIT_COLUMN_WIDTH bounds select-all to used range columns', async () => {
    const deps = createDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [
        {
          startRow: 0,
          startCol: 0,
          endRow: MAX_ROWS - 1,
          endCol: MAX_COLS - 1,
          isFullRow: true,
          isFullColumn: true,
        },
      ],
      usedRange: { startRow: 0, startCol: 0, endRow: 24, endCol: 3 },
    });

    await StructureHandlers.AUTO_FIT_COLUMN_WIDTH(deps);

    expect(autoFitColumns).toHaveBeenCalledWith(
      makeSheetId('sheet1'),
      [0, 1, 2, 3],
      expect.anything(),
      expect.any(Function),
      deps.workbook,
    );
  });

  it('AUTO_FIT_ROW_HEIGHT bounds select-all to used range rows', async () => {
    const deps = createDeps({
      activeCell: { row: 0, col: 0 },
      ranges: [
        {
          startRow: 0,
          startCol: 0,
          endRow: MAX_ROWS - 1,
          endCol: MAX_COLS - 1,
          isFullRow: true,
          isFullColumn: true,
        },
      ],
      usedRange: { startRow: 0, startCol: 0, endRow: 2, endCol: 3 },
    });

    await StructureHandlers.AUTO_FIT_ROW_HEIGHT(deps);

    expect(autoFitRows).toHaveBeenCalledWith(
      makeSheetId('sheet1'),
      [0, 1, 2],
      expect.anything(),
      expect.any(Function),
      deps.workbook,
    );
  });
});
