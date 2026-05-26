import { jest } from '@jest/globals';

import { act, renderHook } from '@testing-library/react';

// =============================================================================
// Mocks
// =============================================================================

let mockSettings = { isWorkbookProtected: false } as Record<string, unknown>;
const mockOn = jest.fn().mockReturnValue(jest.fn());

jest.unstable_mockModule('../../../infra/context', () => ({
  useWorkbook: () => ({
    mirror: {
      getWorkbookSettings: () => mockSettings,
    },
    on: mockOn,
  }),
}));

const { useWorkbookStructureProtection } = await import('../use-workbook-protection');

// =============================================================================
// Tests
// =============================================================================

describe('useWorkbookStructureProtection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettings = { isWorkbookProtected: false };
    mockOn.mockReturnValue(jest.fn());
  });

  it('returns false when isWorkbookProtected is false', () => {
    mockSettings = { isWorkbookProtected: false };
    const { result } = renderHook(() => useWorkbookStructureProtection());
    expect(result.current).toBe(false);
  });

  it('returns true when isWorkbookProtected is true and structure is not explicitly false', () => {
    mockSettings = { isWorkbookProtected: true };
    const { result } = renderHook(() => useWorkbookStructureProtection());
    expect(result.current).toBe(true);
  });

  it('returns true when isWorkbookProtected is true and structure is explicitly true', () => {
    mockSettings = {
      isWorkbookProtected: true,
      workbookProtectionOptions: { structure: true },
    };
    const { result } = renderHook(() => useWorkbookStructureProtection());
    expect(result.current).toBe(true);
  });

  it('returns false when isWorkbookProtected is true but structure is explicitly false', () => {
    mockSettings = {
      isWorkbookProtected: true,
      workbookProtectionOptions: { structure: false },
    };
    const { result } = renderHook(() => useWorkbookStructureProtection());
    expect(result.current).toBe(false);
  });

  it('re-renders when workbook:settings-changed fires for isWorkbookProtected', () => {
    mockSettings = { isWorkbookProtected: false };

    let settingsChangedHandler: ((event: any) => void) | undefined;
    mockOn.mockImplementation((eventType: string, handler: (event: any) => void) => {
      if (eventType === 'workbook:settings-changed') {
        settingsChangedHandler = handler;
      }
      return jest.fn();
    });

    const { result } = renderHook(() => useWorkbookStructureProtection());
    expect(result.current).toBe(false);

    act(() => {
      settingsChangedHandler!({
        type: 'workbook:settings-changed',
        changedKey: 'isWorkbookProtected',
        settings: {
          isWorkbookProtected: true,
          workbookProtectionOptions: { structure: true },
        },
      });
    });

    expect(result.current).toBe(true);
  });

  it('re-renders when workbook:settings-changed fires for workbookProtectionOptions', () => {
    mockSettings = {
      isWorkbookProtected: true,
      workbookProtectionOptions: { structure: true },
    };

    let settingsChangedHandler: ((event: any) => void) | undefined;
    mockOn.mockImplementation((eventType: string, handler: (event: any) => void) => {
      if (eventType === 'workbook:settings-changed') {
        settingsChangedHandler = handler;
      }
      return jest.fn();
    });

    const { result } = renderHook(() => useWorkbookStructureProtection());
    expect(result.current).toBe(true);

    act(() => {
      settingsChangedHandler!({
        type: 'workbook:settings-changed',
        changedKey: 'workbookProtectionOptions',
        settings: {
          isWorkbookProtected: true,
          workbookProtectionOptions: { structure: false },
        },
      });
    });

    expect(result.current).toBe(false);
  });

  it('ignores workbook:settings-changed events for unrelated keys', () => {
    mockSettings = { isWorkbookProtected: false };

    let settingsChangedHandler: ((event: any) => void) | undefined;
    mockOn.mockImplementation((eventType: string, handler: (event: any) => void) => {
      if (eventType === 'workbook:settings-changed') {
        settingsChangedHandler = handler;
      }
      return jest.fn();
    });

    const { result } = renderHook(() => useWorkbookStructureProtection());
    expect(result.current).toBe(false);

    act(() => {
      settingsChangedHandler!({
        type: 'workbook:settings-changed',
        changedKey: 'showTabStrip',
        settings: {
          isWorkbookProtected: true,
          showTabStrip: false,
        },
      });
    });

    expect(result.current).toBe(false);
  });
});
