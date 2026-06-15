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
  layout: {
    hideRows: jest.Mock;
    hideColumns: jest.Mock;
    unhideRows: jest.Mock;
    unhideColumns: jest.Mock;
  };
  workbook: {
    setPendingUndoDescription: jest.Mock;
  };
}

interface MockSelectionOptions {
  activeCell?: { row: number; col: number };
  anchor?: { row: number; col: number } | null;
  anchorCol?: number | null;
  anchorRow?: number | null;
}

function createMockDeps(
  ranges: CellRange[],
  outlineState = { rowGroups: [], columnGroups: [] },
  outlineSettings = { summaryRowsBelow: true, summaryColumnsRight: true },
  selectionOptions: MockSelectionOptions = {},
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
  const layout = {
    hideRows: jest.fn().mockResolvedValue(undefined),
    hideColumns: jest.fn().mockResolvedValue(undefined),
    unhideRows: jest.fn().mockResolvedValue(undefined),
    unhideColumns: jest.fn().mockResolvedValue(undefined),
  };
  const worksheet = { outline, layout };
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
        getActiveCell: jest.fn().mockReturnValue(selectionOptions.activeCell ?? { row: 0, col: 0 }),
        getAnchor: jest.fn().mockReturnValue(selectionOptions.anchor ?? null),
        getAnchorCol: jest.fn().mockReturnValue(selectionOptions.anchorCol ?? null),
        getAnchorRow: jest.fn().mockReturnValue(selectionOptions.anchorRow ?? null),
      },
    },
  } as unknown as ActionDependencies;

  return { deps, outline, layout, workbook };
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

  it('ungroups the containing row group for a single full-row selection', async () => {
    const { deps, outline, workbook } = createMockDeps([fullRowRange(3, 3)], {
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

  it('ungroups the containing column group for a single full-column selection', async () => {
    const { deps, outline, workbook } = createMockDeps([fullColumnRange(4, 4)], {
      rowGroups: [],
      columnGroups: [{ id: 'cols-3-5', start: 2, end: 4, level: 1, collapsed: false }],
    });

    const result = await UNGROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.getState).toHaveBeenCalledTimes(1);
    expect(outline.ungroupColumns).toHaveBeenCalledTimes(1);
    expect(outline.ungroupColumns).toHaveBeenCalledWith(2, 4);
    expect(outline.ungroupRows).not.toHaveBeenCalled();
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Ungroup columns 3-5');
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

  it('recovers a collapsed full-row GROUP selection from the preserved anchor', async () => {
    const { deps, outline, workbook } = createMockDeps(
      [fullRowRange(5, 5)],
      { rowGroups: [], columnGroups: [] },
      { summaryRowsBelow: true, summaryColumnsRight: true },
      { activeCell: { row: 5, col: 0 }, anchor: { row: 3, col: 0 } },
    );

    const result = await GROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.groupRows).toHaveBeenCalledTimes(1);
    expect(outline.groupRows).toHaveBeenCalledWith(3, 5);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Group rows 4-6');
  });

  it('recovers a collapsed full-row UNGROUP selection from the preserved anchor', async () => {
    const { deps, outline, workbook } = createMockDeps(
      [fullRowRange(5, 5)],
      {
        rowGroups: [{ id: 'rows-4-6', start: 3, end: 5, level: 1, collapsed: false }],
        columnGroups: [],
      },
      { summaryRowsBelow: true, summaryColumnsRight: true },
      { activeCell: { row: 5, col: 0 }, anchor: { row: 3, col: 0 } },
    );

    const result = await UNGROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.ungroupRows).toHaveBeenCalledTimes(1);
    expect(outline.ungroupRows).toHaveBeenCalledWith(3, 5);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Ungroup rows 4-6');
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

  it('routes ordinary 2D UNGROUP selections to columns when only a column group contains them', async () => {
    const range: CellRange = { startRow: 2, startCol: 11, endRow: 20, endCol: 13 };
    const { deps, outline, workbook } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [{ id: 'cols-l-n', start: 11, end: 13, level: 2, collapsed: false }],
    });

    const result = await UNGROUP(deps);

    expect(result.handled).toBe(true);
    expect(outline.getState).toHaveBeenCalledTimes(1);
    expect(outline.ungroupColumns).toHaveBeenCalledTimes(1);
    expect(outline.ungroupColumns).toHaveBeenCalledWith(11, 13);
    expect(outline.ungroupRows).not.toHaveBeenCalled();
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Ungroup columns 12-14');
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

  it('expands a collapsed column group from the visible leading outline context', async () => {
    const range: CellRange = { startRow: 20, startCol: 13, endRow: 20, endCol: 13 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [
        { id: 'cols-l', start: 11, end: 11, level: 1, collapsed: false },
        { id: 'cols-p-aa', start: 15, end: 26, level: 1, collapsed: true },
      ],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('cols-p-aa');
  });

  it('expands an imported collapsed-on-member column group from the adjacent column on the left', async () => {
    const range: CellRange = { startRow: 12, startCol: 14, endRow: 12, endCol: 14 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [
        {
          id: 'imported-cols-p-aa',
          start: 15,
          end: 26,
          level: 1,
          collapsed: true,
          collapsedOnMember: true,
        },
      ],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('imported-cols-p-aa');
  });

  it('expands an imported hidden row group through the outline toggle only', async () => {
    const range: CellRange = { startRow: 4, startCol: 0, endRow: 4, endCol: 0 };
    const { deps, outline, layout } = createMockDeps([range], {
      rowGroups: [
        {
          id: 'imported-rows-2-4',
          start: 1,
          end: 3,
          level: 1,
          collapsed: true,
          hidden: true,
        },
      ],
      columnGroups: [],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('imported-rows-2-4');
    expect(layout.unhideRows).not.toHaveBeenCalled();
  });

  it('expands an imported hidden column group from the adjacent column on the left through the outline toggle only', async () => {
    const range: CellRange = { startRow: 12, startCol: 14, endRow: 12, endCol: 14 };
    const { deps, outline, layout } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [
        {
          id: 'imported-cols-p-aa',
          start: 15,
          end: 26,
          level: 1,
          collapsed: true,
          hidden: true,
        },
      ],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('imported-cols-p-aa');
    expect(layout.unhideColumns).not.toHaveBeenCalled();
  });

  it('expands an imported hidden column group from its visible leading sibling group through the outline toggle only', async () => {
    const range: CellRange = { startRow: 12, startCol: 11, endRow: 12, endCol: 11 };
    const { deps, outline, layout } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [
        { id: 'cols-l', start: 11, end: 11, level: 1, collapsed: false },
        {
          id: 'imported-cols-p-aa',
          start: 15,
          end: 26,
          level: 1,
          collapsed: true,
          hidden: true,
        },
      ],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('imported-cols-p-aa');
    expect(layout.unhideColumns).not.toHaveBeenCalled();
  });

  it('expands a collapsed column group when the selection overlaps hidden detail columns', async () => {
    const range: CellRange = { startRow: 2, startCol: 11, endRow: 20, endCol: 27 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [{ id: 'cols-p-aa', start: 15, end: 26, level: 1, collapsed: true }],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('cols-p-aa');
  });

  it('does not expand an ordinary collapsed column group from the opposite summary edge', async () => {
    const range: CellRange = { startRow: 12, startCol: 14, endRow: 12, endCol: 14 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [
        {
          id: 'ordinary-cols-p-aa',
          start: 15,
          end: 26,
          level: 1,
          collapsed: true,
        },
      ],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(false);
    expect(outline.toggleCollapsed).not.toHaveBeenCalled();
  });

  it('does not expand a distant collapsed column group without an outline context', async () => {
    const range: CellRange = { startRow: 0, startCol: 2, endRow: 0, endCol: 2 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [{ id: 'cols-p-aa', start: 15, end: 26, level: 1, collapsed: true }],
    });

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(false);
    expect(outline.toggleCollapsed).not.toHaveBeenCalled();
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

  it('collapses a recovered full-row selection without also collapsing visible column groups', async () => {
    const { deps, outline } = createMockDeps(
      [fullRowRange(8, 8)],
      {
        rowGroups: [{ id: 'rows-7-9', start: 6, end: 8, level: 1, collapsed: false }],
        columnGroups: [
          { id: 'cols-l', start: 11, end: 11, level: 1, collapsed: false },
          { id: 'cols-p-aa', start: 15, end: 26, level: 1, collapsed: true },
        ],
      },
      { summaryRowsBelow: true, summaryColumnsRight: true },
      { activeCell: { row: 8, col: 0 }, anchor: { row: 6, col: 14 } },
    );

    const result = await HIDE_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('rows-7-9');
  });

  it('expands a recovered full-row selection without also expanding collapsed column groups', async () => {
    const { deps, outline } = createMockDeps(
      [fullRowRange(8, 8)],
      {
        rowGroups: [{ id: 'rows-7-9', start: 6, end: 8, level: 1, collapsed: true }],
        columnGroups: [{ id: 'cols-p-aa', start: 15, end: 26, level: 1, collapsed: true }],
      },
      { summaryRowsBelow: true, summaryColumnsRight: true },
      { activeCell: { row: 8, col: 0 }, anchor: { row: 6, col: 14 } },
    );

    const result = await SHOW_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('rows-7-9');
  });

  it('collapses an expanded column group from the visible leading outline context', async () => {
    const range: CellRange = { startRow: 12, startCol: 14, endRow: 12, endCol: 14 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [
        { id: 'cols-l', start: 11, end: 11, level: 1, collapsed: false },
        { id: 'cols-p-aa', start: 15, end: 26, level: 1, collapsed: false },
      ],
    });

    const result = await HIDE_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('cols-p-aa');
  });

  it('collapses an imported expanded column group from the adjacent column on the left', async () => {
    const range: CellRange = { startRow: 12, startCol: 14, endRow: 12, endCol: 14 };
    const { deps, outline } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [
        {
          id: 'imported-cols-p-aa',
          start: 15,
          end: 26,
          level: 1,
          collapsed: false,
          collapsedOnMember: true,
        },
      ],
    });

    const result = await HIDE_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('imported-cols-p-aa');
  });

  it('collapses an imported hidden column group from the adjacent column on the left', async () => {
    const range: CellRange = { startRow: 12, startCol: 14, endRow: 12, endCol: 14 };
    const { deps, outline, layout } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [
        {
          id: 'imported-cols-p-aa',
          start: 15,
          end: 26,
          level: 1,
          collapsed: false,
          hidden: true,
        },
      ],
    });

    const result = await HIDE_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).not.toHaveBeenCalled();
    expect(layout.hideColumns).toHaveBeenCalledTimes(1);
    expect(layout.hideColumns).toHaveBeenCalledWith([
      15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
  });

  it('collapses an imported hidden column group instead of its visible leading sibling group', async () => {
    const range: CellRange = { startRow: 12, startCol: 11, endRow: 12, endCol: 11 };
    const { deps, outline, layout } = createMockDeps([range], {
      rowGroups: [],
      columnGroups: [
        { id: 'cols-l', start: 11, end: 11, level: 1, collapsed: false },
        {
          id: 'imported-cols-p-aa',
          start: 15,
          end: 26,
          level: 1,
          collapsed: false,
        },
      ],
    });

    const result = await HIDE_DETAIL(deps);

    expect(result.handled).toBe(true);
    expect(outline.toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(outline.toggleCollapsed).toHaveBeenCalledWith('imported-cols-p-aa');
    expect(layout.hideColumns).not.toHaveBeenCalled();
  });
});
