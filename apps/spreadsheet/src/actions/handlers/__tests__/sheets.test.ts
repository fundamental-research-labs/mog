import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import { COPY_SHEET_TO_POSITION } from '../sheets';

function createMockDeps(options?: { copyRejects?: boolean }): {
  deps: ActionDependencies;
  copySheet: jest.Mock;
  clearPendingCopySheet: jest.Mock;
  setSelection: jest.Mock;
} {
  const activeCell = { row: 0, col: 2 };
  const copySheet = options?.copyRejects
    ? jest.fn().mockRejectedValue(new Error('copy failed'))
    : jest.fn().mockResolvedValue({ getSheetId: () => 'sheet2-copy' });
  const clearPendingCopySheet = jest.fn();
  const setSelection = jest.fn();

  const deps = {
    workbook: {
      getSheetCount: jest.fn().mockResolvedValue(3),
      getSheetByIndex: jest
        .fn()
        .mockResolvedValueOnce({ getSheetId: () => 'sheet1' })
        .mockResolvedValueOnce({ getSheetId: () => 'sheet2' })
        .mockResolvedValueOnce({ getSheetId: () => 'sheet3' }),
      sheets: {
        copy: copySheet,
      },
    },
    accessors: {
      selection: {
        getActiveCell: jest.fn().mockReturnValue(activeCell),
      },
    },
    commands: {
      selection: {
        setSelection,
      },
    },
    uiStore: {
      getState: () => ({
        pendingCopySheet: {
          sourceSheetId: 'sheet2',
          beforeSheetId: 'sheet3',
          newName: 'Sheet2 (2)',
        },
        clearPendingCopySheet,
      }),
    },
  } as unknown as ActionDependencies;

  return { deps, copySheet, clearPendingCopySheet, setSelection };
}

describe('COPY_SHEET_TO_POSITION', () => {
  it('restores the source active cell on the copied sheet after a successful copy', async () => {
    const { deps, copySheet, clearPendingCopySheet, setSelection } = createMockDeps();

    const result = await COPY_SHEET_TO_POSITION(deps);

    expect(result.handled).toBe(true);
    expect(copySheet).toHaveBeenCalledWith('sheet2', 'Sheet2 (2)', 2);
    expect(setSelection).toHaveBeenCalledWith(
      [{ startRow: 0, startCol: 2, endRow: 0, endCol: 2 }],
      { row: 0, col: 2 },
      { row: 0, col: 2 },
      null,
      null,
      'restore',
    );
    expect(clearPendingCopySheet).toHaveBeenCalledTimes(1);
  });

  it('does not restore selection when the copy fails', async () => {
    const { deps, clearPendingCopySheet, setSelection } = createMockDeps({ copyRejects: true });

    const result = await COPY_SHEET_TO_POSITION(deps);

    expect(result.handled).toBe(true);
    expect(setSelection).not.toHaveBeenCalled();
    expect(clearPendingCopySheet).toHaveBeenCalledTimes(1);
  });
});
