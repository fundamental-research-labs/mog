import { describe, expect, jest, test } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';

import { APPLY_FILL_FORMAT } from '../formatting/cell-format-dialogs';

function createDeps(ranges: CellRange[], pendingFillFormat: Record<string, unknown> | null) {
  const setRanges = jest.fn(async () => undefined);
  const clearPendingFillFormat = jest.fn();
  const worksheet = {
    formats: {
      setRanges,
    },
  };

  const deps = {
    workbook: {
      getSheetById: jest.fn(() => worksheet),
    },
    accessors: {
      selection: {
        getActiveCell: () => ({ row: ranges[0]?.startRow ?? 0, col: ranges[0]?.startCol ?? 0 }),
        getRanges: () => ranges,
      },
    },
    uiStore: {
      getState: () => ({
        pendingFillFormat,
        clearPendingFillFormat,
      }),
    },
    getActiveSheetId: () => 'sheet1' as never,
  } as unknown as ActionDependencies;

  return { deps, setRanges, clearPendingFillFormat };
}

describe('APPLY_FILL_FORMAT', () => {
  test('applies background-only dialog fills as explicit solid fills', async () => {
    const range: CellRange = { startRow: 2, startCol: 1, endRow: 4, endCol: 3 };
    const { deps, setRanges, clearPendingFillFormat } = createDeps([range], {
      backgroundColor: '#fde68a',
    });

    const result = await APPLY_FILL_FORMAT(deps);

    expect(result).toEqual({ handled: true });
    expect(setRanges).toHaveBeenCalledWith([range], {
      backgroundColor: '#fde68a',
      patternType: 'solid',
    });
    expect(clearPendingFillFormat).toHaveBeenCalledTimes(1);
  });

  test('preserves explicit pattern fills from the dialog', async () => {
    const range: CellRange = { startRow: 2, startCol: 1, endRow: 4, endCol: 3 };
    const { deps, setRanges } = createDeps([range], {
      backgroundColor: '#fde68a',
      patternType: 'darkGrid',
      patternForegroundColor: '#111111',
    });

    const result = await APPLY_FILL_FORMAT(deps);

    expect(result).toEqual({ handled: true });
    expect(setRanges).toHaveBeenCalledWith([range], {
      backgroundColor: '#fde68a',
      patternType: 'darkGrid',
      patternForegroundColor: '#111111',
    });
  });
});
