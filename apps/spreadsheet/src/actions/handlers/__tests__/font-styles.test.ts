import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';

import { SET_FONT_SIZE } from '../formatting/font-styles';

const activeSheetId = 'sheet1' as SheetId;

function createMockDeps(ranges: CellRange[]) {
  const calls: string[] = [];

  const worksheet = {
    formats: {
      setRanges: jest.fn(async () => {
        calls.push('setRanges');
      }),
    },
    layout: {
      autoFitRows: jest.fn(async () => {
        calls.push('autoFitRows');
      }),
    },
  };

  const workbook = {
    activeSheet: worksheet,
    getSheetById: jest.fn().mockReturnValue(worksheet),
    undoGroup: jest.fn(async (fn: () => Promise<unknown>) => {
      calls.push('undoGroup:start');
      await fn();
      calls.push('undoGroup:end');
    }),
  };

  const deps = {
    workbook,
    accessors: {
      selection: {
        getActiveCell: jest
          .fn()
          .mockReturnValue({ row: ranges[0]?.startRow ?? 0, col: ranges[0]?.startCol ?? 0 }),
        getRanges: jest.fn().mockReturnValue(ranges),
      },
      editor: {
        isRichTextEditing: jest.fn().mockReturnValue(false),
      },
    },
    getActiveSheetId: () => activeSheetId,
  } as unknown as ActionDependencies;

  return { deps, workbook, worksheet, calls };
}

describe('font style formatting actions', () => {
  it('applies SET_FONT_SIZE and row auto-fit in one undo group', async () => {
    const range: CellRange = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
    const { deps, workbook, worksheet, calls } = createMockDeps([range]);

    const result = await SET_FONT_SIZE(deps, { size: 24 });

    expect(result.handled).toBe(true);
    expect(workbook.undoGroup).toHaveBeenCalledTimes(1);
    expect(worksheet.formats.setRanges).toHaveBeenCalledWith([range], { fontSize: 24 });
    expect(worksheet.layout.autoFitRows).toHaveBeenCalledWith([0]);
    expect(calls).toEqual(['undoGroup:start', 'setRanges', 'autoFitRows', 'undoGroup:end']);
  });
});
