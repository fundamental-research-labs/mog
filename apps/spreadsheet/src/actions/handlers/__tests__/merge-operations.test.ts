import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import {
  CONFIRM_MERGE_WITH_DATA_LOSS,
  MERGE_ACROSS,
  MERGE_AND_CENTER,
  MERGE_CELLS,
  UNMERGE_CELLS,
} from '../formatting/merge-operations';
import { SET_HORIZONTAL_ALIGN } from '../formatting/cell-format-dialogs';

interface MockSetup {
  deps: ActionDependencies;
  workbook: {
    getSheetById: jest.Mock;
    setPendingUndoDescription: jest.Mock;
    undoGroup: jest.Mock;
    notifications: {
      warning: jest.Mock;
    };
  };
  worksheet: {
    viewport: {
      getCellData: jest.Mock;
      getMerges: jest.Mock;
    };
    structure: {
      merge: jest.Mock;
      unmerge: jest.Mock;
      getMergedRegions: jest.Mock;
    };
    formats: {
      set: jest.Mock;
      setRanges: jest.Mock;
    };
    protection: {
      canDoStructureOp: jest.Mock;
    };
  };
  uiState: {
    mergeWarningDialog: {
      isOpen: boolean;
      pendingRange: CellRange | null;
      sheetId: SheetId | null;
      cellsWithData: Array<{ row: number; col: number }>;
      mergeType: 'merge' | 'mergeAcross' | 'mergeAndCenter' | null;
    };
    openMergeWarningDialog: jest.Mock;
    closeMergeWarningDialog: jest.Mock;
    setSelectionError: jest.Mock;
    showProtectionAlert: jest.Mock;
  };
}

const activeSheetId = 'sheet1' as SheetId;

function createMockDeps(ranges: CellRange[]): MockSetup {
  const worksheet = {
    viewport: {
      getCellData: jest.fn().mockReturnValue({ value: null }),
      getMerges: jest.fn().mockReturnValue([]),
    },
    structure: {
      merge: jest.fn().mockResolvedValue(undefined),
      unmerge: jest.fn().mockResolvedValue(undefined),
      getMergedRegions: jest.fn().mockResolvedValue([]),
    },
    formats: {
      set: jest.fn().mockResolvedValue(undefined),
      setRanges: jest.fn().mockResolvedValue(undefined),
    },
    protection: {
      canDoStructureOp: jest.fn().mockResolvedValue(true),
    },
  };

  const workbook = {
    getSheetById: jest.fn().mockReturnValue(worksheet),
    setPendingUndoDescription: jest.fn(),
    undoGroup: jest.fn(async (fn: () => Promise<unknown>) => fn()),
    notifications: {
      warning: jest.fn(),
    },
  };

  const uiState = {
    mergeWarningDialog: {
      isOpen: false,
      pendingRange: null as CellRange | null,
      sheetId: null as SheetId | null,
      cellsWithData: [] as Array<{ row: number; col: number }>,
      mergeType: null as 'merge' | 'mergeAcross' | 'mergeAndCenter' | null,
    },
    openMergeWarningDialog: jest.fn(),
    closeMergeWarningDialog: jest.fn(),
    setSelectionError: jest.fn(),
    showProtectionAlert: jest.fn(),
  };

  const deps = {
    workbook,
    uiStore: {
      getState: () => uiState,
    },
    accessors: {
      selection: {
        getActiveCell: jest
          .fn()
          .mockReturnValue({ row: ranges[0]?.startRow ?? 0, col: ranges[0]?.startCol ?? 0 }),
        getRanges: jest.fn().mockReturnValue(ranges),
      },
    },
    getActiveSheetId: () => activeSheetId,
    getSelectedSheetIds: jest.fn().mockResolvedValue([activeSheetId]),
  } as unknown as ActionDependencies;

  return { deps, workbook, worksheet, uiState };
}

