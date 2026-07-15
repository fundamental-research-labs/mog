import { jest } from '@jest/globals';

import {
  CLEAR_CONDITIONAL_FORMATTING,
  CLEAR_DATA_VALIDATION,
  CLEAR_HYPERLINKS,
} from '../formatting/clear-operations';

const RANGES = [
  { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
  { startRow: 3, startCol: 3, endRow: 3, endCol: 4 },
];

function createDeps() {
  const clear = jest.fn().mockResolvedValue(undefined as never);
  const clearInRanges = jest.fn().mockResolvedValue(undefined as never);
  const clearInRange = jest.fn().mockRejectedValue({ code: 'VALIDATION_NOT_FOUND' } as never);
  const worksheet = {
    clear,
    conditionalFormats: { clearInRanges },
    validations: { clearInRange },
  };
  const undoGroup = jest.fn(async (operation: () => Promise<void>) => operation());
  const deps = {
    getActiveSheetId: jest.fn().mockReturnValue('sheet-a'),
    workbook: {
      getSheetById: jest.fn().mockReturnValue(worksheet),
      undoGroup,
    },
    accessors: {
      selection: {
        getActiveCell: jest.fn().mockReturnValue({ row: 0, col: 0 }),
        getRanges: jest.fn().mockReturnValue(RANGES),
      },
    },
  } as any;
  return { deps, clear, clearInRanges, clearInRange, undoGroup };
}

describe('clear formatting actions', () => {
  test('clears hyperlinks with sparse range operations in one undo group', async () => {
    const { deps, clear, undoGroup } = createDeps();

    await expect(CLEAR_HYPERLINKS(deps)).resolves.toEqual({ handled: true });

    expect(undoGroup).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenNthCalledWith(1, RANGES[0], 'hyperlinks');
    expect(clear).toHaveBeenNthCalledWith(2, RANGES[1], 'hyperlinks');
  });

  test('clears conditional formats in one undo group', async () => {
    const { deps, clearInRanges, undoGroup } = createDeps();

    await expect(CLEAR_CONDITIONAL_FORMATTING(deps)).resolves.toEqual({ handled: true });

    expect(undoGroup).toHaveBeenCalledTimes(1);
    expect(clearInRanges).toHaveBeenCalledWith(RANGES);
  });

  test('treats missing validations as no-ops and groups all selected ranges', async () => {
    const { deps, clearInRange, undoGroup } = createDeps();

    await expect(CLEAR_DATA_VALIDATION(deps)).resolves.toEqual({ handled: true });

    expect(undoGroup).toHaveBeenCalledTimes(1);
    expect(clearInRange).toHaveBeenCalledTimes(2);
    expect(clearInRange).toHaveBeenNthCalledWith(1, RANGES[0]);
    expect(clearInRange).toHaveBeenNthCalledWith(2, RANGES[1]);
  });
});
