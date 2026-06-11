/**
 * Sort Action Handlers — unit tests
 *
 * Coverage for current-region auto-expansion in sort handlers
 * (`SORT_ASCENDING`, `SORT_DESCENDING`, `SORT_BY_CELL_COLOR`,
 * `SORT_BY_FONT_COLOR`). Excel auto-expands a single-cell or single-row
 * selection to the contiguous data block before running Sort, and the sort
 * key is the *active cell's* column within the resolved range (clicking C3
 * in A1:D10 sorts by C, not A). Multi-row selections pass through unchanged
 * but still infer headers when the selected first row has a header signal.
 *
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellCoord, CellRange } from '@mog-sdk/contracts/core';

import { SORT_ASCENDING, SORT_BY_CELL_COLOR, SORT_BY_FONT_COLOR, SORT_DESCENDING } from '../editor';

interface MockSetup {
  deps: ActionDependencies;
  sortRange: jest.Mock;
  getCurrentRegion: jest.Mock;
  getMergedRegions: jest.Mock;
  listSummaries: jest.Mock;
  openSortDialog: jest.Mock;
}

/**
 * Build mock deps. `currentRegion` controls what `ws.getCurrentRegion(row,col)`
 * returns — used by `expandToDataRegion` for single-cell / single-row inputs.
 * Multi-row inputs bypass it entirely.
 */
function makeMockDeps(opts: {
  selectionRanges: CellRange[];
  activeCell?: CellCoord;
  currentRegion?: CellRange;
  mergedRegions?: CellRange[];
  cellValues?: Record<string, unknown>;
  filterSummaries?: Array<{
    id: string;
    filterKind: 'autoFilter' | 'tableFilter' | 'advancedFilter';
    range: CellRange;
    tableId?: string;
    activeColumnCount: number;
    hasActiveCriteria: boolean;
  }>;
  activeFormat?: { backgroundColor?: string; fontColor?: string };
}): MockSetup {
  const activeCell = opts.activeCell ?? { row: 0, col: 0 };
  const sortRange = jest.fn().mockResolvedValue(undefined as never);
  const openSortDialog = jest.fn();
  // Default: identity (single-cell input → single-cell output → expandToDataRegion returns null)
  const defaultRegion: CellRange = {
    startRow: activeCell.row,
    startCol: activeCell.col,
    endRow: activeCell.row,
    endCol: activeCell.col,
  };
  const getCurrentRegion = jest
    .fn()
    .mockResolvedValue((opts.currentRegion ?? defaultRegion) as never);
  const getMergedRegions = jest.fn().mockResolvedValue((opts.mergedRegions ?? []) as never);
  const getCell = jest.fn((row: number, col: number) =>
    Promise.resolve({ value: opts.cellValues?.[`${row},${col}`] ?? null }),
  );
  const listSummaries = jest.fn().mockResolvedValue((opts.filterSummaries ?? []) as never);

  const ws = {
    getCell,
    getCurrentRegion,
    sortRange,
    filters: {
      listSummaries,
    },
    formats: {
      get: jest.fn().mockResolvedValue((opts.activeFormat ?? {}) as never),
    },
    structure: { getMergedRegions },
  };

  const workbook = {
    getSheetById: jest.fn().mockReturnValue(ws),
    indexToAddress: jest.fn((row: number, col: number) => `R${row}C${col}`),
    addressToIndex: jest.fn(() => ({ row: 0, col: 0 })),
  };

  const uiStore = {
    getState: () => ({ openSortDialog }),
  };

  const deps = {
    workbook,
    uiStore,
    accessors: {
      selection: {
        getActiveCell: () => activeCell,
        getRanges: () => opts.selectionRanges,
        getAnchor: () => activeCell,
      },
    },
    commands: {},
    getActiveSheetId: () => 'sheet1' as any,
  } as unknown as ActionDependencies;

  return { deps, sortRange, getCurrentRegion, getMergedRegions, listSummaries, openSortDialog };
}