describe('merge operation action handlers', () => {
  const range: CellRange = { startRow: 0, startCol: 0, endRow: 1, endCol: 1 };

  it('wraps Merge & Center structural and format writes in one undo group', async () => {
    const { deps, workbook, worksheet } = createMockDeps([range]);

    const result = await MERGE_AND_CENTER(deps);

    expect(result.handled).toBe(true);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Merge A1:B2 and center');
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.structure.unmerge).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(worksheet.structure.merge).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(worksheet.formats.set).toHaveBeenCalledWith(0, 0, {
      horizontalAlign: 'center',
      verticalAlign: 'middle',
    });
  });

  it('wraps Merge Cells structural writes in one undo group', async () => {
    const { deps, workbook, worksheet } = createMockDeps([range]);

    const result = await MERGE_CELLS(deps);

    expect(result.handled).toBe(true);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Merge A1:B2');
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.structure.unmerge).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(worksheet.structure.merge).toHaveBeenCalledWith(0, 0, 1, 1);
  });

  it('wraps Merge Across row merges in one undo group', async () => {
    const { deps, workbook, worksheet } = createMockDeps([
      { startRow: 0, startCol: 0, endRow: 2, endCol: 1 },
    ]);

    const result = await MERGE_ACROSS(deps);

    expect(result.handled).toBe(true);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Merge across A1:B3');
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.structure.merge).toHaveBeenCalledTimes(3);
    expect(worksheet.structure.merge).toHaveBeenNthCalledWith(1, 0, 0, 0, 1);
    expect(worksheet.structure.merge).toHaveBeenNthCalledWith(2, 1, 0, 1, 1);
    expect(worksheet.structure.merge).toHaveBeenNthCalledWith(3, 2, 0, 2, 1);
  });

  it('wraps multi-range Unmerge Cells writes in one undo group', async () => {
    const { deps, workbook, worksheet } = createMockDeps([
      { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
      { startRow: 3, startCol: 0, endRow: 3, endCol: 2 },
    ]);

    const result = await UNMERGE_CELLS(deps);

    expect(result.handled).toBe(true);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Unmerge A1:B2');
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.structure.unmerge).toHaveBeenCalledTimes(2);
    expect(worksheet.structure.unmerge).toHaveBeenNthCalledWith(1, 0, 0, 1, 1);
    expect(worksheet.structure.unmerge).toHaveBeenNthCalledWith(2, 3, 0, 3, 2);
  });

  it('wraps confirmed destructive Merge & Center writes in one undo group', async () => {
    const { deps, workbook, worksheet, uiState } = createMockDeps([range]);
    uiState.mergeWarningDialog = {
      isOpen: true,
      pendingRange: range,
      sheetId: activeSheetId,
      cellsWithData: [{ row: 0, col: 1 }],
      mergeType: 'mergeAndCenter',
    };

    const result = await CONFIRM_MERGE_WITH_DATA_LOSS(deps);

    expect(result.handled).toBe(true);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Merge A1:B2 and center');
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.structure.unmerge).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(worksheet.structure.merge).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(worksheet.formats.set).toHaveBeenCalledWith(0, 0, {
      horizontalAlign: 'center',
      verticalAlign: 'middle',
    });
    expect(uiState.closeMergeWarningDialog).toHaveBeenCalledTimes(1);
  });

  it('wraps confirmed destructive Merge Cells writes in one undo group', async () => {
    const { deps, workbook, worksheet, uiState } = createMockDeps([range]);
    uiState.mergeWarningDialog = {
      isOpen: true,
      pendingRange: range,
      sheetId: activeSheetId,
      cellsWithData: [{ row: 0, col: 1 }],
      mergeType: 'merge',
    };

    const result = await CONFIRM_MERGE_WITH_DATA_LOSS(deps);

    expect(result.handled).toBe(true);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Merge A1:B2');
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.structure.unmerge).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(worksheet.structure.merge).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(worksheet.formats.set).not.toHaveBeenCalled();
    expect(uiState.closeMergeWarningDialog).toHaveBeenCalledTimes(1);
  });

  it('accepts captured merge warning payload after the dialog state has closed', async () => {
    const { deps, workbook, worksheet, uiState } = createMockDeps([range]);

    const result = await CONFIRM_MERGE_WITH_DATA_LOSS(deps, {
      pendingRange: range,
      sheetId: activeSheetId,
      mergeType: 'mergeAndCenter',
    });

    expect(result.handled).toBe(true);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Merge A1:B2 and center');
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.structure.merge).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(worksheet.formats.set).toHaveBeenCalledWith(0, 0, {
      horizontalAlign: 'center',
      verticalAlign: 'middle',
    });
    expect(uiState.closeMergeWarningDialog).toHaveBeenCalledTimes(1);
  });

  it('routes SET_HORIZONTAL_ALIGN centerContinuous through bounded center-across formatting', async () => {
    const { deps, workbook, worksheet } = createMockDeps([
      { startRow: 0, startCol: 0, endRow: 0, endCol: 3 },
    ]);

    const result = await SET_HORIZONTAL_ALIGN(deps, { align: 'centerContinuous' });

    expect(result.handled).toBe(true);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Center Across Selection');
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.formats.setRanges).toHaveBeenCalledWith(
      [{ startRow: 0, startCol: 0, endRow: 0, endCol: 3 }],
      { horizontalAlign: 'centerContinuous' },
    );
    expect(worksheet.structure.merge).not.toHaveBeenCalled();
  });

  it('rejects center-across over an existing merge without mutating formats', async () => {
    const { deps, workbook, worksheet, uiState } = createMockDeps([
      { startRow: 0, startCol: 0, endRow: 0, endCol: 3 },
    ]);
    worksheet.structure.getMergedRegions.mockResolvedValue([
      { range: 'B1:C1', startRow: 0, startCol: 1, endRow: 0, endCol: 2, rowSpan: 1, colSpan: 2 },
    ]);

    const result = await SET_HORIZONTAL_ALIGN(deps, { align: 'centerContinuous' });

    expect(result.handled).toBe(true);
    expect(result.error).toContain('merged cells');
    expect(worksheet.formats.setRanges).not.toHaveBeenCalled();
    expect(workbook.undoGroup).not.toHaveBeenCalled();
    expect(uiState.setSelectionError).toHaveBeenCalledWith('merge_conflict', expect.any(String));
  });

  it('rejects center-across whole-row selections before generic row-format writes', async () => {
    const { deps, workbook, worksheet, uiState } = createMockDeps([
      { startRow: 0, startCol: 0, endRow: 0, endCol: 16383, isFullRow: true },
    ]);

    const result = await SET_HORIZONTAL_ALIGN(deps, { align: 'centerContinuous' });

    expect(result.handled).toBe(false);
    expect(worksheet.formats.setRanges).not.toHaveBeenCalled();
    expect(workbook.undoGroup).not.toHaveBeenCalled();
    expect(uiState.setSelectionError).toHaveBeenCalledWith('invalid_range', expect.any(String));
  });
});
