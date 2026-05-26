/**
 * useSheetSelection Hook Tests
 *
 * Verifies that multi-sheet selection state is read correctly from
 * workbook settings and that stale activeSheetId is never merged in.
 *
 * @see hooks/selection/use-sheet-selection.ts
 */

import { jest } from '@jest/globals';

import { act, renderHook, waitFor } from '@testing-library/react';

// =============================================================================
// Mocks
// =============================================================================

const mockGetSelectedSheetIds = jest.fn();
const mockGetSheetIds = jest.fn();
const mockSetSelectedIds = jest.fn();
const mockOn = jest.fn().mockReturnValue(jest.fn());
const mockWorkbook = {
  mirror: {
    getSelectedSheetIds: mockGetSelectedSheetIds,
    getSheetIds: mockGetSheetIds,
  },
  sheets: {
    setSelectedIds: mockSetSelectedIds,
  },
  on: mockOn,
};

jest.unstable_mockModule('../../../infra/context', () => ({
  useWorkbook: () => mockWorkbook,
  useActiveSheetId: () => 'A',
}));

const { useSheetSelection } = await import('../use-sheet-selection');

// =============================================================================
// Tests
// =============================================================================

describe('useSheetSelection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSelectedSheetIds.mockReturnValue([]);
    mockGetSheetIds.mockReturnValue(['A', 'B', 'C']);
    mockSetSelectedIds.mockResolvedValue(undefined);
  });

  it('should not include stale activeSheetId when stored selection differs', async () => {
    // Stored selection is ["B"], but activeSheetId is "A"
    // Before the fix, this would return ["A", "B"] — the race condition bug
    mockGetSelectedSheetIds.mockReturnValue(['B']);

    const { result } = renderHook(() => useSheetSelection());

    await waitFor(() => {
      expect(result.current.selectedSheetIds).toEqual(['B']);
    });
    expect(result.current.hasMultipleSelection).toBe(false);
  });

  it('should default to activeSheetId when no selection is stored', async () => {
    mockGetSelectedSheetIds.mockReturnValue([]);

    const { result } = renderHook(() => useSheetSelection());

    await waitFor(() => {
      expect(result.current.selectedSheetIds).toEqual(['A']);
    });
  });

  it('should default to activeSheetId when selectedSheetIds is undefined', async () => {
    mockGetSelectedSheetIds.mockReturnValue(undefined);

    const { result } = renderHook(() => useSheetSelection());

    await waitFor(() => {
      expect(result.current.selectedSheetIds).toEqual(['A']);
    });
  });

  it('should return stored selection as-is when it includes activeSheetId', async () => {
    mockGetSelectedSheetIds.mockReturnValue(['A', 'B', 'C']);

    const { result } = renderHook(() => useSheetSelection());

    await waitFor(() => {
      expect(result.current.selectedSheetIds).toEqual(['A', 'B', 'C']);
    });
    expect(result.current.hasMultipleSelection).toBe(true);
  });

  it('selectSheet writes through the sheet selection API', async () => {
    mockGetSelectedSheetIds.mockReturnValue(['A']);

    const { result } = renderHook(() => useSheetSelection());

    await waitFor(() => {
      expect(result.current.selectedSheetIds).toEqual(['A']);
    });

    act(() => {
      result.current.selectSheet('B');
    });

    expect(mockSetSelectedIds).toHaveBeenCalledWith(['B']);
  });

  it('should re-fetch when workbook:settings-changed fires', async () => {
    mockGetSelectedSheetIds.mockReturnValue(['A']);

    renderHook(() => useSheetSelection());

    // Verify it subscribed to the event
    expect(mockOn).toHaveBeenCalledWith('workbook:settings-changed', expect.any(Function));

    // Simulate a settings change
    const settingsChangedCallback = mockOn.mock.calls[0][1];
    mockGetSelectedSheetIds.mockReturnValue(['B', 'C']);

    await act(async () => {
      settingsChangedCallback();
    });
  });
});