describe('SORT_ASCENDING — current-region auto-expansion', () => {
  test('single-cell selection at A1 expands to data region and sorts by column 0', async () => {
    // User clicks A1; data region is A1:D10; sort by column A (index 0).
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      activeCell: { row: 0, col: 0 },
      currentRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      activeFormat: { backgroundColor: '#ff0000' },
    });

    const result = await SORT_ASCENDING(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [rangeArg, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(rangeArg).toEqual({ startRow: 0, startCol: 0, endRow: 9, endCol: 3 });
    expect(optionsArg).toEqual({
      columns: [{ column: 0, direction: 'asc' }],
      hasHeaders: false,
    });
  });

  test('single cell at C3 in A1:D10 → sort key is column 2 (C - A)', async () => {
    // User clicks C3; data region is A1:D10. Excel sorts by column C, which is
    // index 2 within the expanded range (range.startCol 2 - expanded.startCol 0).
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 2, startCol: 2, endRow: 2, endCol: 2 }],
      activeCell: { row: 2, col: 2 },
      currentRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
    });

    await SORT_ASCENDING(setup.deps);

    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [rangeArg, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(rangeArg).toEqual({ startRow: 0, startCol: 0, endRow: 9, endCol: 3 });
    expect(optionsArg).toEqual({
      columns: [{ column: 2, direction: 'asc' }],
      hasHeaders: false,
    });
  });

  test('single cell inside an AutoFilter sorts the filter range over visible rows', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 12, startCol: 27, endRow: 12, endCol: 27 }],
      activeCell: { row: 12, col: 27 },
      currentRegion: { startRow: 6, startCol: 15, endRow: 37, endCol: 42 },
      filterSummaries: [
        {
          id: 'filter-1',
          filterKind: 'autoFilter',
          range: { startRow: 2, startCol: 11, endRow: 20, endCol: 27 },
          activeColumnCount: 1,
          hasActiveCriteria: true,
        },
      ],
    });

    await SORT_ASCENDING(setup.deps);

    expect(setup.listSummaries).toHaveBeenCalledWith({ scope: 'available' });
    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [rangeArg, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(rangeArg).toEqual({ startRow: 2, startCol: 11, endRow: 20, endCol: 27 });
    expect(optionsArg).toEqual({
      columns: [{ column: 16, direction: 'asc' }],
      hasHeaders: true,
      visibleRowsOnly: true,
    });
  });

  test('empty cell returns notHandled("disabled") — does not pollute F4 repeat', async () => {
    // User clicks an isolated cell; getCurrentRegion returns the same single
    // cell → expandToDataRegion returns null → nothing was sorted, so the
    // handler reports `disabled` rather than `handled` (otherwise the
    // dispatcher would record SORT_ASCENDING as the last repeatable action
    // and F4 / Ctrl+Y would replay a no-op).
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 5, startCol: 5, endRow: 5, endCol: 5 }],
      activeCell: { row: 5, col: 5 },
      currentRegion: { startRow: 5, startCol: 5, endRow: 5, endCol: 5 },
    });

    const result = await SORT_ASCENDING(setup.deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(setup.sortRange).not.toHaveBeenCalled();
  });

  test('no selection returns notHandled("disabled")', async () => {
    const setup = makeMockDeps({ selectionRanges: [] });

    const result = await SORT_ASCENDING(setup.deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(setup.sortRange).not.toHaveBeenCalled();
  });

  test('single-row A1:D1 with active cell C1 → sort key is C, not A', async () => {
    // User selected the header row A1:D1 and clicked C1; data extends down
    // to A1:D10. expandToDataRegion treats single-row as expandable.
    // Excel sorts by the active cell's column (C, index 2), not the
    // range's leftmost (A, index 0).
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }],
      activeCell: { row: 0, col: 2 },
      currentRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
    });

    await SORT_ASCENDING(setup.deps);

    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [rangeArg, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(rangeArg).toEqual({ startRow: 0, startCol: 0, endRow: 9, endCol: 3 });
    expect(optionsArg).toEqual({
      columns: [{ column: 2, direction: 'asc' }],
      hasHeaders: false,
    });
  });

  test('multi-row selection is honored as-is (no current-region expansion)', async () => {
    // Selection A1:B5 — 5 rows. expandToDataRegion returns the range unchanged.
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 0, startCol: 0, endRow: 4, endCol: 1 }],
      activeCell: { row: 0, col: 0 },
    });

    await SORT_ASCENDING(setup.deps);

    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [rangeArg, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(rangeArg).toEqual({ startRow: 0, startCol: 0, endRow: 4, endCol: 1 });
    expect(optionsArg).toEqual({
      columns: [{ column: 0, direction: 'asc' }],
      hasHeaders: false,
    });
  });

  test('explicit A2:A6 mixed data selection is sorted as headerless', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 1, startCol: 0, endRow: 5, endCol: 0 }],
      activeCell: { row: 1, col: 0 },
      cellValues: {
        '1,0': 'Banana',
        '2,0': 1,
      },
    });

    await SORT_ASCENDING(setup.deps);

    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [rangeArg, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(rangeArg).toEqual({ startRow: 1, startCol: 0, endRow: 5, endCol: 0 });
    expect(optionsArg).toEqual({
      columns: [{ column: 0, direction: 'asc' }],
      hasHeaders: false,
    });
  });

  test('explicit fiscal column selection keeps the top period header out of the sort body', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 2, startCol: 27, endRow: 20, endCol: 27 }],
      activeCell: { row: 2, col: 27 },
      cellValues: {
        '2,27': '1Q',
        '3,27': '',
        '4,27': null,
        '5,27': 100536,
      },
    });

    await SORT_ASCENDING(setup.deps);

    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [rangeArg, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(rangeArg).toEqual({ startRow: 2, startCol: 27, endRow: 20, endCol: 27 });
    expect(optionsArg).toEqual({
      columns: [{ column: 0, direction: 'asc' }],
      hasHeaders: true,
    });
  });

  test('expanded single-cell selection with text headers preserves header row', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 1, startCol: 0, endRow: 1, endCol: 0 }],
      activeCell: { row: 1, col: 0 },
      currentRegion: { startRow: 0, startCol: 0, endRow: 3, endCol: 1 },
      cellValues: {
        '0,0': 'Name',
        '0,1': 'Score',
        '1,0': 'Charlie',
        '1,1': 3,
      },
    });

    await SORT_ASCENDING(setup.deps);

    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(optionsArg).toEqual({
      columns: [{ column: 0, direction: 'asc' }],
      hasHeaders: true,
    });
  });

  test('expanded range overlapping a merged region returns blocked', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      activeCell: { row: 0, col: 0 },
      currentRegion: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 },
      mergedRegions: [{ startRow: 1, startCol: 0, endRow: 1, endCol: 1 }],
    });

    const result = await SORT_ASCENDING(setup.deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('blocked');
    expect(setup.sortRange).not.toHaveBeenCalled();
  });

  test('multi-row selection sorts by active column when active cell is inside range', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 0, startCol: 0, endRow: 4, endCol: 1 }],
      activeCell: { row: 2, col: 1 },
    });

    await SORT_ASCENDING(setup.deps);

    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(optionsArg).toEqual({
      columns: [{ column: 1, direction: 'asc' }],
      hasHeaders: false,
    });
  });

  test('multi-row selection falls back to leftmost column when active cell is outside range', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 0, startCol: 0, endRow: 4, endCol: 1 }],
      activeCell: { row: 8, col: 3 },
    });

    await SORT_ASCENDING(setup.deps);

    expect(setup.getCurrentRegion).not.toHaveBeenCalled();
    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(optionsArg).toEqual({
      columns: [{ column: 0, direction: 'asc' }],
      hasHeaders: false,
    });
  });
});

