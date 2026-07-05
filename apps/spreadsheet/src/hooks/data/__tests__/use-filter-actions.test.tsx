import { jest } from '@jest/globals';

import { renderHook, waitFor } from '@testing-library/react';

const mockListSummaries = jest.fn();
const mockOn = jest.fn();

jest.unstable_mockModule('../../../infra/context', () => ({
  useActiveSheetId: () => 'sheet-1',
  useWorkbook: () => ({
    getSheetById: () => ({
      filters: {
        listSummaries: mockListSummaries,
      },
      on: mockOn,
    }),
  }),
}));

const { useFilterActions } = await import('../use-filter-actions');

describe('useFilterActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOn.mockReturnValue(jest.fn());
    mockListSummaries.mockResolvedValue([
      {
        id: 'filter-1',
        filterKind: 'autoFilter',
        range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
        activeColumnCount: 2,
        hasActiveFilter: true,
        clearable: true,
      },
    ]);
  });

  it('uses available summaries for passive toolbar readiness', async () => {
    const { result } = renderHook(() => useFilterActions());

    await waitFor(() => {
      expect(result.current.canClearFilters).toBe(true);
    });

    expect(mockListSummaries).toHaveBeenCalledWith({ scope: 'available' });
    expect(result.current.canReapplyFilters).toBe(true);
    expect(result.current.activeFilterCount).toBe(2);
  });

  it('disables Clear while keeping Reapply available when filters exist without active criteria', async () => {
    mockListSummaries.mockResolvedValue([
      {
        id: 'filter-1',
        filterKind: 'autoFilter',
        range: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
        activeColumnCount: 0,
        hasActiveFilter: false,
        clearable: false,
      },
    ]);

    const { result } = renderHook(() => useFilterActions());

    await waitFor(() => {
      expect(result.current.canReapplyFilters).toBe(true);
    });

    expect(result.current.canClearFilters).toBe(false);
    expect(result.current.canReapplyFilters).toBe(true);
    expect(result.current.activeFilterCount).toBe(0);
  });
});
