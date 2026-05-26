import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { MAX_COLS, MAX_ROWS, type CellRange, type SheetId } from '@mog-sdk/contracts/core';

import { APPLY_ALIGNMENT_FORMAT, SET_HORIZONTAL_ALIGN } from '../formatting/cell-format-dialogs';

const activeSheetId = 'sheet1' as SheetId;

function createMockDeps(ranges: CellRange[]) {
  const worksheet = {
    viewport: {
      getMerges: jest.fn().mockReturnValue([]),
    },
    structure: {
      getMergedRegions: jest.fn().mockResolvedValue([]),
    },
    protection: {
      canDoStructureOp: jest.fn().mockResolvedValue(true),
    },
    formats: {
      setRanges: jest.fn().mockResolvedValue(undefined),
    },
  };

  const workbook = {
    getSheetById: jest.fn().mockReturnValue(worksheet),
    setPendingUndoDescription: jest.fn(),
    undoGroup: jest.fn(async (fn: () => Promise<unknown>) => fn()),
  };

  const uiState = {
    pendingAlignmentFormat: null as Partial<import('@mog-sdk/contracts/core').CellFormat> | null,
    clearPendingAlignmentFormat: jest.fn(() => {
      uiState.pendingAlignmentFormat = null;
    }),
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
  } as unknown as ActionDependencies;

  return { deps, workbook, worksheet, uiState };
}

describe('Center Across Selection formatting actions', () => {
  it('routes SET_HORIZONTAL_ALIGN centerContinuous through one undoable bounded format mutation', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 3 };
    const { deps, workbook, worksheet } = createMockDeps([range]);

    const result = await SET_HORIZONTAL_ALIGN(deps, { align: 'centerContinuous' });

    expect(result.handled).toBe(true);
    expect(worksheet.protection.canDoStructureOp).toHaveBeenCalledWith('formatCells');
    expect(worksheet.structure.getMergedRegions).toHaveBeenCalledTimes(1);
    expect(workbook.setPendingUndoDescription).toHaveBeenCalledWith('Center Across Selection');
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.formats.setRanges).toHaveBeenCalledWith([range], {
      horizontalAlign: 'centerContinuous',
    });
  });

  it('normalizes reversed and multi-range selections before applying', async () => {
    const { deps, worksheet } = createMockDeps([
      { startRow: 2, startCol: 3, endRow: 1, endCol: 1 },
      { startRow: 5, startCol: 4, endRow: 5, endCol: 2 },
    ]);

    await SET_HORIZONTAL_ALIGN(deps, { align: 'centerContinuous' });

    expect(worksheet.formats.setRanges).toHaveBeenCalledWith(
      [
        { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
        { startRow: 5, startCol: 2, endRow: 5, endCol: 4 },
      ],
      { horizontalAlign: 'centerContinuous' },
    );
  });

  it('rejects whole-row and whole-column selections without writing row or column formats', async () => {
    const fullRow = createMockDeps([
      { startRow: 2, startCol: 0, endRow: 2, endCol: MAX_COLS - 1, isFullRow: true },
    ]);
    const fullRowResult = await SET_HORIZONTAL_ALIGN(fullRow.deps, { align: 'centerContinuous' });

    expect(fullRowResult.handled).toBe(false);
    expect(fullRow.worksheet.formats.setRanges).not.toHaveBeenCalled();

    const fullColumn = createMockDeps([
      { startRow: 0, startCol: 1, endRow: MAX_ROWS - 1, endCol: 1, isFullColumn: true },
    ]);
    const fullColumnResult = await SET_HORIZONTAL_ALIGN(fullColumn.deps, {
      align: 'centerContinuous',
    });

    expect(fullColumnResult.handled).toBe(false);
    expect(fullColumn.worksheet.formats.setRanges).not.toHaveBeenCalled();
  });

  it('rejects merge intersections before mutating', async () => {
    const { deps, worksheet, workbook, uiState } = createMockDeps([
      { startRow: 0, startCol: 0, endRow: 0, endCol: 3 },
    ]);
    worksheet.structure.getMergedRegions.mockResolvedValue([
      { range: 'B1:C1', startRow: 0, startCol: 1, endRow: 0, endCol: 2, rowSpan: 1, colSpan: 2 },
    ]);

    const result = await SET_HORIZONTAL_ALIGN(deps, { align: 'centerContinuous' });

    expect(result.handled).toBe(true);
    expect(result.error).toContain('merged cells');
    expect(workbook.undoGroup).not.toHaveBeenCalled();
    expect(worksheet.formats.setRanges).not.toHaveBeenCalled();
    expect(uiState.setSelectionError).toHaveBeenCalledWith('merge_conflict', expect.any(String));
  });

  it('rejects protected sheets where formatCells is denied', async () => {
    const { deps, worksheet, workbook, uiState } = createMockDeps([
      { startRow: 0, startCol: 0, endRow: 0, endCol: 3 },
    ]);
    worksheet.protection.canDoStructureOp.mockResolvedValue(false);

    const result = await SET_HORIZONTAL_ALIGN(deps, { align: 'centerContinuous' });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
    expect(workbook.undoGroup).not.toHaveBeenCalled();
    expect(worksheet.formats.setRanges).not.toHaveBeenCalled();
    expect(uiState.setSelectionError).toHaveBeenCalledWith('protection', expect.any(String));
  });

  it('keeps generic horizontal alignment on the existing path', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 3 };
    const { deps, workbook, worksheet } = createMockDeps([range]);

    const result = await SET_HORIZONTAL_ALIGN(deps, { align: 'center' });

    expect(result.handled).toBe(true);
    expect(workbook.undoGroup).not.toHaveBeenCalled();
    expect(worksheet.structure.getMergedRegions).not.toHaveBeenCalled();
    expect(worksheet.formats.setRanges).toHaveBeenCalledWith([range], {
      horizontalAlign: 'center',
    });
  });

  it('Format Cells uses the shared helper and preserves the draft on center-across conflict', async () => {
    const { deps, worksheet, uiState } = createMockDeps([
      { startRow: 0, startCol: 0, endRow: 0, endCol: 3 },
    ]);
    uiState.pendingAlignmentFormat = {
      horizontalAlign: 'centerContinuous',
      wrapText: true,
    };
    worksheet.structure.getMergedRegions.mockResolvedValue([
      { range: 'B1:C1', startRow: 0, startCol: 1, endRow: 0, endCol: 2, rowSpan: 1, colSpan: 2 },
    ]);

    const result = await APPLY_ALIGNMENT_FORMAT(deps);

    expect(result.handled).toBe(true);
    expect(result.error).toContain('merged cells');
    expect(uiState.pendingAlignmentFormat).toEqual({
      horizontalAlign: 'centerContinuous',
      wrapText: true,
    });
    expect(uiState.clearPendingAlignmentFormat).not.toHaveBeenCalled();
    expect(worksheet.formats.setRanges).not.toHaveBeenCalled();
  });
});