describe('SORT_DESCENDING — current-region auto-expansion', () => {
  test('single cell at C3 in A1:D10 → sort key column 2, direction desc', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 2, startCol: 2, endRow: 2, endCol: 2 }],
      activeCell: { row: 2, col: 2 },
      currentRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
    });

    await SORT_DESCENDING(setup.deps);

    expect(setup.sortRange).toHaveBeenCalledTimes(1);
    const [rangeArg, optionsArg] = setup.sortRange.mock.calls[0] as [unknown, unknown];
    expect(rangeArg).toEqual({ startRow: 0, startCol: 0, endRow: 9, endCol: 3 });
    expect(optionsArg).toEqual({
      columns: [{ column: 2, direction: 'desc' }],
      hasHeaders: false,
    });
  });
});

describe('SORT_BY_CELL_COLOR — current-region auto-expansion', () => {
  test('single-cell selection in data region opens dialog with expanded range', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      activeCell: { row: 0, col: 0 },
      currentRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      activeFormat: { backgroundColor: '#ff0000' },
    });

    const result = await SORT_BY_CELL_COLOR(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.openSortDialog).toHaveBeenCalledTimes(1);
    expect(setup.openSortDialog).toHaveBeenCalledWith(
      { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      false,
      {
        type: 'cellColor',
        criterion: {
          sortBy: 'cellColor',
          columnIndex: 0,
          direction: 'asc',
          targetColor: '#ff0000',
          colorPosition: 'top',
        },
      },
    );
  });

  test('empty cell returns notHandled("disabled")', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 5, startCol: 5, endRow: 5, endCol: 5 }],
      activeCell: { row: 5, col: 5 },
      currentRegion: { startRow: 5, startCol: 5, endRow: 5, endCol: 5 },
    });

    const result = await SORT_BY_CELL_COLOR(setup.deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(setup.openSortDialog).not.toHaveBeenCalled();
  });

  test('no selection returns notHandled("disabled")', async () => {
    const setup = makeMockDeps({ selectionRanges: [] });

    const result = await SORT_BY_CELL_COLOR(setup.deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(setup.openSortDialog).not.toHaveBeenCalled();
  });
});

describe('SORT_BY_FONT_COLOR — current-region auto-expansion', () => {
  test('single-cell selection in data region opens dialog with expanded range', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
      activeCell: { row: 0, col: 0 },
      currentRegion: { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      activeFormat: { fontColor: '#0000ff' },
    });

    const result = await SORT_BY_FONT_COLOR(setup.deps);

    expect(result.handled).toBe(true);
    expect(setup.openSortDialog).toHaveBeenCalledWith(
      { startRow: 0, startCol: 0, endRow: 9, endCol: 3 },
      false,
      {
        type: 'fontColor',
        criterion: {
          sortBy: 'fontColor',
          columnIndex: 0,
          direction: 'asc',
          targetColor: '#0000ff',
          colorPosition: 'top',
        },
      },
    );
  });

  test('empty cell returns notHandled("disabled")', async () => {
    const setup = makeMockDeps({
      selectionRanges: [{ startRow: 5, startCol: 5, endRow: 5, endCol: 5 }],
      activeCell: { row: 5, col: 5 },
      currentRegion: { startRow: 5, startCol: 5, endRow: 5, endCol: 5 },
    });

    const result = await SORT_BY_FONT_COLOR(setup.deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(setup.openSortDialog).not.toHaveBeenCalled();
  });
});
