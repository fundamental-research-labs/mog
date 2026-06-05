import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { REAPPLY_FILTERS } from '../filter';

function createDeps(filters: Record<string, unknown>): ActionDependencies {
  return {
    workbook: {
      getSheetById: jest.fn(() => ({ filters })),
    },
    getActiveSheetId: () => 'sheet1' as any,
  } as unknown as ActionDependencies;
}

describe('filter action readiness', () => {
  test('REAPPLY_FILTERS uses summaries for imported AutoFilter shells', async () => {
    const filters = {
      list: jest.fn(),
      listSummaries: jest.fn(async () => [
        {
          id: 'filter-1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
          activeColumnCount: 0,
          hasActiveCriteria: true,
          hasActiveFilter: true,
          clearable: true,
          detailsReady: true,
          capability: 'unsupported',
          unsupportedReasons: ['iconFilterUnsupported'],
        },
      ]),
      reapply: jest.fn(async () => undefined),
      getInfo: jest.fn(),
      applyAdvanced: jest.fn(),
    };

    const result = await REAPPLY_FILTERS(createDeps(filters));

    expect(result.handled).toBe(true);
    expect(filters.listSummaries).toHaveBeenCalledTimes(1);
    expect(filters.list).not.toHaveBeenCalled();
    expect(filters.reapply).toHaveBeenCalledWith('filter-1');
    expect(filters.getInfo).not.toHaveBeenCalled();
  });

  test('REAPPLY_FILTERS fetches details only for active advanced filters', async () => {
    const filters = {
      list: jest.fn(),
      listSummaries: jest.fn(async () => [
        {
          id: 'advanced-1',
          filterKind: 'advancedFilter',
          range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
          activeColumnCount: 0,
          hasActiveCriteria: true,
        },
      ]),
      reapply: jest.fn(),
      getInfo: jest.fn(async () => ({
        id: 'advanced-1',
        filterKind: 'advancedFilter',
        range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
        columnFilters: {},
        advancedFilter: {
          criteriaRange: { startRow: 0, startCol: 4, endRow: 1, endCol: 5 },
          uniqueRecordsOnly: true,
          active: true,
        },
      })),
      applyAdvanced: jest.fn(async () => undefined),
    };

    const result = await REAPPLY_FILTERS(createDeps(filters));

    expect(result.handled).toBe(true);
    expect(filters.list).not.toHaveBeenCalled();
    expect(filters.listSummaries).toHaveBeenCalledTimes(1);
    expect(filters.getInfo).toHaveBeenCalledWith('advanced-1');
    expect(filters.reapply).not.toHaveBeenCalled();
    expect(filters.applyAdvanced).toHaveBeenCalledWith({
      listRange: 'A1:C11',
      criteriaRange: 'E1:F2',
      mode: 'inPlace',
      uniqueRecordsOnly: true,
      filterId: 'advanced-1',
    });
  });
});
