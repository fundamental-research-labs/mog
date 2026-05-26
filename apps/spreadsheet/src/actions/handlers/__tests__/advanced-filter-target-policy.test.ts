import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { OPEN_ADVANCED_FILTER_DIALOG } from '../filter';

describe('OPEN_ADVANCED_FILTER_DIALOG target policy', () => {
  test('uses data-bounded selection ranges, not current-region table resolution', () => {
    const openAdvancedFilterDialog = jest.fn();
    const getDataBoundedRanges = jest.fn().mockReturnValue([
      {
        startRow: 0,
        startCol: 0,
        endRow: 9,
        endCol: 2,
      },
    ]);
    const getCurrentRegion = jest.fn();

    const deps = {
      workbook: {
        getSheetById: jest.fn().mockReturnValue({ getCurrentRegion }),
      },
      uiStore: {
        getState: () => ({ openAdvancedFilterDialog }),
      },
      accessors: {
        selection: {
          getDataBoundedRanges,
        },
      },
      getActiveSheetId: () => 'sheet1' as any,
    } as unknown as ActionDependencies;

    const result = OPEN_ADVANCED_FILTER_DIALOG(deps);

    expect(result.handled).toBe(true);
    expect(getDataBoundedRanges).toHaveBeenCalledWith('sheet1');
    expect(getCurrentRegion).not.toHaveBeenCalled();
    expect(openAdvancedFilterDialog).toHaveBeenCalledWith('A1:C10');
  });
});
