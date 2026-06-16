import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { APPLY_ADVANCED_FILTER, CLEAR_ALL_FILTERS, REAPPLY_FILTERS } from '../filter';

function createDeps(filters: Record<string, unknown>): ActionDependencies {
  return {
    workbook: {
      getSheetById: jest.fn(() => ({ filters })),
    },
    getActiveSheetId: () => 'sheet1' as any,
  } as unknown as ActionDependencies;
}

describe('filter action readiness', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

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

  test('CLEAR_ALL_FILTERS clears active advanced filters from summaries', async () => {
    const filters = {
      listSummaries: jest.fn(async () => [
        {
          id: 'advanced-1',
          filterKind: 'advancedFilter',
          range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
          activeColumnCount: 0,
          hasActiveCriteria: true,
          hasActiveFilter: true,
        },
      ]),
      clearAllCriteria: jest.fn(async () => undefined),
    };

    const result = await CLEAR_ALL_FILTERS(createDeps(filters));

    expect(result.handled).toBe(true);
    expect(filters.listSummaries).toHaveBeenCalledTimes(1);
    expect(filters.clearAllCriteria).toHaveBeenCalledWith('advanced-1');
  });

  test('CLEAR_ALL_FILTERS returns unsupported receipt diagnostics instead of ignoring them', async () => {
    const unsupportedReceipt = {
      kind: 'filter.clearAllCriteria',
      status: 'unsupported',
      effects: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'unsupported_filter_clear',
          message: 'Imported icon filters cannot be cleared.',
        },
      ],
    };
    const filters = {
      listSummaries: jest.fn(async () => [
        {
          id: 'filter-1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
          activeColumnCount: 1,
          hasActiveFilter: true,
          clearable: true,
        },
      ]),
      clearAllCriteria: jest.fn(async () => unsupportedReceipt),
    };

    const result = await CLEAR_ALL_FILTERS(createDeps(filters));

    expect(result.handled).toBe(true);
    expect(result.error).toBe('Imported icon filters cannot be cleared.');
    expect(result.receipts).toEqual([unsupportedReceipt]);
    expect(filters.clearAllCriteria).toHaveBeenCalledWith('filter-1');
  });

  test('REAPPLY_FILTERS returns failed receipt diagnostics instead of treating reapply as success', async () => {
    const failedReceipt = {
      kind: 'filter.reapply',
      status: 'failed',
      effects: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'filter_reapply_failed',
          message: 'Filter criteria could not be evaluated.',
        },
      ],
    };
    const filters = {
      listSummaries: jest.fn(async () => [
        {
          id: 'filter-1',
          filterKind: 'autoFilter',
          range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
          activeColumnCount: 1,
          hasActiveFilter: true,
        },
      ]),
      reapply: jest.fn(async () => failedReceipt),
      getInfo: jest.fn(),
      applyAdvanced: jest.fn(),
    };

    const result = await REAPPLY_FILTERS(createDeps(filters));

    expect(result.handled).toBe(true);
    expect(result.error).toBe('Filter criteria could not be evaluated.');
    expect(result.receipts).toEqual([failedReceipt]);
    expect(filters.reapply).toHaveBeenCalledWith('filter-1');
    expect(filters.getInfo).not.toHaveBeenCalled();
  });

  test('APPLY_ADVANCED_FILTER keeps dialog open and surfaces failed receipt diagnostics', async () => {
    const failedReceipt = {
      kind: 'filter.applyAdvanced',
      status: 'failed',
      effects: [],
      diagnostics: [
        {
          severity: 'error',
          code: 'advanced_filter_failed',
          message: 'Advanced Filter criteria are invalid.',
        },
      ],
    };
    const applyAdvanced = jest.fn(async () => failedReceipt);
    const setAdvancedFilterError = jest.fn();
    const closeAdvancedFilterDialog = jest.fn();
    const deps = {
      workbook: {
        getSheetById: jest.fn(() => ({ filters: { applyAdvanced } })),
      },
      getActiveSheetId: () => 'sheet1' as any,
      uiStore: {
        getState: () => ({
          advancedFilterDialog: {
            listRange: 'A1:C10',
            criteriaRange: 'E1:F2',
            filterInPlace: true,
            copyToRange: '',
            uniqueRecordsOnly: false,
          },
          setAdvancedFilterError,
          closeAdvancedFilterDialog,
        }),
      },
    } as unknown as ActionDependencies;

    const result = await APPLY_ADVANCED_FILTER(deps);

    expect(result.handled).toBe(true);
    expect(result.error).toBe('Advanced Filter criteria are invalid.');
    expect(result.receipts).toEqual([failedReceipt]);
    expect(setAdvancedFilterError).toHaveBeenCalledWith('Advanced Filter criteria are invalid.');
    expect(closeAdvancedFilterDialog).not.toHaveBeenCalled();
  });
});
