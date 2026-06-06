import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { MAX_COLS, MAX_ROWS, sheetId, type CellRange } from '@mog-sdk/contracts/core';

import { GROUP, HIDE_DETAIL, SHOW_DETAIL, UNGROUP } from '../workbook';

interface MockSetup {
  deps: ActionDependencies;
  outline: {
    groupRows: jest.Mock;
    groupColumns: jest.Mock;
    ungroupRows: jest.Mock;
    ungroupColumns: jest.Mock;
    toggleCollapsed: jest.Mock;
    getState: jest.Mock;
    getSettings: jest.Mock;
  };
  workbook: {
    setPendingUndoDescription: jest.Mock;
  };
}

function createMockDeps(
  ranges: CellRange[],
  outlineState = { rowGroups: [], columnGroups: [] },
  outlineSettings = { summaryRowsBelow: true, summaryColumnsRight: true },
): MockSetup {
  const activeSheetId = sheetId('sheet1');
  const outline = {
    groupRows: jest.fn().mockResolvedValue(undefined),
    groupColumns: jest.fn().mockResolvedValue(undefined),
    ungroupRows: jest.fn().mockResolvedValue(undefined),
    ungroupColumns: jest.fn().mockResolvedValue(undefined),
    toggleCollapsed: jest.fn().mockResolvedValue(undefined),
    getState: jest.fn().mockResolvedValue(outlineState),
    getSettings: jest.fn().mockResolvedValue(outlineSettings),
  };
  const worksheet = { outline };
  const workbook = {
    getActiveSheetId: jest.fn().mockReturnValue(activeSheetId),
    getSheetById: jest.fn().mockReturnValue(worksheet),
    setPendingUndoDescription: jest.fn(),
  };

  const deps = {
    workbook,
    accessors: {
      selection: {
        getRanges: jest.fn().mockReturnValue(ranges),
      },
    },
  } as unknown as ActionDependencies;

  return { deps, outline, workbook };
}

function fullColumnRange(startCol: number, endCol: number): CellRange {
  return {
    startRow: 0,
    startCol,
    endRow: MAX_ROWS - 1,
    endCol,
    isFullColumn: true,
  };
}

function fullRowRange(startRow: number, endRow: number): CellRange {
  return {
    startRow,
    startCol: 0,
    endRow,
    endCol: MAX_COLS - 1,
    isFullRow: true,
  };
}

