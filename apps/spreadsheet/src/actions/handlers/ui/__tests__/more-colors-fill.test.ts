import { describe, expect, jest, test } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';

import { APPLY_MORE_COLORS_FILL } from '../dialog-handlers';

function createDeps(ranges: CellRange[]) {
  const setRanges = jest.fn(async () => undefined);
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
    getActiveSheetId: () => 'sheet1' as never,
  } as unknown as ActionDependencies;

  return { deps, setRanges };
}

describe('APPLY_MORE_COLORS_FILL', () => {
  test('applies More Colors fill as an explicit solid fill', async () => {
    localStorage.clear();
    const range: CellRange = { startRow: 4, startCol: 2, endRow: 6, endCol: 5 };
    const { deps, setRanges } = createDeps([range]);

    const result = await APPLY_MORE_COLORS_FILL(deps, { color: '#fff2cc' });

    expect(result).toEqual({ handled: true });
    expect(setRanges).toHaveBeenCalledWith([range], {
      backgroundColor: '#fff2cc',
      patternType: 'solid',
    });
    expect(JSON.parse(localStorage.getItem('spreadsheet:recentFillColors') ?? '[]')).toEqual([
      '#FFF2CC',
    ]);
  });

  test('returns disabled when no selection range is available', async () => {
    const { deps, setRanges } = createDeps([]);

    const result = await APPLY_MORE_COLORS_FILL(deps, { color: '#fff2cc' });

    expect(result).toEqual({ handled: false, reason: 'disabled' });
    expect(setRanges).not.toHaveBeenCalled();
  });
});
