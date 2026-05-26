import { jest } from '@jest/globals';

import { createFlashFillCoordinator } from '../flash-fill-coordination';

type Grid = unknown[][];

function previewDefaults() {
  return {
    isShowingPreview: false,
    sourceColumn: null,
    targetColumn: null,
    sheetId: null,
    previewValues: [],
    patternDescription: null,
    confidence: 0,
    startRow: null,
    endRow: null,
  };
}

function createMockUIStore() {
  let state: any;

  const showFlashFillPreview = jest.fn((config: any) => {
    state = {
      ...state,
      flashFillPreview: {
        isShowingPreview: true,
        sheetId: config.sheetId,
        sourceColumn: config.sourceColumn,
        targetColumn: config.targetColumn,
        previewValues: config.previewValues,
        patternDescription: config.patternDescription,
        confidence: config.confidence,
        startRow: config.startRow,
        endRow: config.endRow,
      },
    };
  });

  const hideFlashFillPreview = jest.fn(() => {
    state = {
      ...state,
      flashFillPreview: previewDefaults(),
    };
  });

  function createState() {
    return {
      flashFillPreview: previewDefaults(),
      showFlashFillPreview,
      hideFlashFillPreview,
    };
  }

  state = createState();

  return {
    getState: () => state,
  };
}

function cellValue(grid: Grid, row: number, col: number): unknown {
  return grid[row]?.[col] ?? null;
}

function rangeValues(
  grid: Grid,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
) {
  const rows = [];
  for (let row = startRow; row <= endRow; row++) {
    const cells = [];
    for (let col = startCol; col <= endCol; col++) {
      cells.push({ value: cellValue(grid, row, col) });
    }
    rows.push(cells);
  }
  return rows;
}

function createMockWorkbook(
  grid: Grid,
  getRangeImpl?: (
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ) => Promise<any[][]>,
) {
  const worksheet = {
    getCell: jest.fn(async (row: number, col: number) => ({
      value: cellValue(grid, row, col),
    })),
    getRange: jest.fn(
      async (startRow: number, startCol: number, endRow: number, endCol: number) => {
        if (getRangeImpl) {
          return getRangeImpl(startRow, startCol, endRow, endCol);
        }
        return rangeValues(grid, startRow, startCol, endRow, endCol);
      },
    ),
  };

  return {
    workbook: {
      getSheetById: jest.fn(() => worksheet),
    },
    worksheet,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushAsync(turns = 20): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

async function waitForMockCall(mock: { mock: { calls: unknown[] } }, expectedCalls = 1) {
  for (let i = 0; i < 20; i++) {
    if (mock.mock.calls.length >= expectedCalls) return;
    await Promise.resolve();
  }
  throw new Error(`Expected mock to be called ${expectedCalls} time(s)`);
}

describe('FlashFillCoordinator auto-preview', () => {
  it('does not show a passive suggestion after only one example', async () => {
    const uiStore = createMockUIStore();
    const { workbook } = createMockWorkbook([
      ['John Smith', 'John'],
      ['Mary Jones', null],
      ['Carlos Diaz', null],
    ]);
    const coordinator = createFlashFillCoordinator();
    coordinator.setDependencies({
      workbook: workbook as any,
      uiStore: uiStore as any,
      getActiveSheetId: () => 'sheet-1' as any,
    });

    coordinator.checkForPatternOnCellCommit(0, 1);
    await flushAsync();

    expect(uiStore.getState().showFlashFillPreview).not.toHaveBeenCalled();
    expect(uiStore.getState().flashFillPreview.isShowingPreview).toBe(false);
  });

  it('shows a passive suggestion after two examples establish the pattern', async () => {
    const uiStore = createMockUIStore();
    const { workbook } = createMockWorkbook([
      ['John Smith', 'John'],
      ['Mary Jones', 'Mary'],
      ['Carlos Diaz', null],
    ]);
    const coordinator = createFlashFillCoordinator();
    coordinator.setDependencies({
      workbook: workbook as any,
      uiStore: uiStore as any,
      getActiveSheetId: () => 'sheet-1' as any,
    });

    coordinator.checkForPatternOnCellCommit(1, 1);
    await flushAsync();

    expect(uiStore.getState().flashFillPreview).toMatchObject({
      isShowingPreview: true,
      targetColumn: 1,
      previewValues: [{ row: 2, col: 1, value: 'Carlos' }],
    });
  });

  it('does not show a stale async suggestion after the preview is rejected', async () => {
    const grid = [
      ['John Smith', 'John'],
      ['Mary Jones', 'Mary'],
      ['Carlos Diaz', null],
    ];
    const rangeDeferred = createDeferred<any[][]>();
    const uiStore = createMockUIStore();
    const { workbook, worksheet } = createMockWorkbook(grid, async () => rangeDeferred.promise);
    const coordinator = createFlashFillCoordinator();
    coordinator.setDependencies({
      workbook: workbook as any,
      uiStore: uiStore as any,
      getActiveSheetId: () => 'sheet-1' as any,
    });

    coordinator.checkForPatternOnCellCommit(1, 1);
    await waitForMockCall(worksheet.getRange);

    coordinator.rejectPreview();
    rangeDeferred.resolve(rangeValues(grid, 0, 0, 2, 5));
    await flushAsync();

    expect(uiStore.getState().flashFillPreview.isShowingPreview).toBe(false);
    expect(uiStore.getState().showFlashFillPreview).not.toHaveBeenCalled();
  });
});