describe('Workbook GROUP/UNGROUP axis inference', () => {
  it('routes GROUP on full-column selections to column grouping', async () => {
    const { deps, outline, workbook } = createMockDeps([fullColumnRange(2, 4)]);

    const result = await GROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.groupColumns).toHaveBeenCalledTimes(1);
    expect(outline.groupColumns).toHaveBeenCalledWith(2, 4);
    expect(outline.groupRows).not.toHaveBeenCalled();
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Group columns 3-5');
  });

  it('routes UNGROUP on full-column selections to column ungrouping', async () => {
    const { deps, outline, workbook } = createMockDeps([fullColumnRange(5, 6)]);

    const result = await UNGROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.ungroupColumns).toHaveBeenCalledTimes(1);
    expect(outline.ungroupColumns).toHaveBeenCalledWith(5, 6);
    expect(outline.ungroupRows).not.toHaveBeenCalled();
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Ungroup columns 6-7');
  });

  it('ungroups the containing row group for a single-cell selection', async () => {
    const range: CellRange = { startRow: 1, startCol: 0, endRow: 1, endCol: 0 };
    const { deps, outline, workbook } = createMockDeps([range], {
      rowGroups: [{ id: 'rows-2-4', start: 1, end: 3, level: 1, collapsed: false }],
      columnGroups: [],
    });

    const result = await UNGROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.getState).toHaveBeenCalledTimes(1);
    expect(outline.ungroupRows).toHaveBeenCalledTimes(1);
    expect(outline.ungroupRows).toHaveBeenCalledWith(1, 3);
    expect(outline.ungroupColumns).not.toHaveBeenCalled();
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Ungroup rows 2-4');
  });

  it('routes full-row selections to row grouping', async () => {
    const { deps, outline, workbook } = createMockDeps([fullRowRange(3, 5)]);

    const result = await GROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.groupRows).toHaveBeenCalledTimes(1);
    expect(outline.groupRows).toHaveBeenCalledWith(3, 5);
    expect(outline.groupColumns).not.toHaveBeenCalled();
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Group rows 4-6');
  });

  it('keeps ordinary 2D selections on the existing row-first route', async () => {
    const range: CellRange = { startRow: 2, startCol: 3, endRow: 4, endCol: 6 };
    const { deps, outline, workbook } = createMockDeps([range]);

    const result = await GROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.groupRows).toHaveBeenCalledTimes(1);
    expect(outline.groupRows).toHaveBeenCalledWith(2, 4);
    expect(outline.groupColumns).not.toHaveBeenCalled();
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Group rows 3-5');
  });

  it('treats canonical max-bound column ranges as full-column selections', async () => {
    const range: CellRange = {
      startRow: 0,
      startCol: 7,
      endRow: MAX_ROWS - 1,
      endCol: 8,
    };
    const { deps, outline, workbook } = createMockDeps([range]);

    const result = await GROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.groupColumns).toHaveBeenCalledTimes(1);
    expect(outline.groupColumns).toHaveBeenCalledWith(7, 8);
    expect(outline.groupRows).not.toHaveBeenCalled();
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Group columns 8-9');
  });

  it('keeps select-all on the existing row-first fallback', async () => {
    const range: CellRange = {
      startRow: 0,
      startCol: 0,
      endRow: MAX_ROWS - 1,
      endCol: MAX_COLS - 1,
      isFullColumn: true,
      isFullRow: true,
    };
    const { deps, outline, workbook } = createMockDeps([range]);

    const result = await GROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.groupRows).toHaveBeenCalledTimes(1);
    expect(outline.groupRows).toHaveBeenCalledWith(0, MAX_ROWS - 1);
    expect(outline.groupColumns).not.toHaveBeenCalled();
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Group rows 1-1048576');
  });
});

describe('Workbook SHOW_DETAIL/HIDE_DETAIL summary selections', () => {
  it('expands a collapsed row group from the adjacent summary row below', async () => {
    const range: CellRange = { startRow: 4, startCol: 0, endRow: 4, endCol: 0 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [{ id: 'rows-2-4', start: 1, end: 3, level: 1, collapsed: true }],
      columnGroups: [],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.getSettings).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('rows-2-4');
  });

  it('expands a collapsed row group from the adjacent summary row above', async () => {
    const range: CellRange = { startRow: 1, startCol: 0, endRow: 1, endCol: 0 };
    const { deps, outline } = createMockDeps(
      [range],
      {
        rowGroups: [{ id: 'rows-3-5', start: 2, end: 4, level: 1, collapsed: true }],
        columnGroups: [],
      },
      { summaryRowsBelow: false, summaryColumnsRight: true },
    );

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('rows-3-5');
  });

  it('expands a collapsed column group from the adjacent summary column on the right', async () => {
    const range: CellRange = { startRow: 0, startCol: 4, endRow: 0, endCol: 4 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [{ id: 'cols-b-d', start: 1, end: 3, level: 1, collapsed: true }],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('cols-b-d');
  });

  it('collapses the innermost expanded row group from its adjacent summary row', async () => {
    const range: CellRange = { startRow: 4, startCol: 0, endRow: 4, endCol: 0 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [
        { id: 'outer', start: 1, end: 5, level: 1, collapsed: false },
        { id: 'inner', start: 2, end: 3, level: 2, collapsed: false },
      ],
      columnGroups: [],
    });

    const result = await HIDE_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('inner');
  });
});
